import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { apiWebhooks, creditEntries, paymentLinks, payments, webhookDeliveries } from "../src/db/schema";
import { sweepDirectPayments } from "../src/direct-payments/validation";
import { releaseQueuedForCredit } from "../src/credit/topups";
import { BACKOFF_MINUTES, sweepWebhookDeliveries } from "../src/webhooks/queue";
import { KEY_RETENTION_DAYS } from "../src/webhooks/sign";
import { WEBHOOK_EVENT_TYPES } from "../src/routes/v1/schema";
import { issueCredential } from "../src/api-clients/store";
import {
  collectingCtx,
  db,
  DESTINATION_URL,
  expectNoIspVocabulary,
  jwksOf,
  mockApiCep,
  mockDestination,
  payerPost,
  payerStatus,
  payerUploadProof,
  registerWebhook,
  seedApiBusiness,
  testEnv,
  TRANSFER,
  v1,
  verifyDelivery,
} from "./collections-api-helpers";

/* automated-collections-api US2 — the webhook tells the caller the
   transfer was validated (spec scenarios 1–8 and 10, FR-012 – FR-018,
   FR-026, FR-038 – FR-041, contracts/public-api.md). Every business here
   is a gym: a CLABE, a bank, a credential, an address, and NO integration
   row at all — so the seam of research D7 is proven to reach every
   verdict with `integration === null`. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const FEE = 1500;
const ASK = 49900;
const minutes = (n: number) => n * 60_000;
const inAnHour = () => Date.now() + 3_600_000;

/* A configured gym with an address registered and one reusable link */
async function arrange(overrides: Parameters<typeof seedApiBusiness>[0] = {}) {
  const { key, business } = await seedApiBusiness({ serviceFeeCents: FEE, ...overrides });
  const registered = await registerWebhook(key);
  expect(registered.status).toBe(200);
  const link = (await v1(key, "POST", "/payment-links", { customerRef: "CLI-4471", askCents: ASK, label: "Ana Ruiz" })).body.data!;
  return { key, business, link, token: String(link.url).split("/p/")[1] };
}

const deliveriesOf = (businessId: string) =>
  db().select().from(webhookDeliveries).where(eq(webhookDeliveries.businessId, businessId)).orderBy(asc(webhookDeliveries.createdAt), asc(webhookDeliveries.id));

const byType = (captured: { event: { type: string } }[]) => Object.fromEntries(captured.map((c) => [c.event.type, c]));

describe("scenarios 1, 2, 10: the accepted proof, then the verdict — signed, identified, complete", () => {
  it("through the transfer door: `payment.validating` at submission, `payment.confirmed` at the verdict, both verifiable against the published keys", async () => {
    const { business, token } = await arrange();
    const captured = mockDestination({ times: 2 });
    mockApiCep({ cep: { amountCents: ASK + FEE } });
    const { ctx, settled } = collectingCtx();
    const paid = await payerPost(token, TRANSFER("TRACK0004471", ASK + FEE), testEnv, ctx);
    expect(paid.status).toBe(201);
    expect(paid.body.data).toMatchObject({ status: "confirmed" });
    /* FR-017: the payer had their answer; the deliveries ran past it */
    await settled();
    expect(captured).toHaveLength(2);

    const { "payment.validating": first, "payment.confirmed": verdict } = byType(captured);
    const paymentId = String(paid.body.data!.directPaymentId);
    /* scenario 10 / FR-014: a claim, never money — and which door */
    expect(first.event.data).toEqual({
      paymentId,
      paymentLinkId: expect.stringMatching(/^lnk_/),
      customerRef: "CLI-4471",
      askedCents: ASK,
      claimedCents: ASK + FEE,
      proofDoor: "transfer",
      receivedCents: null,
      match: null,
      folio: null,
      confirmedAt: null,
      isTest: false,
    });
    /* scenario 1 / FR-014: the verdict's facts */
    expect(verdict.event.data).toMatchObject({
      paymentId,
      customerRef: "CLI-4471",
      askedCents: ASK,
      claimedCents: ASK + FEE,
      proofDoor: "transfer",
      receivedCents: ASK + FEE,
      match: "exact",
      isTest: false,
    });
    expect(verdict.event.data.folio).toMatch(/^DV-/);
    expect(verdict.event.data.confirmedAt).toEqual(expect.any(Number));
    /* FR-040: the verdict moment is the message's moment */
    expect(verdict.event.createdAt).toBe(verdict.event.data.confirmedAt);
    expect(verdict.event.createdAt).toBeGreaterThanOrEqual(first.event.createdAt);

    /* scenario 2 / FR-015: proof of origin, against nothing but the JWKS */
    const jwks = (await jwksOf()).body;
    expect(jwks.keys.map((k) => k.kid)).toEqual(["test-2026-09-17"]);
    for (const delivery of captured) {
      expect(delivery.headers["devolada-key-id"]).toBe("test-2026-09-17");
      expect(delivery.headers["content-type"]).toBe("application/json");
      expect(delivery.headers["devolada-event-id"]).toBe(delivery.event.eventId);
      expect(delivery.headers["devolada-timestamp"]).toMatch(/^\d+$/);
      expect(await verifyDelivery(jwks, delivery)).toBe(true);
      /* altered in transit → refused */
      expect(await verifyDelivery(jwks, { ...delivery, body: delivery.body.replace("49900", "49901") })).toBe(false);
    }
    /* each message carries its own identity (FR-014), distinct */
    expect(first.event.eventId).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(first.event.eventId).not.toBe(verdict.event.eventId);

    /* FR-026: the record, and the payment's own outcome from the verdict's delivery */
    const rows = await deliveriesOf(business.id);
    expect(rows.map((r) => [r.eventType, r.status, r.attempts, r.responseStatus, r.keyId])).toEqual([
      ["payment.validating", "delivered", 1, 200, "test-2026-09-17"],
      ["payment.confirmed", "delivered", 1, 200, "test-2026-09-17"],
    ]);
    const [payment] = await db().select().from(payments).where(eq(payments.id, paymentId));
    expect(payment).toMatchObject({ status: "confirmed", actionOutcome: "done", actionAttempts: 1, actionError: null });
    expect(payment.actionDoneAt).not.toBeNull();
    const [endpoint] = await db().select().from(apiWebhooks).where(eq(apiWebhooks.businessId, business.id));
    expect(endpoint.consecutiveFailures).toBe(0);
    expect(endpoint.lastSuccessAt).not.toBeNull();

    /* nothing left to do: the sweep finds nothing due */
    expect(await sweepWebhookDeliveries(testEnv, new Date(Date.now() + minutes(10)))).toMatchObject({ claimed: 0 });
  });

  it("through the receipt door: `proofDoor: receipt`, the receipt's amount as the claim, and the verdict later as its own message", async () => {
    const { business, token } = await arrange();
    const proofId = await payerUploadProof(token);
    const captured = mockDestination({ times: 1 });
    /* the CEP is not published yet: the row rides the schedule */
    mockApiCep({ status: "pending" });
    const { ctx, settled } = collectingCtx();
    const submitted = await payerPost(token, { proofId, receiptAmountCents: ASK + FEE }, testEnv, ctx);
    expect(submitted.body.data).toMatchObject({ status: "validating" });
    await settled();
    expect(captured).toHaveLength(1);
    expect(captured[0].event.type).toBe("payment.validating");
    expect(captured[0].event.data).toMatchObject({ proofDoor: "receipt", claimedCents: ASK + FEE, receivedCents: null, match: null, folio: null });

    /* three minutes later Banxico has it: the sweep reaches the verdict
       with no `waitUntil`, and the webhook sweep chained after it
       delivers this same minute */
    const later = new Date(Date.now() + minutes(3));
    mockApiCep({ cep: { amountCents: ASK + FEE, trackingKey: "TRACK000RCPT" } });
    expect(await sweepDirectPayments(testEnv, later)).toMatchObject({ claimed: 1, confirmed: 1 });
    const verdicts = mockDestination({ times: 1 });
    expect(await sweepWebhookDeliveries(testEnv, later)).toMatchObject({ claimed: 1, delivered: 1 });
    expect(verdicts[0].event.type).toBe("payment.confirmed");
    expect(verdicts[0].event.data).toMatchObject({
      paymentId: submitted.body.data!.directPaymentId,
      proofDoor: "receipt",
      claimedCents: ASK + FEE,
      receivedCents: ASK + FEE,
      match: "exact",
    });
    expect((await deliveriesOf(business.id)).map((r) => r.status)).toEqual(["delivered", "delivered"]);
  });

  it("credit paused: `payment.queued_for_credit` at submission, `payment.validating` again when a top-up releases it", async () => {
    const { business, token } = await arrange();
    /* prepaid-credit D8: −$60.00 against the −$50.00 default cap */
    await db().insert(creditEntries).values({ businessId: business.id, kind: "adjustment", cents: -6000, reason: "test: pause", authorUserId: null });
    const captured = mockDestination({ times: 1 });
    const { ctx, settled } = collectingCtx();
    const queued = await payerPost(token, TRANSFER("TRACK000QUEUE", ASK + FEE), testEnv, ctx);
    expect(queued.body.data).toMatchObject({ status: "queued_for_credit" });
    await settled();
    expect(captured.map((c) => c.event.type)).toEqual(["payment.queued_for_credit"]);
    expect(captured[0].event.data).toMatchObject({ claimedCents: ASK + FEE, receivedCents: null });

    await db().insert(creditEntries).values({ businessId: business.id, kind: "adjustment", cents: 20000, reason: "test: top up", authorUserId: null });
    const later = new Date(Date.now() + minutes(1));
    expect(await releaseQueuedForCredit(testEnv, later)).toBe(1);
    const released = mockDestination({ times: 1 });
    expect(await sweepWebhookDeliveries(testEnv, later)).toMatchObject({ claimed: 1, delivered: 1 });
    expect(released[0].event.type).toBe("payment.validating");
    expect(released[0].event.data.paymentId).toBe(queued.body.data!.directPaymentId);
    /* a pre-verdict delivery never touches the payment's outcome (FR-026) */
    const [row] = await db().select().from(payments).where(eq(payments.businessId, business.id));
    expect(row).toMatchObject({ status: "validating", actionOutcome: null });
  });
});

describe("scenario 6: every other verdict is announced with the row's own word (D17)", () => {
  it("`partial`, never `short`: a short transfer names the class in `match`", async () => {
    const { token } = await arrange();
    const captured = mockDestination({ times: 2 });
    mockApiCep({ cep: { amountCents: 40000 } });
    const { ctx, settled } = collectingCtx();
    await payerPost(token, TRANSFER("TRACK000SHORT", 40000), testEnv, ctx);
    await settled();
    const verdict = byType(captured)["payment.partial"];
    expect(verdict).toBeDefined();
    expect(verdict.event.data).toMatchObject({ receivedCents: 40000, askedCents: ASK, match: "short" });
    expect(captured.map((c) => c.event.type).sort()).toEqual(["payment.partial", "payment.validating"]);
  });

  it("`unapplied` (D16): a transfer validated after another one closed the link", async () => {
    const { key } = await arrange();
    const oneTime = (await v1(key, "POST", "/payment-links", { customerRef: "INV-9", askCents: ASK, mode: "one_time", expiresAt: inAnHour() })).body.data!;
    const token = String(oneTime.url).split("/p/")[1];
    const early = mockDestination({ times: 3 });
    mockApiCep({ status: "pending" });
    const { ctx, settled } = collectingCtx();
    const first = await payerPost(token, TRANSFER("TRACK000FIRST", ASK + FEE), testEnv, ctx);
    mockApiCep({ cep: { amountCents: ASK + FEE, trackingKey: "TRACK000SECOND" } });
    await payerPost(token, TRANSFER("TRACK000SECOND", ASK + FEE), testEnv, ctx);
    await settled();
    expect(early.map((c) => c.event.type).sort()).toEqual(["payment.confirmed", "payment.validating", "payment.validating"]);

    const later = new Date(Date.now() + minutes(3));
    mockApiCep({ cep: { amountCents: ASK + FEE, trackingKey: "TRACK000FIRST" } });
    expect(await sweepDirectPayments(testEnv, later)).toMatchObject({ unapplied: 1 });
    const late = mockDestination({ times: 1 });
    await sweepWebhookDeliveries(testEnv, later);
    expect(late[0].event.type).toBe("payment.unapplied");
    expect(late[0].event.data).toMatchObject({ paymentId: first.body.data!.directPaymentId, receivedCents: ASK + FEE, match: "over" });
  });

  it("`invalid`: Banxico contradicted the claim", async () => {
    const { token } = await arrange();
    const captured = mockDestination({ times: 2 });
    mockApiCep({ status: "invalid", cepStatus: "DEVUELTO" });
    const { ctx, settled } = collectingCtx();
    const res = await payerPost(token, TRANSFER("TRACK000DEVUE", ASK + FEE), testEnv, ctx);
    expect(res.body.data).toMatchObject({ status: "invalid" });
    await settled();
    const verdict = byType(captured)["payment.invalid"];
    expect(verdict.event.data).toMatchObject({ receivedCents: null, match: null, folio: null, claimedCents: ASK + FEE });
  });

  it("`expired`: the schedule gave up, announced by the sweep's verdict", async () => {
    const { business, link } = await arrange();
    const now = new Date();
    const [payment] = await db()
      .insert(payments)
      .values({
        paymentLinkId: link.id as string,
        businessId: business.id,
        amountCents: ASK + FEE,
        invoiceCents: ASK,
        serviceFeeCents: FEE,
        askedCents: ASK,
        customerRef: "CLI-4471",
        customerName: "Ana Ruiz",
        proofMode: "transfer",
        trackingKey: "TRACK000LATE1",
        senderBank: "NUBANK",
        transferDate: now.toISOString().slice(0, 10),
        constaStatus: "pending",
        validationAttempts: 6,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000),
      })
      .returning();
    mockApiCep({ status: "pending" });
    expect(await sweepDirectPayments(testEnv, now)).toMatchObject({ expired: 1 });
    const captured = mockDestination({ times: 1 });
    expect(await sweepWebhookDeliveries(testEnv, now)).toMatchObject({ delivered: 1 });
    expect(captured[0].event.type).toBe("payment.expired");
    expect(captured[0].event.data).toMatchObject({ paymentId: payment.id, receivedCents: null, folio: null });
    const [row] = await db().select().from(payments).where(eq(payments.id, payment.id));
    expect(row).toMatchObject({ status: "expired", actionOutcome: "done" });
  });

  it("`superseded`: the payer corrected a validating attempt — the old row is announced closed, the correction is its own payment", async () => {
    const { token } = await arrange();
    const captured = mockDestination({ times: 3 });
    mockApiCep({ status: "pending" });
    const { ctx, settled } = collectingCtx();
    const first = await payerPost(token, { transfer: { ...TRANSFER("TRACK000CORR", ASK + FEE).transfer, date: "2026-09-01" } }, testEnv, ctx);
    mockApiCep({ status: "pending" });
    const corrected = await payerPost(token, { transfer: { ...TRANSFER("TRACK000CORR", ASK + FEE).transfer, date: "2026-09-02" } }, testEnv, ctx);
    await settled();
    expect(corrected.body.data!.directPaymentId).not.toBe(first.body.data!.directPaymentId);
    const types = captured.map((c) => [c.event.type, c.event.data.paymentId]);
    expect(types).toContainEqual(["payment.validating", first.body.data!.directPaymentId]);
    expect(types).toContainEqual(["payment.superseded", first.body.data!.directPaymentId]);
    expect(types).toContainEqual(["payment.validating", corrected.body.data!.directPaymentId]);
  });

  it("the contract names all eight, and nothing here speaks ISP", () => {
    expect(WEBHOOK_EVENT_TYPES).toEqual([
      "payment.validating",
      "payment.queued_for_credit",
      "payment.confirmed",
      "payment.partial",
      "payment.unapplied",
      "payment.invalid",
      "payment.expired",
      "payment.superseded",
    ]);
    expectNoIspVocabulary(WEBHOOK_EVENT_TYPES);
  });
});

describe("scenario 8: no address registered", () => {
  it("nothing is sent and nothing fails — no row, no outcome, the verdict whole", async () => {
    const { key, business } = await seedApiBusiness({ serviceFeeCents: FEE });
    const link = (await v1(key, "POST", "/payment-links", { customerRef: "CLI-1", askCents: ASK })).body.data!;
    mockApiCep({ cep: { amountCents: ASK + FEE } });
    const { ctx, settled } = collectingCtx();
    const paid = await payerPost(String(link.url).split("/p/")[1], TRANSFER("TRACK000NOHOOK", ASK + FEE), testEnv, ctx);
    await settled();
    expect(paid.body.data).toMatchObject({ status: "confirmed" });
    expect(await deliveriesOf(business.id)).toHaveLength(0);
    const [row] = await db().select().from(payments).where(eq(payments.businessId, business.id));
    expect(row).toMatchObject({ status: "confirmed", actionOutcome: null });
    expect(await sweepWebhookDeliveries(testEnv)).toMatchObject({ claimed: 0 });
  });
});

describe("scenarios 3 and 5 (T038): the widening schedule, the visible end, and the re-send", () => {
  it("a non-2xx widens the wait through [1, 5, 15, 60, 240], ends in `failed`, and a re-send carries the same event id and the same body", async () => {
    const { key, business, token } = await arrange();
    /* the pre-verdict message lands; the verdict's endpoint is broken */
    const start = Date.now();
    const okOnce = mockDestination({ times: 1 });
    const failing = mockDestination({ status: 500, times: 1 });
    mockApiCep({ cep: { amountCents: ASK + FEE } });
    const { ctx, settled } = collectingCtx();
    const paid = await payerPost(token, TRANSFER("TRACK000RETRY", ASK + FEE), testEnv, ctx);
    await settled();
    /* undici serves interceptors in order, so the second one — the 500 —
       met whichever delivery came second. Which one is not the point:
       one of the two rows is now pending its first retry. */
    expect(okOnce.length + failing.length).toBe(2);
    const paymentId = String(paid.body.data!.directPaymentId);

    const pending = (await deliveriesOf(business.id)).find((r) => r.status === "pending")!;
    expect(pending).toMatchObject({ attempts: 1, responseStatus: 500, lastError: "HTTP_500" });
    expect(pending.nextAttemptAt!.getTime() - start).toBeGreaterThanOrEqual(minutes(BACKOFF_MINUTES[0]) - 1000);
    const [endpoint] = await db().select().from(apiWebhooks).where(eq(apiWebhooks.businessId, business.id));
    expect(endpoint.consecutiveFailures).toBe(1);
    expect(endpoint.lastFailureAt).not.toBeNull();

    /* the schedule: each sweep at the due moment fails again and widens
       the wait; before the due moment nothing is claimed */
    let at = pending.nextAttemptAt!.getTime();
    for (const [i, wait] of BACKOFF_MINUTES.entries()) {
      expect(await sweepWebhookDeliveries(testEnv, new Date(at - 1000))).toMatchObject({ claimed: 0 });
      mockDestination({ status: 503, times: 1 });
      const report = await sweepWebhookDeliveries(testEnv, new Date(at));
      const last = i === BACKOFF_MINUTES.length - 1;
      expect(report).toMatchObject(last ? { claimed: 1, failed: 1 } : { claimed: 1, stillPending: 1 });
      const [row] = await db().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, pending.id));
      expect(row.attempts).toBe(i + 2);
      expect(row.lastError).toBe("HTTP_503");
      if (last) {
        expect(row.status).toBe("failed");
        expect(row.nextAttemptAt).toBeNull();
      } else {
        const nextWait = BACKOFF_MINUTES[i + 1];
        expect(row.nextAttemptAt!.getTime()).toBe(at + minutes(nextWait));
        at = row.nextAttemptAt!.getTime();
      }
      void wait;
    }
    /* six attempts in all, visible to the business (FR-016, FR-018) */
    const [spent] = await db().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, pending.id));
    expect(spent.attempts).toBe(BACKOFF_MINUTES.length + 1);
    const [afterwards] = await db().select().from(apiWebhooks).where(eq(apiWebhooks.businessId, business.id));
    expect(afterwards.consecutiveFailures).toBe(BACKOFF_MINUTES.length + 1);
    const listed = await v1(key, "GET", "/webhook/deliveries?status=failed");
    expect(listed.body.data!.deliveries).toEqual([
      expect.objectContaining({ id: pending.id, eventId: pending.eventId, status: "failed", attempts: 6, responseStatus: 503, lastError: "HTTP_503", keyId: "test-2026-09-17" }),
    ]);
    /* FR-026: the verdict's delivery is what the payment's outcome reflects */
    const [payment] = await db().select().from(payments).where(eq(payments.id, paymentId));
    expect(payment.actionOutcome).toBe(spent.eventType === "payment.confirmed" ? "failed" : "done");

    /* scenario 5 / FR-041: the endpoint is fixed; the business asks again */
    const resent = await v1(key, "POST", `/webhook/deliveries/${pending.id}/retry`);
    expect(resent.status).toBe(202);
    expect(resent.body.data).toMatchObject({ id: pending.id, eventId: pending.eventId, status: "pending", attempts: 0 });
    const redelivered = mockDestination({ times: 1 });
    expect(await sweepWebhookDeliveries(testEnv, new Date(at + minutes(1)))).toMatchObject({ claimed: 1, delivered: 1 });
    expect(redelivered[0].event.eventId).toBe(pending.eventId);
    expect(redelivered[0].body).toBe(pending.payload);
    expect(redelivered[0].headers["devolada-event-id"]).toBe(pending.eventId);
    const [done] = await db().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, pending.id));
    expect(done).toMatchObject({ status: "delivered", attempts: 1, responseStatus: 200, lastError: null });
    const [healed] = await db().select().from(apiWebhooks).where(eq(apiWebhooks.businessId, business.id));
    expect(healed.consecutiveFailures).toBe(0);
    if (spent.eventType === "payment.confirmed") {
      const [settled2] = await db().select().from(payments).where(eq(payments.id, paymentId));
      expect(settled2.actionOutcome).toBe("done");
    }

    /* a delivered one, or one still scheduled, is not re-sent */
    expect((await v1(key, "POST", `/webhook/deliveries/${pending.id}/retry`)).body.error).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("another business cannot re-send, list or see this one's deliveries (FR-023)", async () => {
    const { business, token } = await arrange();
    const other = await seedApiBusiness({ email: "otro@business.mx" });
    const captured = mockDestination({ times: 2 });
    mockApiCep({ cep: { amountCents: ASK + FEE } });
    const { ctx, settled } = collectingCtx();
    await payerPost(token, TRANSFER("TRACK000ISOL", ASK + FEE), testEnv, ctx);
    await settled();
    expect(captured).toHaveLength(2);
    const [row] = await deliveriesOf(business.id);
    expect((await v1(other.key, "POST", `/webhook/deliveries/${row.id}/retry`)).status).toBe(404);
    expect((await v1(other.key, "GET", "/webhook/deliveries")).body.data).toEqual({ deliveries: [] });
    expect((await v1(other.key, "GET", "/webhook")).status).toBe(404);
  });
});

describe("scenarios 4 and 7 (T039): a destination that never answers, and a key that retires", () => {
  it("no answer within the deadline counts as a failed attempt; the money stays confirmed and the payer sees success (FR-016, FR-017)", async () => {
    const { business, token } = await arrange();
    /* the destination hangs past the deadline, shrunk for the test as
       APICEP_DEADLINE_MS is (D8: 10 s in every deploy) */
    const slow = { ...testEnv, WEBHOOK_DELIVERY_TIMEOUT_MS: "50" } as typeof testEnv;
    mockDestination({ times: 2, delayMs: 500 });
    mockApiCep({ cep: { amountCents: ASK + FEE } });
    const { ctx, settled } = collectingCtx();
    const paid = await payerPost(token, TRANSFER("TRACK000SLOW", ASK + FEE), slow, ctx);
    expect(paid.body.data).toMatchObject({ status: "confirmed" });
    await settled();
    const rows = await deliveriesOf(business.id);
    expect(rows.map((r) => [r.status, r.attempts, r.lastError, r.responseStatus])).toEqual([
      ["pending", 1, "TIMEOUT", null],
      ["pending", 1, "TIMEOUT", null],
    ]);
    const paymentId = String(paid.body.data!.directPaymentId);
    const [payment] = await db().select().from(payments).where(eq(payments.id, paymentId));
    expect(payment).toMatchObject({ status: "confirmed", actionOutcome: "queued", actionError: "TIMEOUT" });
    expect(payment.folio).toMatch(/^DV-/);
    expect((await payerStatus(paymentId)).data).toMatchObject({ status: "confirmed" });
  });

  it("retiring the signing key: the next delivery carries the new `kid`, both stay published, and a verifier holding only the JWKS accepts the message before and the one after (FR-039)", async () => {
    const { key, token } = await arrange();
    const before = mockDestination({ times: 2 });
    mockApiCep({ cep: { amountCents: ASK + FEE } });
    const { ctx, settled } = collectingCtx();
    await payerPost(token, TRANSFER("TRACK000KEY1", ASK + FEE), testEnv, ctx);
    await settled();
    expect(before.map((c) => c.headers["devolada-key-id"])).toEqual(["test-2026-09-17", "test-2026-09-17"]);

    /* the rotation: the old key retired now, a new one active. A
       second fixed pair, generated once and hardcoded like the first. */
    const retiredAt = new Date().toISOString();
    const rotated = {
      ...testEnv,
      WEBHOOK_SIGNING_KEYS: JSON.stringify([
        { ...JSON.parse(env.WEBHOOK_SIGNING_KEYS!)[0], retiredAt },
        {
          kty: "EC",
          crv: "P-256",
          x: "pwLJX5dtuZtMOSm1-97rVgl5HM5rfUyX59ZJvO_eyEA",
          y: "8DzScCLK0Ev3Eg6_DkiKQwIWupeVWJOzLxb9gxW_Txs",
          d: "Wvlzt1uttWoPzVeXPqEwsGDkiBAtQypRTohgCXk8P1E",
          kid: "test-2026-09-18",
        },
      ]),
    } as typeof testEnv;
    const link2 = (await v1(key, "POST", "/payment-links", { customerRef: "CLI-2", askCents: ASK }, {}, rotated)).body.data!;
    const after = mockDestination({ times: 2 });
    mockApiCep({ cep: { amountCents: ASK + FEE, trackingKey: "TRACK000KEY2" } });
    const second = collectingCtx();
    await payerPost(String(link2.url).split("/p/")[1], TRANSFER("TRACK000KEY2", ASK + FEE), rotated, second.ctx);
    await second.settled();
    expect(after.map((c) => c.headers["devolada-key-id"])).toEqual(["test-2026-09-18", "test-2026-09-18"]);

    const published = await jwksOf(rotated);
    expect(published.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(published.body.keys.map((k) => k.kid)).toEqual(["test-2026-09-17", "test-2026-09-18"]);
    for (const jwk of published.body.keys) {
      expect(jwk).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
      expect(jwk).not.toHaveProperty("d");
    }
    for (const delivery of [...before, ...after]) expect(await verifyDelivery(published.body, delivery)).toBe(true);
    /* the wrong key never verifies the other's message */
    expect(await verifyDelivery({ keys: [published.body.keys[1]] }, before[0])).toBe(false);

    /* KEY_RETENTION_DAYS later the retired key leaves the set */
    const longRetired = {
      ...rotated,
      WEBHOOK_SIGNING_KEYS: JSON.stringify(
        JSON.parse(rotated.WEBHOOK_SIGNING_KEYS!).map((k: { kid: string }) =>
          k.kid === "test-2026-09-17" ? { ...k, retiredAt: Date.now() - (KEY_RETENTION_DAYS + 1) * 86_400_000 } : k,
        ),
      ),
    } as typeof testEnv;
    expect((await jwksOf(longRetired)).body.keys.map((k) => k.kid)).toEqual(["test-2026-09-18"]);
  });

  it("with no signing key nothing is attempted: the row reads SIGNING_KEY_MISSING, the set is empty, and the secret's arrival delivers it (constitution VIII)", async () => {
    const { business, token } = await arrange();
    const unsigned = { ...testEnv, WEBHOOK_SIGNING_KEYS: undefined } as typeof testEnv;
    expect((await jwksOf(unsigned)).body).toEqual({ keys: [] });
    mockApiCep({ cep: { amountCents: ASK + FEE } });
    const { ctx, settled } = collectingCtx();
    const paid = await payerPost(token, TRANSFER("TRACK000UNSIGNED", ASK + FEE), unsigned, ctx);
    expect(paid.body.data).toMatchObject({ status: "confirmed" });
    await settled();
    const rows = await deliveriesOf(business.id);
    expect(rows.map((r) => [r.status, r.attempts, r.lastError])).toEqual([
      ["pending", 0, "SIGNING_KEY_MISSING"],
      ["pending", 0, "SIGNING_KEY_MISSING"],
    ]);
    /* the sweep waits without spending an attempt, and says so once */
    const halfHour = new Date(Date.now() + minutes(31));
    expect(await sweepWebhookDeliveries(unsigned, halfHour)).toMatchObject({ claimed: 2, unsigned: 2 });
    /* the secret lands: the next sweep delivers, signed */
    const captured = mockDestination({ times: 2 });
    expect(await sweepWebhookDeliveries(testEnv, new Date(halfHour.getTime() + minutes(31)))).toMatchObject({ claimed: 2, delivered: 2 });
    expect(captured.map((c) => c.headers["devolada-key-id"])).toEqual(["test-2026-09-17", "test-2026-09-17"]);
  });
});

describe("FR-012, FR-038: registering the address", () => {
  it("PUT registers or replaces, GET reads it, DELETE removes it idempotently; nothing here carries a secret", async () => {
    const { key } = await seedApiBusiness();
    expect((await v1(key, "GET", "/webhook")).status).toBe(404);
    const put = await registerWebhook(key);
    expect(put.status).toBe(200);
    expect(put.body.data).toEqual({ url: DESTINATION_URL, createdAt: expect.any(Number), consecutiveFailures: 0, lastFailureAt: null, lastSuccessAt: null });
    expect(JSON.stringify(put.body)).not.toMatch(/secret/i);
    const replaced = await registerWebhook(key, `${DESTINATION_URL}/v2`);
    expect(replaced.body.data).toMatchObject({ url: `${DESTINATION_URL}/v2` });
    expect((await v1(key, "GET", "/webhook")).body.data).toMatchObject({ url: `${DESTINATION_URL}/v2` });
    expect((await db().select().from(apiWebhooks)).length).toBe(1);
    expect((await v1(key, "DELETE", "/webhook")).body.data).toEqual({ removed: true });
    expect((await v1(key, "DELETE", "/webhook")).body.data).toEqual({ removed: false });
    expect((await v1(key, "GET", "/webhook")).status).toBe(404);
  });

  it("INSECURE_URL for anything that cannot protect the message in transit", async () => {
    const { key } = await seedApiBusiness();
    for (const url of ["http://gym.example/hooks", "ftp://gym.example/x", "gym.example/hooks", "https://"]) {
      const res = await registerWebhook(key, url);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: "INSECURE_URL", retryable: false });
    }
    expect(await db().select().from(apiWebhooks)).toHaveLength(0);
  });

  it("a delivery pending when the address is removed ends as ENDPOINT_REMOVED, readable, never lost", async () => {
    const { key, business, token } = await arrange();
    mockDestination({ status: 500, times: 2 });
    mockApiCep({ cep: { amountCents: ASK + FEE } });
    const { ctx, settled } = collectingCtx();
    await payerPost(token, TRANSFER("TRACK000GONE", ASK + FEE), testEnv, ctx);
    await settled();
    await v1(key, "DELETE", "/webhook");
    expect(await sweepWebhookDeliveries(testEnv, new Date(Date.now() + minutes(2)))).toMatchObject({ claimed: 2, failed: 2 });
    expect((await deliveriesOf(business.id)).map((r) => [r.status, r.lastError])).toEqual([
      ["failed", "ENDPOINT_REMOVED"],
      ["failed", "ENDPOINT_REMOVED"],
    ]);
    const [row] = await db().select().from(payments).where(eq(payments.businessId, business.id));
    expect(row.actionOutcome).toBe("failed");
  });

  it("D12: a test credential's deliveries are its own; the real one does not list them", async () => {
    const { key, business } = await arrange();
    const test = await issueCredential(db(), business.id, { name: "test", isTest: true });
    const link = (await v1(test.plaintext, "POST", "/payment-links", { customerRef: "CLI-T", askCents: ASK })).body.data!;
    const captured = mockDestination({ times: 2 });
    mockApiCep({ cep: { amountCents: ASK + FEE } });
    const { ctx, settled } = collectingCtx();
    await payerPost(String(link.url).split("/p/")[1], TRANSFER("TRACK000TEST", ASK + FEE), testEnv, ctx);
    await settled();
    expect(captured.every((c) => c.event.data.isTest)).toBe(true);
    expect((await v1(key, "GET", "/webhook/deliveries")).body.data).toEqual({ deliveries: [] });
    const own = await v1(test.plaintext, "GET", "/webhook/deliveries");
    expect((own.body.data!.deliveries as unknown[]).length).toBe(2);
    expect(await db().select().from(paymentLinks)).toHaveLength(2);
  });
});

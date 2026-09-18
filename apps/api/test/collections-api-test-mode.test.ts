import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchMock } from "cloudflare:test";
import { and, asc, eq } from "drizzle-orm";
import { creditEntries, paymentLinks, payments, webhookDeliveries } from "../src/db/schema";
import { sweepDirectPayments } from "../src/direct-payments/validation";
import { releaseQueuedForCredit } from "../src/credit/topups";
import { balanceCents } from "../src/credit";
import { sweepWebhookDeliveries } from "../src/webhooks/queue";
import { issueCredential } from "../src/api-clients/store";
import { PAYMENT_STATUSES } from "../src/routes/v1/schema";
import { app, sessionCookieHeader } from "./helpers";
import {
  collectingCtx,
  db,
  expectNoIspVocabulary,
  jwksOf,
  mockApiCep,
  mockDestination,
  payerPost,
  registerWebhook,
  seedApiBusiness,
  testEnv,
  TRANSFER,
  v1,
  verifyDelivery,
} from "./collections-api-helpers";

/* automated-collections-api US1 — test mode (FR-034, FR-035, SC-010,
   research D12, contracts/public-api.md "POST /v1/test/payments/:id/
   advance"). A developer at a company that is not an ISP runs the whole
   flow — link, payment, verdict, webhook — under a test credential with
   no bank transfer and no Consta call; and not one test record touches
   anything real: not the panel, not the credit, not the real
   credential's own history. This is the requirement most likely to
   leak, so the isolation is proven here before it is trusted. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const FEE = 1500;
const ASK = 49900;
const minutes = (n: number) => n * 60_000;
const tokenOf = (link: Record<string, unknown>) => String(link.url).split("/p/")[1];

/* A configured gym with a REAL credential and a TEST credential, its
   one webhook address registered (one per business, whichever key
   registers it), and no integration row — the business of research D5 */
async function arrange() {
  const { key: realKey, business } = await seedApiBusiness({ serviceFeeCents: FEE });
  const { plaintext: testKey } = await issueCredential(db(), business.id, { name: "pruebas", isTest: true });
  expect((await registerWebhook(testKey)).status).toBe(200);
  const panel = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };
  return { realKey, testKey, business, panel };
}

async function testLink(testKey: string, over: Record<string, unknown> = {}) {
  const created = await v1(testKey, "POST", "/payment-links", { customerRef: "CLI-4471", askCents: ASK, ...over });
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({ isTest: true });
  return { link: created.body.data!, token: tokenOf(created.body.data!) };
}

/* The payer submits on a test link: the row is born `validating` and
   announced, and nothing else happens — no provider, no schedule */
async function submitTest(token: string, trackingKey: string, amountCents = ASK + FEE) {
  const { ctx, settled } = collectingCtx();
  const paid = await payerPost(token, TRANSFER(trackingKey, amountCents), testEnv, ctx);
  await settled();
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);
  expect(paid.body.data).toMatchObject({ status: "validating" });
  return String(paid.body.data!.directPaymentId);
}

async function advance(testKey: string, id: string, body: Record<string, unknown>) {
  const { ctx, settled } = collectingCtx();
  const res = await (await app()).request(
    `/v1/test/payments/${id}/advance`,
    { method: "POST", headers: { Authorization: `Bearer ${testKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    testEnv,
    ctx,
  );
  await settled();
  const json = (await res.json()) as { success: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } };
  expectNoIspVocabulary(json);
  return { status: res.status, body: json };
}

const rowOf = async (id: string) => (await db().select().from(payments).where(eq(payments.id, id)))[0];

describe("FR-034 / SC-010: the whole flow, with zero pesos moved and Consta never asked", () => {
  it("test link → payer submits → `payment.validating` → advance to `confirmed` → `payment.confirmed`, signed like a real one; the row never reached the provider", async () => {
    const { testKey, business } = await arrange();
    const { link, token } = await testLink(testKey, { label: "Ana Ruiz" });

    /* No apiCEP interceptor is registered: any call to the provider
       would fail this suite, and the attempt counter — written BEFORE a
       real call — is the witness that none was even started */
    const captured = mockDestination({ times: 2 });
    const id = await submitTest(token, "TRACK000TEST1");
    expect(captured.map((c) => c.event.type)).toEqual(["payment.validating"]);
    expect(captured[0].event.data).toMatchObject({ paymentId: id, paymentLinkId: link.id, customerRef: "CLI-4471", askedCents: ASK, claimedCents: ASK + FEE, isTest: true, receivedCents: null });
    expect(await rowOf(id)).toMatchObject({ isTest: true, status: "validating", validationAttempts: 0, constaStatus: null, nextValidationAt: null });

    /* D12: the sweeps never claim it — it moves only when the caller says */
    expect(await sweepDirectPayments(testEnv, new Date(Date.now() + minutes(10)))).toMatchObject({ claimed: 0 });
    expect(await rowOf(id)).toMatchObject({ status: "validating", validationAttempts: 0 });

    const moved = await advance(testKey, id, { to: "confirmed", receivedCents: ASK + FEE });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.data).toMatchObject({ id, status: "confirmed", receivedCents: ASK + FEE, match: "exact", isTest: true, customerRef: "CLI-4471" });
    expect(moved.body.data!.folio).toMatch(/^DV-/);
    expect(moved.body.data!.confirmedAt).toEqual(expect.any(Number));

    /* the real webhook, through the real queue, verifiable against the
       published keys — the developer rehearses exactly what production sends */
    expect(captured.map((c) => c.event.type)).toEqual(["payment.validating", "payment.confirmed"]);
    const verdict = captured[1];
    expect(verdict.event.data).toMatchObject({ paymentId: id, receivedCents: ASK + FEE, match: "exact", isTest: true });
    expect(verdict.event.createdAt).toBe(verdict.event.data.confirmedAt);
    expect(await verifyDelivery((await jwksOf()).body, verdict)).toBe(true);
    const deliveries = await db().select().from(webhookDeliveries).where(eq(webhookDeliveries.businessId, business.id)).orderBy(asc(webhookDeliveries.createdAt));
    expect(deliveries.map((d) => [d.eventType, d.status])).toEqual([
      ["payment.validating", "delivered"],
      ["payment.confirmed", "delivered"],
    ]);

    /* readable through the API, like any payment (D12: records exist) */
    const read = await v1(testKey, "GET", `/payments/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ id, status: "confirmed", isTest: true });
    const byRef = await v1(testKey, "GET", "/payments?customerRef=CLI-4471");
    expect((byRef.body.data!.payments as unknown[]).length).toBe(1);

    /* still never the provider's business */
    expect(await rowOf(id)).toMatchObject({ validationAttempts: 0, constaStatus: null, actionOutcome: "done" });
    expect(await sweepWebhookDeliveries(testEnv, new Date(Date.now() + minutes(10)))).toMatchObject({ claimed: 0 });
  });

  it("an empty balance never queues a test payment: it costs nothing, so it is born `validating`, and a top-up releases nothing of it", async () => {
    const { testKey, business } = await arrange();
    /* prepaid-credit D8: −$60.00 against the −$50.00 default cap */
    await db().insert(creditEntries).values({ businessId: business.id, kind: "adjustment", cents: -6000, reason: "test: pause", authorUserId: null });
    const { token } = await testLink(testKey);
    const captured = mockDestination({ times: 1 });
    const id = await submitTest(token, "TRACK000PAUSE");
    expect(captured[0].event.type).toBe("payment.validating");
    await db().insert(creditEntries).values({ businessId: business.id, kind: "adjustment", cents: 20000, reason: "test: top up", authorUserId: null });
    expect(await releaseQueuedForCredit(testEnv, new Date(Date.now() + minutes(1)))).toBe(0);
    expect(await rowOf(id)).toMatchObject({ status: "validating", nextValidationAt: null });
  });
});

describe("FR-035: not one test record reaches anything real", () => {
  it("the panel feed, its totals, the roster, the proof, the deliveries list, the credit and the REAL credential's history all read nothing", async () => {
    const { realKey, testKey, business, panel } = await arrange();
    const before = await balanceCents(db(), business.id);
    const { link, token } = await testLink(testKey);
    mockDestination({ times: 2 });
    const id = await submitTest(token, "TRACK000ISOL");
    expect((await advance(testKey, id, { to: "confirmed" })).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ status: "confirmed", receivedCents: ASK + FEE, isTest: true });

    /* the panel's Pagos feed and its "today" total */
    const feed = (await (await (await app()).request("/payments/feed", panel, testEnv)).json()) as { data: { payments: unknown[]; today: { count: number; totalCents: number } } };
    expect(feed.data.payments).toEqual([]);
    expect(feed.data.today).toMatchObject({ count: 0, totalCents: 0 });
    /* the panel's proof and actions: as if the row did not exist */
    expect((await (await app()).request(`/payments/${id}/proof`, panel, testEnv)).status).toBe(404);
    expect((await (await app()).request(`/payments/${id}/execute-action`, { ...panel, method: "POST" }, testEnv)).status).toBe(404);
    expect((await (await app()).request(`/payments/${id}/retry-action`, { ...panel, method: "POST" }, testEnv)).status).toBe(404);
    /* the panel's link roster (a gym: no WispHub, API rows only) */
    const roster = (await (await (await app()).request("/direct-payments/links/roster", panel, testEnv)).json()) as { data: { results: unknown[] } };
    expect(roster.data.results).toEqual([]);
    /* the panel's webhook health: two deliveries happened, none of them real */
    const health = (await (await (await app()).request("/integrations/webhook", panel, testEnv)).json()) as { data: { deliveries: unknown[] } };
    expect(health.data.deliveries).toEqual([]);

    /* no validation fee (D12: one gate, in the one place a payment costs money) */
    expect(await balanceCents(db(), business.id)).toBe(before);
    expect(await db().select().from(creditEntries).where(eq(creditEntries.businessId, business.id))).toEqual([]);

    /* the real credential's own doors */
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const transfers = await v1(realKey, "GET", `/transfers?from=${yesterday}&to=${tomorrow}`);
    expect(transfers.status, today).toBe(200);
    expect(transfers.body.data).toEqual({ transfers: [], nextCursor: null });
    expect((await v1(realKey, "GET", `/payments/${id}`)).body.error?.code).toBe("NOT_FOUND");
    expect((await v1(realKey, "GET", "/payments?customerRef=CLI-4471")).body.data).toEqual({ payments: [] });
    expect((await v1(realKey, "GET", `/payment-links/${link.id}`)).body.error?.code).toBe("NOT_FOUND");
    expect((await v1(realKey, "GET", "/payment-links?customerRef=CLI-4471")).body.data).toMatchObject({ links: [] });
    /* and the test credential's, the other way round */
    expect((await v1(testKey, "GET", `/transfers?from=${yesterday}&to=${tomorrow}`)).body.data).toMatchObject({ transfers: [expect.objectContaining({ id, isTest: true })] });
  });
});

describe("D12: the door exists only for a test credential", () => {
  it("a real credential gets NOT_FOUND; a test credential cannot move a real payment, nor one of another business", async () => {
    const { realKey, testKey } = await arrange();
    /* a real payment, validating on the schedule like any other */
    const real = (await v1(realKey, "POST", "/payment-links", { customerRef: "CLI-REAL", askCents: ASK })).body.data!;
    mockApiCep({ status: "pending" });
    mockDestination({ times: 1 });
    const { ctx, settled } = collectingCtx();
    const paid = await payerPost(tokenOf(real), TRANSFER("TRACK000REAL", ASK + FEE), testEnv, ctx);
    await settled();
    expect(paid.body.data).toMatchObject({ status: "validating" });
    const realId = String(paid.body.data!.directPaymentId);
    expect(await rowOf(realId)).toMatchObject({ isTest: false, validationAttempts: 1 });

    /* the real key: the route does not exist for it, whatever the id */
    const { token } = await testLink(testKey);
    mockDestination({ times: 1 });
    const testId = await submitTest(token, "TRACK000DOOR");
    for (const id of [testId, realId, "nope"]) {
      const res = await advance(realKey, id, { to: "confirmed" });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: "NOT_FOUND", retryable: false });
    }
    /* the test key: a real payment is not its to move */
    expect((await advance(testKey, realId, { to: "confirmed" })).body.error?.code).toBe("NOT_FOUND");
    expect(await rowOf(realId)).toMatchObject({ status: "validating" });
    /* another business's test payment, neither */
    const other = await seedApiBusiness({ email: "otro@devolada.app", serviceFeeCents: FEE }, { isTest: true });
    expect((await advance(other.key, testId, { to: "confirmed" })).body.error?.code).toBe("NOT_FOUND");
    expect(await rowOf(testId)).toMatchObject({ status: "validating" });
  });
});

describe("every webhook type can be rehearsed (contract: `to` accepts any status)", () => {
  it("each verdict lands with the row's own word, `match` from the same classifier, and a one-time link closes on `confirmed`", async () => {
    const { testKey } = await arrange();
    /* one link per verdict: the payer door budgets five submissions an hour per link */
    const verdicts = [
      { to: "partial", body: { to: "partial", receivedCents: 40000 }, expect: { receivedCents: 40000, match: "short" } },
      { to: "unapplied", body: { to: "unapplied" }, expect: { receivedCents: ASK + FEE, match: "over" } },
      { to: "invalid", body: { to: "invalid" }, expect: { receivedCents: null, match: null, folio: null } },
      { to: "expired", body: { to: "expired" }, expect: { receivedCents: null, match: null } },
      { to: "superseded", body: { to: "superseded" }, expect: { receivedCents: null, match: null } },
    ] as const;
    for (const [i, v] of verdicts.entries()) {
      const { token } = await testLink(testKey, { customerRef: `CLI-${v.to}` });
      const captured = mockDestination({ times: 2 });
      const id = await submitTest(token, `TRACK00${i}VERD`);
      const moved = await advance(testKey, id, v.body);
      expect(moved.status, `${v.to}: ${JSON.stringify(moved.body)}`).toBe(200);
      expect(moved.body.data).toMatchObject({ status: v.to, isTest: true, ...v.expect });
      expect(captured.map((c) => c.event.type)).toEqual(["payment.validating", `payment.${v.to}`]);
      expect(captured[1].event.data).toMatchObject({ paymentId: id, isTest: true, ...v.expect });
      /* a verdict is final, in test mode too: no second story on one row */
      const again = await advance(testKey, id, { to: "confirmed" });
      expect(again.status).toBe(400);
      expect(again.body.error).toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining("to:") });
    }
    /* the pre-verdict states can be rehearsed too, in either order */
    const { token } = await testLink(testKey, { customerRef: "CLI-QUEUE" });
    const captured = mockDestination({ times: 3 });
    const id = await submitTest(token, "TRACK000QUEUE");
    expect((await advance(testKey, id, { to: "queued_for_credit" })).body.data).toMatchObject({ status: "queued_for_credit" });
    expect((await advance(testKey, id, { to: "validating" })).body.data).toMatchObject({ status: "validating" });
    expect(captured.map((c) => c.event.type)).toEqual(["payment.validating", "payment.queued_for_credit", "payment.validating"]);
    expect(PAYMENT_STATUSES).toHaveLength(8);

    /* FR-027 / FR-031: `confirmed` closes a one-time link, so LINK_CLOSED can be rehearsed */
    const oneTime = await testLink(testKey, { customerRef: "CLI-ONCE", mode: "one_time", expiresAt: Date.now() + 3_600_000 });
    mockDestination({ times: 2 });
    const onceId = await submitTest(oneTime.token, "TRACK000ONCE");
    expect((await advance(testKey, onceId, { to: "confirmed" })).status).toBe(200);
    expect((await v1(testKey, "GET", `/payment-links/${oneTime.link.id}`)).body.data).toMatchObject({ state: "paid" });
    const refused = await payerPost(oneTime.token, TRANSFER("TRACK000ONCE2", ASK + FEE), testEnv);
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("LINK_CLOSED");
    const [closed] = await db().select().from(paymentLinks).where(and(eq(paymentLinks.id, oneTime.link.id), eq(paymentLinks.isTest, true)));
    expect(closed.closedAt).not.toBeNull();
  });

  it("the request must tell one story: the amount and the verdict agree, and only a money verdict carries an amount", async () => {
    const { testKey } = await arrange();
    const { token } = await testLink(testKey);
    mockDestination({ times: 1 });
    const id = await submitTest(token, "TRACK000STORY");
    const refusals: [Record<string, unknown>, string][] = [
      [{ to: "confirmed", receivedCents: 40000 }, "receivedCents"],
      [{ to: "partial" }, "receivedCents"],
      [{ to: "partial", receivedCents: ASK + FEE }, "receivedCents"],
      [{ to: "invalid", receivedCents: ASK + FEE }, "receivedCents"],
      [{ to: "validating" }, "to"],
      [{ to: "paid" }, "to"],
      [{ receivedCents: 1 }, "to"],
      [{ to: "confirmed", receivedCents: -1 }, "receivedCents"],
    ];
    for (const [body, field] of refusals) {
      const res = await advance(testKey, id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
      expect(res.body.error?.message, JSON.stringify(body)).toMatch(new RegExp(`^${field}:`));
    }
    /* nothing moved, nothing was announced */
    expect(await rowOf(id)).toMatchObject({ status: "validating" });
  });
});

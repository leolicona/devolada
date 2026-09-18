import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { paymentLinks, payments } from "../src/db/schema";
import { sweepDirectPayments } from "../src/direct-payments/validation";
import { issueCredential } from "../src/api-clients/store";
import { seedBusiness } from "./helpers";
import {
  db,
  DEFAULT_CEP,
  expectNoIspVocabulary,
  mockApiCep,
  payerGet,
  payerPost,
  seedApiBusiness,
  testEnv,
  TRANSFER,
  v1,
  withoutToken,
} from "./collections-api-helpers";

/* automated-collections-api US1 — the caller's own system creates the
   payment link (spec scenarios 1–9 and 12, contracts/public-api.md).
   Every business here is a gym: a CLABE, a bank, a credential, and NO
   WispHub integration row at all (research D5). */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const FEE = 1500;
const inAnHour = () => Date.now() + 3_600_000;

describe("scenario 1: a reusable link, and the payer's page behind it", () => {
  it("creates the link and the page asks for the amount against the business's CLABE", async () => {
    const { key } = await seedApiBusiness({ serviceFeeCents: FEE });
    const res = await v1(key, "POST", "/payment-links", { customerRef: "CLI-4471", askCents: 49900, label: "Ana Ruiz", concept: "Mensualidad octubre" });
    expect(res.status).toBe(201);
    const link = res.body.data!;
    expect(link).toMatchObject({
      customerRef: "CLI-4471",
      askCents: 49900,
      mode: "reusable",
      expiresAt: null,
      state: "open",
      closedAt: null,
      label: "Ana Ruiz",
      concept: "Mensualidad octubre",
      isTest: false,
      notices: [],
    });
    expect(String(link.id)).toMatch(/^lnk_[0-9a-f]{32}$/);
    expect(String(link.url)).toMatch(/^http:\/\/localhost:5175\/p\/[a-z2-9]{16}$/);

    const token = String(link.url).split("/p/")[1];
    const page = await payerGet(token);
    expect(page.status).toBe(200);
    expect(page.body.data).toMatchObject({
      status: "debt",
      customerName: "Ana Ruiz",
      concept: "Mensualidad octubre",
      invoiceCents: 49900,
      carriedBalanceCents: 0,
      serviceFeeCents: FEE,
      totalCents: 49900 + FEE,
      speiClabe: "646180157000000004",
      speiBank: "STP",
      reference: "CLI-4471",
      cobros: [],
    });
  });

  it("FR-010: the amount is whole positive cents — anything else names the field", async () => {
    const { key } = await seedApiBusiness();
    for (const askCents of [0, -1, 499.5, "49900"]) {
      const res = await v1(key, "POST", "/payment-links", { customerRef: "CLI-1", askCents });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
      expect(res.body.error!.message).toMatch(/askCents/);
    }
    expect(await db().select().from(paymentLinks)).toHaveLength(0);
  });

  it("FR-027: a one-time link needs its deadline; a reusable one refuses one", async () => {
    const { key } = await seedApiBusiness();
    const noDeadline = await v1(key, "POST", "/payment-links", { customerRef: "CLI-1", askCents: 100, mode: "one_time" });
    expect(noDeadline.status).toBe(400);
    expect(noDeadline.body.error!.message).toMatch(/expiresAt/);
    const reusableDeadline = await v1(key, "POST", "/payment-links", { customerRef: "CLI-1", askCents: 100, expiresAt: inAnHour() });
    expect(reusableDeadline.status).toBe(400);
    expect(reusableDeadline.body.error!.message).toMatch(/expiresAt/);
  });
});

describe("scenario 2: re-pricing a reusable link", () => {
  it("the same link asks for the new amount from the moment the change lands", async () => {
    const { key } = await seedApiBusiness({ serviceFeeCents: FEE });
    const created = (await v1(key, "POST", "/payment-links", { customerRef: "CLI-4471", askCents: 49900 })).body.data!;
    const patched = await v1(key, "PATCH", `/payment-links/${created.id}`, { askCents: 52000 });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ id: created.id, askCents: 52000, state: "open" });

    const token = String(created.url).split("/p/")[1];
    const page = await payerGet(token);
    expect(page.body.data).toMatchObject({ invoiceCents: 52000, totalCents: 52000 + FEE });
  });

  it("a one-time link's amount is the thing it is: re-pricing is refused", async () => {
    const { key } = await seedApiBusiness();
    const created = (await v1(key, "POST", "/payment-links", { customerRef: "INV-1", askCents: 120000, mode: "one_time", expiresAt: inAnHour() })).body.data!;
    const res = await v1(key, "PATCH", `/payment-links/${created.id}`, { askCents: 130000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
  });

  it("an empty patch asks for nothing and is refused", async () => {
    const { key } = await seedApiBusiness();
    const created = (await v1(key, "POST", "/payment-links", { customerRef: "CLI-1", askCents: 100 })).body.data!;
    expect((await v1(key, "PATCH", `/payment-links/${created.id}`, {})).status).toBe(400);
  });
});

describe("scenario 3: a one-time link closes when it is paid", () => {
  it("the paying transfer confirms with a folio, the link reads `paid`, and a second payer meets the closed page — no WispHub, no integration row", async () => {
    const { key, business } = await seedApiBusiness({ serviceFeeCents: FEE });
    const created = (await v1(key, "POST", "/payment-links", { customerRef: "INV-7", askCents: 120000, mode: "one_time", expiresAt: inAnHour() })).body.data!;
    const token = String(created.url).split("/p/")[1];

    const captured = mockApiCep({ cep: { amountCents: 120000 + FEE } });
    const paid = await payerPost(token, TRANSFER("TRACK000INV7"));
    expect(paid.status).toBe(201);
    expect(paid.body.data).toMatchObject({ status: "confirmed", error: null });
    /* the engine was asked with the business's own account and the
       amount typed by nobody: the ask + fee, server-supplied */
    expect(captured.body).toMatchObject({ beneficiary: { clabe: "646180157000000004", bank: "STP" } });

    const [row] = await db().select().from(payments).where(eq(payments.businessId, business.id));
    expect(row).toMatchObject({
      status: "confirmed",
      reconciliationClass: "exact",
      receivedCents: 120000 + FEE,
      askedCents: 120000,
      customerRef: "INV-7",
      customerName: "INV-7",
      wisphubCustomerId: null,
      customerUsuario: null,
      actionOutcome: null,
    });
    expect(row.folio).toMatch(/^DV-/);
    expect(row.confirmedAt).not.toBeNull();

    const read = await v1(key, "GET", `/payment-links/${created.id}`);
    expect(read.body.data).toMatchObject({ state: "paid" });
    expect(read.body.data!.closedAt).toEqual(expect.any(Number));

    const page = await payerGet(token);
    expect(page.body.data).toEqual({ ispName: "ISP Demo", status: "closed", closedReason: "paid" });
    const again = await payerPost(token, TRANSFER("TRACK000OTHER"));
    expect(again.status).toBe(409);
    expect(again.body.error!.code).toBe("LINK_CLOSED");
  });

  it("the payer's status endpoint carries the folio without an action outcome", async () => {
    const { key } = await seedApiBusiness({ serviceFeeCents: FEE });
    const created = (await v1(key, "POST", "/payment-links", { customerRef: "CLI-1", askCents: 49900 })).body.data!;
    const token = String(created.url).split("/p/")[1];
    mockApiCep({ cep: { amountCents: 49900 + FEE } });
    const paid = await payerPost(token, TRANSFER());
    const id = String(paid.body.data!.directPaymentId);
    const res = await (await import("./helpers")).app().then((app) => app.request(`/direct-payments/${id}/status`, {}, testEnv));
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data.status).toBe("confirmed");
    expect(data.folio).toMatch(/^DV-/);
    expect(data).not.toHaveProperty("actionOutcome");
  });

  it("a short transfer is `partial` and leaves a one-time link open for the rest", async () => {
    const { key, business } = await seedApiBusiness({ serviceFeeCents: FEE });
    const created = (await v1(key, "POST", "/payment-links", { customerRef: "INV-8", askCents: 120000, mode: "one_time", expiresAt: inAnHour() })).body.data!;
    const token = String(created.url).split("/p/")[1];
    mockApiCep({ cep: { amountCents: 100000 } });
    const paid = await payerPost(token, TRANSFER("TRACK000SHORT", 100000));
    expect(paid.body.data).toMatchObject({ status: "partial" });
    const [row] = await db().select().from(payments).where(eq(payments.businessId, business.id));
    expect(row).toMatchObject({ status: "partial", reconciliationClass: "short", receivedCents: 100000 });
    expect((await v1(key, "GET", `/payment-links/${created.id}`)).body.data).toMatchObject({ state: "open" });
  });

  it("D16: a transfer validated after another one closed the link is `unapplied`, never lost", async () => {
    const { key, business } = await seedApiBusiness({ serviceFeeCents: FEE });
    const created = (await v1(key, "POST", "/payment-links", { customerRef: "INV-9", askCents: 120000, mode: "one_time", expiresAt: inAnHour() })).body.data!;
    const token = String(created.url).split("/p/")[1];

    /* the first payer's CEP is not published yet: the row rides the schedule */
    mockApiCep({ status: "pending" });
    const first = await payerPost(token, TRANSFER("TRACK000FIRST"));
    expect(first.body.data).toMatchObject({ status: "validating" });
    /* the second payer's is, and it closes the link */
    mockApiCep({ cep: { amountCents: 120000 + FEE, trackingKey: "TRACK000SECOND" } });
    const second = await payerPost(token, TRANSFER("TRACK000SECOND"));
    expect(second.body.data).toMatchObject({ status: "confirmed" });

    /* the sweep now finds the first one — real money, nothing left to pay */
    mockApiCep({ cep: { amountCents: 120000 + FEE, trackingKey: "TRACK000FIRST" } });
    const report = await sweepDirectPayments(testEnv, new Date(Date.now() + 3 * 60_000));
    expect(report).toMatchObject({ claimed: 1, unapplied: 1 });
    const rows = await db().select().from(payments).where(eq(payments.businessId, business.id));
    const firstRow = rows.find((row) => row.id === first.body.data!.directPaymentId)!;
    expect(firstRow).toMatchObject({ status: "unapplied", receivedCents: 120000 + FEE, reconciliationClass: "over" });
  });

  it("the caller can close a one-time link itself, idempotently — never a reusable one", async () => {
    const { key } = await seedApiBusiness();
    const oneTime = (await v1(key, "POST", "/payment-links", { customerRef: "INV-1", askCents: 100, mode: "one_time", expiresAt: inAnHour() })).body.data!;
    const closed = await v1(key, "PATCH", `/payment-links/${oneTime.id}`, { close: true });
    expect(closed.body.data).toMatchObject({ state: "paid" });
    const closedAt = closed.body.data!.closedAt;
    const again = await v1(key, "PATCH", `/payment-links/${oneTime.id}`, { close: true });
    expect(again.body.data!.closedAt).toBe(closedAt);
    /* re-pricing a closed link is LINK_CLOSED, not a silent write */
    const reusable = (await v1(key, "POST", "/payment-links", { customerRef: "CLI-1", askCents: 100 })).body.data!;
    const refused = await v1(key, "PATCH", `/payment-links/${reusable.id}`, { close: true });
    expect(refused.status).toBe(400);
    expect(refused.body.error!.code).toBe("VALIDATION_ERROR");
  });
});

describe("scenario 4: a one-time link past its deadline", () => {
  it("reads `expired`, the page says so in es-MX with no CLABE, and a submission is refused", async () => {
    const { key } = await seedApiBusiness();
    const created = (await v1(key, "POST", "/payment-links", { customerRef: "INV-2", askCents: 100, mode: "one_time", expiresAt: Date.now() - 1000 })).body.data!;
    expect(created.state).toBe("expired");
    const token = String(created.url).split("/p/")[1];
    const page = await payerGet(token);
    expect(page.body.data).toEqual({ ispName: "ISP Demo", status: "closed", closedReason: "expired" });
    expect(page.body.data).not.toHaveProperty("speiClabe");
    const refused = await payerPost(token, TRANSFER());
    expect(refused.status).toBe(409);
    expect(refused.body.error!.code).toBe("LINK_CLOSED");
    /* closing what already expired changes nothing: it stays `expired` */
    const later = await v1(key, "PATCH", `/payment-links/${created.id}`, { close: true });
    expect(later.status).toBe(200);
    expect(later.body.data).toMatchObject({ state: "expired", closedAt: null });
  });

  it("a deadline that passes AFTER submission never voids the transfer on its way", async () => {
    const { key, business } = await seedApiBusiness({ serviceFeeCents: FEE });
    const created = (await v1(key, "POST", "/payment-links", { customerRef: "INV-3", askCents: 100000, mode: "one_time", expiresAt: Date.now() + 60_000 })).body.data!;
    const token = String(created.url).split("/p/")[1];
    mockApiCep({ status: "pending" });
    const submitted = await payerPost(token, TRANSFER("TRACK000LATE"));
    expect(submitted.body.data).toMatchObject({ status: "validating" });
    /* three minutes later the deadline has passed and Banxico answers */
    mockApiCep({ cep: { amountCents: 100000 + FEE, trackingKey: "TRACK000LATE" } });
    await sweepDirectPayments(testEnv, new Date(Date.now() + 3 * 60_000));
    const [row] = await db().select().from(payments).where(eq(payments.businessId, business.id));
    expect(row.status).toBe("confirmed");
  });
});

describe("scenario 5 / FR-033: one reusable link per customer reference", () => {
  it("asking twice returns the same link, not a second one", async () => {
    const { key } = await seedApiBusiness();
    const first = await v1(key, "POST", "/payment-links", { customerRef: "CLI-4471", askCents: 49900 });
    const second = await v1(key, "POST", "/payment-links", { customerRef: "CLI-4471", askCents: 52000 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data!.id).toBe(first.body.data!.id);
    /* the existing link is returned as it is — re-pricing is PATCH's job */
    expect(second.body.data!.askCents).toBe(49900);
    expect(await db().select().from(paymentLinks)).toHaveLength(1);
  });

  it("one-time links may repeat a reference; the list finds them all, newest first", async () => {
    const { key } = await seedApiBusiness();
    await v1(key, "POST", "/payment-links", { customerRef: "CLI-1", askCents: 100, mode: "one_time", expiresAt: inAnHour() });
    await v1(key, "POST", "/payment-links", { customerRef: "CLI-1", askCents: 200, mode: "one_time", expiresAt: inAnHour() });
    await v1(key, "POST", "/payment-links", { customerRef: "CLI-1", askCents: 300 });
    const list = await v1(key, "GET", "/payment-links?customerRef=CLI-1");
    expect(list.status).toBe(200);
    expect((list.body.data!.links as unknown[]).length).toBe(3);
    const none = await v1(key, "GET", "/payment-links?customerRef=NOBODY");
    expect(none.body.data).toEqual({ links: [] });
  });
});

describe("scenario 6 / FR-008: the idempotency key", () => {
  it("a repeated create replays the first response and creates nothing new", async () => {
    const { key } = await seedApiBusiness();
    const first = await v1(key, "POST", "/payment-links", { customerRef: "INV-1", askCents: 100, mode: "one_time", expiresAt: inAnHour() }, { "Idempotency-Key": "req-1" });
    const replay = await v1(key, "POST", "/payment-links", { customerRef: "INV-1", askCents: 100, mode: "one_time", expiresAt: inAnHour() }, { "Idempotency-Key": "req-1" });
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await db().select().from(paymentLinks)).toHaveLength(1);
  });
});

describe("scenario 7 / FR-009: refusals name what the business can fix, and nothing else", () => {
  it("no CLABE → CHANNEL_UNAVAILABLE naming `clabe`; a bank outside the vocabulary → `bank`; no link created", async () => {
    const noClabe = await seedApiBusiness({ speiClabe: null });
    const res = await v1(noClabe.key, "POST", "/payment-links", { customerRef: "CLI-1", askCents: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: "CHANNEL_UNAVAILABLE", retryable: false, message: "clabe" });

    const badBank = await seedApiBusiness({ speiBank: "Klar", email: "otro@business.mx" });
    const bank = await v1(badBank.key, "POST", "/payment-links", { customerRef: "CLI-1", askCents: 100 });
    expect(bank.body.error).toEqual({ code: "CHANNEL_UNAVAILABLE", retryable: false, message: "bank" });
    expect(await db().select().from(paymentLinks)).toHaveLength(0);
  });

  it("scenario 12: no provider token on Devolada's side → the link is created with a VALIDATION_UNAVAILABLE notice, and the payer's page says the channel is unavailable", async () => {
    const { key } = await seedApiBusiness();
    const res = await v1(key, "POST", "/payment-links", { customerRef: "CLI-1", askCents: 100 }, {}, withoutToken);
    expect(res.status).toBe(201);
    expect(res.body.data!.notices).toEqual([{ code: "VALIDATION_UNAVAILABLE" }]);
    const read = await v1(key, "GET", `/payment-links/${res.body.data!.id}`, undefined, {}, withoutToken);
    expect(read.body.data!.notices).toEqual([{ code: "VALIDATION_UNAVAILABLE" }]);
    /* and none once the platform recovers */
    const later = await v1(key, "GET", `/payment-links/${res.body.data!.id}`);
    expect(later.body.data!.notices).toEqual([]);

    const token = String(res.body.data!.url).split("/p/")[1];
    const page = await payerGet(token, withoutToken);
    expect(page.body.data).toEqual({ ispName: "ISP Demo", status: "unavailable" });
  });
});

describe("scenario 8 / FR-005: a bad credential reveals nothing", () => {
  it("junk, unknown and revoked keys get the same empty 401", async () => {
    const { business } = await seedApiBusiness();
    const { credential, plaintext } = await issueCredential(db(), business.id, { name: "old" });
    const { revokeCredential } = await import("../src/api-clients/store");
    await revokeCredential(db(), business.id, credential.id, new Date());
    for (const bad of ["junk", "dk_0123456789abcdef0123456789abcdef", plaintext]) {
      const res = await v1(bad, "POST", "/payment-links", { customerRef: "CLI-1", askCents: 100 });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, error: { code: "AUTHENTICATION_ERROR", retryable: false } });
    }
  });
});

describe("scenario 9 / FR-002, FR-023: cross-business isolation", () => {
  it("business B's credential creates B's own link for A's reference and cannot read A's", async () => {
    const a = await seedApiBusiness();
    const b = await seedApiBusiness({ email: "b@business.mx" });
    const theirs = (await v1(a.key, "POST", "/payment-links", { customerRef: "CLI-4471", askCents: 49900, label: "Ana Ruiz" })).body.data!;
    const mine = await v1(b.key, "POST", "/payment-links", { customerRef: "CLI-4471", askCents: 100 });
    expect(mine.status).toBe(201);
    expect(mine.body.data!.id).not.toBe(theirs.id);
    expect(mine.body.data!.askCents).toBe(100);
    expect(mine.body.data!.label).toBeNull();

    expect((await v1(b.key, "GET", `/payment-links/${theirs.id}`)).status).toBe(404);
    expect((await v1(b.key, "PATCH", `/payment-links/${theirs.id}`, { askCents: 1 })).status).toBe(404);
    const list = await v1(b.key, "GET", "/payment-links?customerRef=CLI-4471");
    expect((list.body.data!.links as { id: string }[]).map((l) => l.id)).toEqual([mine.body.data!.id]);
    const rows = await db().select().from(paymentLinks).where(eq(paymentLinks.businessId, a.business.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].askCents).toBe(49900);
  });

  it("D12: a test credential's links are its own — a real credential does not see them, and the reference namespace is named when it collides", async () => {
    const { business, key } = await seedApiBusiness();
    const test = await issueCredential(db(), business.id, { name: "test", isTest: true });
    const created = await v1(test.plaintext, "POST", "/payment-links", { customerRef: "CLI-T", askCents: 100 });
    expect(created.body.data!.isTest).toBe(true);
    expect((await v1(key, "GET", `/payment-links/${created.body.data!.id}`)).status).toBe(404);
    expect((await v1(key, "GET", "/payment-links?customerRef=CLI-T")).body.data).toEqual({ links: [] });
    const collision = await v1(key, "POST", "/payment-links", { customerRef: "CLI-T", askCents: 100 });
    expect(collision.status).toBe(400);
    expect(collision.body.error!.message).toMatch(/test credential/);
  });
});

describe("scenario 10 / FR-028, FR-029: nothing names an ISP, and nothing reaches WispHub", () => {
  it("an ISP with WispHub connected and actions enabled pays an API link: the verdict lands and not one WispHub call is made", async () => {
    /* `disableNetConnect` plus no WispHub interceptor: a single call to
       api.wisphub.net fails this test at the network edge */
    const business = await seedBusiness({ ...(await import("./collections-api-helpers")).SPEI, serviceFeeCents: FEE, wisphubApiKey: "wh-key-1", actionsEnabled: true });
    const { plaintext: key } = await issueCredential(db(), business.id, { name: "sistema" });
    const created = (await v1(key, "POST", "/payment-links", { customerRef: "CLI-9", askCents: 49900 })).body.data!;
    const token = String(created.url).split("/p/")[1];
    mockApiCep({ cep: { amountCents: 49900 + FEE } });
    const paid = await payerPost(token, TRANSFER());
    expect(paid.body.data).toMatchObject({ status: "confirmed" });
    const [row] = await db().select().from(payments).where(eq(payments.businessId, business.id));
    expect(row).toMatchObject({ status: "confirmed", actionOutcome: null, wisphubInvoiceId: null, paymentRegisteredAt: null });
    expectNoIspVocabulary(created);
  });

  it("the shared assertion catches a stray word", () => {
    expect(() => expectNoIspVocabulary({ reference: "usuario" })).toThrow(/usuario/);
    expect(() => expectNoIspVocabulary({ cep: DEFAULT_CEP })).not.toThrow();
  });
});

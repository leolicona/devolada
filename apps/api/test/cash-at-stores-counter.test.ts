import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import {
  creditEntries,
  integrationEvents,
  integrations,
  paymentLinks,
  payments,
  storeLedger,
} from "../src/db/schema";
import type { Bindings } from "../src/env";
import { setSetting } from "../src/platform/settings";
import { sweepReconnections } from "../src/reconnection/queue";
import {
  collectionReceiptResponse,
  collectionStatusResponse,
  storeQuoteResponse,
  storeSearchResponse,
} from "../src/routes/store/schema";
import { app, seedBusiness } from "./helpers";
import { mockCustomer, WISPHUB } from "./payer-helpers";
import {
  mockAction,
  mockCustomerDebt,
  mockCustomerSearch,
  mockCustomerSearchFails,
  seedActiveStore,
  seedStorePayment,
  seedStoreChannel,
} from "./store-helpers";

/* cash-at-stores US1 (T024) — the counter, against contracts/store-api.md:
   search, quote, record, status and receipt. WispHub answers at its pinned
   origin; the record's first action attempt runs past the response
   (D25), so the suite hands the app an execution context and waits on it. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const db = () => drizzle(env.DB);
const MINUTE = 60_000;

/* Guadalupe owes 798.00: a 499.00 invoice and 299.00 carried */
const LUPE = { usuario: "greyes@wifiplus", nombre: "Guadalupe Reyes", zona: "Centro", saldo: "299.00", id: 6 };
const DEBT = 79800;
const FEE = 1500;
const mockLupeDebt = (times = 1) => mockCustomerDebt(LUPE, [{ id: 42, total: "499.00" }], times);

async function counter(over: Parameters<typeof seedBusiness>[0] = {}) {
  const business = await seedBusiness({ wisphubApiKey: "wh-key-1", name: "WiFi Plus", ...over });
  await seedStoreChannel(business);
  const shop = await seedActiveStore();
  const call = async (path: string, init: RequestInit = {}, e: unknown = env) => {
    const ctx = createExecutionContext();
    const res = await (await app()).request(
      path,
      { ...init, headers: { "Content-Type": "application/json", ...shop.headers, ...(init.headers ?? {}) } },
      e as typeof env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  };
  return { business, shop, call };
}

const collect = (over: Record<string, unknown> = {}): RequestInit => ({
  method: "POST",
  body: JSON.stringify({
    usuario: LUPE.usuario,
    amountCents: DEBT,
    expectedDebtCents: DEBT,
    expectedFeeCents: FEE,
    collectionKey: crypto.randomUUID(),
    ...over,
  }),
});

describe("cash-at-stores US1 — the search: nothing before three characters, ten at most, the minimum shown (D24)", () => {
  it("two characters are QUERY_TOO_SHORT, and WispHub is never asked", async () => {
    const { call } = await counter();
    const res = await call("/store/customers?q=%20gu%20");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("QUERY_TOO_SHORT");
  });

  it("a result shows name, usuario and zone, and nothing else — the contract's strict shape holds", async () => {
    const { call } = await counter();
    mockCustomerSearch([{ ...LUPE, telefono: "5512345678" }]);
    const res = await call("/store/customers?q=gua");
    expect(res.status).toBe(200);
    const data = storeSearchResponse.parse((await res.json()).data);
    expect(data).toEqual({
      rows: [{ usuario: "greyes@wifiplus", name: "Guadalupe Reyes", zone: "Centro" }],
      more: false,
      integration: "ok",
    });
  });

  it("at most ten, and `more` when more matched", async () => {
    const { call } = await counter();
    const many = Array.from({ length: 12 }, (_, i) => ({ usuario: `c${i}@wifiplus`, nombre: `Cliente ${i}`, id: 100 + i }));
    mockCustomerSearch(many, { more: ["nombre"] });
    const data = storeSearchResponse.parse((await (await call("/store/customers?q=cli")).json()).data);
    expect(data.rows).toHaveLength(10);
    expect(data.more).toBe(true);
  });

  it("the business's system down is `unavailable` with no rows, never an empty list that reads 'nobody' (FR-028)", async () => {
    const { call } = await counter();
    mockCustomerSearchFails(503);
    const data = (await (await call("/store/customers?q=gua")).json()).data;
    expect(data).toEqual({ rows: [], more: false, integration: "unavailable" });
  });

  it("no business with the channel on is CHANNEL_OFF on the search, the quote and the record", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const { headers } = await seedActiveStore();
    const call = async (path: string, init: RequestInit = {}) =>
      (await app()).request(path, { ...init, headers: { "Content-Type": "application/json", ...headers } }, env);
    for (const res of [
      await call("/store/customers?q=gua"),
      await call(`/store/customers/debt?usuario=${encodeURIComponent(LUPE.usuario)}`),
      await call("/store/collections", collect()),
    ]) {
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("CHANNEL_OFF");
    }
  });

  it("a business whose integration lost its key is NOT_CAPABLE", async () => {
    const { business, call } = await counter();
    await db().update(integrations).set({ apiKey: null }).where(eq(integrations.businessId, business.id));
    const res = await call("/store/customers?q=gua");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_CAPABLE");
  });
});

describe("cash-at-stores US1 — the quote: the debt read live, the fee, the total (D14, D22)", () => {
  it("owes: 798.00 plus the network fee", async () => {
    const { call } = await counter();
    mockLupeDebt();
    const data = storeQuoteResponse.parse((await (await call("/store/customers/debt?usuario=greyes%40wifiplus")).json()).data);
    expect(data).toEqual({
      state: "owes",
      usuario: "greyes@wifiplus",
      name: "Guadalupe Reyes",
      zone: "Centro",
      debtCents: DEBT,
      invoiceCents: 49900,
      carriedBalanceCents: 29900,
      feeCents: FEE,
      totalCents: DEBT + FEE,
      /* the business's threshold is 100 %: only the whole debt brings the
         service back */
      reconnectsFromCents: DEBT,
    });
  });

  it("reconnectsFromCents follows the business's own rule: a lenient threshold, register-only, observation", async () => {
    const { business, call } = await counter();
    const quote = async () => {
      mockLupeDebt();
      return (await (await call("/store/customers/debt?usuario=greyes%40wifiplus")).json()).data;
    };
    await db().update(integrations).set({ thresholdPercent: 50, floorCents: 30000 }).where(eq(integrations.businessId, business.id));
    /* half of 798.00 is 399.00, above the 300.00 floor */
    expect((await quote()).reconnectsFromCents).toBe(39900);

    await db().update(integrations).set({ shortAction: "register_only" }).where(eq(integrations.businessId, business.id));
    expect((await quote()).reconnectsFromCents).toBe(DEBT);

    await db().update(integrations).set({ exactAction: "register_only" }).where(eq(integrations.businessId, business.id));
    expect((await quote()).reconnectsFromCents).toBeNull();

    await db().update(integrations).set({ exactAction: "register_and_reconnect", actionsEnabled: false }).where(eq(integrations.businessId, business.id));
    expect((await quote()).reconnectsFromCents).toBeNull();
  });

  it("the fee is the setting's current value", async () => {
    const { call, business } = await counter();
    const [{ id: userId }] = await db().select({ id: sql<string>`user_id` }).from(sql`member`).limit(1);
    await setSetting(db(), "store_fee_cents", "2000", userId);
    mockLupeDebt();
    const data = (await (await call("/store/customers/debt?usuario=greyes%40wifiplus")).json()).data;
    expect(data).toMatchObject({ feeCents: 2000, totalCents: DEBT + 2000 });
    expect(business).toBeTruthy();
  });

  it("none: nothing owed is *Sin adeudo*", async () => {
    const { call } = await counter();
    mockCustomerDebt({ ...LUPE, saldo: "0.00" }, []);
    const data = storeQuoteResponse.parse((await (await call("/store/customers/debt?usuario=greyes%40wifiplus")).json()).data);
    expect(data).toMatchObject({ state: "none", debtCents: 0 });
  });

  it("unavailable: an outage carries no amount", async () => {
    const { call } = await counter();
    fetchMock.get(WISPHUB).intercept({ method: "GET", path: (p) => p.includes("usuario=") }).reply(503, "{}");
    const data = (await (await call("/store/customers/debt?usuario=greyes%40wifiplus")).json()).data;
    expect(data).toEqual({ usuario: "greyes@wifiplus", state: "unavailable" });
  });
});

describe("cash-at-stores US1 — the record: one payment, confirmed at once, acted on in the background (D11–D17, D25)", () => {
  it("the whole debt: exact and confirmed, the store fee on its own column, a folio, one fee, one movement — and reconnected", async () => {
    const { business, shop, call } = await counter();
    mockLupeDebt();
    const captured = mockAction({ verify: "Activo" });

    const res = await call("/store/collections", collect());
    expect(res.status).toBe(201);
    const { id, folio } = (await res.json()).data;
    expect(folio).toMatch(/^DV-[0-9A-Z]{6}$/);

    const [row] = await db().select().from(payments).where(eq(payments.id, id));
    expect(row).toMatchObject({
      businessId: business.id,
      channel: "store",
      proofMode: "none",
      storeId: shop.store.id,
      storeUserId: shop.userId,
      storeFeeCents: FEE,
      serviceFeeCents: 0,
      amountCents: DEBT,
      receivedCents: DEBT,
      invoiceCents: 49900,
      carriedBalanceCents: 29900,
      registeredCents: DEBT,
      status: "confirmed",
      reconciliationClass: "exact",
      customerName: "Guadalupe Reyes",
      customerZone: "Centro",
      /* D18: never kept */
      customerPhone: null,
      actionOutcome: "done",
      decidedAction: "register_and_reconnect:reconnect",
    });
    /* the money the payer's debt saw travels; the store's fee does not */
    expect(captured).toEqual({ accion: 1, totalCobrado: 798 });

    const fees = await db().select().from(creditEntries).where(eq(creditEntries.paymentId, id));
    expect(fees).toEqual([expect.objectContaining({ kind: "validation_fee", cents: -500 })]);
    const movements = await db().select().from(storeLedger);
    expect(movements).toEqual([
      expect.objectContaining({ kind: "collection", cents: DEBT, paymentId: id, storeId: shop.store.id, businessId: business.id }),
    ]);
    const [event] = await db().select().from(integrationEvents);
    expect(event).toMatchObject({ paymentId: id, class: "exact", action: "register_and_reconnect", status: "acked" });

    const status = collectionStatusResponse.parse((await (await call(`/store/collections/${id}`)).json()).data);
    expect(status).toMatchObject({ folio, businessName: "WiFi Plus", class: "exact", remainingCents: 0, outcome: "reconnected", feeCents: FEE });
  });

  it("ensures the customer's panel link, and creates none when one exists (D11)", async () => {
    const { call } = await counter();
    mockLupeDebt();
    mockAction();
    expect(await db().select().from(paymentLinks)).toHaveLength(0);
    await call("/store/collections", collect());
    const links = await db().select().from(paymentLinks);
    expect(links).toEqual([expect.objectContaining({ source: "panel", customerUsuario: LUPE.usuario, wisphubCustomerId: "6" })]);

    mockCustomerDebt({ ...LUPE, saldo: "0.00" }, [{ id: 43, total: "100.00" }]);
    mockAction({ invoiceId: 43, formas: false });
    expect((await call("/store/collections", collect({ amountCents: 10000, expectedDebtCents: 10000 }))).status).toBe(201);
    expect(await db().select().from(paymentLinks)).toHaveLength(1);
    expect(await db().select().from(payments)).toHaveLength(2);
  });

  it("a short amount under the threshold: short and partial, registered without reconnecting, and the app says so", async () => {
    const { call } = await counter();
    mockLupeDebt();
    const captured = mockAction({ verify: false });
    const { id } = (await (await call("/store/collections", collect({ amountCents: 50000 }))).json()).data;
    expect(captured.accion).toBe(0);
    const [row] = await db().select().from(payments).where(eq(payments.id, id));
    expect(row).toMatchObject({ status: "partial", reconciliationClass: "short", actionOutcome: "withheld", registeredCents: 50000 });
    const status = (await (await call(`/store/collections/${id}`)).json()).data;
    expect(status).toMatchObject({ class: "short", remainingCents: DEBT - 50000, outcome: "not_reconnected_short" });
  });

  it("a 503 on the first attempt queues it; the sweep's retry still does not reconnect (D10, bug queue-retry-forgets-action)", async () => {
    const { call } = await counter();
    mockLupeDebt();
    mockAction({ fail: 503 });
    const { id } = (await (await call("/store/collections", collect({ amountCents: 50000 }))).json()).data;
    const [queued] = await db().select().from(payments).where(eq(payments.id, id));
    expect(queued).toMatchObject({ actionOutcome: "queued", actionError: "INTEGRATION_UNAVAILABLE", decidedAction: "register_and_reconnect:withhold" });
    /* T071: queued, and it says the service will not come back */
    expect((await (await call(`/store/collections/${id}`)).json()).data).toMatchObject({ outcome: "queued", reconnects: false });

    const captured = mockAction({ verify: false, formas: false });
    /* the first backoff is one minute; the cash method stays cached ten
       (provider-latency D5), so the retry asks only what it needs */
    await sweepReconnections(env as unknown as Bindings, new Date(Date.now() + 2 * MINUTE));
    expect(captured.accion).toBe(0);
    const [after] = await db().select().from(payments).where(eq(payments.id, id));
    expect(after.actionOutcome).toBe("withheld");
  });

  it("a debt that moved, or a fee that moved, is AMOUNT_CHANGED and nothing is written (FR-021)", async () => {
    const { call } = await counter();
    mockLupeDebt();
    const moved = await call("/store/collections", collect({ expectedDebtCents: 49900, amountCents: 49900 }));
    expect(moved.status).toBe(409);
    expect((await moved.json()).error).toEqual({ code: "AMOUNT_CHANGED" });

    mockLupeDebt();
    const fee = await call("/store/collections", collect({ expectedFeeCents: 1000 }));
    expect((await fee.json()).error.code).toBe("AMOUNT_CHANGED");
    expect(await db().select().from(payments)).toHaveLength(0);
    expect(await db().select().from(paymentLinks)).toHaveLength(0);
  });

  it("NOTHING_DUE, AMOUNT_ABOVE_DEBT, and an unproven zero is INTEGRATION_UNAVAILABLE (D14)", async () => {
    const { call } = await counter();
    mockCustomerDebt({ ...LUPE, saldo: "0.00" }, []);
    const nothing = await call("/store/collections", collect({ expectedDebtCents: 0 }));
    expect(nothing.status).toBe(409);
    expect((await nothing.json()).error.code).toBe("NOTHING_DUE");

    mockLupeDebt();
    const above = await call("/store/collections", collect({ amountCents: DEBT + 1 }));
    expect(above.status).toBe(400);
    expect((await above.json()).error.code).toBe("AMOUNT_ABOVE_DEBT");

    /* the customer gone from the system: nothing can be proven */
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "GET", path: (p) => p.includes("usuario=") })
      .reply(200, JSON.stringify({ count: 0, next: null, results: [] }), { headers: { "Content-Type": "application/json" } });
    const unproven = await call("/store/collections", collect());
    expect(unproven.status).toBe(503);
    expect((await unproven.json()).error.code).toBe("INTEGRATION_UNAVAILABLE");
    expect(await db().select().from(payments)).toHaveLength(0);
  });

  it("the same collectionKey twice is one row, and the second answer is 200 with the first folio (D15, FR-023)", async () => {
    const { call } = await counter();
    mockLupeDebt();
    mockAction();
    const body = collect();
    const first = await call("/store/collections", body);
    expect(first.status).toBe(201);
    /* no WispHub call at all on the replay: the key answers before any read */
    const again = await call("/store/collections", body);
    expect(again.status).toBe(200);
    expect((await again.json()).data).toEqual((await first.json()).data);
    expect(await db().select().from(payments)).toHaveLength(1);
    expect(await db().select().from(storeLedger)).toHaveLength(1);
  });

  it("a paused credit never holds a cash payment: recorded, acted on, debited, and the crossing announced (FR-029, D16)", async () => {
    const { business, call } = await counter();
    /* −$50.00: at the cap, about to cross it */
    await db().insert(creditEntries).values({ businessId: business.id, kind: "adjustment", cents: -5000, reason: "seed" });
    const sent: string[] = [];
    fetchMock
      .get("https://api.resend.com")
      .intercept({ method: "POST", path: "/emails" })
      .reply(200, (req) => {
        sent.push((JSON.parse(String(req.body)) as { subject: string }).subject);
        return { id: "e" };
      });
    mockLupeDebt();
    mockAction();
    const res = await call("/store/collections", collect(), { ...env, RESEND_API_KEY: "re_test" });
    expect(res.status).toBe(201);
    const [row] = await db().select().from(payments);
    expect(row).toMatchObject({ status: "confirmed", actionOutcome: "done" });
    expect(await db().select().from(creditEntries).where(eq(creditEntries.kind, "validation_fee"))).toHaveLength(1);
    expect(sent).toEqual([expect.stringMatching(/validación en pausa/)]);

    /* already past the cap: the next one proceeds the same way */
    mockCustomerDebt({ ...LUPE, saldo: "0.00" }, [{ id: 43, total: "100.00" }]);
    mockAction({ invoiceId: 43, formas: false });
    expect((await call("/store/collections", collect({ amountCents: 10000, expectedDebtCents: 10000 }))).status).toBe(201);
  });

  it("observation mode: the payment lands whole and no action runs", async () => {
    const { call } = await counter({ actionsEnabled: false });
    mockLupeDebt();
    const { id } = (await (await call("/store/collections", collect())).json()).data;
    const [row] = await db().select().from(payments).where(eq(payments.id, id));
    expect(row).toMatchObject({ status: "confirmed", actionOutcome: "observation", observedAction: "register_and_reconnect:reconnect" });
    expect((await (await call(`/store/collections/${id}`)).json()).data.outcome).toBe("observation");
  });

  it("an integration whose `exact` maps to register_only: done with no reconnection, shown as `registered` (H2)", async () => {
    const { business, call } = await counter();
    await db().update(integrations).set({ exactAction: "register_only" }).where(eq(integrations.businessId, business.id));
    mockLupeDebt();
    const captured = mockAction({ verify: false });
    const { id } = (await (await call("/store/collections", collect())).json()).data;
    expect(captured.accion).toBe(0);
    const [row] = await db().select().from(payments).where(eq(payments.id, id));
    expect(row.actionOutcome).toBe("done");
    expect((await (await call(`/store/collections/${id}`)).json()).data.outcome).toBe("registered");
  });
});

describe("cash-at-stores US1 — a record cut mid-way always ends settled and in the cash book (T072, SC-003, SC-005)", () => {
  /* The row a request leaves when it dies right after its insert: leased,
     unsettled, carrying what its settlement needs */
  const stranded = (leaseMs: number) => ({
    status: "validating" as const,
    reconciliationClass: null,
    registeredCents: null,
    confirmedAt: null,
    actionOutcome: null,
    amountCents: DEBT,
    receivedCents: null,
    invoiceCents: 49900,
    carriedBalanceCents: 29900,
    wisphubInvoiceId: 42,
    customerUsuario: LUPE.usuario,
    nextAttemptAt: new Date(Date.now() + leaseMs),
  });
  const movementsOf = async (paymentId: string) =>
    db().select().from(storeLedger).where(eq(storeLedger.paymentId, paymentId));

  it("the retry with the same key finishes it: settled, one fee, one movement, the action run — and its folio", async () => {
    const { business, shop, call } = await counter();
    const row = await seedStorePayment(business, shop.store, stranded(-MINUTE));
    const captured = mockAction({ verify: "Activo" });
    const res = await call("/store/collections", collect({ collectionKey: row.collectionKey }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: row.id, folio: row.folio });
    const [after] = await db().select().from(payments).where(eq(payments.id, row.id));
    expect(after).toMatchObject({ status: "confirmed", reconciliationClass: "exact", actionOutcome: "done" });
    expect(captured.accion).toBe(1);
    expect(await movementsOf(row.id)).toHaveLength(1);
    const fees = await db().select().from(creditEntries).where(eq(creditEntries.paymentId, row.id));
    expect(fees).toHaveLength(1);
  });

  it("a row its first try still holds is answered with its folio and never settled twice", async () => {
    const { business, shop, call } = await counter();
    const row = await seedStorePayment(business, shop.store, stranded(MINUTE));
    const res = await call("/store/collections", collect({ collectionKey: row.collectionKey }));
    expect(res.status).toBe(200);
    const [after] = await db().select().from(payments).where(eq(payments.id, row.id));
    expect(after.status).toBe("validating");
    expect(await movementsOf(row.id)).toHaveLength(0);
  });

  it("the sweep settles a stranded row past its lease, and books a settled row that lacks its movement", async () => {
    const { business, shop } = await counter();
    const lost = await seedStorePayment(business, shop.store, stranded(-MINUTE));
    const unbooked = await seedStorePayment(business, shop.store, {
      customerUsuario: "otro@wifiplus",
      createdAt: new Date(Date.now() - 10 * MINUTE),
    });
    const { sweepUnsettledCollections } = await import("../src/store-collections");
    const report = await sweepUnsettledCollections(env as unknown as Bindings);
    expect(report).toMatchObject({ settled: 1, movements: 1, failed: 0 });
    const [after] = await db().select().from(payments).where(eq(payments.id, lost.id));
    expect(after).toMatchObject({ status: "confirmed", actionOutcome: "queued" });
    expect(await movementsOf(lost.id)).toHaveLength(1);
    expect(await movementsOf(unbooked.id)).toHaveLength(1);
    /* and the queue takes the action from here, the same minute */
    expect(after.nextAttemptAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("cash-at-stores US1 — status and receipt", () => {
  it("the status maps all six outcomes, and another store's payment is 404", async () => {
    const { business, shop, call } = await counter();
    const rows = {
      reconnected: await seedStorePayment(business, shop.store, { actionOutcome: "done", decidedAction: "register_and_reconnect:reconnect" }),
      registered: await seedStorePayment(business, shop.store, { actionOutcome: "done", decidedAction: "register_only" }),
      queued: await seedStorePayment(business, shop.store, { actionOutcome: "queued" }),
      not_reconnected_short: await seedStorePayment(business, shop.store, { actionOutcome: "withheld", status: "partial", reconciliationClass: "short" }),
      observation: await seedStorePayment(business, shop.store, { actionOutcome: "observation" }),
      failed: await seedStorePayment(business, shop.store, { actionOutcome: "failed" }),
    };
    for (const [outcome, row] of Object.entries(rows)) {
      const data = collectionStatusResponse.parse((await (await call(`/store/collections/${row.id}`)).json()).data);
      expect(data.outcome).toBe(outcome);
    }

    const other = await seedActiveStore();
    const res = await (await app()).request(`/store/collections/${rows.reconnected.id}`, { headers: other.headers }, env);
    expect(res.status).toBe(404);
    const receipt = await (await app()).request(`/store/collections/${rows.reconnected.id}/receipt`, { headers: other.headers }, env);
    expect(receipt.status).toBe(404);
  });

  it("a queued payment promises only what its verdict decided — on the status and in the receipt (T071)", async () => {
    const { business, shop, call } = await counter();
    const cases = [
      { decidedAction: "register_and_reconnect:reconnect", reconnects: true, sentence: "Tu servicio se reactivará en unos minutos." },
      {
        decidedAction: "register_and_reconnect:withhold",
        status: "partial" as const,
        reconciliationClass: "short" as const,
        reconnects: false,
        sentence: "Como no cubre todo tu adeudo, tu servicio sigue sin reactivarse.",
      },
      { decidedAction: "register_only", reconnects: false, sentence: "WiFi Plus lo aplicará en su sistema." },
    ];
    for (const { reconnects, sentence, ...over } of cases) {
      const row = await seedStorePayment(business, shop.store, { actionOutcome: "queued", ...over });
      const status = collectionStatusResponse.parse((await (await call(`/store/collections/${row.id}`)).json()).data);
      expect(status).toMatchObject({ outcome: "queued", reconnects });
      mockCustomer({ usuario: LUPE.usuario, telefono: null });
      const receipt = collectionReceiptResponse.parse((await (await call(`/store/collections/${row.id}/receipt`)).json()).data);
      expect(receipt.text).toContain(sentence);
      if (!reconnects) expect(receipt.text).not.toContain("se reactivará");
    }
  });

  it("the receipt is the template filled for this payment, and the next one uses the operator's new template", async () => {
    const { business, shop, call } = await counter();
    const payment = await seedStorePayment(business, shop.store, {
      receivedCents: 50000,
      amountCents: 50000,
      invoiceCents: 49900,
      carriedBalanceCents: 29900,
      status: "partial",
      reconciliationClass: "short",
      actionOutcome: "withheld",
      confirmedAt: new Date(Date.UTC(2026, 9, 1, 20, 35)),
    });
    mockCustomer({ usuario: LUPE.usuario, telefono: null });
    const data = collectionReceiptResponse.parse((await (await call(`/store/collections/${payment.id}/receipt`)).json()).data);
    expect(data.text).toContain("Comprobante de pago · WiFi Plus");
    expect(data.text).toContain(`Folio: ${payment.folio}`);
    expect(data.text).toContain("Pagaste: $500.00");
    expect(data.text).toContain("Cargo por servicio: $15.00");
    expect(data.text).toContain("Total: $515.00");
    expect(data.text).toContain("Queda por pagar: $298.00");
    expect(data.text).toContain("Tienda: Abarrotes Lupita");
    /* 20:35 UTC is 14:35 in Mexico City; the business reads a 12-hour clock */
    expect(data.text).toMatch(/1 de octubre de 2026, 2:35\s?p\.\s?m\./);
    expect(data.text).toContain("no cubre todo tu adeudo");
    expect(data.text).not.toMatch(/cobro/i);

    const [{ id: userId }] = await db().select({ id: sql<string>`user_id` }).from(sql`member`).limit(1);
    await setSetting(db(), "store_receipt_template", "Recibimos tu pago {folio} en {tienda}. ¡Gracias!", userId);
    mockCustomer({ usuario: LUPE.usuario, telefono: null });
    const next = (await (await call(`/store/collections/${payment.id}/receipt`)).json()).data;
    expect(next.text).toBe(`Recibimos tu pago ${payment.folio} en Abarrotes Lupita. ¡Gracias!`);
  });

  it("the WhatsApp link carries the phone the business's system has, read now — and the phone is kept nowhere (D18)", async () => {
    const { shop, call } = await counter();
    mockLupeDebt();
    mockAction();
    const { id } = (await (await call("/store/collections", collect())).json()).data;

    mockCustomer({ usuario: LUPE.usuario, telefono: "33 1234 5678" });
    const data = collectionReceiptResponse.parse((await (await call(`/store/collections/${id}/receipt`)).json()).data);
    expect(data.hasPhone).toBe(true);
    expect(data.waLink).toMatch(/^https:\/\/wa\.me\/523312345678\?text=/);
    expect(decodeURIComponent(data.waLink.split("text=")[1])).toBe(data.text);

    /* every table, every row: the digits live nowhere */
    const tables = await db().all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'`,
    );
    for (const { name } of tables) {
      const rows = await db().all(sql.raw(`SELECT * FROM "${name}"`));
      expect(JSON.stringify(rows), `table ${name}`).not.toContain("3312345678");
    }
    expect(shop.store.phone).not.toBe("3312345678");
  });

  it("no phone on file, a number that is not ten digits, a failing system, or no capability: the contact picker (FR-027, L3)", async () => {
    const { business, shop, call } = await counter();
    const payment = await seedStorePayment(business, shop.store);
    const receipt = async () => collectionReceiptResponse.parse((await (await call(`/store/collections/${payment.id}/receipt`)).json()).data);

    for (const telefono of [null, "1234 5678", "33-ABCD-5678"]) {
      mockCustomer({ usuario: LUPE.usuario, telefono });
      const data = await receipt();
      expect(data.hasPhone, String(telefono)).toBe(false);
      expect(data.waLink).toMatch(/^https:\/\/wa\.me\/\?text=/);
    }

    fetchMock.get(WISPHUB).intercept({ method: "GET", path: (p) => p.includes("usuario=") }).reply(503, "{}");
    expect((await receipt()).hasPhone).toBe(false);

    await db().update(integrations).set({ apiKey: null }).where(eq(integrations.businessId, business.id));
    expect((await receipt()).hasPhone).toBe(false);
  });
});

import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { creditEntries, integrationEvents } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { debitValidationFee } from "../src/credit";
import { recordCorrection } from "../src/store-ledger";
import { feedResponse } from "../src/routes/payments/schema";
import { app, seedBusiness, seedConfirmedPayment, sessionCookieHeader } from "./helpers";
import { mockAction, seedActiveStore, seedCashPayment, seedStoreChannel } from "./store-helpers";

/* cash-at-stores US4 (T047) — the business sees every peso collected in
   its name in the list it already reads: Pagos lists cash beside SPEI,
   filters by channel, names the store, and its credit shows one fee per
   cash payment (contracts/business-cash-api.md § Pagos). */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const db = () => drizzle(env.DB);
const asOwner = async (path: string, init: RequestInit = {}) =>
  (await app()).request(
    path,
    { ...init, headers: { "Content-Type": "application/json", Cookie: await sessionCookieHeader("demo@devolada.app") } },
    env,
  );

async function mixed() {
  const business = await seedBusiness({ wisphubApiKey: "wh-key-1", name: "WiFi Plus" });
  await seedStoreChannel(business);
  const shop = await seedActiveStore();
  const t0 = Date.now() - 60 * 60_000;
  const spei = await seedConfirmedPayment(business, { createdAt: new Date(t0), customerUsuario: "a@wifiplus", folio: "DV-SPEI01" });
  const whole = await seedCashPayment(business, shop.store, { createdAt: new Date(t0 + 60_000), customerUsuario: "b@wifiplus", folio: "DV-CASH01" });
  const short = await seedCashPayment(business, shop.store, {
    createdAt: new Date(t0 + 120_000),
    customerUsuario: "c@wifiplus",
    folio: "DV-CASH02",
    amountCents: 30000,
    receivedCents: 30000,
    invoiceCents: 49900,
    registeredCents: 30000,
    status: "partial",
    reconciliationClass: "short",
    actionOutcome: "withheld",
  });
  return { business, shop, spei, whole, short };
}

describe("cash-at-stores US4 — cash in Pagos, beside SPEI (D23, FR-031, FR-032)", () => {
  it("lists both channels in time order, the cash rows marked with their store", async () => {
    await mixed();
    const data = feedResponse.parse((await (await asOwner("/payments/feed")).json()).data);
    expect(data.payments.map((p) => [p.folio, p.channel, p.storeName])).toEqual([
      ["DV-CASH02", "store", "Abarrotes Lupita"],
      ["DV-CASH01", "store", "Abarrotes Lupita"],
      ["DV-SPEI01", "spei", null],
    ]);
  });

  it("the channel filter answers cash only, SPEI only, or both", async () => {
    await mixed();
    const cash = feedResponse.parse((await (await asOwner("/payments/feed?channel=store")).json()).data);
    expect(cash.payments.map((p) => p.folio)).toEqual(["DV-CASH02", "DV-CASH01"]);
    const spei = feedResponse.parse((await (await asOwner("/payments/feed?channel=spei")).json()).data);
    expect(spei.payments.map((p) => p.folio)).toEqual(["DV-SPEI01"]);
    expect((await asOwner("/payments/feed?channel=efectivo")).status).toBe(400);
  });

  it("a cash row's money reads with no special case: no SPEI fee, the debt as the ask, the store's fee apart", async () => {
    await mixed();
    const data = feedResponse.parse((await (await asOwner("/payments/feed?channel=store")).json()).data);
    const [short, whole] = data.payments;
    expect(whole).toMatchObject({ serviceFeeCents: 0, askedCents: 49900, missingCents: 0, surplusCents: 0, storeFeeCents: 1500, reconciliationClass: "exact" });
    expect(short).toMatchObject({ serviceFeeCents: 0, askedCents: 49900, missingCents: 19900, storeFeeCents: 1500, reconciliationClass: "short" });
    const spei = feedResponse.parse((await (await asOwner("/payments/feed?channel=spei")).json()).data).payments[0];
    expect(spei).toMatchObject({ storeFeeCents: null, corrections: [] });
  });

  it("the expanded row shows the operator's corrections, with reason, author and date (FR-030)", async () => {
    const { business, shop, whole } = await mixed();
    const { userId } = (await (await asOwner("/auth/me")).json()).data;
    await recordCorrection(db(), {
      storeId: shop.store.id,
      businessId: business.id,
      paymentId: whole.id,
      cents: -49900,
      reason: "Se cobró al cliente equivocado",
      authorUserId: userId,
    });
    const data = feedResponse.parse((await (await asOwner("/payments/feed?channel=store")).json()).data);
    expect(data.payments.find((p) => p.id === whole.id)?.corrections).toEqual([
      { cents: -49900, reason: "Se cobró al cliente equivocado", author: "demo@devolada.app", at: expect.any(Number) },
    ]);
  });

  it("one fee per cash payment, never a second one for the same payment (FR-033)", async () => {
    const { business, whole, short } = await mixed();
    for (const p of [whole, short, whole, short]) await debitValidationFee(env as unknown as Bindings, db(), p);
    const fees = await db().select().from(creditEntries).where(eq(creditEntries.businessId, business.id));
    expect(fees.filter((f) => f.kind === "validation_fee").map((f) => f.paymentId).sort()).toEqual([short.id, whole.id].sort());
  });

  it("the proof door answers 404 for a cash row: there is no proof", async () => {
    const { whole } = await mixed();
    const res = await asOwner(`/payments/${whole.id}/proof`);
    expect(res.status).toBe(404);
  });

  it("retry and run-now work on a cash row, through paymentActions, with the row's own decision (D9)", async () => {
    const { business, shop } = await mixed();
    const failed = await seedCashPayment(business, shop.store, {
      customerUsuario: "greyes@wifiplus",
      folio: "DV-CASH03",
      actionOutcome: "failed",
      actionAttempts: 6,
      wisphubInvoiceId: 42,
      decidedAction: "register_only",
    });
    const res = await asOwner(`/payments/${failed.id}/retry-action`, { method: "POST" });
    expect(res.status).toBe(200);
    const [event] = await db().select().from(integrationEvents).where(eq(integrationEvents.paymentId, failed.id));
    expect(event).toMatchObject({ action: "register_only", status: "dispatched" });

    const observed = await seedCashPayment(business, shop.store, {
      customerUsuario: "greyes@wifiplus",
      folio: "DV-CASH04",
      actionOutcome: "observation",
      observedAction: "register_and_reconnect:reconnect",
      wisphubInvoiceId: 42,
    });
    const captured = mockAction({ verify: "Activo" });
    const run = await asOwner(`/payments/${observed.id}/execute-action`, { method: "POST" });
    expect((await run.json()).data.actionOutcome).toBe("done");
    expect(captured.accion).toBe(1);
  });
});

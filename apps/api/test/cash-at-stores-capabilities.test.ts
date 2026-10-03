import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { creditEntries, paymentLinks, payments } from "../src/db/schema";
import { capabilitiesOf } from "../src/integrations/registry";
import { integrationOf } from "../src/integrations/store";
import { debitValidationFee } from "../src/credit";
import { isRevoked } from "../src/direct-payments/provisional";
import type { Bindings } from "../src/env";
import { app, seedBusiness, seedConfirmedPayment } from "./helpers";
import { WISPHUB } from "./payer-helpers";
import { mockCustomerDebt, mockCustomerSearch, mockCustomerSearchFails, seedActiveStore, seedStorePayment } from "./store-helpers";

/* cash-at-stores US1 (T018, T021) — the counter's three questions asked
   by capability, never by provider (D8, D9), and the link's SPEI rules
   made blind to a cash row hanging off the same link (D12). */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const db = () => drizzle(env.DB);
const json = (body: unknown) => [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

async function capabilities() {
  const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
  const integration = await integrationOf(db(), business.id);
  return { business, caps: capabilitiesOf(integration, env as unknown as Bindings) };
}

describe("cash-at-stores US1 — customerSearch: name, usuario, zone and the provider id, never a phone (D8, FR-017)", () => {
  it("rows carry the four fields and nothing else; the phone was a search key and stays one", async () => {
    const { caps } = await capabilities();
    mockCustomerSearch([
      { usuario: "greyes@wifiplus", nombre: "Guadalupe Reyes", telefono: "55 1234 5678", zona: "Centro", id: 6 },
      { usuario: "gruiz@wifiplus", nombre: "Gabriel Ruiz", telefono: "5587654321", zona: null, id: 9 },
    ]);
    const answer = await caps.customerSearch!.find("gua", 10);
    expect(answer).toEqual({
      rows: [
        { usuario: "greyes@wifiplus", name: "Guadalupe Reyes", zone: "Centro", providerCustomerId: "6" },
        { usuario: "gruiz@wifiplus", name: "Gabriel Ruiz", zone: null, providerCustomerId: "9" },
      ],
      more: false,
    });
    expect(JSON.stringify(answer)).not.toMatch(/5512345678|55 1234|87654321/);
  });

  it("the four filters merge and dedupe; past the limit, `more` says the rest exist", async () => {
    const { caps } = await capabilities();
    const many = Array.from({ length: 8 }, (_, i) => ({ usuario: `c${i}@wifiplus`, nombre: `Cliente ${i}`, id: 100 + i }));
    mockCustomerSearch([], {
      byField: { nombre: many, usuario: [...many.slice(0, 4), { usuario: "otro@wifiplus", nombre: "Otro", id: 99 }] },
    });
    const answer = await caps.customerSearch!.find("cli", 5);
    expect(answer.rows).toHaveLength(5);
    expect(answer.more).toBe(true);
  });

  it("an outage is the core's word — the caller says 'no disponible', never 'sin resultados' (FR-028)", async () => {
    const { caps } = await capabilities();
    mockCustomerSearchFails(503);
    await expect(caps.customerSearch!.find("gua", 10)).rejects.toMatchObject({ code: "INTEGRATION_UNAVAILABLE" });
  });
});

describe("cash-at-stores US1 — customerDebt names its customer, with no phone (D8)", () => {
  it("owes: the debt's two halves and the customer block", async () => {
    const { caps } = await capabilities();
    mockCustomerDebt(
      { usuario: "greyes@wifiplus", nombre: "Guadalupe Reyes", zona: "Centro", telefono: "5512345678", saldo: "299.00" },
      [{ id: 42, total: "499.00" }],
    );
    const answer = await caps.customerDebt!.of("greyes@wifiplus");
    expect(answer).toMatchObject({
      state: "owes",
      totalCents: 79800,
      invoiceCents: 49900,
      carriedBalanceCents: 29900,
      customer: { providerCustomerId: "6", name: "Guadalupe Reyes", zone: "Centro" },
    });
    expect(JSON.stringify(answer)).not.toContain("5512345678");
  });

  it("none: a proven zero still names the customer", async () => {
    const { caps } = await capabilities();
    mockCustomerDebt({ usuario: "greyes@wifiplus", nombre: "Guadalupe Reyes", zona: "Centro" }, []);
    expect(await caps.customerDebt!.of("greyes@wifiplus")).toMatchObject({
      state: "none",
      totalCents: 0,
      customer: { name: "Guadalupe Reyes" },
    });
  });
});

describe("cash-at-stores US1 — paymentActions speaks the core's words (D9)", () => {
  const input = (business: { id: string; timezone: string }) => ({
    business,
    usuario: "greyes@wifiplus",
    providerCustomerId: "6",
    registeredCents: 49900,
    invoiceId: 42,
    paymentRegistered: false,
    reconnect: true,
    now: new Date(),
  });
  /* bug: transferred-invoice-paid — the invoice is asked about first (the
     detail route's measured shape), then the opt-in */
  const optIn = () => {
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "GET", path: "/api/facturas/42/" })
      .reply(...json({ id_factura: 42, estado: "Pendiente de Pago" }));
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "PATCH", path: "/api/clientes/6/" })
      .reply(...json({ auto_activar_servicio: true }));
  };

  it("a refused key (401) is INTEGRATION_AUTH_FAILED, and the attempt stays queued", async () => {
    const { business, caps } = await capabilities();
    optIn();
    fetchMock.get(WISPHUB).intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") }).reply(401, "{}");
    expect(await caps.paymentActions!.attempt(input(business))).toEqual({
      status: "queued",
      paymentRegistered: false,
      invoiceId: 42,
      error: "INTEGRATION_AUTH_FAILED",
    });
  });

  it("an outage (503) is INTEGRATION_UNAVAILABLE", async () => {
    const { business, caps } = await capabilities();
    optIn();
    fetchMock.get(WISPHUB).intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") }).reply(503, "{}");
    expect((await caps.paymentActions!.attempt(input(business))).error).toBe("INTEGRATION_UNAVAILABLE");
  });

  it("register-only lands `withheld`, with the router never asked", async () => {
    const { business, caps } = await capabilities();
    optIn();
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "POST", path: "/api/facturas/42/registrar-pago/", body: (raw) => JSON.parse(String(raw)).accion === 0 })
      .reply(...json({ messages: ["ok"] }));
    expect(await caps.paymentActions!.attempt({ ...input(business), reconnect: false })).toEqual({
      status: "withheld",
      paymentRegistered: true,
      invoiceId: 42,
      error: null,
    });
  });
});

describe("cash-at-stores US1 — a cash row cannot disturb its link's SPEI rules (D12)", () => {
  it("the payer's hourly attempt budget counts SPEI attempts only", async () => {
    /* No CLABE: a request that passes the budget meets SPEI_NOT_CONFIGURED,
       one that does not is refused TOO_MANY_ATTEMPTS — the answer tells
       which rule spoke */
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const { store } = await seedActiveStore();
    for (let i = 0; i < 6; i++) await seedStorePayment(business, store);
    const [link] = await db().select().from(paymentLinks);
    const pay = async () =>
      (await app()).request(
        `/direct-payments/links/${link.token}/pay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transfer: { trackingKey: "TRACK001XYZ", senderBank: "NUBANK", date: "2026-08-17" } }),
        },
        env,
      );
    const passed = await pay();
    expect((await passed.json()).error.code).toBe("SPEI_NOT_CONFIGURED");

    /* the control: five SPEI attempts on the same link do spend it */
    for (let i = 0; i < 5; i++) {
      await db().insert(payments).values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        status: "invalid",
      });
    }
    const refused = await pay();
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("an earlier invalid SPEI row keeps its fee when a cash row of the same link is debited", async () => {
    const business = await seedBusiness();
    const { store } = await seedActiveStore();
    const contradicted = await seedConfirmedPayment(business, { status: "invalid", folio: null });
    await debitValidationFee(env as unknown as Bindings, db(), contradicted);
    const cash = await seedStorePayment(business, store);
    expect(cash.paymentLinkId).toBe(contradicted.paymentLinkId);

    expect(await debitValidationFee(env as unknown as Bindings, db(), cash)).toBe(true);
    const reversals = await db()
      .select()
      .from(creditEntries)
      .where(and(eq(creditEntries.kind, "fee_reversal"), eq(creditEntries.paymentId, contradicted.id)));
    expect(reversals).toHaveLength(0);

    /* the control: a confirmed SPEI row of the same link does refund it */
    const spei = await seedConfirmedPayment(business, { status: "confirmed" });
    await debitValidationFee(env as unknown as Bindings, db(), spei);
    expect(
      await db().select().from(creditEntries).where(and(eq(creditEntries.kind, "fee_reversal"), eq(creditEntries.paymentId, contradicted.id))),
    ).toHaveLength(1);
  });

  it("the incident history of a provisional release reads the link's SPEI attempts, never a cash row", async () => {
    const business = await seedBusiness();
    const { store } = await seedActiveStore();
    const ride = await seedConfirmedPayment(business, { status: "validating", folio: null });
    /* an incident word on a cash row — no real cash row carries one; the
       filter is what keeps it out either way */
    await seedStorePayment(business, store, { lastError: "TRANSFER_CONTRADICTED" });
    expect(await isRevoked(db(), ride, new Date())).toBe(false);

    await seedConfirmedPayment(business, { status: "invalid", lastError: "TRANSFER_CONTRADICTED", folio: null });
    expect(await isRevoked(db(), ride, new Date())).toBe(true);
  });
});

describe("cash-at-stores US1 — the link keeps the integration's customer id as given (T070, constitution IX)", () => {
  it("an id that is not a number is stored untouched, and a second call returns the same link", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const { ensureLink } = await import("../src/direct-payments/links");
    const first = await ensureLink(db(), business.id, { usuario: "greyes@wifiplus", providerCustomerId: "cus_A7x9" });
    expect(first.created).toBe(true);
    const again = await ensureLink(db(), business.id, { usuario: "greyes@wifiplus", providerCustomerId: "cus_A7x9" });
    expect(again).toEqual({ token: first.token, created: false });
    const [link] = await db().select().from(paymentLinks).where(eq(paymentLinks.token, first.token));
    expect(link.wisphubCustomerId).toBe("cus_A7x9");
  });
});

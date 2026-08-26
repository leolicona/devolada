import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { ledgerEntries } from "../src/db/schema";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/charges/charge-confirm.spec.md scenarios 1–4 and
   docs/charges/debt-truth.spec.md scenario 4 (US-C06). */

const WISPHUB_ORIGIN = "https://api.wisphub.net";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const wisphubCustomer = {
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely",
  estado: "Suspendido",
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: { id: 71342, nombre: "Zona dia 15" },
};

function mockWispHubUserLookup(results: unknown[] = [wisphubCustomer]) {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario="),
    })
    .reply(200, JSON.stringify({ count: results.length, results }), {
      headers: { "Content-Type": "application/json" },
    });
}

/* Debt truth (debt-truth spec D1): the quote's billingStatus comes from
   the pending-invoice list, not from estado_facturas. */
function mockPendingInvoices(
  results: { id_factura: number; cliente: { usuario: string }; total: number }[] = [
    { id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 },
  ],
) {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1"),
    })
    .reply(200, JSON.stringify({ next: null, count: results.length, results }), {
      headers: { "Content-Type": "application/json" },
    });
}

const asStore = { headers: { Cookie: await sessionCookieHeader("5512345678") } };
const QUOTE_PATH = "/charges/customers/greyes%40wifiplus";

describe("US-C02: the quote is computed server-side", () => {
  it("returns the customer and the breakdown (total = monthly + service fee)", async () => {
    const isp = await seedIsp({ wisphubApiKey: "wh-key-1", serviceFeeCents: 1500 });
    await seedStore(isp.id);
    mockWispHubUserLookup();
    mockPendingInvoices();

    const res = await (await app()).request(QUOTE_PATH, asStore, env);
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.customer).toMatchObject({
      usuario: "greyes@wifiplus",
      name: "Janely",
      serviceStatus: "suspended",
      billingStatus: "due",
    });
    expect(data.quote).toEqual({
      invoiceCents: 49900,
      /* debt-truth D11: its own field, zero when nothing is carried */
      carriedBalanceCents: 0,
      serviceFeeCents: 1500,
      totalCents: 51400,
    });
    expect(data.cap.blocked).toBe(false);
  });

  it("zero pending invoices → 'paid', whatever the stale label says (US-C06)", async () => {
    const isp = await seedIsp({ wisphubApiKey: "wh-key-1" });
    await seedStore(isp.id);
    /* The double-charge window: label still due, nothing actually owed */
    mockWispHubUserLookup([{ ...wisphubCustomer, estado_facturas: "Pendiente de Pago" }]);
    mockPendingInvoices([]);

    const res = await (await app()).request(QUOTE_PATH, asStore, env);
    expect((await res.json()).data.customer.billingStatus).toBe("paid");
  });

  it("a pending invoice → 'due', even when the label says Pagadas (US-C06)", async () => {
    const isp = await seedIsp({ wisphubApiKey: "wh-key-1" });
    await seedStore(isp.id);
    /* The freshly-invoiced customer the label has not caught up with */
    mockWispHubUserLookup([{ ...wisphubCustomer, estado_facturas: "Pagadas" }]);
    mockPendingInvoices();

    const res = await (await app()).request(QUOTE_PATH, asStore, env);
    expect((await res.json()).data.customer.billingStatus).toBe("due");
  });

  it("unknown usuario returns 404 CUSTOMER_NOT_FOUND", async () => {
    const isp = await seedIsp({ wisphubApiKey: "wh-key-1" });
    await seedStore(isp.id);
    mockWispHubUserLookup([]);

    const res = await (await app()).request(QUOTE_PATH, asStore, env);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("CUSTOMER_NOT_FOUND");
  });
});

describe("US-K04: the balance cap blocks new charges", () => {
  it("a ledger balance at the cap sets cap.blocked", async () => {
    const isp = await seedIsp({ wisphubApiKey: "wh-key-1" });
    const store = await seedStore(isp.id, { balanceCapCents: 100000 });
    /* The scenario is built with ledger entries, like production does */
    const db = drizzle(env.DB);
    await db.insert(ledgerEntries).values([
      { storeId: store.id, type: "charge", cents: 60000 },
      { storeId: store.id, type: "charge", cents: 41500 },
      { storeId: store.id, type: "commission", cents: -900 },
    ]);
    mockWispHubUserLookup();
    mockPendingInvoices();

    const res = await (await app()).request(QUOTE_PATH, asStore, env);
    const { data } = await res.json();
    expect(data.cap).toEqual({ balanceCents: 100600, capCents: 100000, blocked: true });
  });
});

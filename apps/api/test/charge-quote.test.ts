import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { ledgerEntries } from "../src/db/schema";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/charges/charge-confirm.spec.md scenarios 1–4. */

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

const asStore = { headers: { Cookie: sessionCookieHeader("5512345678") } };
const QUOTE_PATH = "/charges/customers/greyes%40wifiplus";

describe("US-C02: the quote is computed server-side", () => {
  it("returns the customer and the breakdown (total = monthly + service fee)", async () => {
    const isp = await seedIsp({ wisphubApiKey: "wh-key-1", serviceFeeCents: 1500 });
    await seedStore(isp.id);
    mockWispHubUserLookup();

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
      monthlyFeeCents: 49900,
      serviceFeeCents: 1500,
      totalCents: 51400,
    });
    expect(data.cap.blocked).toBe(false);
  });

  it("maps estado_facturas 'Pagadas' to billingStatus 'paid'", async () => {
    const isp = await seedIsp({ wisphubApiKey: "wh-key-1" });
    await seedStore(isp.id);
    mockWispHubUserLookup([{ ...wisphubCustomer, estado_facturas: "Pagadas" }]);

    const res = await (await app()).request(QUOTE_PATH, asStore, env);
    expect((await res.json()).data.customer.billingStatus).toBe("paid");
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

    const res = await (await app()).request(QUOTE_PATH, asStore, env);
    const { data } = await res.json();
    expect(data.cap).toEqual({ balanceCents: 100600, capCents: 100000, blocked: true });
  });
});

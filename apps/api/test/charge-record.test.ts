import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { charges, ledgerEntries } from "../src/db/schema";
import { storeBalanceCents } from "../src/ledger";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/charges/charge-record.spec.md scenarios 1–7. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const wisphubCustomer = (estado = "Suspendido") => ({
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely",
  estado,
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  zona: { id: 71342, nombre: "Zona dia 15" },
});

const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const json = (body: unknown) => [
  200,
  JSON.stringify(body),
  { headers: { "Content-Type": "application/json" } },
] as const;

function mockCustomerLookup(results: unknown[], times = 1) {
  wh()
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario="),
    })
    .reply(...json({ count: results.length, results }))
    .times(times);
}

/* The full happy reconnection: payment methods → look for a pending
   invoice (reconnection-queue D1) → create → payment → verify */
function mockReconnection(verifyEstado = "Activo") {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
    .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
    .reply(...json({ count: 0, results: [] }));
  wh()
    .intercept({ method: "POST", path: "/api/facturas/" })
    .reply(...json({ messages: "Se genero correctamente la factura 42." }));
  wh()
    .intercept({ method: "POST", path: "/api/facturas/42/registrar-pago/" })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
  mockCustomerLookup([wisphubCustomer(verifyEstado)]);
}

async function seedChargeableStore(overrides: Parameters<typeof seedStore>[1] = {}) {
  const isp = await seedIsp({
    wisphubApiKey: "wh-key-1",
    serviceFeeCents: 1500,
    storeCommissionCents: 900,
  });
  const store = await seedStore(isp.id, overrides);
  return { isp, store };
}

const asStore = { headers: { Cookie: await sessionCookieHeader("5512345678") } };
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...asStore.headers },
  body: JSON.stringify(body),
});

describe("US-C04: record first, reconnect second", () => {
  it("records the charge and exactly two ledger entries", async () => {
    const { store } = await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]);
    mockReconnection();

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.folio).toMatch(/^DV-[0-9A-Z]{6}$/);
    expect(data.totalCents).toBe(51400);

    const db = drizzle(env.DB);
    const entries = await db.select().from(ledgerEntries);
    expect(entries).toHaveLength(2);
    /* balance = total in − commission kept by the store */
    expect(await storeBalanceCents(db, store.id)).toBe(51400 - 900);
  });

  it("WispHub down after the guards → still 201, status queued", async () => {
    await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]);
    /* the reconnection attempt fails at the first step */
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(500, "boom");

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.reconnectionStatus).toBe("queued");

    const db = drizzle(env.DB);
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });
});

describe("US-C03: only a verified active service is 'reconnected'", () => {
  it("invoice + payment + verified active → reconnected", async () => {
    await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]);
    mockReconnection("Activo");

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect((await res.json()).data.reconnectionStatus).toBe("reconnected");
  });

  it("payment ok but service still suspended → stays queued", async () => {
    await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]);
    mockReconnection("Suspendido");

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect((await res.json()).data.reconnectionStatus).toBe("queued");
  });
});

describe("US-C04: server-side guards", () => {
  it("paid customer → 409 NOTHING_DUE and no rows written", async () => {
    await seedChargeableStore();
    mockCustomerLookup([{ ...wisphubCustomer(), estado_facturas: "Pagadas" }]);

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOTHING_DUE");

    const db = drizzle(env.DB);
    expect(await db.select().from(charges)).toHaveLength(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("balance at the cap → 409 BALANCE_CAP_EXCEEDED and no rows written", async () => {
    const { store } = await seedChargeableStore({ balanceCapCents: 1000 });
    const db = drizzle(env.DB);
    await db.insert(ledgerEntries).values({ storeId: store.id, type: "charge", cents: 1000 });
    mockCustomerLookup([wisphubCustomer()]);

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("BALANCE_CAP_EXCEEDED");
    expect(await db.select().from(charges)).toHaveLength(0);
  });
});

describe("US-C03: the store reads its own charge status", () => {
  it("GET returns the own charge; a foreign charge → 404", async () => {
    const { isp } = await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]);
    mockReconnection();
    const created = await (
      await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env)
    ).json();

    const own = await (await app()).request(`/charges/${created.data.id}`, asStore, env);
    expect(own.status).toBe(200);
    expect((await own.json()).data.folio).toBe(created.data.folio);

    /* another store of the same ISP must not see it */
    await seedStore(isp.id, { phone: "5599999999" });
    const foreign = await (await app()).request(`/charges/${created.data.id}`, {
      headers: { Cookie: await sessionCookieHeader("5599999999") },
    }, env);
    expect(foreign.status).toBe(404);
  });
});

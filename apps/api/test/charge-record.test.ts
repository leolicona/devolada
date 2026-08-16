import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { charges, ledgerEntries } from "../src/db/schema";
import { storeBalanceCents } from "../src/ledger";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/charges/charge-record.spec.md scenarios 1–7 and
   docs/charges/debt-truth.spec.md scenarios 1, 2 and 5 (US-C06). */

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

/* The guard's question (debt-truth spec D5): the pending-invoice list.
   The default holds invoice 42 for the demo customer. */
function mockPendingInvoices(
  results: { id_factura: number; cliente: { usuario: string } }[] = [
    { id_factura: 42, cliente: { usuario: "greyes@wifiplus" } },
  ],
) {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
    .reply(...json({ next: null, count: results.length, results }));
}

/* The happy reconnection with the invoice already resolved by the guard
   (debt-truth D5): payment methods → payment → verify. No find, and no
   create — a POST /api/facturas/ here would fail the test. */
function mockReconnection(verifyEstado = "Activo") {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
    .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
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
    mockPendingInvoices();
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
    mockPendingInvoices();
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
    mockPendingInvoices();
    mockReconnection("Activo");

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect((await res.json()).data.reconnectionStatus).toBe("reconnected");
  });

  it("payment ok but service still suspended → stays queued", async () => {
    await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    mockReconnection("Suspendido");

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect((await res.json()).data.reconnectionStatus).toBe("queued");
  });
});

describe("US-C04 / US-C06: server-side guards ask the invoices, not the label", () => {
  it("zero pending invoices → 409 NOTHING_DUE even with a stale due label", async () => {
    /* debt-truth spec scenario 1: the double-charge window. The label
       still says due; the invoices say nothing is owed. No POST
       /api/facturas/ interceptor — fabricating one fails the test. */
    await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]); /* estado_facturas: Pendiente de Pago */
    mockPendingInvoices([]);

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOTHING_DUE");

    const db = drizzle(env.DB);
    expect(await db.select().from(charges)).toHaveLength(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("a pending invoice → charge proceeds and pays it, even with a stale Pagadas label", async () => {
    /* debt-truth spec scenario 2: the freshly-invoiced customer whose
       label has not caught up. The charge pays invoice 42 — no create. */
    await seedChargeableStore();
    mockCustomerLookup([{ ...wisphubCustomer(), estado_facturas: "Pagadas" }]);
    mockPendingInvoices();
    mockReconnection();

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(201);

    const db = drizzle(env.DB);
    const [row] = await db.select().from(charges);
    expect(row.wisphubInvoiceId).toBe(42);
  });

  it("a truncated pending list falls back to the label (debt-truth D4)", async () => {
    /* debt-truth spec scenario 5: five pages, always a next link, the
       customer never in them. The guard cannot prove "owes nothing", so
       the due label lets the charge through and the reconnection takes
       the old find-then-create path. */
    await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]);
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
      .reply(
        ...json({
          next: "http://api.wisphub.net/api/facturas/?estado=1&offset=100",
          count: 600,
          results: [{ id_factura: 7, cliente: { usuario: "otro@wifiplus" } }],
        }),
      )
      .times(10); /* 5 pages for the guard + 5 for the reconnection's find */
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
    wh()
      .intercept({ method: "POST", path: "/api/facturas/" })
      .reply(...json({ messages: "Se genero correctamente la factura 91." }));
    wh()
      .intercept({ method: "POST", path: "/api/facturas/91/registrar-pago/" })
      .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
    mockCustomerLookup([wisphubCustomer("Activo")]);

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(201);
    expect((await res.json()).data.reconnectionStatus).toBe("reconnected");
  });

  it("balance at the cap → 409 BALANCE_CAP_EXCEEDED and no rows written", async () => {
    const { store } = await seedChargeableStore({ balanceCapCents: 1000 });
    const db = drizzle(env.DB);
    await db.insert(ledgerEntries).values({ storeId: store.id, type: "charge", cents: 1000 });
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();

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
    mockPendingInvoices();
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

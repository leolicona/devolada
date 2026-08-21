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
  saldo: "0.00",
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
  results: { id_factura: number; cliente: { usuario: string }; total: number }[] = [
    { id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 },
  ],
  times = 1,
) {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
    .reply(...json({ next: null, count: results.length, results }))
    .times(times);
}

/* The happy reconnection with the invoice already resolved by the guard
   (debt-truth D5): auto-activate opt-in → payment methods → payment →
   verify. No find, and no create — a POST /api/facturas/ here would
   fail the test, and an unfired PATCH fails it too (D9). */
function mockReconnection(verifyEstado = "Activo") {
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
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
          results: [{ id_factura: 7, cliente: { usuario: "otro@wifiplus" }, total: 499 }],
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

/* docs/charges/debt-truth.spec.md (2026-08-20 revision) scenarios 1, 3,
   5, 6, 7 and 10 — US-C08. Every one of them is a customer the product
   could not charge correctly before, and the defect needed no partial
   payment from Devolada: an ISP taking a short payment in their own
   panel is enough to produce it. */
describe("US-C08: the debt is the invoices plus what was carried", () => {
  /* Captures what actually travels to registrar-pago. The amount is the
     whole debt (D15), because WispHub applies a payment to the customer
     and not to the invoice named in the URL. */
  function mockReconnectionCapturing(invoiceId: number) {
    const seen: { totalCobrado?: number } = {};
    wh()
      .intercept({ method: "PATCH", path: "/api/clientes/6/" })
      .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
    wh()
      .intercept({
        method: "POST",
        path: `/api/facturas/${invoiceId}/registrar-pago/`,
        body: (raw) => {
          seen.totalCobrado = JSON.parse(String(raw)).total_cobrado;
          return true;
        },
      })
      .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
    mockCustomerLookup([wisphubCustomer("Activo")]);
    return seen;
  }

  it("scenario 1: no pending invoice, label 'Pagadas', saldo 199 → charged, not refused", async () => {
    /* The F17 state, exactly: a short payment closed the invoice and the
       remainder went to `saldo`. Before this spec the guard read an empty
       invoice list and answered NOTHING_DUE — a real debt nobody could
       collect through either channel. */
    await seedChargeableStore();
    mockCustomerLookup([
      { ...wisphubCustomer(), estado_facturas: "Pagadas", saldo: "199.00" },
    ]);
    /* twice: the guard asks, and the reconnection asks again before it
       decides to create the vehicle */
    mockPendingInvoices([], 2);
    /* D15: nothing pending, so the payment needs an empty vehicle — an
       invoice sized to the 199.00 would raise the debt to 398.00 */
    const created: { total?: number } = {};
    wh()
      .intercept({
        method: "POST",
        path: "/api/facturas/",
        body: (raw) => {
          created.total = JSON.parse(String(raw)).total;
          return true;
        },
      })
      .reply(...json({ messages: "Se genero correctamente la factura 91." }));
    const seen = mockReconnectionCapturing(91);

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    /* 199 carried + 15 service fee — the plan's 499 never enters */
    expect(data.totalCents).toBe(19900 + 1500);
    expect(created.total).toBe(0);
    expect(seen.totalCobrado).toBe(199);

    const [charge] = await drizzle(env.DB).select().from(charges);
    expect(charge.invoiceCents).toBe(0);
    expect(charge.carriedBalanceCents).toBe(19900);
  });

  it("scenario 3: the invoice total wins over precio_plan, and it is what gets registered", async () => {
    /* The reconnection charge case: the plan says 499, the invoice says
       649. Registering 499 against it would leave 150 carried — the
       product manufacturing the defect above (D10). */
    await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices([{ id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 649 }]);
    const seen = mockReconnectionCapturing(42);

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(201);
    expect((await res.json()).data.totalCents).toBe(64900 + 1500);
    expect(seen.totalCobrado).toBe(649);

    const [charge] = await drizzle(env.DB).select().from(charges);
    expect(charge.invoiceCents).toBe(64900);
    expect(charge.carriedBalanceCents).toBe(0);
  });

  it("scenario 4: invoice and carried balance stay separate on the row", async () => {
    await seedChargeableStore();
    mockCustomerLookup([{ ...wisphubCustomer(), saldo: "150.00" }]);
    mockPendingInvoices();
    const seen = mockReconnectionCapturing(42);

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(201);
    expect((await res.json()).data.totalCents).toBe(49900 + 15000 + 1500);
    /* one call, the whole account (D15) */
    expect(seen.totalCobrado).toBe(649);

    const [charge] = await drizzle(env.DB).select().from(charges);
    expect(charge.invoiceCents).toBe(49900);
    expect(charge.carriedBalanceCents).toBe(15000);
  });

  it("scenario 5: a credit lowers the charge, and a big enough one means nothing is due", async () => {
    await seedChargeableStore();
    mockCustomerLookup([{ ...wisphubCustomer(), saldo: "-100.00" }]);
    mockPendingInvoices();
    const seen = mockReconnectionCapturing(42);

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(201);
    /* 499 − 100 credit + 15 fee. D12: the credit is netted, never shown
       as a balance the customer could ask us to pay out. */
    expect((await res.json()).data.totalCents).toBe(39900 + 1500);
    expect(seen.totalCobrado).toBe(399);
    const [charge] = await drizzle(env.DB).select().from(charges);
    expect(charge.carriedBalanceCents).toBe(0);
  });

  it("scenario 5b: a credit larger than the invoice → NOTHING_DUE", async () => {
    await seedChargeableStore();
    mockCustomerLookup([{ ...wisphubCustomer(), saldo: "-600.00" }]);
    mockPendingInvoices();

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOTHING_DUE");
    expect(await drizzle(env.DB).select().from(charges)).toHaveLength(0);
  });

  it("scenario 6: a carried balance proves a debt even when the list is truncated", async () => {
    /* D14: `saldo` comes from the customer record, which is never
       truncated, so the label fallback is not reached at all here. */
    await seedChargeableStore();
    mockCustomerLookup([
      { ...wisphubCustomer(), estado_facturas: "Pagadas", saldo: "250.00" },
    ]);
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
      .reply(
        ...json({
          next: "http://api.wisphub.net/api/facturas/?estado=1&offset=100",
          count: 600,
          results: [{ id_factura: 7, cliente: { usuario: "otro@wifiplus" }, total: 499 }],
        }),
      )
      .times(10);
    wh()
      .intercept({ method: "POST", path: "/api/facturas/" })
      .reply(...json({ messages: "Se genero correctamente la factura 91." }));
    const seen = mockReconnectionCapturing(91);

    const res = await (await app()).request("/charges", post({ usuario: "greyes@wifiplus" }), env);
    expect(res.status).toBe(201);
    expect(seen.totalCobrado).toBe(250);
  });
});

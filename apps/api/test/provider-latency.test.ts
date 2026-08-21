import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { charges, ledgerEntries } from "../src/db/schema";
import { WispHub } from "../src/wisphub/client";
import { cashPaymentMethodId, pendingInvoicesForDisplay } from "../src/wisphub/cache";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/polish/provider-latency.spec.md scenarios 1–12 (US-P06).

   WispHub stalls on about one call in eight and never recovers from
   those stalls (measured 2026-08-18 against the live demo tenant). The
   provider is not ours to fix; the arithmetic around it is. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const json = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

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

/* What `AbortSignal.timeout` throws when the deadline fires. Simulated
   rather than waited for: a real 5s stall in a test would be a 5s test,
   and scenario 1 already proves the deadline fires for real. */
const stalled = () => new DOMException("The operation was aborted", "TimeoutError");

const clientes = (p: string) => p.startsWith("/api/clientes/");
const facturas = (p: string) => p.startsWith("/api/facturas/?") && p.includes("estado=1");
const formasDePago = (p: string) => p.startsWith("/api/formas-de-pago/");

function mockCustomerLookup(results: unknown[], times = 1) {
  wh()
    .intercept({ method: "GET", path: (p) => clientes(p) && p.includes("usuario=") })
    .reply(...json({ count: results.length, results }))
    .times(times);
}

function mockPendingInvoices(
  results: { id_factura: number; cliente: { usuario: string }; total: number }[] = [
    { id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 },
  ],
) {
  wh()
    .intercept({ method: "GET", path: facturas })
    .reply(...json({ next: null, count: results.length, results }));
}

function mockReconnection(verifyEstado = "Activo", paymentMethodCached = false) {
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
  if (!paymentMethodCached) {
    wh()
      .intercept({ method: "GET", path: formasDePago })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  }
  wh()
    .intercept({ method: "POST", path: "/api/facturas/42/registrar-pago/" })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
  mockCustomerLookup([wisphubCustomer(verifyEstado)]);
}

async function seedChargeableStore() {
  const isp = await seedIsp({
    wisphubApiKey: "wh-key-1",
    serviceFeeCents: 1500,
    storeCommissionCents: 900,
  });
  const store = await seedStore(isp.id);
  return { isp, store };
}

const asStore = { headers: { Cookie: await sessionCookieHeader("5512345678") } };
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...asStore.headers },
  body: JSON.stringify(body),
});
const chargeBody = post({ usuario: "greyes@wifiplus" });

describe("US-P06: every provider call has a deadline (D1)", () => {
  it("scenario 1: a call that never answers raises WISPHUB_UNAVAILABLE at the deadline", async () => {
    /* A real deadline against a real delay — the one place this suite
       waits, because a mocked abort would prove only the mapping. */
    wh()
      .intercept({ method: "GET", path: formasDePago })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }))
      .delay(400);

    const provider = new WispHub("wh-key-1", undefined, { callMs: 60, operationMs: 5_000 });
    await expect(provider.getCashPaymentMethodId()).rejects.toMatchObject({
      code: "WISPHUB_UNAVAILABLE",
      message: expect.stringContaining("timed out"),
    });
  });

  it("scenario 2: a spent budget fails the next call without opening a connection", async () => {
    wh()
      .intercept({ method: "GET", path: formasDePago })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }))
      .delay(150);

    /* The budget is smaller than the first call, so by the time the
       second is asked for there is no time left to spend. */
    const provider = new WispHub("wh-key-1", undefined, { callMs: 500, operationMs: 100 });
    await provider.getCashPaymentMethodId().catch(() => undefined);

    /* No interceptor is registered for this second call on purpose: if
       it reached the network at all, the mock agent would answer with a
       "not matched" error instead of this message. */
    await expect(provider.getCashPaymentMethodId()).rejects.toMatchObject({
      code: "WISPHUB_UNAVAILABLE",
      message: "operation budget spent",
    });
  });
});

describe("US-P06: a deadline is an outage, not a rejection (D6)", () => {
  it("scenario 3: a pre-charge timeout answers 503 and records nothing", async () => {
    await seedChargeableStore();
    wh().intercept({ method: "GET", path: clientes }).replyWithError(stalled());
    wh().intercept({ method: "GET", path: facturas }).replyWithError(stalled());

    const res = await (await app()).request("/charges", chargeBody, env);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("WISPHUB_UNAVAILABLE");

    const db = drizzle(env.DB);
    expect(await db.select().from(charges)).toHaveLength(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("scenario 4: a timeout during the reconnection keeps the charge, queued", async () => {
    await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    /* The guard passed; the money is already the store's problem. What
       stalls now is the reconnection, which is exactly what the queue
       exists for (US-C04). */
    wh().intercept({ method: "PATCH", path: "/api/clientes/6/" }).replyWithError(stalled());
    wh().intercept({ method: "GET", path: formasDePago }).replyWithError(stalled());

    const res = await (await app()).request("/charges", chargeBody, env);
    expect(res.status).toBe(201);
    expect((await res.json()).data.reconnectionStatus).toBe("queued");

    const db = drizzle(env.DB);
    const [row] = await db.select().from(charges);
    expect(row.lastError).toBe("WISPHUB_UNAVAILABLE");
    expect(row.nextAttemptAt).not.toBeNull();
    /* The ledger is untouched by a provider stall: charge + commission */
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });
});

describe("US-P06: the pending list is cached for display only (D3)", () => {
  it("scenario 6: two display reads share one fetch; past the window it fetches again", async () => {
    const provider = new WispHub("wh-key-1");
    const at = (ms: number) => new Date(Date.parse("2026-08-18T12:00:00Z") + ms);

    mockPendingInvoices();
    const first = await pendingInvoicesForDisplay("isp-1", provider, at(0));
    const second = await pendingInvoicesForDisplay("isp-1", provider, at(29_000));
    expect(second).toEqual(first);

    /* Past 30s the entry is gone, so this second interceptor is the
       proof the provider was asked again. */
    mockPendingInvoices([]);
    const third = await pendingInvoicesForDisplay("isp-1", provider, at(31_000));
    expect(third.invoices).toHaveLength(0);
  });

  it("scenario 7: two ISPs never share a cached list", async () => {
    const provider = new WispHub("wh-key-1");
    const now = new Date("2026-08-18T12:00:00Z");

    mockPendingInvoices();
    mockPendingInvoices([]);
    const mine = await pendingInvoicesForDisplay("isp-1", provider, now);
    const theirs = await pendingInvoicesForDisplay("isp-2", provider, now);

    /* Both interceptors consumed: one tenant's debt never answers for
       another's, however close together they ask. */
    expect(mine.invoices).toHaveLength(1);
    expect(theirs.invoices).toHaveLength(0);
  });

  it("scenario 10: a failed fetch is not cached — the next call retries the provider", async () => {
    const provider = new WispHub("wh-key-1");
    const now = new Date("2026-08-18T12:00:00Z");

    wh().intercept({ method: "GET", path: facturas }).replyWithError(stalled());
    await expect(pendingInvoicesForDisplay("isp-1", provider, now)).rejects.toMatchObject({
      code: "WISPHUB_UNAVAILABLE",
    });

    /* A remembered failure would be a 30-second outage of our own making */
    mockPendingInvoices();
    const retried = await pendingInvoicesForDisplay("isp-1", provider, now);
    expect(retried.invoices).toHaveLength(1);
  });

  it("scenario 5: a customer WispHub does not have is a 404, even when the list also fails", async () => {
    await seedChargeableStore();
    /* Both reads are in flight together (D2). The customer's answer
       still decides first — `Promise.all` would have reported the
       provider outage and lost the 404. */
    mockCustomerLookup([]);
    wh().intercept({ method: "GET", path: facturas }).replyWithError(stalled());

    const res = await (await app()).request(
      "/charges/customers/greyes@wifiplus",
      asStore,
      env,
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("CUSTOMER_NOT_FOUND");
  });
});

describe("US-P06: a charge invalidates its tenant's cached list (D4)", () => {
  it("scenario 8: a search right after a charge sees the new truth, not the old one", async () => {
    await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    mockReconnection();
    const charged = await (await app()).request("/charges", chargeBody, env);
    expect(charged.status).toBe(201);

    /* The debt is settled now. Without the invalidation this search
       would read the pre-charge list for another 30 seconds and tell the
       shopkeeper the customer still owes — the confusion US-C06 was
       written to end. */
    wh()
      .intercept({ method: "GET", path: (p) => clientes(p) && p.includes("nombre=") })
      .reply(...json({ count: 1, results: [wisphubCustomer("Activo")] }));
    mockPendingInvoices([]);

    const res = await (await app()).request("/charges/customers?q=Janely", asStore, env);
    expect((await res.json()).data.customers[0].billingStatus).toBe("paid");
  });

  it("scenario 9: the second charge reads fresh and still refuses with NOTHING_DUE", async () => {
    await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    mockReconnection();
    expect((await (await app()).request("/charges", chargeBody, env)).status).toBe(201);

    /* The guard never reads the cache (D3), so the empty list it gets
       here is the provider's, not a memory of one. debt-truth D5 holds. */
    mockCustomerLookup([wisphubCustomer("Activo")]);
    mockPendingInvoices([]);
    const res = await (await app()).request("/charges", chargeBody, env);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOTHING_DUE");

    const db = drizzle(env.DB);
    expect(await db.select().from(charges)).toHaveLength(1);
  });
});

describe("US-P06: the cash payment method is cached (D5)", () => {
  it("scenario 11: two charges in a row make one payment-method lookup", async () => {
    await seedChargeableStore();
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    mockReconnection();
    expect((await (await app()).request("/charges", chargeBody, env)).status).toBe(201);

    /* No second `formas-de-pago` interceptor: the catalog answer is held
       for the tenant. An unconsumed one would fail this file's
       afterEach, which is the assertion. */
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    mockReconnection("Activo", true);
    expect((await (await app()).request("/charges", chargeBody, env)).status).toBe(201);

    const db = drizzle(env.DB);
    expect(await db.select().from(charges)).toHaveLength(2);
  });

  it("scenario 11b: a second tenant asks the provider for its own", async () => {
    const now = new Date("2026-08-18T12:00:00Z");
    const provider = new WispHub("wh-key-1");
    wh()
      .intercept({ method: "GET", path: formasDePago })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
    wh()
      .intercept({ method: "GET", path: formasDePago })
      .reply(...json({ results: [{ id: 9, nombre: "Efectivo" }] }));

    expect(await cashPaymentMethodId("isp-1", provider, now)).toBe(7);
    expect(await cashPaymentMethodId("isp-1", provider, now)).toBe(7);
    expect(await cashPaymentMethodId("isp-2", provider, now)).toBe(9);
  });
});

describe("US-P06: the configured base is the one called (D7)", () => {
  it("scenario 12: the adapter calls the base it was given, not the default", async () => {
    /* The charge path used to build its client without the configured
       base, so it was the one surface that could not be pointed at a
       sandbox. `storeContext` now passes `c.env.WISPHUB_BASE_URL`; the
       adapter half of that is what this asserts. The route half is held
       by the pin in vitest.config.ts, which makes the configured base
       and the default the same string in this suite (TESTING.md rule 8)
       — so a test cannot tell them apart here by design. */
    fetchMock
      .get("https://sandbox-api.wisphub.net")
      .intercept({ method: "GET", path: formasDePago })
      .reply(...json({ results: [{ id: 3, nombre: "Efectivo" }] }));

    const provider = new WispHub("wh-key-1", "https://sandbox-api.wisphub.net/api");
    expect(await provider.getCashPaymentMethodId()).toBe(3);
  });
});

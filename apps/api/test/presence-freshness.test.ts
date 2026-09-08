import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { app, seedBusiness, seedConfirmedPayment, sessionCookieHeader } from "./helpers";
import { resetProviderCaches } from "../src/wisphub/cache";

/* docs/legacy/polish/presence-freshness.spec.md (US-P07), API side: the pulse
   (scenario 7), the colo cache keyed by the tenant's last registration
   (scenario 8, provider-latency D4 by key) and the honest readAt
   (scenarios 8–9, BUG-018). Scenario 10 is provider-latency.test.ts
   running unchanged on the new store. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(() => resetProviderCaches());
afterEach(() => fetchMock.assertNoPendingInterceptors());

const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const json = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

const invoiceRow = (over: Record<string, unknown> = {}) => ({
  id_factura: 42,
  cliente: { usuario: "greyes@wifiplus", nombre: "Janely" },
  total: 499,
  fecha_emision: "2026-08-01",
  fecha_vencimiento: "2026-08-11",
  ...over,
});

function mockFacturas(results: unknown[]) {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
    .reply(...json({ next: null, count: results.length, results }));
}

function mockClientes(results: unknown[]) {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/?") })
    .reply(...json({ next: null, count: results.length, results }));
}

const asBusiness = async (email = "demo@devolada.app") => ({
  headers: { Cookie: await sessionCookieHeader(email) },
});

describe("US-P07: the pulse says when WispHub last learned about a payment (D5)", () => {
  it("scenario 7: null with nothing registered, then the latest registration; a confirmed-but-unregistered payment does not move it", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const a = await app();

    let res = await a.request("/payments/pulse", await asBusiness(), env);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ registeredAt: null });

    /* confirmed, dispatched, but WispHub never told (observation, or a
       queued action): the debt list did not change, so neither does the
       pulse */
    await seedConfirmedPayment(business, { paymentRegisteredAt: null, actionOutcome: "observation" });
    res = await a.request("/payments/pulse", await asBusiness(), env);
    expect((await res.json()).data).toEqual({ registeredAt: null });

    const earlier = new Date("2026-09-03T10:00:00Z");
    const later = new Date("2026-09-03T11:30:00Z");
    await seedConfirmedPayment(business, { paymentRegisteredAt: later });
    await seedConfirmedPayment(business, { paymentRegisteredAt: earlier });
    res = await a.request("/payments/pulse", await asBusiness(), env);
    expect((await res.json()).data).toEqual({ registeredAt: later.getTime() });
  });

  it("another tenant's registration is not my pulse", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const other = await seedBusiness({ email: "other@isp.mx", wisphubApiKey: "wh-key-2" });
    await seedConfirmedPayment(other, { paymentRegisteredAt: new Date() });

    const res = await (await app()).request("/payments/pulse", await asBusiness(), env);
    expect((await res.json()).data).toEqual({ registeredAt: null });
  });
});

describe("US-P07: the colo cache is keyed by the last registration, and readAt is honest (D6, D7)", () => {
  it("scenario 8: two reads inside the window share one provider read and one readAt; a registration between them asks WispHub again", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const a = await app();

    mockFacturas([invoiceRow()]);
    const first = (await (await a.request("/payment-requests", await asBusiness(), env)).json()).data;
    expect(first.cobros).toHaveLength(1);

    /* No interceptor: this read must be the cache's. BUG-018 — the
       label's timestamp is the provider read's, so it repeats. */
    const second = (await (await a.request("/payment-requests", await asBusiness(), env)).json()).data;
    expect(second.cobros).toHaveLength(1);
    expect(second.readAt).toBe(first.readAt);

    /* provider-latency D4 by key: the sweep registered a payment in
       WispHub — in this colo or any other — so the next display read
       carries a new key and finds nothing under it. */
    await seedConfirmedPayment(business, { paymentRegisteredAt: new Date() });
    mockFacturas([]);
    const third = (await (await a.request("/payment-requests", await asBusiness(), env)).json()).data;
    expect(third.cobros).toHaveLength(0);
    expect(third.readAt).toBeGreaterThanOrEqual(first.readAt);
  });

  it("scenario 9: two roster reads inside the window answer the same readAt", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const a = await app();

    mockClientes([{ id_servicio: 101, usuario: "greyes", nombre: "Janely Reyes", telefono: "5551234567" }]);
    const first = (await (await a.request("/direct-payments/links/roster", await asBusiness(), env)).json()).data;
    expect(first.results).toHaveLength(1);

    const second = (await (await a.request("/direct-payments/links/roster", await asBusiness(), env)).json()).data;
    expect(second.results).toHaveLength(1);
    expect(second.readAt).toBe(first.readAt);
  });
});

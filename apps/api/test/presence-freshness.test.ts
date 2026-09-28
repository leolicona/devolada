import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { app, seedBusiness, seedConfirmedPayment, sessionCookieHeader } from "./helpers";
import { resetProviderCaches } from "../src/wisphub/cache";
import { wisphubFor } from "../src/wisphub/factory";
import { readPendingInvoices } from "../src/wisphub/snapshot";

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
  /* cobros-in-links D3: this scenario used to read through
     `GET /payment-requests`, the Cobros section. The Por cobrar view
     reads live and never this cache. The cache stays — the payer's page
     reads the list through it (`readPendingInvoices` with `display`) —
     so the scenario now asks that reader directly. What it proves is
     unchanged: one provider read and one readAt inside the window, and
     a registration in between is a new key. */
  it("scenario 8: two display reads inside the window share one provider read and one readAt; a registration between them asks WispHub again", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const db = drizzle(env.DB);
    const display = () =>
      readPendingInvoices(db, business.id, wisphubFor({ apiKey: "wh-key-1", installation: null }, env), new Date(), {
        display: true,
      });

    mockFacturas([invoiceRow()]);
    const first = await display();
    expect(first.invoices).toHaveLength(1);

    /* No interceptor: this read must be the cache's. BUG-018 — the
       timestamp is the provider read's, so it repeats. */
    const second = await display();
    expect(second.invoices).toHaveLength(1);
    expect(second.readAt).toBe(first.readAt);

    /* provider-latency D4 by key: the sweep registered a payment in
       WispHub — in this colo or any other — so the next display read
       carries a new key and finds nothing under it. */
    await seedConfirmedPayment(business, { paymentRegisteredAt: new Date() });
    mockFacturas([]);
    const third = await display();
    expect(third.invoices).toHaveLength(0);
    expect(third.readAt).toBeGreaterThanOrEqual(first.readAt);
  });

  /* Scenario 9 — "two roster reads inside the window answer the same
     readAt" — is RETIRED by links-on-demand-search FR-027 / D15.

     It measured a promise that no longer has anything to measure. The
     Links page served a cache, so two reads inside the window were the
     same bytes and had to say so with one `readAt`. There is no cache
     and no roster now: a block is read from WispHub when it RENDERS, so
     no two blocks share a read time and the customers door reports none
     at all. Printing a timestamp on a live read invents a doubt the
     page does not have.

     What survives of presence-freshness on that page is the re-read on
     returning to the tab, first block only, above its 30-second floor —
     proved in `apps/admin/test/presence-freshness.test.tsx`, which is
     where the floor lives. Scenario 8 above, the invoice read's own
     cache and its honest `readAt`, still holds for the payer's page,
     which serves that cache; the Por cobrar view no longer does
     (cobros-in-links D3). */
});

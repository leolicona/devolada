import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { fetchMock } from "cloudflare:test";
import { WispHub } from "../src/wisphub/client";
import { cashPaymentMethodId, pendingInvoicesForDisplay } from "../src/wisphub/cache";

/* docs/polish/provider-latency.spec.md (US-P06), adapter and cache
   scenarios: 1–2 (deadlines), 6–7 and 10 (display cache), 11b (payment
   method per tenant), 12 (configured base).

   The route-level scenarios (3–5, 8–9, 11) drove the store charge path
   and retired with it to devolada-red; the direct SPEI channel asserts
   its own provider-failure behavior in direct-payment.test.ts.

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

/* What `AbortSignal.timeout` throws when the deadline fires. Simulated
   rather than waited for: a real 5s stall in a test would be a 5s test,
   and scenario 1 already proves the deadline fires for real. */
const stalled = () => new DOMException("The operation was aborted", "TimeoutError");

const facturas = (p: string) => p.startsWith("/api/facturas/?") && p.includes("estado=1");
const formasDePago = (p: string) => p.startsWith("/api/formas-de-pago/");

function mockPendingInvoices(
  results: { id_factura: number; cliente: { usuario: string }; total: number }[] = [
    { id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 },
  ],
) {
  wh()
    .intercept({ method: "GET", path: facturas })
    .reply(...json({ next: null, count: results.length, results }));
}

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

describe("US-P06: the pending list is cached for display only (D3)", () => {
  it("scenario 6: two display reads share one fetch; past the window it fetches again", async () => {
    const provider = new WispHub("wh-key-1");
    const at = (ms: number) => new Date(Date.parse("2026-08-18T12:00:00Z") + ms);

    mockPendingInvoices();
    const first = await pendingInvoicesForDisplay("business-1", provider, at(0));
    const second = await pendingInvoicesForDisplay("business-1", provider, at(29_000));
    expect(second).toEqual(first);

    /* Past 30s the entry is gone, so this second interceptor is the
       proof the provider was asked again. */
    mockPendingInvoices([]);
    const third = await pendingInvoicesForDisplay("business-1", provider, at(31_000));
    expect(third.invoices).toHaveLength(0);
  });

  it("scenario 7: two ISPs never share a cached list", async () => {
    const provider = new WispHub("wh-key-1");
    const now = new Date("2026-08-18T12:00:00Z");

    mockPendingInvoices();
    mockPendingInvoices([]);
    const mine = await pendingInvoicesForDisplay("business-1", provider, now);
    const theirs = await pendingInvoicesForDisplay("business-2", provider, now);

    /* Both interceptors consumed: one tenant's debt never answers for
       another's, however close together they ask. */
    expect(mine.invoices).toHaveLength(1);
    expect(theirs.invoices).toHaveLength(0);
  });

  it("scenario 10: a failed fetch is not cached — the next call retries the provider", async () => {
    const provider = new WispHub("wh-key-1");
    const now = new Date("2026-08-18T12:00:00Z");

    wh().intercept({ method: "GET", path: facturas }).replyWithError(stalled());
    await expect(pendingInvoicesForDisplay("business-1", provider, now)).rejects.toMatchObject({
      code: "WISPHUB_UNAVAILABLE",
    });

    /* A remembered failure would be a 30-second outage of our own making */
    mockPendingInvoices();
    const retried = await pendingInvoicesForDisplay("business-1", provider, now);
    expect(retried.invoices).toHaveLength(1);
  });

});

describe("US-P06: the cash payment method is cached (D5)", () => {
  it("scenario 11b: a second tenant asks the provider for its own", async () => {
    const now = new Date("2026-08-18T12:00:00Z");
    const provider = new WispHub("wh-key-1");
    wh()
      .intercept({ method: "GET", path: formasDePago })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
    wh()
      .intercept({ method: "GET", path: formasDePago })
      .reply(...json({ results: [{ id: 9, nombre: "Efectivo" }] }));

    expect(await cashPaymentMethodId("business-1", provider, now)).toBe(7);
    expect(await cashPaymentMethodId("business-1", provider, now)).toBe(7);
    expect(await cashPaymentMethodId("business-2", provider, now)).toBe(9);
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

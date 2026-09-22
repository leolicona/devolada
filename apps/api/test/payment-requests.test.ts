import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { app, seedBusiness, sessionCookieHeader } from "./helpers";
import { paymentLinks } from "../src/db/schema";
import { resetProviderCaches } from "../src/wisphub/cache";
import type { Bindings } from "../src/env";

/* docs/legacy/reconciliation/cobros-live.spec.md — the live read (US-R01:
   scenarios 1, 4, 6, 7, 9) and the payer link's own Cobros (US-R04:
   scenario 8). No table exists; the DoD's "no migration" proof is this
   whole file running against a schema without payment_requests. */

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

function mockFacturas(results: unknown[], next: string | null = null, times = 1) {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
    .reply(...json({ next, count: results.length, results }))
    .times(times);
}

const asBusiness = async (email = "demo@devolada.app") => ({
  headers: { Cookie: await sessionCookieHeader(email) },
});

describe("US-R01: the section reads WispHub live", () => {
  it("scenario 1: maps every pending invoice with customer, amount and dates", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockFacturas([
      invoiceRow(),
      invoiceRow({ id_factura: 57, total: 300, fecha_emision: "2026-08-20", fecha_vencimiento: "2026-08-30" }),
    ]);

    const res = await (await app()).request("/payment-requests", await asBusiness(), env);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.cobros).toHaveLength(2);
    expect(data.cobros[0]).toEqual({
      externalId: 42,
      customerUsuario: "greyes@wifiplus",
      customerName: "Janely",
      amountCents: 49900,
      invoiceDate: "2026-08-01",
      dueDate: "2026-08-11",
    });
    expect(data.complete).toBe(true);
    expect(data.readAt).toEqual(expect.any(Number));
  });

  /* links-on-demand-search US4 (D16): this used to assert that a debtor
     with a stored link carried it on the row and a debtor without one
     got two nulls that hid the buttons. Both halves are retired.

     The row carries NO link now, for either debtor. `linkUrl` existed
     because the roster had already made a link for every customer;
     under FR-008 most have none, and the surviving field would have
     produced the worse behaviour — a link with no phone, for a debtor
     who already has one, opening WhatsApp's contact picker instead of
     their chat. Both buttons press the act instead, which reads the
     customer fresh and carries their number (FR-025, FR-026, FR-028).

     What replaces this case lives in `links-create-on-act.test.ts`,
     where the act is: the debtor with no link gains one, the debtor who
     has one keeps it, and the `waLink` carries the phone that read. */
  it("D16: the row carries the debt and the identity, and no link at all", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    /* Even a debtor whose link Devolada already holds */
    await drizzle(env.DB).insert(paymentLinks).values({
      businessId: business.id,
      token: "tokrowlink123456",
      wisphubCustomerId: "6",
      customerUsuario: "greyes@wifiplus",
    });
    mockFacturas([
      invoiceRow(),
      invoiceRow({ id_factura: 77, cliente: { usuario: "aflores@wifiplus", nombre: "Abraham" } }),
    ]);

    const res = await (await app()).request("/payment-requests", await asBusiness(), env);
    const { data } = await res.json();
    for (const row of data.cobros) {
      expect(row).not.toHaveProperty("linkUrl");
      expect(row).not.toHaveProperty("waLink");
      /* What the row DOES carry is the identity the act needs */
      expect(row.customerUsuario).toEqual(expect.any(String));
    }
  });

  /* bug: cobros-links-lookup-params — the pilot's 205 pending invoices
     name more than 99 debtors. The lookup chunked by D1_MAX_PARAMS - 1
     and bound the business id, `source = 'panel'` AND 99 usuarios: 101,
     one over D1's cap, and the read died as a generic 500.

     links-on-demand-search D16 retired the lookup itself, so the bind
     that overran the cap cannot happen on this path any more. The case
     stays, narrowed to what is still true and still worth guarding: a
     tenant with more debtors than D1 will bind parameters for is read in
     one page, whole. `test/setup.ts` still makes the cap real for every
     statement the suite runs, so a new wide bind anywhere fails a test
     rather than a tenant. */
  it("bug cobros-links-lookup-params: 120 debtors read in one page, none of them costing a bound parameter", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const usuarios = Array.from({ length: 120 }, (_, i) => `cliente${String(i).padStart(3, "0")}@wifiplus`);
    mockFacturas(
      usuarios.map((usuario, i) =>
        invoiceRow({ id_factura: 5000 + i, cliente: { usuario, nombre: `Cliente ${i}` } }),
      ),
    );

    const res = await (await app()).request("/payment-requests", await asBusiness(), env);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.cobros).toHaveLength(120);
  });

  it("scenario 4: two reads inside 30 seconds cost one provider call (the display cache)", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockFacturas([invoiceRow()]); /* once — the second read must not fetch */

    const first = await (await app()).request("/payment-requests", await asBusiness(), env);
    const second = await (await app()).request("/payment-requests", await asBusiness(), env);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json()).data.cobros).toHaveLength(1);
  });

  it("scenario 6: a fifth page with more behind it answers complete: false", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockFacturas([invoiceRow()], `${WISPHUB_ORIGIN}/api/facturas/?estado=1&page=2`, 5);

    const res = await (await app()).request("/payment-requests", await asBusiness(), env);
    const { data } = await res.json();
    expect(data.complete).toBe(false);
    expect(data.cobros).toHaveLength(5);
  });

  it("scenario 7: a provider failure answers 503, never an empty list", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") })
      .reply(500, "boom");

    const res = await (await app()).request("/payment-requests", await asBusiness(), env);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: { code: "WISPHUB_UNAVAILABLE" } });
  });

  /* bug: cobros-installation-fallback — a refused key is a setup
     problem, and the screen can only send it to Integraciones if the
     code says which of the two it was. The 403 is what wisphub.net
     answers a wisphub.io key (provider-address-per-isp D5). */
  it("bug cobros-installation-fallback: a refused key answers 503 with WISPHUB_AUTH_FAILED, not the outage code", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-io" });
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") })
      .reply(403, JSON.stringify({ detail: "Invalid API key" }), {
        headers: { "Content-Type": "application/json" },
      });

    const res = await (await app()).request("/payment-requests", await asBusiness(), env);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: { code: "WISPHUB_AUTH_FAILED" } });
    /* The key never rides the wire, whatever the provider said */
    expect(JSON.stringify(body)).not.toContain("wh-key-io");
  });

  it("scenario 9: without a WispHub key the read answers 409 NOT_CONFIGURED", async () => {
    await seedBusiness();

    const res = await (await app()).request("/payment-requests", await asBusiness(), env);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_CONFIGURED");
  });
});

describe("US-R04: the payer's link lists the open Cobros that make the total", () => {
  /* The provider credential comes pinned from vitest.config.ts
     (consta-api-merge D12), so the channel is available here */
  const testEnv = {
    ...env,
  } as typeof env & Bindings;

  it("scenario 8: oldest first, from the read the page already pays for", async () => {
    const business = await seedBusiness({
      wisphubApiKey: "wh-key-1",
      serviceFeeCents: 1500,
      speiClabe: "646180157000000004",
      speiBank: "STP",
    });
    await drizzle(env.DB).insert(paymentLinks).values({
      businessId: business.id,
      token: "tokcobros1234567",
      wisphubCustomerId: "6",
      customerUsuario: "greyes@wifiplus",
    });
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
      .reply(
        ...json({
          count: 1,
          results: [
            {
              id_servicio: 6,
              usuario: "greyes@wifiplus",
              nombre: "Janely",
              estado: "Suspendido",
              estado_facturas: "Pendiente de Pago",
              precio_plan: "499.00",
              saldo: "0.00",
              zona: { id: 71342, nombre: "Zona dia 15" },
            },
          ],
        }),
      );
    /* Newest first on the wire, as WispHub lists them */
    mockFacturas([
      invoiceRow({ id_factura: 57, total: 300, fecha_emision: "2026-08-20", fecha_vencimiento: "2026-08-30" }),
      invoiceRow(),
    ]);

    const res = await (await app()).request("/direct-payments/links/tokcobros1234567", {}, testEnv);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("debt");
    /* Oldest first (D8), and only this customer's invoices */
    expect(data.cobros).toEqual([
      { externalId: 42, amountCents: 49900, invoiceDate: "2026-08-01" },
      { externalId: 57, amountCents: 30000, invoiceDate: "2026-08-20" },
    ]);
    /* The pay flow is untouched: the total is still the whole debt */
    expect(data.totalCents).toBe(49900 + 30000 + 1500);
  });
});

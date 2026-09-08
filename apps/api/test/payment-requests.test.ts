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
      linkUrl: null,
      waLink: null,
    });
    expect(data.complete).toBe(true);
    expect(data.readAt).toEqual(expect.any(Number));
  });

  it("pilot-UX round: a debtor with a stored link carries it on the row; without one, nulls hide the buttons", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
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
    const janely = data.cobros.find((c: { customerUsuario: string }) => c.customerUsuario === "greyes@wifiplus");
    const abraham = data.cobros.find((c: { customerUsuario: string }) => c.customerUsuario === "aflores@wifiplus");
    expect(janely.linkUrl).toMatch(/\/p\/tokrowlink123456$/);
    /* no phone on the invoice row: the wa.me link opens the picker with
       the message ready, never a stranger's chat */
    expect(janely.waLink).toContain("wa.me/?text=");
    expect(janely.waLink).toContain(encodeURIComponent(janely.linkUrl));
    expect(abraham.linkUrl).toBeNull();
    expect(abraham.waLink).toBeNull();
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

  it("scenario 9: without a WispHub key the read answers 409 NOT_CONFIGURED", async () => {
    await seedBusiness();

    const res = await (await app()).request("/payment-requests", await asBusiness(), env);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_CONFIGURED");
  });
});

describe("US-R04: the payer's link lists the open Cobros that make the total", () => {
  /* Consta config is env (secret + var); the test carries it itself,
     same as direct-payment.test.ts */
  const testEnv = {
    ...env,
    CONSTA_BASE_URL: "https://consta.test",
    CONSTA_API_KEY: "ck_test",
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

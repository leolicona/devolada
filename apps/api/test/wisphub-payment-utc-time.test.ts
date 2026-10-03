import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { paymentLinks, payments } from "../src/db/schema";
import { sweepReconnections } from "../src/reconnection/queue";
import { businessWallClock } from "../src/time/business-day";
import type { Bindings } from "../src/env";
import { app, seedBusiness, seedConfirmedPayment, sessionCookieHeader } from "./helpers";

/* bug: wisphub-payment-utc-time — Devolada wrote WispHub's `fecha_pago`
   on the UTC clock, and WispHub reads a date without a zone as its
   tenant's local time: a Mexico City ISP saw every payment six hours
   late, one registered after 18:00 on the next day, and a month-end one
   in the next month. The fix writes the ISP's wall clock, from
   `businesses.timezone`. WispHub is fetch-mocked at its origin, and the
   bodies it receives are the assertion. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const APICEP_ORIGIN = "https://api.apicep.cloud";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/* 20:30 on Sep 30 in Mexico City, 19:30 in Hermosillo — and already
   02:30 on Oct 1 in UTC: the evening the bug moved into October */
const EVENING = new Date("2026-10-01T02:30:00.000Z");

const testEnv = { ...env } as typeof env & Bindings;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const apicep = () => fetchMock.get(APICEP_ORIGIN);
const json = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

const wisphubCustomer = (usuario: string, idServicio: number, estado: string) => ({
  id_servicio: idServicio,
  usuario,
  nombre: "Janely",
  estado,
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: { id: 71342, nombre: "Zona dia 15" },
});

/* undici sorts the query when it matches, and encodes the @ — so the
   matcher reads the part of the usuario before it */
function mockCustomerLookup(usuario: string, idServicio: number, estado: string, times = 1) {
  const name = usuario.split("@")[0];
  wh()
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/clientes/") && p.includes(`usuario=${name}`),
    })
    .reply(...json({ count: 1, results: [wisphubCustomer(usuario, idServicio, estado)] }))
    .times(times);
}

function mockPendingInvoices(results: unknown[], times = 1) {
  wh()
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1"),
    })
    .reply(...json({ next: null, count: results.length, results }))
    .times(times);
}

/* The D9 opt-in and the payment method: the attempt's first two calls */
function mockPreamble(idServicio: number) {
  wh()
    .intercept({ method: "PATCH", path: `/api/clientes/${idServicio}/` })
    .reply(...json({ id_servicio: idServicio, auto_activar_servicio: true }));
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
    .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
}

/* bug: transferred-invoice-paid — an attempt that carries an invoice asks
   about it before any money moves; still pending here (the detail route's
   measured shape) */
function mockInvoicePending(invoiceId: number) {
  wh()
    .intercept({ method: "GET", path: `/api/facturas/${invoiceId}/` })
    .reply(...json({ id_factura: invoiceId, estado: "Pendiente de Pago" }));
}

/* registrar-pago, with the body WispHub received kept for the assertion */
function mockRegisterPayment(invoiceId: number) {
  const sent: { fecha_pago?: string } = {};
  wh()
    .intercept({
      method: "POST",
      path: `/api/facturas/${invoiceId}/registrar-pago/`,
      body: (raw) => {
        Object.assign(sent, JSON.parse(String(raw)));
        return true;
      },
    })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
  return sent;
}

describe("bug: wisphub-payment-utc-time — the ISP's wall clock", () => {
  it("puts one instant on each business's own clock", () => {
    expect(businessWallClock("America/Mexico_City", EVENING)).toEqual({
      date: "2026-09-30",
      dateTime: "2026-09-30 20:30",
    });
    expect(businessWallClock("America/Hermosillo", EVENING)).toEqual({
      date: "2026-09-30",
      dateTime: "2026-09-30 19:30",
    });
  });

  it("writes midnight as 00:00 of the new day, and cuts to the minute", () => {
    expect(businessWallClock("America/Mexico_City", new Date("2026-09-30T06:00:00.000Z")).dateTime).toBe(
      "2026-09-30 00:00",
    );
    /* 20:30:59.999 is still 20:30 — never rounded into the next minute */
    expect(businessWallClock("America/Mexico_City", new Date("2026-10-01T02:30:59.999Z")).dateTime).toBe(
      "2026-09-30 20:30",
    );
  });

  it("follows Baja California through both clock changes", () => {
    /* Tijuana still changes clocks. Spring: 02:00 PST jumps to 03:00 PDT
       at 10:00 UTC on 2026-03-08. */
    const tijuana = (iso: string) => businessWallClock("America/Tijuana", new Date(iso)).dateTime;
    expect(tijuana("2026-03-08T09:59:00.000Z")).toBe("2026-03-08 01:59");
    expect(tijuana("2026-03-08T10:00:00.000Z")).toBe("2026-03-08 03:00");
    /* Autumn: 02:00 PDT falls back to 01:00 PST at 09:00 UTC on
       2026-11-01, so the wall clock reads 01:30 twice, an hour apart */
    expect(tijuana("2026-11-01T08:30:00.000Z")).toBe("2026-11-01 01:30");
    expect(tijuana("2026-11-01T09:30:00.000Z")).toBe("2026-11-01 01:30");
  });
});

describe("bug: wisphub-payment-utc-time — the queue registers on each ISP's clock", () => {
  async function queuedCharge(
    business: { id: string },
    over: Partial<typeof payments.$inferInsert> = {},
  ) {
    return seedConfirmedPayment(business, {
      wisphubCustomerId: "6",
      customerUsuario: "greyes@wifiplus",
      registeredCents: 49900,
      actionOutcome: "queued",
      actionAttempts: 1,
      nextAttemptAt: new Date(EVENING.getTime() - MINUTE),
      ...over,
    });
  }

  it("one batch, two businesses: 20:30 in Mexico City, 19:30 in Hermosillo — both still Sep 30", async () => {
    const centro = await seedBusiness({ wisphubApiKey: "wh-key-1", timezone: "America/Mexico_City" });
    const sonora = await seedBusiness({
      email: "sonora@devolada.app",
      wisphubApiKey: "wh-key-2",
      timezone: "America/Hermosillo",
    });
    await queuedCharge(centro, { wisphubInvoiceId: 12 });
    await queuedCharge(sonora, {
      wisphubCustomerId: "7",
      customerUsuario: "lmora@sonora",
      wisphubInvoiceId: 13,
    });

    mockInvoicePending(12);
    mockInvoicePending(13);
    mockPreamble(6);
    mockPreamble(7);
    const toCentro = mockRegisterPayment(12);
    const toSonora = mockRegisterPayment(13);
    mockCustomerLookup("greyes@wifiplus", 6, "Activo");
    mockCustomerLookup("lmora@sonora", 7, "Activo");

    const report = await sweepReconnections(testEnv, EVENING);
    expect(report).toMatchObject({ claimed: 2, reconnected: 2 });

    /* The UTC string was "2026-10-01 02:30" for both: October, and the
       wrong hour on each ISP's books */
    expect(toCentro.fecha_pago).toBe("2026-09-30 20:30");
    expect(toSonora.fecha_pago).toBe("2026-09-30 19:30");
  });

  it("the 'Adeudo anterior' vehicle is born on the ISP's day, not tomorrow (debt-truth D15)", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1", timezone: "America/Mexico_City" });
    await queuedCharge(business);

    mockPreamble(6);
    mockPendingInvoices([]);
    const invoice: Record<string, unknown> = {};
    wh()
      .intercept({
        method: "POST",
        path: "/api/facturas/",
        body: (raw) => {
          Object.assign(invoice, JSON.parse(String(raw)));
          return true;
        },
      })
      .reply(...json({ messages: "Se genero correctamente la factura 55." }));
    const sent = mockRegisterPayment(55);
    mockCustomerLookup("greyes@wifiplus", 6, "Activo");

    await sweepReconnections(testEnv, EVENING);

    expect(invoice).toMatchObject({
      total: 0,
      fecha_emision: "2026-09-30",
      fecha_vencimiento: "2026-09-30",
      fecha_pago: "2026-09-30",
    });
    expect(sent.fecha_pago).toBe("2026-09-30 20:30");
  });
});

/* The verdict and "Ejecutar ahora" read their own `now` from the real
   clock, so these assert against the moment of the request instead.
   Hermosillo has kept UTC−7 all year since 1999: its wall clock is plain
   arithmetic here, independent of the Intl path the code takes, and
   never equal to UTC's — the old string cannot pass. */
const sonoraClock = (ms: number) => new Date(ms - 7 * HOUR).toISOString().slice(0, 16).replace("T", " ");

/* Either side of a minute boundary the request may have crossed */
async function wallClockAround(run: () => Promise<void>): Promise<string[]> {
  const before = Date.now();
  await run();
  const after = Date.now();
  return [sonoraClock(before), sonoraClock(after)];
}

async function seedSonoraLink(overrides: Parameters<typeof seedBusiness>[0] = {}) {
  const business = await seedBusiness({
    wisphubApiKey: "wh-key-1",
    timezone: "America/Hermosillo",
    serviceFeeCents: 1500,
    speiClabe: "646180157000000004",
    speiBank: "STP",
    speiBeneficiaryName: "WifiPlus SA de CV",
    ...overrides,
  });
  await drizzle(env.DB).insert(paymentLinks).values({
    businessId: business.id,
    token: "tok2345abcdefgh2",
    wisphubCustomerId: "6",
    customerUsuario: "greyes@wifiplus",
  });
  return business;
}

/* The pay pre-check and the verdict's fresh re-read, then a settled CEP */
function mockVerdictReads() {
  mockCustomerLookup("greyes@wifiplus", 6, "Suspendido", 2);
  mockPendingInvoices([{ id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 }], 2);
  apicep()
    .intercept({ method: "POST", path: "/validate-transfer" })
    .reply(
      ...json({
        validationId: "v-1",
        status: "valid",
        validation: {
          cepStatus: "LIQUIDADO",
          cepPreviouslyValidated: false,
          cepDetails: {
            trackingKey: "TRACK001XYZ",
            amount: 514,
            operationDate: new Date().toISOString().slice(0, 10),
            senderBank: "NUBANK",
            senderName: "JANELY REYES",
            receiverBank: "STP",
            beneficiaryName: "WifiPlus SA de CV",
          },
        },
      }),
    );
}

async function payTransfer() {
  const res = await (await app()).request(
    "/direct-payments/links/tok2345abcdefgh2/pay",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transfer: { trackingKey: "TRACK001XYZ", senderBank: "NUBANK", date: "2026-08-17" } }),
    },
    testEnv,
  );
  expect(res.status).toBe(201);
}

describe("bug: wisphub-payment-utc-time — every door that registers writes the ISP's clock", () => {
  it("the verdict registers the payment on the business's clock", async () => {
    await seedSonoraLink();
    mockVerdictReads();
    mockInvoicePending(42);
    mockPreamble(6);
    const sent = mockRegisterPayment(42);
    mockCustomerLookup("greyes@wifiplus", 6, "Activo");

    const window = await wallClockAround(payTransfer);
    expect(window).toContain(sent.fecha_pago);
  });

  it("'Ejecutar ahora' registers an observed payment on the business's clock (integrations-hub D5)", async () => {
    await seedSonoraLink({ actionsEnabled: false });
    mockVerdictReads();
    await payTransfer();
    const [observed] = await drizzle(env.DB).select().from(payments);
    expect(observed.actionOutcome).toBe("observation");

    mockInvoicePending(42);
    mockPreamble(6);
    const sent = mockRegisterPayment(42);
    mockCustomerLookup("greyes@wifiplus", 6, "Activo");
    const cookie = await sessionCookieHeader("demo@devolada.app");

    const window = await wallClockAround(async () => {
      const res = await (await app()).request(
        `/payments/${observed.id}/execute-action`,
        { method: "POST", headers: { Cookie: cookie } },
        testEnv,
      );
      expect(res.status).toBe(200);
    });
    expect(window).toContain(sent.fecha_pago);
  });
});

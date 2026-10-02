import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { integrationEvents, integrations, paymentLinks, payments } from "../src/db/schema";
import { sweepReconnections } from "../src/reconnection/queue";
import { app, seedBusiness, seedConfirmedPayment, sessionCookieHeader } from "./helpers";

/* bug: queue-retry-forgets-action — a retry runs the action the verdict
   decided. The sweep used to call the adapter with its default
   (`reconnect = true`) and the operator's retry recorded
   `register_and_reconnect` whatever the row decided, so a payment the
   business's rule left cut got its service back after one outage. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const APICEP_ORIGIN = "https://api.apicep.cloud";
const MINUTE = 60_000;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const asBusiness = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };
const db = () => drizzle(env.DB);
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

function mockCustomerLookup(times = 1) {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
    .reply(...json({ count: 1, results: [wisphubCustomer()] }))
    .times(times);
}

function mockPendingInvoices(times = 1) {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
    .reply(
      ...json({ next: null, count: 1, results: [{ id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 }] }),
    )
    .times(times);
}

function mockConsta(cepAmountCents: number) {
  fetchMock
    .get(APICEP_ORIGIN)
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
            amount: cepAmountCents / 100,
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

/* The first attempt: the opt-in and the payment method land, and
   registrar-pago meets an outage before any money moved */
function mockFirstAttemptOutage() {
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
    .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  wh().intercept({ method: "POST", path: "/api/facturas/42/registrar-pago/" }).reply(503, "unavailable");
}

/* A retry: the opt-in again and registrar-pago, whose `accion` is the
   assertion. The payment method is cached by now (provider-latency D5).
   No verify lookup is registered: a register-only retry never asks the
   router, and an unmatched request would fail the test. */
function mockRetry(opts: { formas?: boolean } = {}) {
  const captured: { accion?: number } = {};
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
  if (opts.formas) {
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  }
  wh()
    .intercept({
      method: "POST",
      path: "/api/facturas/42/registrar-pago/",
      body: (raw) => {
        captured.accion = JSON.parse(String(raw)).accion;
        return true;
      },
    })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: null }));
  return captured;
}

async function seedLinkedBusiness() {
  const business = await seedBusiness({
    wisphubApiKey: "wh-key-1",
    serviceFeeCents: 1500,
    speiClabe: "646180157000000004",
    speiBank: "STP",
    speiBeneficiaryName: "WifiPlus SA de CV",
  });
  await db().insert(paymentLinks).values({
    businessId: business.id,
    token: "tok2345abcdefgh2",
    wisphubCustomerId: "6",
    customerUsuario: "greyes@wifiplus",
  });
  return business;
}

async function payTransfer() {
  return (await app()).request(
    "/direct-payments/links/tok2345abcdefgh2/pay",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transfer: { trackingKey: "TRACK001XYZ", senderBank: "NUBANK", date: "2026-08-17" } }),
    },
    env,
  );
}

const later = () => new Date(Date.now() + 2 * MINUTE);

describe("bug: queue-retry-forgets-action — the sweep retries what the verdict decided", () => {
  it("a short payment below the threshold, whose first attempt met a 503, is retried register-only and ends withheld", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup(2);
    mockPendingInvoices(2);
    /* 300.00 of a 499.00 debt: the threshold (100 %) votes withhold */
    mockConsta(30000);
    mockFirstAttemptOutage();

    expect((await payTransfer()).status).toBe(201);
    const [queued] = await db().select().from(payments);
    expect(queued).toMatchObject({
      status: "partial",
      actionOutcome: "queued",
      /* cash-at-stores D9: the core's word for the outage */
      actionError: "INTEGRATION_UNAVAILABLE",
      decidedAction: "register_and_reconnect:withhold",
    });

    const captured = mockRetry();
    const report = await sweepReconnections(env, later());
    expect(report).toMatchObject({ claimed: 1, reconnected: 0, failed: 0 });
    /* the router is left alone: accion 0 */
    expect(captured.accion).toBe(0);

    const [after] = await db().select().from(payments);
    expect(after).toMatchObject({
      actionOutcome: "withheld",
      nextAttemptAt: null,
      actionError: null,
      paymentRegisteredAt: expect.any(Date),
    });
    const [event] = await db().select().from(integrationEvents);
    expect(event).toMatchObject({ action: "register_and_reconnect", status: "acked" });
  });

  it("a class mapped to register_only, whose first attempt met a 503, is retried register-only and ends done", async () => {
    const business = await seedLinkedBusiness();
    await db().update(integrations).set({ exactAction: "register_only" }).where(eq(integrations.businessId, business.id));
    mockCustomerLookup(2);
    mockPendingInvoices(2);
    /* the whole ask: exact */
    mockConsta(51400);
    mockFirstAttemptOutage();

    expect((await payTransfer()).status).toBe(201);
    const [queued] = await db().select().from(payments);
    expect(queued).toMatchObject({
      status: "confirmed",
      reconciliationClass: "exact",
      actionOutcome: "queued",
      decidedAction: "register_only",
    });

    const captured = mockRetry();
    await sweepReconnections(env, later());
    expect(captured.accion).toBe(0);

    const [after] = await db().select().from(payments);
    /* integrations-hub D7: register_only's completed registration is done */
    expect(after).toMatchObject({ actionOutcome: "done", nextAttemptAt: null, actionDoneAt: expect.any(Date) });
    const [event] = await db().select().from(integrationEvents);
    expect(event).toMatchObject({ action: "register_only", status: "acked" });
  });

  it("the operator's retry of a failed register-only row records register_only and the sweep registers with accion 0", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const row = await seedConfirmedPayment(business, {
      actionOutcome: "failed",
      actionAttempts: 6,
      wisphubInvoiceId: 42,
      decidedAction: "register_only",
    });

    const res = await (await app()).request(`/payments/${row.id}/retry-action`, { method: "POST", ...asBusiness }, env);
    expect(res.status).toBe(200);
    const [event] = await db().select().from(integrationEvents);
    expect(event).toMatchObject({ paymentId: row.id, action: "register_only", status: "dispatched" });

    /* nothing cached for this business yet: the method list is read */
    const captured = mockRetry({ formas: true });
    await sweepReconnections(env, later());
    expect(captured.accion).toBe(0);
    const [after] = await db().select().from(payments).where(eq(payments.id, row.id));
    expect(after.actionOutcome).toBe("done");
  });

  it("a row queued before the fix, with no decision on file, keeps the old reconnect", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const row = await seedConfirmedPayment(business, {
      actionOutcome: "queued",
      actionAttempts: 1,
      wisphubInvoiceId: 42,
      nextAttemptAt: new Date(Date.now() - MINUTE),
    });
    expect(row.decidedAction).toBeNull();

    const captured = mockRetry({ formas: true });
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
      .reply(...json({ count: 1, results: [wisphubCustomer("Activo")] }));
    await sweepReconnections(env);
    expect(captured.accion).toBe(1);
    const [after] = await db().select().from(payments).where(eq(payments.id, row.id));
    expect(after.actionOutcome).toBe("done");
  });
});

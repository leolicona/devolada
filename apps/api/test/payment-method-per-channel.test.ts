import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { integrations, paymentLinks, payments } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { sweepReconnections } from "../src/reconnection/queue";
import { app, seedBusiness, seedConfirmedPayment, sessionCookieHeader } from "./helpers";

/* payment-method-per-channel (specs/019-payment-method-per-channel): every
   payment Devolada records in a business's WispHub carries its channel's
   payment method when the business created it, the cash method otherwise,
   and a reference back to Devolada. Workerd with a real D1; WispHub at its
   origin. Every assertion about a recording is made on the `registrar-pago`
   body that reached WispHub, never on what the core built (D13). */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const APICEP_ORIGIN = "https://api.apicep.cloud";
const MINUTE = 60_000;

const testEnv = { ...env } as typeof env & Bindings;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const db = () => drizzle(env.DB);
const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const json = (body: unknown) => [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;
const asOwner = async () => ({ Cookie: await sessionCookieHeader("demo@devolada.app") });

type Method = { id: number; nombre: string };
const EFECTIVO: Method = { id: 7, nombre: "efectivo" };
const SPEI: Method = { id: 12, nombre: "SPEI - LINK.DEVOLADAPAGO" };
const NETWORK: Method = { id: 13, nombre: "CASH - RED.DEVOLADAPAGO" };

/* The tenant's payment methods, one read */
function mockMethods(methods: Method[]) {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
    .reply(...json({ next: null, results: methods }));
}

type Sent = { forma_pago: number; accion: number; referencia?: string; total_cobrado: number };

/* Every `registrar-pago` that reached WispHub, in order, answered by
   `answers` one by one (200 when it runs out). `calls` is how many the
   test expects: one more is unmatched and fails the attempt, one fewer
   leaves the interceptor pending. */
function mockRegister(invoiceId: number, answers: { status: number; body: unknown }[] = [], calls = Math.max(1, answers.length)) {
  const sent: Sent[] = [];
  /* undici runs a body matcher more than once per request; the reply runs
     once, so the body is kept by the one and recorded by the other */
  let body: Sent | null = null;
  wh()
    .intercept({
      method: "POST",
      path: `/api/facturas/${invoiceId}/registrar-pago/`,
      body: (raw) => {
        body = JSON.parse(String(raw)) as Sent;
        return true;
      },
    })
    .reply(() => {
      sent.push(body!);
      const answer = answers[sent.length - 1] ?? { status: 200, body: { messages: ["Se agrego correctamente el pago"], task_id: "t-1" } };
      return { statusCode: answer.status, data: JSON.stringify(answer.body), responseOptions: { headers: { "Content-Type": "application/json" } } };
    })
    .times(calls);
  return sent;
}

const customer = (estado: string) => ({
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely",
  estado,
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: { id: 71342, nombre: "Zona dia 15" },
});

function mockCustomerLookup(estado: string, times = 1) {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
    .reply(...json({ count: 1, results: [customer(estado)] }))
    .times(times);
}

function mockPendingInvoices(results: unknown[] = [{ id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 }], times = 1) {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
    .reply(...json({ next: null, count: results.length, results }))
    .times(times);
}

const mockAutoActivate = () =>
  wh().intercept({ method: "PATCH", path: "/api/clientes/6/" }).reply(...json({ id_servicio: 6, auto_activar_servicio: true }));

/* A recording that lands and reconnects: the opt-in, the methods, the
   payment, the verify */
function mockRecording(
  methods: Method[],
  opts: { invoiceId?: number; verify?: boolean; answers?: { status: number; body: unknown }[]; calls?: number } = {},
) {
  mockAutoActivate();
  mockMethods(methods);
  const sent = mockRegister(opts.invoiceId ?? 42, opts.answers, opts.calls);
  if (opts.verify ?? true) mockCustomerLookup("Activo");
  return sent;
}

/* ---- the SPEI verdict (integration-dispatch.test.ts's recipe) ---- */

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

async function seedLinkedBusiness(over: Parameters<typeof seedBusiness>[0] = {}) {
  const business = await seedBusiness({
    wisphubApiKey: "wh-key-1",
    serviceFeeCents: 1500,
    speiClabe: "646180157000000004",
    speiBank: "STP",
    speiBeneficiaryName: "WifiPlus SA de CV",
    ...over,
  });
  await db()
    .insert(paymentLinks)
    .values({ businessId: business.id, token: "tok2345abcdefgh2", wisphubCustomerId: "6", customerUsuario: "greyes@wifiplus" });
  return business;
}

/* The payer's transfer, checked by Banxico: the submission and the verdict
   each read the customer and the debt. Registered before the recording's
   own reads, which undici would otherwise answer first. */
function mockTransfer(cepAmountCents = 51400) {
  mockCustomerLookup("Suspendido", 2);
  mockPendingInvoices(undefined, 2);
  mockConsta(cepAmountCents);
}

async function submitTransfer() {
  return (await app()).request(
    "/direct-payments/links/tok2345abcdefgh2/pay",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transfer: { trackingKey: "TRACK001XYZ", senderBank: "NUBANK", date: "2026-08-17" } }),
    },
    testEnv,
  );
}

/* ---- the queue (reconnection-queue.test.ts's recipe) ---- */

async function seedQueued(over: Partial<typeof payments.$inferInsert> = {}, business?: { id: string }) {
  const owner = business ?? (await seedBusiness({ wisphubApiKey: "wh-key-1" }));
  const row = await seedConfirmedPayment(owner, {
    wisphubCustomerId: "6",
    customerUsuario: "greyes@wifiplus",
    registeredCents: 49900,
    wisphubInvoiceId: 42,
    actionOutcome: "queued",
    actionAttempts: 1,
    nextAttemptAt: new Date(Date.now() - MINUTE),
    ...over,
  });
  return { business: owner, row };
}

const reload = async (id: string) => (await db().select().from(payments).where(eq(payments.id, id)))[0];

/* What the sweep records for one queued SPEI payment, given the tenant's
   methods */
async function sweptWith(methods: Method[]) {
  const { row } = await seedQueued();
  const sent = mockRecording(methods);
  await sweepReconnections(env);
  expect((await reload(row.id)).actionOutcome).toBe("done");
  return sent;
}

describe("payment-method-per-channel US1: the business downloads what came in by SPEI", () => {
  it("the SPEI verdict records with SPEI - LINK.DEVOLADAPAGO when the business has it", async () => {
    await seedLinkedBusiness();
    mockTransfer();
    const sent = mockRecording([EFECTIVO, SPEI]);
    expect((await submitTransfer()).status).toBe(201);
    const [row] = await db().select().from(payments);
    expect(row).toMatchObject({ status: "confirmed", actionOutcome: "done" });
    expect(sent.map((b) => b.forma_pago)).toEqual([12]);
  });

  it("Ejecutar ahora on an observed SPEI payment records with the SPEI method", async () => {
    await seedLinkedBusiness({ actionsEnabled: false });
    mockTransfer();
    await submitTransfer();
    const [observed] = await db().select().from(payments);
    expect(observed.actionOutcome).toBe("observation");

    const sent = mockRecording([EFECTIVO, SPEI]);
    const res = await (await app()).request(`/payments/${observed.id}/execute-action`, { method: "POST", headers: await asOwner() }, testEnv);
    expect(res.status).toBe(200);
    expect(sent.map((b) => b.forma_pago)).toEqual([12]);
  });

  it("the sweep records a queued SPEI payment with the SPEI method", async () => {
    expect((await sweptWith([EFECTIVO, SPEI])).map((b) => b.forma_pago)).toEqual([12]);
  });

  it("no Devolada method: the cash method, and the action ends as today", async () => {
    expect((await sweptWith([EFECTIVO])).map((b) => b.forma_pago)).toEqual([7]);
  });

  it("FR-012: with CASH - RED.DEVOLADAPAGO listed before Cash (R11) and no SPEI method, the cash method is Cash", async () => {
    expect((await sweptWith([{ id: 3, nombre: "CASH - RED.DEVOLADAPAGO" }, { id: 4, nombre: "Cash" }, EFECTIVO])).map((b) => b.forma_pago)).toEqual([4]);
  });

  it("FR-012: only Devolada's names are set aside — a business's own Devoladapago stays its cash method", async () => {
    expect((await sweptWith([{ id: 3, nombre: "CASH - RED.DEVOLADAPAGO" }, { id: 5, nombre: "Devoladapago" }])).map((b) => b.forma_pago)).toEqual([5]);
  });

  it("FR-012: a business with only Devolada's network method records with it, today's behaviour", async () => {
    expect((await sweptWith([{ id: 3, nombre: "CASH - RED.DEVOLADAPAGO" }])).map((b) => b.forma_pago)).toEqual([3]);
  });

  it("D5: the name typed by hand as `spei-link . devoladapago` is matched", async () => {
    expect((await sweptWith([EFECTIVO, { id: 12, nombre: "spei-link . devoladapago" }])).map((b) => b.forma_pago)).toEqual([12]);
  });

  it("FR-003: two methods with the SPEI name → the lowest id", async () => {
    expect((await sweptWith([EFECTIVO, SPEI, { id: 9, nombre: "SPEI - LINK.DEVOLADAPAGO" }])).map((b) => b.forma_pago)).toEqual([9]);
  });

  it("D6: the provider refuses the method → the same payment again with the cash method, in the same attempt; the next payment reads the list again", async () => {
    const { business, row } = await seedQueued();
    const sent = mockRecording([EFECTIVO, SPEI], {
      answers: [{ status: 400, body: { forma_pago: ['Clave primaria "12" inválida - objeto no existe.'] } }],
      calls: 2,
    });
    await sweepReconnections(env);
    expect(sent.map((b) => b.forma_pago)).toEqual([12, 7]);
    expect(await reload(row.id)).toMatchObject({ actionOutcome: "done", actionError: null });
    expect((await reload(row.id)).paymentRegisteredAt).not.toBeNull();

    /* The list this data center held was dropped: the next payment asks
       WispHub again, and the method is gone from it */
    const next = await seedQueued({}, business);
    const again = mockRecording([EFECTIVO]);
    await sweepReconnections(env);
    expect(again.map((b) => b.forma_pago)).toEqual([7]);
    expect((await reload(next.row.id)).actionOutcome).toBe("done");
  });

  it("D6: a 400 naming another field is not a missing method — one call, and the action stays queued", async () => {
    const { row } = await seedQueued();
    mockAutoActivate();
    mockMethods([EFECTIVO, SPEI]);
    const sent = mockRegister(42, [{ status: 400, body: { total_cobrado: ["Monto inválido."] } }]);
    await sweepReconnections(env);
    expect(sent.map((b) => b.forma_pago)).toEqual([12]);
    expect(await reload(row.id)).toMatchObject({ actionOutcome: "queued", actionError: "INTEGRATION_UNAVAILABLE" });
    expect((await reload(row.id)).paymentRegisteredAt).toBeNull();
  });

  it("D9, FR-006: a payment whose money already landed is never recorded again — no list read, no registrar-pago", async () => {
    const { row } = await seedQueued({ paymentRegisteredAt: new Date(Date.now() - 5 * MINUTE) });
    mockCustomerLookup("Activo");
    await sweepReconnections(env);
    expect((await reload(row.id)).actionOutcome).toBe("done");
  });

  it("FR-005: a partial payment that leaves the service cut records with the SPEI method, accion 0", async () => {
    await seedLinkedBusiness();
    mockTransfer(30000);
    const sent = mockRecording([EFECTIVO, SPEI], { verify: false });
    await submitTransfer();
    const [row] = await db().select().from(payments);
    expect(row).toMatchObject({ status: "partial", actionOutcome: "withheld" });
    expect(sent.map((b) => [b.forma_pago, b.accion])).toEqual([[12, 0]]);
  });

  it("FR-005: a customer with no pending invoice — Devolada creates the invoice, then pays it with the SPEI method", async () => {
    const { row } = await seedQueued({ wisphubInvoiceId: null });
    mockAutoActivate();
    mockMethods([EFECTIVO, SPEI]);
    mockPendingInvoices([]);
    wh().intercept({ method: "POST", path: "/api/facturas/" }).reply(...json({ messages: "Se genero correctamente la factura 55." }));
    const sent = mockRegister(55);
    mockCustomerLookup("Activo");
    await sweepReconnections(env);
    expect(sent.map((b) => b.forma_pago)).toEqual([12]);
    expect((await reload(row.id)).wisphubInvoiceId).toBe(55);
  });

  it("FR-005: a held payment the business accepts records with the SPEI method", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1", speiClabe: "646180157000000004", speiBank: "STP" });
    const held = await seedConfirmedPayment(business, {
      wisphubInvoiceId: 42,
      reconciliationClass: "exact",
      observedAction: "register_and_reconnect:reconnect",
      actionOutcome: "review",
      reviewReason: "retired_account",
      beneficiary: JSON.stringify({ kind: "card", value: "4000000000004321", bank: "NUBANK", retired: true }),
    });
    const sent = mockRecording([EFECTIVO, SPEI]);
    const res = await (await app()).request(
      `/payments/${held.id}/review`,
      { method: "POST", headers: { "Content-Type": "application/json", ...(await asOwner()) }, body: JSON.stringify({ decision: "accept" }) },
      testEnv,
    );
    expect(res.status).toBe(200);
    expect(sent.map((b) => b.forma_pago)).toEqual([12]);
  });
});

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, integrations, paymentLinks, payments, stores } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { sweepReconnections } from "../src/reconnection/queue";
import { app, seedBusiness, seedConfirmedPayment, seedMember, sessionCookieHeader } from "./helpers";
import { devoladaMethods } from "../src/routes/integrations/schema";
import { paymentMethods, rememberPaymentMethods } from "../src/wisphub/cache";
import { cashMethodOf } from "../src/wisphub/payment-methods";
import { WispHub } from "../src/wisphub/client";
import {
  businessToday,
  BUSINESS_CLABE,
  linkRead,
  mockCustomer,
  mockFound,
  mockPanelSettle,
  mockPendingInvoices as mockPanelInvoices,
  mockPhoneSearch,
  pay,
  rowById,
  seedPanelLink,
  seedReferenceBusiness,
} from "./payer-helpers";
import { SENDER_8301 } from "./consta/bundle-fixtures";
import { mockAction, mockCustomerDebt, seedActiveStore, seedStore, seedStoreChannel, seedStorePayment } from "./store-helpers";

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
    /* D13: dispatchObserved builds its own reference — read at the edge */
    expect(observed.folio).toMatch(/^DV-[0-9A-Z]{6}$/);
    expect(sent.map((b) => b.referencia)).toEqual([`${observed.folio} · TRACK001XYZ`]);
  });

  it("the sweep records a queued SPEI payment with the SPEI method", async () => {
    expect((await sweptWith([EFECTIVO, SPEI])).map((b) => b.forma_pago)).toEqual([12]);
  });

  it("no Devolada method: the cash method with its reference, and the action ends as today", async () => {
    const { row } = await seedQueued({ trackingKey: "TRACK001XYZ" });
    const sent = mockRecording([EFECTIVO]);
    await sweepReconnections(env);
    expect((await reload(row.id)).actionOutcome).toBe("done");
    /* FR-007: a fallback still ties the record back to Devolada */
    expect(sent.map((b) => [b.forma_pago, b.referencia])).toEqual([[7, `${row.folio} · TRACK001XYZ`]]);
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

  it("FR-012: with only Devolada's methods, the cash method is today's — the one that says cash, whatever the order", () => {
    expect(cashMethodOf([SPEI, NETWORK]).id).toBe(13);
    expect(cashMethodOf([NETWORK, SPEI]).id).toBe(13);
    /* nothing says cash: the first, as today */
    expect(cashMethodOf([SPEI]).id).toBe(12);
  });

  it("D6, FR-004: the method just refused is never sent again — with only Devolada's methods, the payment lands at once", async () => {
    const { row } = await seedQueued();
    const sent = mockRecording([SPEI, NETWORK], {
      answers: [{ status: 400, body: { forma_pago: ['Clave primaria "12" inválida - objeto no existe.'] } }],
      calls: 2,
    });
    await sweepReconnections(env);
    expect(sent.map((b) => b.forma_pago)).toEqual([12, 13]);
    expect(await reload(row.id)).toMatchObject({ actionOutcome: "done", actionError: null });
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
    /* D13: the held row knows no clave, so its reference is the folio */
    expect(held.trackingKey).toBeNull();
    expect(sent.map((b) => b.referencia)).toEqual([held.folio]);
  });
});

/* ---- the store's record (cash-at-stores-counter.test.ts's recipe) ---- */

const LUPE = { usuario: "greyes@wifiplus", nombre: "Guadalupe Reyes", zona: "Centro", saldo: "299.00", id: 6 };

async function counter() {
  const business = await seedBusiness({ wisphubApiKey: "wh-key-1", name: "WiFi Plus" });
  await seedStoreChannel(business);
  const shop = await seedActiveStore();
  /* The first action attempt runs past the response (cash-at-stores D25):
     the call waits on the execution context, so the recording is done
     when it returns */
  const record = async () => {
    const ctx = createExecutionContext();
    const res = await (await app()).request(
      "/store/collections",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...shop.headers },
        body: JSON.stringify({ usuario: LUPE.usuario, amountCents: 79800, expectedDebtCents: 79800, expectedFeeCents: 1500, collectionKey: crypto.randomUUID() }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  };
  return { business, shop, record };
}

/* A store's cash payment waiting in the queue, not yet landed */
async function queuedStorePayment(business: { id: string }, store: { id: string; userId: string | null }) {
  return seedStorePayment(business, store, {
    actionOutcome: "queued",
    actionAttempts: 1,
    wisphubInvoiceId: 42,
    nextAttemptAt: new Date(Date.now() - MINUTE),
  });
}

async function storeBusiness() {
  const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
  await seedStoreChannel(business);
  return business;
}

describe("payment-method-per-channel US2: the business downloads what its network of stores collected", () => {
  it("a store's record carries CASH - RED.DEVOLADAPAGO", async () => {
    const { record } = await counter();
    mockCustomerDebt(LUPE, [{ id: 42, total: "499.00" }]);
    const captured = mockAction({ verify: "Activo", methods: [EFECTIVO, SPEI, NETWORK] });
    expect((await record()).status).toBe(201);
    expect(captured.formaPago).toBe(13);
  });

  it("the sweep records a queued store payment with the network's method", async () => {
    const business = await storeBusiness();
    const store = await seedStore({ status: "active" });
    await queuedStorePayment(business, store);
    const sent = mockRecording([EFECTIVO, SPEI, NETWORK]);
    await sweepReconnections(env);
    expect(sent.map((b) => b.forma_pago)).toEqual([13]);
  });

  it("FR-004: the network's method missing — a store payment records with the cash method, never the SPEI one", async () => {
    const business = await storeBusiness();
    const store = await seedStore({ status: "active" });
    await queuedStorePayment(business, store);
    const sent = mockRecording([EFECTIVO, SPEI]);
    await sweepReconnections(env);
    expect(sent.map((b) => b.forma_pago)).toEqual([7]);
  });

  it("FR-004: the SPEI method missing — a SPEI payment records with the cash method, never the network's", async () => {
    expect((await sweptWith([EFECTIVO, NETWORK])).map((b) => b.forma_pago)).toEqual([7]);
  });

  it("FR-002: two stores, one method — both record with it", async () => {
    const business = await storeBusiness();
    const north = await seedStore({ status: "active", name: "Tienda Norte" });
    const south = await seedStore({ status: "active", name: "Tienda Sur" });
    await queuedStorePayment(business, north);
    await queuedStorePayment(business, south);
    /* one list read: the second payment is answered by the cache (D3) */
    mockAutoActivate();
    mockAutoActivate();
    mockMethods([EFECTIVO, SPEI, NETWORK]);
    const sent = mockRegister(42, [], 2);
    mockCustomerLookup("Activo", 2);
    await sweepReconnections(env);
    expect(sent.map((b) => b.forma_pago)).toEqual([13, 13]);
  });
});

const ANA = { usuario: "ana@isp", telefono: "55 1826 4039", nombre: "Ana", apellido: "López" };

describe("payment-method-per-channel US3: each recorded payment says where it came from", () => {
  it("a SPEI payment with its clave → `folio · clave`", async () => {
    await seedLinkedBusiness();
    mockTransfer();
    const sent = mockRecording([EFECTIVO, SPEI]);
    await submitTransfer();
    const [row] = await db().select().from(payments);
    expect(row.folio).toMatch(/^DV-[0-9A-Z]{6}$/);
    expect(sent.map((b) => b.referencia)).toEqual([`${row.folio} · TRACK001XYZ`]);
  });

  it("a SPEI payment found by the payer's reference carries the clave adopted at the verdict", async () => {
    const business = await seedReferenceBusiness();
    const link = await seedPanelLink(business, ANA.usuario);
    mockCustomer(ANA);
    mockPanelInvoices([{ usuario: ANA.usuario, total: 348.5 }]);
    mockPhoneSearch("8264039", [ANA]);
    await linkRead(link.token);

    const today = businessToday();
    const found = {
      clave: `REF${today.replace(/-/g, "")}000001I`,
      operationDay: today,
      creditDay: today,
      creditTime: "07:11:20",
      senderAccount: SENDER_8301,
      beneficiaryAccount: BUSINESS_CLABE,
      amount: "350.00",
    };
    mockCustomer(ANA);
    mockPanelInvoices([{ usuario: ANA.usuario, total: 348.5 }]);
    mockFound(found);
    const sent = mockPanelSettle(ANA, 348.5, { methods: [EFECTIVO, SPEI] });
    const res = await pay(link.token, {
      transfer: { referenceSource: "own", senderBank: "AZTECA", date: today, referenceNumber: "1111111" },
    });
    expect(res.status).toBe(201);
    const row = await rowById(res.body.data!.directPaymentId);
    /* the payer sent no clave: it was adopted from Banxico's record */
    expect(row.trackingKey).toBe(found.clave);
    expect(sent).toMatchObject({ formaPago: 12, referencia: `${row.folio} · ${found.clave}` });
  });

  it("a SPEI payment with no clave → the folio alone", async () => {
    const { row } = await seedQueued({ trackingKey: null });
    const sent = mockRecording([EFECTIVO, SPEI]);
    await sweepReconnections(env);
    expect(sent.map((b) => b.referencia)).toEqual([row.folio]);
  });

  it("a store's record → `folio · store name`", async () => {
    const { shop, record } = await counter();
    mockCustomerDebt(LUPE, [{ id: 42, total: "499.00" }]);
    const captured = mockAction({ verify: "Activo", methods: [EFECTIVO, SPEI, NETWORK] });
    const { folio } = (await (await record()).json()).data;
    expect(captured.referencia).toBe(`${folio} · ${shop.store.name}`);
  });

  it("D10: a store renamed afterwards — a retry of a payment not yet landed carries the new name; a landed one is never recorded again", async () => {
    const business = await storeBusiness();
    const store = await seedStore({ status: "active", name: "Abarrotes Lupita" });
    const waiting = await queuedStorePayment(business, store);
    const landed = await seedStorePayment(business, store, {
      actionOutcome: "queued",
      actionAttempts: 1,
      wisphubInvoiceId: 43,
      paymentRegisteredAt: new Date(Date.now() - 5 * MINUTE),
      nextAttemptAt: new Date(Date.now() - MINUTE),
    });
    await db().update(stores).set({ name: "Abarrotes Lupita Centro" }).where(eq(stores.id, store.id));

    /* the waiting one is recorded, the landed one only verified */
    const sent = mockRecording([EFECTIVO, NETWORK]);
    mockCustomerLookup("Activo");
    await sweepReconnections(env);
    expect(sent.map((b) => b.referencia)).toEqual([`${waiting.folio} · Abarrotes Lupita Centro`]);
    expect((await reload(landed.id)).actionOutcome).toBe("done");
  });

  it("D6: the fallback carries the reference too", async () => {
    const { row } = await seedQueued({ trackingKey: "MBAN01002610020000001" });
    const sent = mockRecording([EFECTIVO, SPEI], {
      answers: [{ status: 400, body: { forma_pago: ['Clave primaria "12" inválida - objeto no existe.'] } }],
      calls: 2,
    });
    await sweepReconnections(env);
    const reference = `${row.folio} · MBAN01002610020000001`;
    expect(sent.map((b) => [b.forma_pago, b.referencia])).toEqual([
      [12, reference],
      [7, reference],
    ]);
  });

  it("D7: a 300-character store name, written straight to the row → 200 characters, the folio intact, the name ending in …", async () => {
    const business = await storeBusiness();
    const store = await seedStore({ status: "active" });
    await db().update(stores).set({ name: "N".repeat(300) }).where(eq(stores.id, store.id));
    const waiting = await queuedStorePayment(business, store);
    const sent = mockRecording([EFECTIVO, NETWORK]);
    await sweepReconnections(env);
    const [reference] = sent.map((b) => b.referencia!);
    expect([...reference]).toHaveLength(200);
    expect(reference.startsWith(`${waiting.folio} · NNN`)).toBe(true);
    expect(reference.endsWith("N…")).toBe(true);
  });

  it("FR-007: the body never holds the customer's name or phone", async () => {
    const business = await storeBusiness();
    const store = await seedStore({ status: "active" });
    await queuedStorePayment(business, store);
    await seedQueued({ customerName: "Janely Reyes", customerPhone: "5518264039" }, business);
    mockAutoActivate();
    mockAutoActivate();
    mockMethods([EFECTIVO, SPEI, NETWORK]);
    const sent = mockRegister(42, [], 2);
    mockCustomerLookup("Activo", 2);
    await sweepReconnections(env);
    expect(sent).toHaveLength(2);
    const bodies = JSON.stringify(sent);
    for (const personal of ["Guadalupe", "Reyes", "Janely", "5518264039", "8264039"]) {
      expect(bodies).not.toContain(personal);
    }
  });
});

/* ---- US4: the setup read, the connection test, the gate ---- */

const SPEI_LINE = {
  name: "SPEI - LINK.DEVOLADAPAGO",
  description:
    "Pagos SPEI validados por link de Devolada (bancos, Spin, Mercado Pago, CoDi, DiMo). Los registra Devolada; no usar en mostrador.",
};
const NETWORK_LINE = {
  name: "CASH - RED.DEVOLADAPAGO",
  description: "Pagos en efectivo en tiendas de la red Devolada. Los registra Devolada; no usar en mostrador.",
};
const timedOut = () => new DOMException("The operation was aborted", "TimeoutError");

const request = async (path: string, method = "GET", body?: unknown, headers?: Record<string, string>) =>
  (await app()).request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json", ...(headers ?? (await asOwner())) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    testEnv,
  );
const setupRead = (headers?: Record<string, string>) => request("/integrations/wisphub/payment-methods", "GET", undefined, headers);
const patch = (body: unknown) => request("/integrations/wisphub", "PATCH", body);
const connectionTest = (body: unknown = {}) => request("/integrations/wisphub/test", "POST", body);

const integrationRow = async () => (await db().select().from(integrations))[0];

/* The three probes of the connection test, the methods one answered by
   `methods` (a list, a status, or an error) */
function mockProbes(methods: Method[] | number | "timeout", origin = WISPHUB_ORIGIN) {
  const at = fetchMock.get(origin);
  at.intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/?") }).reply(...json({ count: 1, next: null, results: [customer("Activo")] }));
  at.intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") }).reply(...json({ count: 0, next: null, results: [] }));
  const read = at.intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") });
  if (methods === "timeout") read.replyWithError(timedOut());
  else if (typeof methods === "number") read.reply(methods, "{}");
  else read.reply(...json({ next: null, results: methods }));
}

describe("payment-method-per-channel US4: the business sets up its methods before Devolada writes in its system", () => {
  describe("GET /integrations/wisphub/payment-methods (D8)", () => {
    it("both found, store channel on → two lines, each with its name and description", async () => {
      const business = await seedBusiness({ wisphubApiKey: "wh-key-1", actionsEnabled: false });
      await seedStoreChannel(business);
      mockMethods([EFECTIVO, SPEI, NETWORK]);
      const res = await setupRead();
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(devoladaMethods.parse(data)).toEqual({
        checked: true,
        link: { ...SPEI_LINE, status: "found" },
        network: { ...NETWORK_LINE, status: "found" },
      });
    });

    it("store channel off → no network line; one missing → missing; two with one name → duplicate", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1", actionsEnabled: false });
      mockMethods([EFECTIVO, NETWORK]);
      expect((await (await setupRead()).json()).data).toEqual({ checked: true, link: { ...SPEI_LINE, status: "missing" }, network: null });
      mockMethods([EFECTIVO, SPEI, { id: 9, nombre: "spei-link . devoladapago" }]);
      expect((await (await setupRead()).json()).data.link.status).toBe("duplicate");
    });

    it("FR-009: WispHub timing out → checked: false, never missing", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1", actionsEnabled: false });
      wh().intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") }).replyWithError(timedOut());
      const res = await setupRead();
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ checked: false });
    });

    it("FR-009: a 200 whose body is the JSON null → checked: false, never a 500", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1", actionsEnabled: false });
      wh().intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") }).reply(...json(null));
      const res = await setupRead();
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ checked: false });
      expect((await integrationRow()).paymentMethodsSeenAt).toBeNull();
    });

    it("no key → 409 WISPHUB_NOT_CONFIGURED, and WispHub is not asked", async () => {
      await seedBusiness();
      const res = await setupRead();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ success: false, error: { code: "WISPHUB_NOT_CONFIGURED" } });
    });

    it("a role without integrations: manage is refused, as the hub's other routes", async () => {
      const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
      await seedMember(business, "operador@wifiplus.mx", "operator");
      const res = await setupRead({ Cookie: await sessionCookieHeader("operador@wifiplus.mx") });
      expect(res.status).toBe(403);
    });

    it("FR-014: after a payment cached the list without the SPEI method, a setup read that finds it makes the next SPEI payment use it", async () => {
      const { business, row } = await seedQueued();
      const first = mockRecording([EFECTIVO]);
      await sweepReconnections(env);
      expect(first.map((b) => b.forma_pago)).toEqual([7]);
      expect((await reload(row.id)).actionOutcome).toBe("done");

      /* the business creates the method and opens the screen */
      expect((await integrationRow()).paymentMethodsSeenAt).toBeNull();
      mockMethods([EFECTIVO, SPEI]);
      expect((await (await setupRead()).json()).data.link.status).toBe("found");
      /* D16: the read the screen made is the moment Devolada saw them */
      expect((await integrationRow()).paymentMethodsSeenAt).not.toBeNull();

      /* the next payment: the list the screen read, under its new stamp */
      await seedQueued({}, business);
      mockAutoActivate();
      const next = mockRegister(42);
      mockCustomerLookup("Activo");
      await sweepReconnections(env);
      expect(next.map((b) => b.forma_pago)).toEqual([12]);
    });
  });

  describe("POST /integrations/wisphub/test carries the block (D8)", () => {
    it("the probe answered → the block of the key tested", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1", actionsEnabled: false });
      mockProbes([EFECTIVO, SPEI]);
      const { data } = await (await connectionTest()).json();
      expect(data.outcome).toBe("OK");
      expect(data.devoladaMethods).toEqual({ checked: true, link: { ...SPEI_LINE, status: "found" }, network: null });
    });

    it("the methods probe refused or timed out → checked: false, never missing", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1", actionsEnabled: false });
      mockProbes(403);
      expect((await (await connectionTest()).json()).data).toMatchObject({ missingPermission: "payment_methods", devoladaMethods: { checked: false } });
      mockProbes("timeout");
      expect((await (await connectionTest()).json()).data.devoladaMethods).toEqual({ checked: false });
    });

    it("the test stopped at an earlier probe → null", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1", actionsEnabled: false });
      wh().intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/?") }).reply(503, "{}");
      expect((await (await connectionTest()).json()).data.devoladaMethods).toBeNull();
    });

    it("D16: a candidate key's test stamps nothing and leaves the cache; the saved connection's test stamps", async () => {
      const business = await seedBusiness({ wisphubApiKey: "wh-key-1", actionsEnabled: false });
      mockProbes([EFECTIVO, SPEI]);
      await connectionTest({ apiKey: "candidate-key-9" });
      expect((await integrationRow()).paymentMethodsSeenAt).toBeNull();

      /* T017: the candidate's list was not kept for the saved key — the
         next payment reads WispHub, whose list has no SPEI method */
      const { row } = await seedQueued({}, business);
      const sent = mockRecording([EFECTIVO]);
      await sweepReconnections(env);
      expect(sent.map((b) => b.forma_pago)).toEqual([7]);
      expect((await reload(row.id)).actionOutcome).toBe("done");

      mockProbes([EFECTIVO, SPEI]);
      await connectionTest();
      expect((await integrationRow()).paymentMethodsSeenAt).not.toBeNull();
    });
  });

  describe("PATCH /integrations/wisphub turning execution on (D14)", () => {
    async function observing(over: Parameters<typeof seedBusiness>[0] = {}) {
      return seedBusiness({ wisphubApiKey: "wh-key-1", actionsEnabled: false, ...over });
    }

    it("no key → 409 WISPHUB_NOT_CONFIGURED, no WispHub call, nothing saved", async () => {
      await seedBusiness({ wisphubApiKey: null, actionsEnabled: false });
      const res = await patch({ actionsEnabled: true });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("WISPHUB_NOT_CONFIGURED");
      expect((await integrationRow()).actionsEnabled).toBe(false);
    });

    it("the channel's methods exist → 200, execution on, the seen stamp moves", async () => {
      await observing();
      mockMethods([EFECTIVO, SPEI]);
      const res = await patch({ actionsEnabled: true });
      expect(res.status).toBe(200);
      const row = await integrationRow();
      expect(row.actionsEnabled).toBe(true);
      expect(row.paymentMethodsSeenAt).not.toBeNull();
    });

    it("the SPEI method missing → 409 PAYMENT_METHODS_MISSING, still observing, no stamp", async () => {
      await observing();
      mockMethods([EFECTIVO]);
      const res = await patch({ actionsEnabled: true, thresholdPercent: 50 });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("PAYMENT_METHODS_MISSING");
      const row = await integrationRow();
      /* the whole patch is refused, never half-applied */
      expect(row).toMatchObject({ actionsEnabled: false, thresholdPercent: 100, paymentMethodsSeenAt: null });
    });

    it("store channel on and only the SPEI method → refused; store channel off → saved", async () => {
      const business = await observing();
      await seedStoreChannel(business);
      mockMethods([EFECTIVO, SPEI]);
      const refused = await patch({ actionsEnabled: true });
      expect(refused.status).toBe(409);
      expect((await refused.json()).error.code).toBe("PAYMENT_METHODS_MISSING");
      expect((await integrationRow()).actionsEnabled).toBe(false);

      await db().update(businesses).set({ storeChannelOn: false }).where(eq(businesses.id, business.id));
      mockMethods([EFECTIVO, SPEI]);
      expect((await patch({ actionsEnabled: true })).status).toBe(200);
    });

    it("two methods with the SPEI name count as present → 200", async () => {
      await observing();
      mockMethods([SPEI, { id: 9, nombre: "SPEI - LINK.DEVOLADAPAGO" }]);
      expect((await patch({ actionsEnabled: true })).status).toBe(200);
    });

    it("WispHub timing out → 503 PAYMENT_METHODS_UNCHECKED, still observing", async () => {
      await observing();
      wh().intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") }).replyWithError(timedOut());
      const res = await patch({ actionsEnabled: true });
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("PAYMENT_METHODS_UNCHECKED");
      expect((await integrationRow()).actionsEnabled).toBe(false);
    });

    it("FR-009: a 200 whose body is the JSON null → 503 PAYMENT_METHODS_UNCHECKED, never a 500", async () => {
      await observing();
      wh().intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") }).reply(...json(null));
      const res = await patch({ actionsEnabled: true });
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("PAYMENT_METHODS_UNCHECKED");
      expect((await integrationRow()).actionsEnabled).toBe(false);
    });

    it("FR-013: turning off, and true on a row already on, never ask WispHub", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1", actionsEnabled: true });
      /* no interceptor: a WispHub call would fail the request */
      expect((await patch({ actionsEnabled: true })).status).toBe(200);
      expect((await patch({ actionsEnabled: false })).status).toBe(200);
      expect((await integrationRow()).actionsEnabled).toBe(false);
    });
  });

  describe("the seen stamp (D16)", () => {
    it("a saved new key stamps with no provider call for it; a refused gate does not", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1", actionsEnabled: false });
      mockMethods([EFECTIVO]);
      expect((await patch({ actionsEnabled: true })).status).toBe(409);
      expect((await integrationRow()).paymentMethodsSeenAt).toBeNull();

      /* the key save re-tests the connection (settings D3); the stamp
         comes with the save itself */
      mockProbes([EFECTIVO]);
      expect((await patch({ wisphubApiKey: "another-key-1234" })).status).toBe(200);
      expect((await integrationRow()).paymentMethodsSeenAt).not.toBeNull();
    });

    it("a saved new installation stamps even when its re-test never reaches the methods probe", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1", actionsEnabled: false });
      /* the new door refuses the first probe: no list is read at all */
      fetchMock
        .get("https://api.wisphub.io")
        .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/?") })
        .reply(403, "{}");
      const res = await patch({ installation: "wisphub_io" });
      expect(res.status).toBe(200);
      expect((await res.json()).data.wisphubTest.devoladaMethods).toBeNull();
      expect((await integrationRow()).paymentMethodsSeenAt).not.toBeNull();
    });

    it("a list cached under one stamp is read again when asked with a newer one", async () => {
      const now = new Date();
      const provider = new WispHub("wh-key-1");
      await rememberPaymentMethods("business-1", provider, [EFECTIVO], now, 1000);
      /* same stamp: the cache answers, no provider call */
      expect(await paymentMethods("business-1", provider, now, 1000)).toEqual([EFECTIVO]);
      mockMethods([EFECTIVO, SPEI]);
      expect(await paymentMethods("business-1", provider, now, 2000)).toEqual([EFECTIVO, SPEI]);
    });

    it("after one account's list was cached, another key on the same installation makes the next payment read the list again", async () => {
      const { business, row } = await seedQueued();
      mockRecording([EFECTIVO]);
      await sweepReconnections(env);
      expect((await reload(row.id)).actionOutcome).toBe("done");

      mockProbes([{ id: 31, nombre: "Efectivo" }, { id: 32, nombre: "SPEI - LINK.DEVOLADAPAGO" }]);
      expect((await patch({ wisphubApiKey: "second-account-key" })).status).toBe(200);

      /* the test of the saved key read the new account's list and kept
         it here under the new stamp — or, elsewhere, the next payment
         reads it: either way never the old account's ids */
      await seedQueued({}, business);
      mockAutoActivate();
      const next = mockRegister(42);
      mockCustomerLookup("Activo");
      await sweepReconnections(env);
      expect(next.map((b) => b.forma_pago)).toEqual([32]);
    });
  });
});

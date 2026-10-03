import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { payments } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { sweepReconnections } from "../src/reconnection/queue";
import { resetProviderCaches } from "../src/wisphub/cache";
import { app, seedBusiness, seedConfirmedPayment, sessionCookieHeader } from "./helpers";
import { WISPHUB } from "./payer-helpers";
import { mockAction, mockCustomerDebt, seedActiveStore, seedStoreChannel } from "./store-helpers";

/* bug: transferred-invoice-paid — when a customer with a pending invoice
   gets a new one, WispHub moves the pending invoice into it ("Se
   Transfirio") and still takes a payment on the moved one: the moved
   amount is then billed twice (measured 2026-10-01 on the demo tenant).
   Every path that registers a payment carries an invoice chosen earlier
   — at the verdict, at the counter, on a row that waits — so the adapter
   asks about it before any money moves, and follows the debt when it
   moved. WispHub answers at its pinned origin in the shapes measured that
   day. A registration on the moved invoice has no interceptor: it would
   fail the attempt, and the row would carry the error these tests say it
   does not. */

const testEnv = { ...env } as typeof env & Bindings;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
/* the payment method is cached per business (provider-latency D5) */
beforeEach(() => resetProviderCaches());
afterEach(() => fetchMock.assertNoPendingInterceptors());

const asOwner = { Cookie: await sessionCookieHeader("demo@devolada.app") };
const db = () => drizzle(env.DB);
const wh = () => fetchMock.get(WISPHUB);
const json = (body: unknown) => [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;
const MINUTE = 60_000;
const RECONNECT = "register_and_reconnect:reconnect";

/* The detail route's words for the three states (measured 2026-10-01) */
const PENDING = "Pendiente de Pago";
const PAID = "Pagada";
const MOVED = "Se Transfirio";

const customerRow = (estado = "Suspendido") => ({
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely",
  estado,
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: { id: 71342, nombre: "Zona dia 15" },
});

function mockInvoice(invoiceId: number, estado: string) {
  wh()
    .intercept({ method: "GET", path: `/api/facturas/${invoiceId}/` })
    .reply(...json({ id_factura: invoiceId, estado }));
}

/* Where the debt went: the record by usuario, then that customer's open
   invoices from the balance door — open ones only, never the moved one
   (measured 2026-10-01) */
function mockOpenInvoices(invoices: { id: number; total: number }[]) {
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/?") && p.includes("usuario=") })
    .reply(...json({ count: 1, next: null, results: [customerRow()] }));
  wh()
    .intercept({ method: "GET", path: "/api/clientes/6/saldo/" })
    .reply(
      ...json({
        facturas: invoices.map((f) => ({ id: f.id, fecha_emision: "2026-10-01", fecha_vencimiento: "2026-10-01", total: f.total })),
      }),
    );
}

/* The attempt that pays `invoiceId`: the opt-in, the cash method (read
   once per business, then cached), the registration with its body kept,
   and the verify read when the money landed */
function mockPay(invoiceId: number, opts: { status?: number; formas?: boolean } = {}) {
  const sent: { accion?: number; totalCobrado?: number } = {};
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
  if (opts.formas ?? true) {
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  }
  const pay = wh().intercept({
    method: "POST",
    path: `/api/facturas/${invoiceId}/registrar-pago/`,
    body: (raw) => {
      const b = JSON.parse(String(raw));
      sent.accion = b.accion;
      sent.totalCobrado = b.total_cobrado;
      return true;
    },
  });
  if (opts.status) {
    pay.reply(opts.status, JSON.stringify({ errors: ["WispHub"] }), { headers: { "Content-Type": "application/json" } });
  } else {
    pay.reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
  }
  /* an outage at the registration never reaches the verify; a 422 is
     the money already landed (reconnection D8), and verifies */
  if (!opts.status || opts.status === 422) {
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/?") && p.includes("usuario=") })
      .reply(...json({ count: 1, next: null, results: [customerRow("Activo")] }));
  }
  return sent;
}

const reload = async (id: string) => (await db().select().from(payments).where(eq(payments.id, id)))[0];

/* The queue's next pass, a minute past the wait the last attempt set */
async function nextPass(id: string) {
  const row = await reload(id);
  return sweepReconnections(testEnv, new Date((row.nextAttemptAt?.getTime() ?? Date.now()) + MINUTE));
}

const post = async (path: string, body?: unknown) =>
  (await app()).request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asOwner },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    testEnv,
  );

/* A confirmed payment that has not paid yet, on stored invoice 42 */
async function stored(over: Partial<typeof payments.$inferInsert>) {
  const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
  return seedConfirmedPayment(business, { reconciliationClass: "exact", wisphubInvoiceId: 42, ...over });
}

const dueNow = () => new Date(Date.now() - MINUTE);

describe("bug: transferred-invoice-paid — every path asks before it pays, and follows a moved debt", () => {
  it("'Ejecutar ahora' (integrations-hub D5): the invoice moved since the verdict — nothing is paid on it; the row waits on the invoice the debt moved to, and the next attempt pays that one", async () => {
    const row = await stored({ actionOutcome: "observation", observedAction: RECONNECT });
    mockInvoice(42, MOVED);
    mockOpenInvoices([{ id: 43, total: 998 }]);

    const res = await post(`/payments/${row.id}/execute-action`);
    expect(res.status).toBe(200);
    expect((await res.json()).data.actionOutcome).toBe("queued");
    expect(await reload(row.id)).toMatchObject({
      actionOutcome: "queued",
      wisphubInvoiceId: 43,
      paymentRegisteredAt: null,
      actionError: null,
      actionAttempts: 1,
    });

    mockInvoice(43, PENDING);
    const sent = mockPay(43);
    expect(await nextPass(row.id)).toMatchObject({ claimed: 1, reconnected: 1 });
    /* what the verdict decided, unchanged: its amount (partial-payment D9)
       and its reconnection */
    expect(sent).toEqual({ accion: 1, totalCobrado: 499 });
    const after = await reload(row.id);
    expect(after).toMatchObject({ actionOutcome: "done", wisphubInvoiceId: 43 });
    expect(after.paymentRegisteredAt).not.toBeNull();
  });

  it("accepting a held payment (receipt-triage D31): the moved invoice is never paid; the row waits on the new one", async () => {
    const row = await stored({ actionOutcome: "review", reviewReason: "no_clave", observedAction: RECONNECT });
    mockInvoice(42, MOVED);
    mockOpenInvoices([{ id: 43, total: 998 }]);

    const res = await post(`/payments/${row.id}/review`, { decision: "accept" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: "confirmed", actionOutcome: "queued" });
    expect(await reload(row.id)).toMatchObject({ wisphubInvoiceId: 43, paymentRegisteredAt: null, actionError: null });
  });

  it("a queue retry: the first attempt met an outage, the invoice moved before the retry — the retry pays where the debt went", async () => {
    const row = await stored({ actionOutcome: "queued", decidedAction: RECONNECT, actionAttempts: 0, nextAttemptAt: dueNow() });

    /* the first attempt: 42 still pending, WispHub down at the payment */
    mockInvoice(42, PENDING);
    mockPay(42, { status: 503 });
    expect(await sweepReconnections(testEnv)).toMatchObject({ claimed: 1, stillQueued: 1 });
    expect(await reload(row.id)).toMatchObject({
      wisphubInvoiceId: 42,
      paymentRegisteredAt: null,
      actionError: "INTEGRATION_UNAVAILABLE",
    });

    /* the business's billing moved 42 into 43 before the retry */
    mockInvoice(42, MOVED);
    mockOpenInvoices([{ id: 43, total: 998 }]);
    expect(await nextPass(row.id)).toMatchObject({ claimed: 1, stillQueued: 1 });
    expect(await reload(row.id)).toMatchObject({ wisphubInvoiceId: 43, paymentRegisteredAt: null, actionError: null });

    mockInvoice(43, PENDING);
    const sent = mockPay(43, { formas: false });
    expect(await nextPass(row.id)).toMatchObject({ claimed: 1, reconnected: 1 });
    expect(sent).toEqual({ accion: 1, totalCobrado: 499 });
  });

  it("'Reintentar' on a failed row (payments-and-classes D5): the moved invoice is never paid — the one attempt a click buys finds the new invoice, the next click pays it", async () => {
    const row = await stored({
      actionOutcome: "failed",
      decidedAction: RECONNECT,
      actionAttempts: 6,
      nextAttemptAt: null,
      actionError: "INTEGRATION_UNAVAILABLE",
    });

    expect((await post(`/payments/${row.id}/retry-action`)).status).toBe(200);
    mockInvoice(42, MOVED);
    mockOpenInvoices([{ id: 43, total: 998 }]);
    expect(await sweepReconnections(testEnv)).toMatchObject({ claimed: 1, failed: 1 });
    /* the attempt went to finding where the debt is: nothing paid, and
       the row keeps the invoice for the next click */
    expect(await reload(row.id)).toMatchObject({
      actionOutcome: "failed",
      wisphubInvoiceId: 43,
      paymentRegisteredAt: null,
      actionError: null,
    });

    expect((await post(`/payments/${row.id}/retry-action`)).status).toBe(200);
    mockInvoice(43, PENDING);
    const sent = mockPay(43);
    expect(await sweepReconnections(testEnv)).toMatchObject({ claimed: 1, reconnected: 1 });
    expect(sent).toEqual({ accion: 1, totalCobrado: 499 });
  });

  it("a store's cash record (cash-at-stores D25): the invoice moved between the debt read and the deferred attempt — the folio is answered, and the payment lands on the new invoice", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1", name: "WiFi Plus" });
    await seedStoreChannel(business);
    const shop = await seedActiveStore();
    const lupe = { usuario: "greyes@wifiplus", nombre: "Guadalupe Reyes", zona: "Centro", saldo: "0.00", id: 6 };
    /* the counter's debt read: 499.00 on invoice 42 */
    mockCustomerDebt(lupe, [{ id: 42, total: "499.00" }]);
    /* the move, before the attempt the record defers: the adapter's own
       look at 42, then where the debt went */
    mockInvoice(42, MOVED);
    mockCustomerDebt(lupe, [{ id: 43, total: "998.00" }]);

    const ctx = createExecutionContext();
    const res = await (await app()).request(
      "/store/collections",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...shop.headers },
        body: JSON.stringify({
          usuario: lupe.usuario,
          amountCents: 49900,
          expectedDebtCents: 49900,
          expectedFeeCents: 1500,
          collectionKey: crypto.randomUUID(),
        }),
      },
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(201);
    const { id, folio } = (await res.json()).data;
    expect(folio).toMatch(/^DV-/);
    expect(await reload(id)).toMatchObject({ actionOutcome: "queued", wisphubInvoiceId: 43, paymentRegisteredAt: null, actionError: null });

    /* mockAction asks about 43 first, and finds it pending */
    const captured = mockAction({ invoiceId: 43, verify: "Activo" });
    expect(await nextPass(id)).toMatchObject({ claimed: 1, reconnected: 1 });
    expect(captured).toEqual({ accion: 1, totalCobrado: 499 });
  });

  it("at most once (reconnection D8): the new invoice was on the row before its payment, whose answer was lost — the retry meets it paid, WispHub's 422 says landed, and nothing is paid twice", async () => {
    const row = await stored({
      actionOutcome: "queued",
      decidedAction: RECONNECT,
      wisphubInvoiceId: 43,
      actionAttempts: 2,
      nextAttemptAt: dueNow(),
    });
    mockInvoice(43, PAID);
    const sent = mockPay(43, { status: 422 });

    expect(await sweepReconnections(testEnv)).toMatchObject({ claimed: 1, reconnected: 1 });
    expect(sent.accion).toBe(1);
    const after = await reload(row.id);
    /* no vehicle: its POST /facturas/ has no interceptor and would have
       failed the attempt */
    expect(after).toMatchObject({ actionOutcome: "done", wisphubInvoiceId: 43, actionError: null });
    expect(after.paymentRegisteredAt).not.toBeNull();
  });

  it("nothing open after the move (paid at the counter meanwhile): the payment rides the empty vehicle (debt-truth D15), never the moved invoice", async () => {
    const row = await stored({ actionOutcome: "queued", decidedAction: RECONNECT, actionAttempts: 1, nextAttemptAt: dueNow() });
    mockInvoice(42, MOVED);
    mockOpenInvoices([]);
    expect(await sweepReconnections(testEnv)).toMatchObject({ claimed: 1, stillQueued: 1 });
    expect(await reload(row.id)).toMatchObject({ wisphubInvoiceId: null, paymentRegisteredAt: null, actionError: null });

    /* no invoice on the row: the live list is asked, then the vehicle made */
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
      .reply(...json({ next: null, count: 0, results: [] }));
    const vehicle: Record<string, unknown> = {};
    wh()
      .intercept({
        method: "POST",
        path: "/api/facturas/",
        body: (raw) => {
          Object.assign(vehicle, JSON.parse(String(raw)));
          return true;
        },
      })
      .reply(...json({ messages: "Se genero correctamente la factura 77." }));
    const sent = mockPay(77);

    expect(await nextPass(row.id)).toMatchObject({ claimed: 1, reconnected: 1 });
    expect(vehicle).toMatchObject({ cliente: "greyes@wifiplus", total: 0 });
    expect(sent.totalCobrado).toBe(499);
    expect(await reload(row.id)).toMatchObject({ actionOutcome: "done", wisphubInvoiceId: 77 });
  });

  it("an invoice still pending is paid at once — one read more, nothing else changed", async () => {
    const row = await stored({ actionOutcome: "observation", observedAction: RECONNECT });
    mockInvoice(42, PENDING);
    const sent = mockPay(42);

    const res = await post(`/payments/${row.id}/execute-action`);
    expect((await res.json()).data.actionOutcome).toBe("done");
    expect(sent).toEqual({ accion: 1, totalCobrado: 499 });
    expect(await reload(row.id)).toMatchObject({ wisphubInvoiceId: 42, actionAttempts: 1 });
  });

  it("a detail route WispHub does not serve (405) keeps the old behaviour: the stored invoice is paid", async () => {
    const row = await stored({ actionOutcome: "queued", decidedAction: RECONNECT, actionAttempts: 1, nextAttemptAt: dueNow() });
    wh().intercept({ method: "GET", path: "/api/facturas/42/" }).reply(405, "{}");
    const sent = mockPay(42);

    expect(await sweepReconnections(testEnv)).toMatchObject({ claimed: 1, reconnected: 1 });
    expect(sent.totalCobrado).toBe(499);
    expect(await reload(row.id)).toMatchObject({ actionOutcome: "done", wisphubInvoiceId: 42 });
  });
});

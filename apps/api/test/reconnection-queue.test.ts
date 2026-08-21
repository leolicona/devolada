import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { charges } from "../src/db/schema";
import { sweepReconnections, MAX_ATTEMPTS } from "../src/reconnection/queue";
import { seedIsp, seedStore } from "./helpers";

/* docs/charges/reconnection-queue.spec.md scenarios 1–6. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const MINUTE = 60_000;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const json = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

const customer = (estado: string) => ({
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely",
  estado,
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: { id: 1, nombre: "Centro" },
});

const mockPaymentMethods = () =>
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
    .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));

/* D9: the payment attempt ensures the reactivation opt-in first.
   Registering the interceptor also asserts the PATCH happens —
   assertNoPendingInterceptors fails if it never fires. */
const mockAutoActivate = () =>
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));

/* undici sorts the query when it matches, so the matcher must not
   depend on the order the adapter writes the params in. */
const invoiceListPath = (p: string) => p.startsWith("/api/facturas/?") && p.includes("estado=1");

const mockPendingInvoices = (results: unknown[]) =>
  wh()
    .intercept({ method: "GET", path: invoiceListPath })
    .reply(...json({ count: results.length, results }));

const mockCreateInvoice = (id: number) =>
  wh()
    .intercept({ method: "POST", path: "/api/facturas/" })
    .reply(...json({ messages: `Se genero correctamente la factura ${id}.` }));

const mockPayment = (invoiceId: number) =>
  wh()
    .intercept({ method: "POST", path: `/api/facturas/${invoiceId}/registrar-pago/` })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));

const mockVerify = (estado: string) =>
  wh()
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario="),
    })
    .reply(...json({ count: 1, results: [customer(estado)] }));

async function seedQueuedCharge(over: Partial<typeof charges.$inferInsert> = {}) {
  const isp = await seedIsp({ wisphubApiKey: "wh-key-1" });
  const store = await seedStore(isp.id);
  const db = drizzle(env.DB);
  const [charge] = await db
    .insert(charges)
    .values({
      ispId: isp.id,
      storeId: store.id,
      folio: `DV-Q${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      /* Production-faithful: recordCharge stores the numeric id here and
         the usuario apart (D8). The old seed put the usuario in the id
         column — a mock that lied (TESTING.md rule 5), hiding that no
         real retry could ever look the customer up. */
      wisphubCustomerId: "6",
      customerUsuario: "greyes@wifiplus",
      customerName: "Janely",
      invoiceCents: 49900,
      serviceFeeCents: 1500,
      totalCents: 51400,
      reconnectionStatus: "queued",
      reconnectionAttempts: 1,
      nextAttemptAt: new Date(Date.now() - MINUTE),
      ...over,
    })
    .returning();
  return { isp, store, charge, db };
}

const reload = async (db: ReturnType<typeof drizzle>, id: string) =>
  (await db.select().from(charges).where(eq(charges.id, id)))[0];

describe("US-C04: the queue pays the invoice the customer already has (TD-009)", () => {
  it("reuses a pending invoice and creates none", async () => {
    const { charge, db } = await seedQueuedCharge();
    mockAutoActivate();
    mockPaymentMethods();
    /* Two pending invoices exist; the older debt is the one to settle */
    mockPendingInvoices([
      { id_factura: 77, cliente: { usuario: "greyes@wifiplus" }, total: 499 },
      { id_factura: 12, cliente: { usuario: "greyes@wifiplus" }, total: 499 },
      { id_factura: 99, cliente: { usuario: "otro@wifiplus" }, total: 499 },
    ]);
    mockPayment(12);
    mockVerify("Activo");
    /* No POST /api/facturas/ interceptor: creating one would fail the test */

    const report = await sweepReconnections(env);
    expect(report).toMatchObject({ claimed: 1, reconnected: 1, failed: 0 });

    const row = await reload(db, charge.id);
    expect(row.wisphubInvoiceId).toBe(12);
    expect(row.reconnectionStatus).toBe("reconnected");
    expect(row.nextAttemptAt).toBeNull();
    expect(row.reconnectedAt).not.toBeNull();
  });

  it("creates one when there is none, and the retry only verifies (D8)", async () => {
    const { charge, db } = await seedQueuedCharge();
    mockAutoActivate();
    mockPaymentMethods();
    mockPendingInvoices([]);
    mockCreateInvoice(55);
    mockPayment(55);
    mockVerify("Suspendido"); /* paid, not flipped yet (D6) */

    await sweepReconnections(env);
    const afterFirst = await reload(db, charge.id);
    expect(afterFirst.wisphubInvoiceId).toBe(55);
    expect(afterFirst.reconnectionStatus).toBe("queued");
    /* The payment landed: that progress survives the failed convert */
    expect(afterFirst.paymentRegisteredAt).not.toBeNull();

    /* D8: the retry asks the only open question. No payment methods, no
       invoice list, no registrar-pago — any of those would fail the
       test as an unmatched request. The old flow re-paid here, and
       WispHub's 422 on a paid invoice killed every retry. */
    await db
      .update(charges)
      .set({ nextAttemptAt: new Date(Date.now() - MINUTE) })
      .where(eq(charges.id, charge.id));
    mockVerify("Activo");

    await sweepReconnections(env);
    expect((await reload(db, charge.id)).reconnectionStatus).toBe("reconnected");
  });

  it("WispHub's 422 on an already-paid invoice counts as landed (D8)", async () => {
    /* An overlapping attempt or a panel payment got there first. The
       refusal is the goal state: verify, don't fail. Measured live. */
    const { charge, db } = await seedQueuedCharge({ wisphubInvoiceId: 55 });
    mockAutoActivate();
    mockPaymentMethods();
    wh()
      .intercept({ method: "POST", path: "/api/facturas/55/registrar-pago/" })
      .reply(422, JSON.stringify({ errors: ["La Factura seleccionada se encuentra en estado pagada"] }), {
        headers: { "Content-Type": "application/json" },
      });
    mockVerify("Activo");

    await sweepReconnections(env);
    const row = await reload(db, charge.id);
    expect(row.reconnectionStatus).toBe("reconnected");
    expect(row.paymentRegisteredAt).not.toBeNull();
  });
});

describe("US-C04: the backoff walks and then gives up", () => {
  it("schedules 5, 15, 60, 240 minutes and marks failed after the last", async () => {
    /* The payment already landed (D8): every walk step verifies only */
    const { charge, db } = await seedQueuedCharge({
      wisphubInvoiceId: 55,
      paymentRegisteredAt: new Date(),
    });
    const expected = [5, 15, 60, 240];

    for (const [i, wait] of expected.entries()) {
      mockVerify("Suspendido");

      const before = Date.now();
      await sweepReconnections(env);
      const row = await reload(db, charge.id);

      expect(row.reconnectionAttempts).toBe(i + 2);
      expect(row.reconnectionStatus).toBe("queued");
      /* The next date is the backoff step for the attempts made so far */
      const waited = (row.nextAttemptAt!.getTime() - before) / MINUTE;
      expect(Math.round(waited)).toBe(wait);

      await db
        .update(charges)
        .set({ nextAttemptAt: new Date(Date.now() - MINUTE) })
        .where(eq(charges.id, charge.id));
    }

    /* One more failure exhausts the budget */
    mockVerify("Suspendido");
    const report = await sweepReconnections(env);

    const dead = await reload(db, charge.id);
    expect(dead.reconnectionAttempts).toBe(MAX_ATTEMPTS);
    expect(dead.reconnectionStatus).toBe("failed");
    expect(dead.nextAttemptAt).toBeNull();
    expect(report.failed).toBe(1);
  });
});

describe("US-C04: a rejected key is not the store's fault", () => {
  it("reschedules without spending an attempt, unlike an outage", async () => {
    const { charge, db } = await seedQueuedCharge({ wisphubInvoiceId: 55 });

    /* D5: WispHub rejects the ISP's key */
    mockAutoActivate();
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(403, "{}", { headers: { "Content-Type": "application/json" } });

    await sweepReconnections(env);
    const paused = await reload(db, charge.id);
    expect(paused.reconnectionAttempts).toBe(1); /* unchanged */
    expect(paused.lastError).toBe("WISPHUB_AUTH_FAILED");
    expect(paused.reconnectionStatus).toBe("queued");
    expect(Math.round((paused.nextAttemptAt!.getTime() - Date.now()) / MINUTE)).toBe(30);

    /* An outage is what the backoff is for: it counts */
    await db
      .update(charges)
      .set({ nextAttemptAt: new Date(Date.now() - MINUTE) })
      .where(eq(charges.id, charge.id));
    mockAutoActivate();
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(500, "{}", { headers: { "Content-Type": "application/json" } });

    await sweepReconnections(env);
    const counted = await reload(db, charge.id);
    expect(counted.reconnectionAttempts).toBe(2);
    expect(counted.lastError).toBe("WISPHUB_UNAVAILABLE");
  });
});

describe("US-C03: the sweep only touches what is due", () => {
  it("leases claimed charges and ignores terminal ones", async () => {
    const { charge, db, isp, store } = await seedQueuedCharge({
      nextAttemptAt: new Date(Date.now() + 10 * MINUTE),
    });
    /* A reconnected charge and a future-dated one: neither is due */
    await db.insert(charges).values({
      ispId: isp.id,
      storeId: store.id,
      folio: "DV-DONE01",
      wisphubCustomerId: "greyes@wifiplus",
      customerName: "Janely",
      invoiceCents: 49900,
      serviceFeeCents: 1500,
      totalCents: 51400,
      reconnectionStatus: "reconnected",
      nextAttemptAt: new Date(Date.now() - MINUTE),
    });

    const quiet = await sweepReconnections(env);
    expect(quiet).toEqual({ claimed: 0, reconnected: 0, stillQueued: 0, failed: 0 });

    /* Due now: the sweep claims it and leases it two minutes ahead (D4) */
    await db
      .update(charges)
      .set({ nextAttemptAt: new Date(Date.now() - MINUTE) })
      .where(eq(charges.id, charge.id));
    mockAutoActivate();
    mockPaymentMethods();
    mockPendingInvoices([]);
    mockCreateInvoice(60);
    mockPayment(60);
    mockVerify("Suspendido");

    const worked = await sweepReconnections(env);
    expect(worked).toMatchObject({ claimed: 1, stillQueued: 1 });

    /* Immediately after, nothing is due: the lease (or the backoff) holds */
    const again = await sweepReconnections(env);
    expect(again.claimed).toBe(0);
  });
});

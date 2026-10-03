import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { creditEntries, integrationEvents, integrations, paymentLinks, payments } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { app, seedBusiness, seedMember, sessionCookieHeader } from "./helpers";

/* docs/legacy/integrations/integrations-hub.spec.md scenarios 3, 4, 5, 7 and 9
   (US-I02, US-I03) — the dispatch: the mapping in the real path, the
   observation gate, "Ejecutar ahora", the event ledger, and the
   provisional pause. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const APICEP_ORIGIN = "https://api.apicep.cloud";

const testEnv = {
  ...env,
} as typeof env & Bindings;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const asBusiness = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };

const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const apicep = () => fetchMock.get(APICEP_ORIGIN);
const json = (body: unknown) => [
  200,
  JSON.stringify(body),
  { headers: { "Content-Type": "application/json" } },
] as const;

const wisphubCustomer = (over: Record<string, unknown> = {}) => ({
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely",
  estado: "Suspendido",
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: { id: 71342, nombre: "Zona dia 15" },
  ...over,
});

function mockCustomerLookup(results: unknown[], times = 1) {
  wh()
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario="),
    })
    .reply(...json({ count: results.length, results }))
    .times(times);
}

function mockPendingInvoices(times = 1) {
  wh()
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1"),
    })
    .reply(...json({ next: null, count: 1, results: [{ id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 }] }))
    .times(times);
}

/* PATCH + formas + registrar (accion captured) + the verify lookup only
   when the router was actually asked. */
function mockDispatch(opts: { verify?: boolean; formas?: boolean } = {}) {
  const captured: { accion?: number; totalCobrado?: number } = {};
  /* bug: transferred-invoice-paid — the invoice is asked about before any
     money moves (the detail route's measured shape) */
  wh()
    .intercept({ method: "GET", path: "/api/facturas/42/" })
    .reply(...json({ id_factura: 42, estado: "Pendiente de Pago" }));
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
  if (opts.formas ?? true) {
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  }
  wh()
    .intercept({
      method: "POST",
      path: "/api/facturas/42/registrar-pago/",
      body: (raw) => {
        const b = JSON.parse(String(raw));
        captured.accion = b.accion;
        captured.totalCobrado = b.total_cobrado;
        return true;
      },
    })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: opts.verify === false ? null : "t-1" }));
  if (opts.verify ?? true) mockCustomerLookup([wisphubCustomer({ estado: "Activo" })]);
  return captured;
}

/* consta-api-merge D12: apiCEP at its real origin, answering a settled
   CEP in pesos; the engine turns it into the verdict the lifecycle reads */
function mockConsta(cepAmountCents: number) {
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

async function seedLinkedBusiness(
  overrides: Parameters<typeof seedBusiness>[0] = {},
) {
  const business = await seedBusiness({
    wisphubApiKey: "wh-key-1",
    serviceFeeCents: 1500,
    speiClabe: "646180157000000004",
    speiBank: "STP",
    speiBeneficiaryName: "WifiPlus SA de CV",
    ...overrides,
  });
  const [link] = await drizzle(env.DB)
    .insert(paymentLinks)
    .values({
      businessId: business.id,
      token: "tok2345abcdefgh2",
      wisphubCustomerId: "6",
      customerUsuario: "greyes@wifiplus",
    })
    .returning();
  return { business, link };
}

async function payTransfer() {
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

const db = () => drizzle(env.DB);

describe("US-I02 scenario 3: the mapping decides in the real path", () => {
  it("short → register_only registers with accion 0 and the outcome is done, whatever the threshold", async () => {
    const { business } = await seedLinkedBusiness();
    await db().update(integrations).set({ shortAction: "register_only" }).where(eq(integrations.businessId, business.id));

    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(2);
    mockConsta(30000);
    const captured = mockDispatch({ verify: false });

    expect((await payTransfer()).status).toBe(201);
    const [row] = await db().select().from(payments);
    expect(row).toMatchObject({
      status: "partial",
      reconciliationClass: "short",
      actionOutcome: "done",
      observedAction: null,
    });
    expect(row.actionDoneAt).not.toBeNull();
    expect(captured.accion).toBe(0);

    /* scenario 7 rides along: the ledger row carries class and action */
    const events = await db().select().from(integrationEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      paymentId: row.id,
      class: "short",
      action: "register_only",
      status: "acked",
    });
  });

  it("back on register_and_reconnect, the threshold decides again and the acked event carries it", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(2);
    mockConsta(51400);
    const captured = mockDispatch();

    await payTransfer();
    const [row] = await db().select().from(payments);
    expect(row.actionOutcome).toBe("done");
    expect(captured.accion).toBe(1);
    const [event] = await db().select().from(integrationEvents);
    expect(event).toMatchObject({ class: "exact", action: "register_and_reconnect", status: "acked" });

    /* D7: the feed names `done` by the ledger's action */
    const feed = await (await app()).request("/payments/feed", asBusiness, env);
    expect((await feed.json()).data.payments[0]).toMatchObject({
      actionOutcome: "done",
      dispatchedAction: "register_and_reconnect",
    });
  });
});

describe("US-I03 scenario 4: observation writes nothing to WispHub", () => {
  it("the verdict lands whole, the row records the hypothesis, the credit is spent — and no event exists", async () => {
    await seedLinkedBusiness({ actionsEnabled: false });

    /* Reads only: the pay pre-check and the validation's fresh re-read.
       No PATCH, no formas, no registrar — disableNetConnect is the
       assertion that nothing else was even attempted. */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(2);
    mockConsta(51400);

    expect((await payTransfer()).status).toBe(201);
    const [row] = await db().select().from(payments);
    expect(row).toMatchObject({
      status: "confirmed",
      reconciliationClass: "exact",
      actionOutcome: "observation",
      observedAction: "register_and_reconnect:reconnect",
      registeredCents: 49900,
      wisphubInvoiceId: 42,
      customerName: "Janely",
    });
    expect(row.folio).not.toBeNull();
    /* the oracle still earned its keep */
    expect(await db().select().from(creditEntries).where(eq(creditEntries.kind, "validation_fee"))).toHaveLength(1);
    /* D6: the gate sits BEFORE dispatch — no ledger row */
    expect(await db().select().from(integrationEvents)).toHaveLength(0);
  });

  it("a short payment below the threshold records the withhold hypothesis", async () => {
    await seedLinkedBusiness({ actionsEnabled: false });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(2);
    mockConsta(30000);

    await payTransfer();
    const [row] = await db().select().from(payments);
    expect(row).toMatchObject({
      status: "partial",
      actionOutcome: "observation",
      observedAction: "register_and_reconnect:withhold",
    });
  });
});

describe("US-I03 scenario 5: Ejecutar ahora dispatches the recorded action", () => {
  async function observedPayment(cepCents: number) {
    await seedLinkedBusiness({ actionsEnabled: false });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(2);
    mockConsta(cepCents);
    await payTransfer();
    const [row] = await db().select().from(payments);
    return row;
  }
  const execute = async (id: string, headers = asBusiness.headers) =>
    (await app()).request(`/payments/${id}/execute-action`, { method: "POST", headers }, testEnv);

  it("a reconnect hypothesis reconnects: observation → done, one event dispatched → acked; a second click is 409", async () => {
    const row = await observedPayment(51400);
    const captured = mockDispatch();

    const res = await execute(row.id);
    expect(res.status).toBe(200);
    expect((await res.json()).data.actionOutcome).toBe("done");
    expect(captured.accion).toBe(1);

    const [after] = await db().select().from(payments);
    expect(after.actionOutcome).toBe("done");
    expect(after.actionDoneAt).not.toBeNull();
    /* the hypothesis stays for the audit trail */
    expect(after.observedAction).toBe("register_and_reconnect:reconnect");
    const [event] = await db().select().from(integrationEvents);
    expect(event).toMatchObject({ class: "exact", action: "register_and_reconnect", status: "acked" });

    const again = await execute(row.id);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("NOT_OBSERVED");
  });

  it("a withhold hypothesis registers with accion 0 and lands withheld — the threshold stays the law", async () => {
    const row = await observedPayment(30000);
    const captured = mockDispatch({ verify: false });

    const res = await execute(row.id);
    expect((await res.json()).data.actionOutcome).toBe("withheld");
    expect(captured.accion).toBe(0);
    const [after] = await db().select().from(payments);
    expect(after).toMatchObject({ actionOutcome: "withheld", paymentRegisteredAt: expect.any(Date) });
  });

  it("a viewer cannot execute", async () => {
    const row = await observedPayment(51400);
    const { businesses } = await import("../src/db/schema");
    const [b] = await db().select().from(businesses);
    await seedMember({ orgId: b.orgId }, "lector@wifiplus.mx", "viewer");
    const asViewer = { Cookie: await sessionCookieHeader("lector@wifiplus.mx") };
    const res = await execute(row.id, asViewer);
    expect(res.status).toBe(403);
  });
});

describe("US-I03 scenario 9: observation pauses the provisional release", () => {
  it("evidence that would buy the promise buys nothing while observing", async () => {
    await seedLinkedBusiness({ actionsEnabled: false, provisionalReleaseEnabled: true });
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices(1);
    /* pending is the strongest pre-valid evidence (provisional D1) —
       with actions on this would call WispHub for the promise */
    apicep()
      .intercept({ method: "POST", path: "/validate-transfer" })
      .reply(...json({ validationId: "v-1", status: "pending", validation: { cepPreviouslyValidated: false } }));

    expect((await payTransfer()).status).toBe(201);
    const [row] = await db().select().from(payments);
    expect(row.status).toBe("validating");
    expect(row.provisionalReleaseAt).toBeNull();
  });
});

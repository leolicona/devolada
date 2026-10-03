import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { app, fakeProofs, seedBusiness } from "./helpers";
import { paymentLinks, payments, wisphubPages, wisphubSweeps } from "../src/db/schema";
import { resetProviderCaches } from "../src/wisphub/cache";
import { PENDING_LIVE_PAGES } from "../src/wisphub/client";
import { readPendingInvoices, REST_MS, SWEEP_PAGES, sweepWispHubLists, wakeSweep } from "../src/wisphub/snapshot";
import { wisphubFor } from "../src/wisphub/factory";
import type { Bindings } from "../src/env";

/* bug: pending-invoice-cap — a customer whose invoice sat beyond the
   five pages a request can read computed to a debt of zero: the payer's
   page painted "al corriente", the submission and the verdict fell back
   to the plan's price, and the payment was registered on an empty
   invoice while the real one stayed pending. The fix reads such a
   tenant in the background and serves the finished pass to every path.
   WispHub is fetch-mocked at its origin; the sweep is driven by hand. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const APICEP_ORIGIN = "https://api.apicep.cloud";

const testEnv = { ...env, PROOFS: fakeProofs() } as typeof env & Bindings;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(() => resetProviderCaches());
afterEach(() => fetchMock.assertNoPendingInterceptors());

const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const apicep = () => fetchMock.get(APICEP_ORIGIN);
const json = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

const USUARIO = "greyes@wifiplus";
const TOKEN = "tok2345abcdefgh2";

const wisphubCustomer = (over: Record<string, unknown> = {}) => ({
  id_servicio: 6,
  usuario: USUARIO,
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
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
    .reply(...json({ count: results.length, results }))
    .times(times);
}

/* One hundred strangers' invoices, ids climbing with the page */
const strangers = (page: number) =>
  Array.from({ length: 100 }, (_, k) => ({
    id_factura: page * 100 + k + 1,
    cliente: { usuario: `otro${page * 100 + k + 1}@wifiplus`, nombre: "Otro" },
    total: 499,
    fecha_emision: "2026-08-01",
    fecha_vencimiento: "2026-08-11",
  }));

const mine = (id: number, total = 350) => ({
  id_factura: id,
  cliente: { usuario: USUARIO, nombre: "Janely" },
  total,
  fecha_emision: "2026-09-01",
  fecha_vencimiento: "2026-09-11",
});

/* The tenant's list as WispHub pages it: page k answers at `offset=k*100`
   and points at the next; the last says `next: null`. `cut` stops the
   mocks short of the end so a walk that reads that far is cut off. */
function mockPages(pages: unknown[][], opts: { from?: number; to?: number; last?: boolean } = {}) {
  const from = opts.from ?? 0;
  const to = opts.to ?? pages.length;
  for (let i = from; i < to; i++) {
    const isLast = i === pages.length - 1 && (opts.last ?? true);
    wh()
      .intercept({
        method: "GET",
        path: (p) =>
          p.startsWith("/api/facturas/?") &&
          p.includes("estado=1") &&
          (i === 0 ? !p.includes("offset=") : p.includes(`offset=${i * 100}`)),
      })
      .reply(
        ...json({
          next: isLast
            ? null
            : `http://api.wisphub.net/api/facturas/?estado=1&limit=100&offset=${(i + 1) * 100}`,
          count: pages.length * 100,
          results: pages[i],
        }),
      );
  }
}

/* Six pages: one more than the live budget, so a live read is cut off */
const sixPages = () => Array.from({ length: PENDING_LIVE_PAGES + 1 }, (_, p) => strangers(p));
/* Seven pages with the customer's invoice on the last one — the case
   the bug is about. Ids above the strangers' 1..700. */
const sevenPagesWithMine = (ids: number[] = [7001]) => {
  const pages = Array.from({ length: 7 }, (_, p) => strangers(p));
  pages[6] = [...ids.map((id) => mine(id)), ...pages[6].slice(ids.length)];
  return pages;
};

const SPEI_CONFIG = {
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "WifiPlus SA de CV",
};

async function seedLinkedBusiness(overrides: Parameters<typeof seedBusiness>[0] = {}) {
  const business = await seedBusiness({
    wisphubApiKey: "wh-key-1",
    serviceFeeCents: 1500,
    ...SPEI_CONFIG,
    ...overrides,
  });
  await drizzle(env.DB)
    .insert(paymentLinks)
    .values({ businessId: business.id, token: TOKEN, wisphubCustomerId: "6", customerUsuario: USUARIO });
  return business;
}

const getPage = async () => (await app()).request(`/direct-payments/links/${TOKEN}`, {}, testEnv);

const TRANSFER = {
  transfer: { trackingKey: "TRACK001XYZ", senderBank: "NUBANK", date: "2026-08-17" },
};
const payTransfer = async () =>
  (await app()).request(`/direct-payments/links/${TOKEN}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(TRANSFER),
  }, testEnv);

/* apiCEP confirms whatever amount the test says arrived */
function mockApiCep(amountCents: number) {
  apicep()
    .intercept({ method: "POST", path: "/validate-transfer" })
    .reply(
      ...json({
        validationId: "v-1",
        status: "valid",
        validation: {
          banxicoConfirmed: true,
          cepPreviouslyValidated: false,
          cepStatus: "LIQUIDADO",
          cepDetails: {
            trackingKey: "TRACK001XYZ",
            amount: amountCents / 100,
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

/* The reconnection a confirmed payment triggers: the adapter's own fresh
   look at the invoice (bug: transferred-invoice-paid), auto-activate, the
   cash method, the registration on `invoiceId`, the verify read */
function mockReconnection(invoiceId: number) {
  const captured: { totalCobrado?: number } = {};
  mockInvoiceDetail(invoiceId, "Pendiente de Pago");
  wh().intercept({ method: "PATCH", path: "/api/clientes/6/" }).reply(...json({ id_servicio: 6 }));
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
    .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  wh()
    .intercept({
      method: "POST",
      path: `/api/facturas/${invoiceId}/registrar-pago/`,
      body: (raw) => {
        captured.totalCobrado = JSON.parse(String(raw)).total_cobrado;
        return true;
      },
    })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
  mockCustomerLookup([wisphubCustomer({ estado: "Activo" })]);
  return captured;
}

/* The detail route as measured 2026-10-01 (bug: transferred-invoice-paid):
   `estado` is text — "Pendiente de Pago", "Pagada", "Se Transfirio" */
function mockInvoiceDetail(invoiceId: number, estado: unknown) {
  wh()
    .intercept({ method: "GET", path: `/api/facturas/${invoiceId}/` })
    .reply(...json({ id_factura: invoiceId, estado }));
}

const sweepRow = async (businessId: string) =>
  (
    await drizzle(env.DB)
      .select()
      .from(wisphubSweeps)
      .where(and(eq(wisphubSweeps.businessId, businessId), eq(wisphubSweeps.kind, "pending")))
  )[0];

/* Wakes the tenant and runs the sweep until the pass finishes */
async function sweptTenant(businessId: string, pages: unknown[][], now = new Date()) {
  await wakeSweep(drizzle(env.DB), businessId, "pending", `${WISPHUB_ORIGIN}/api`, now);
  mockPages(pages);
  const report = await sweepWispHubLists(testEnv, now);
  expect(report).toMatchObject({ lists: 1, pages: pages.length, finished: 1, failed: 0 });
  return report;
}

describe("bug: pending-invoice-cap — a cut-off read is never 'owes nothing'", () => {
  it("the payer's page answers 'cannot confirm', not the green 'al corriente'", async () => {
    const business = await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()]);
    /* The live walk reads its five pages and finds a sixth behind them;
       the customer's invoice is beyond the read */
    mockPages(sixPages(), { to: PENDING_LIVE_PAGES, last: false });

    const res = await getPage();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("WISPHUB_READ_INCOMPLETE");

    /* …and the cut-off read is what starts the background read */
    const row = await sweepRow(business.id);
    expect(row).toBeDefined();
    expect(row.restUntil).toBeNull();
    expect(row.servedPassId).toBeNull();
  });

  it("the submission asks nothing — no plan price, no row", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()]);
    mockPages(sixPages(), { to: PENDING_LIVE_PAGES, last: false });

    const res = await payTransfer();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("WISPHUB_READ_INCOMPLETE");
    expect(await drizzle(env.DB).select().from(payments)).toHaveLength(0);
  });

  it("a live read that fits stays live and complete (the small tenant, unchanged)", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()]);
    mockPages([[mine(42, 499)]]);

    const res = await getPage();
    const { data } = await res.json();
    expect(data.status).toBe("debt");
    expect(data.invoiceCents).toBe(49900);
    /* nothing to wake: no row is born from a complete read */
    expect(await drizzle(env.DB).select().from(wisphubSweeps)).toHaveLength(0);
  });
});

describe("bug: pending-invoice-cap — the sweep reads the tenant whole and every path serves it", () => {
  it("the page shows the real invoice from page seven; the money paths' list holds all 700, complete", async () => {
    const business = await seedLinkedBusiness();
    await sweptTenant(business.id, sevenPagesWithMine());
    const row = await sweepRow(business.id);
    expect(row.servedPages).toBe(7);
    expect(row.livePassId).toBeNull();
    /* a tenant past the live budget is read again at once, never rests */
    expect(row.restUntil).toBeNull();

    mockCustomerLookup([wisphubCustomer()]);
    const res = await getPage();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("debt");
    expect(data.invoiceCents).toBe(35000);
    expect(data.totalCents).toBe(35000 + 1500);
    expect(data.cobros).toEqual([{ externalId: 7001, amountCents: 35000, invoiceDate: "2026-09-01" }]);

    /* cobros-in-links D3: this asserted through `GET /payment-requests`,
       which served the finished pass to the Cobros section. The Por
       cobrar view reads live, one block at a time, and never this copy
       (SC-006). The copy still feeds every money path, so the assertion
       moves to the reader they all share: whole, complete, the pass's
       own time. */
    const served = await readPendingInvoices(
      drizzle(env.DB),
      business.id,
      wisphubFor({ apiKey: "wh-key-1", installation: null }, testEnv),
      new Date(),
    );
    expect(served.source).toBe("snapshot");
    expect(served.complete).toBe(true);
    expect(served.invoices).toHaveLength(700);
    expect(served.readAt).toBe(row.servedFinishedAt!.getTime());
  });

  it("the verdict settles against the real debt and registers on the real invoice, checked fresh", async () => {
    const business = await seedLinkedBusiness();
    await sweptTenant(business.id, sevenPagesWithMine());

    /* the submission's read and the verdict's read, both live for the
       customer and neither touching /facturas/ for the list */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockApiCep(35000 + 1500);
    /* the snapshot's id is re-read before money moves: still pending */
    mockInvoiceDetail(7001, "Pendiente de Pago");
    const registration = mockReconnection(7001);

    const res = await payTransfer();
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");
    expect(registration.totalCobrado).toBe(350);

    const [charge] = await drizzle(env.DB).select().from(payments);
    expect(charge.invoiceCents).toBe(35000);
    expect(charge.registeredCents).toBe(35000);
    expect(charge.wisphubInvoiceId).toBe(7001);
    expect(charge.paymentRegisteredAt).not.toBeNull();
    expect(charge.reconciliationClass).toBe("exact");
  });

  it("an invoice paid meanwhile yields to the customer's next one", async () => {
    const business = await seedLinkedBusiness();
    await sweptTenant(business.id, sevenPagesWithMine([7001, 7002]));

    mockCustomerLookup([wisphubCustomer()], 2);
    /* two months: the ask is the whole debt (direct-payment D21) */
    mockApiCep(70000 + 1500);
    /* 7001 was paid in the panel since the pass; 7002 still stands */
    mockInvoiceDetail(7001, "Pagada");
    mockInvoiceDetail(7002, "Pendiente de Pago");
    const registration = mockReconnection(7002);

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");
    expect(registration.totalCobrado).toBe(700);
    const [charge] = await drizzle(env.DB).select().from(payments);
    expect(charge.wisphubInvoiceId).toBe(7002);
  });

  it("a customer the finished pass does not list: the live label decides", async () => {
    const business = await seedLinkedBusiness();
    /* the customer is nowhere in the seven pages */
    await sweptTenant(business.id, Array.from({ length: 7 }, (_, p) => strangers(p)));

    /* WispHub says they owe: their invoice is newer than the pass */
    mockCustomerLookup([wisphubCustomer()]);
    const due = await getPage();
    expect(due.status).toBe(503);
    expect((await due.json()).error.code).toBe("WISPHUB_READ_INCOMPLETE");

    /* WispHub says they are paid up: nothing to wait for */
    mockCustomerLookup([wisphubCustomer({ estado_facturas: "Pagadas" })]);
    const paid = await getPage();
    expect((await paid.json()).data.status).toBe("no_debt");
  });

  it("what Devolada registered is gone from the list before the next pass", async () => {
    const business = await seedLinkedBusiness();
    await sweptTenant(business.id, sevenPagesWithMine());
    mockCustomerLookup([wisphubCustomer()], 2);
    mockApiCep(35000 + 1500);
    mockInvoiceDetail(7001, "Pendiente de Pago");
    mockReconnection(7001);
    expect((await (await payTransfer()).json()).data.status).toBe("confirmed");

    /* WispHub's own label flips with the registration; the snapshot has
       not been read again, and still the page says nothing is owed */
    mockCustomerLookup([wisphubCustomer({ estado_facturas: "Pagadas" })]);
    const { data } = await (await getPage()).json();
    expect(data.status).toBe("no_debt");

    /* cobros-in-links D3: asserted on the money paths' reader rather than
       the Por cobrar door, which no longer serves this copy */
    const listed = (
      await readPendingInvoices(
        drizzle(env.DB),
        business.id,
        wisphubFor({ apiKey: "wh-key-1", installation: null }, testEnv),
        new Date(),
      )
    ).invoices;
    expect(listed.some((f) => f.invoiceId === 7001)).toBe(false);
    expect(listed).toHaveLength(699);
  });
});

describe("bug: transferred-invoice-paid — the snapshot's invoice moved after the pass", () => {
  it("the verdict does not skip a moved invoice: the adapter follows its debt, and nothing is paid on the moved one", async () => {
    const business = await seedLinkedBusiness();
    await sweptTenant(business.id, sevenPagesWithMine());

    mockCustomerLookup([wisphubCustomer()], 2);
    mockApiCep(35000 + 1500);
    /* the billing moved 7001 into 7101 after the pass: the verdict's own
       look, then the adapter's, both read it moved */
    mockInvoiceDetail(7001, "Se Transfirio");
    mockInvoiceDetail(7001, "Se Transfirio");
    /* where the debt went: the record, then the customer's balance door —
       which knows 7101, an invoice the snapshot never saw */
    mockCustomerLookup([wisphubCustomer()]);
    wh()
      .intercept({ method: "GET", path: "/api/clientes/6/saldo/" })
      .reply(...json({ facturas: [{ id: 7101, fecha_emision: "2026-10-01", fecha_vencimiento: "2026-10-01", total: 849 }] }));

    const res = await payTransfer();
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe("confirmed");
    /* the verdict stands on the debt it measured; the money waits a
       minute for the invoice its debt moved to — 7001 has no
       registrar-pago interceptor, and an attempt on it would have failed */
    const [charge] = await drizzle(env.DB).select().from(payments);
    expect(charge).toMatchObject({
      registeredCents: 35000,
      wisphubInvoiceId: 7101,
      actionOutcome: "queued",
      paymentRegisteredAt: null,
      actionError: null,
    });
  });
});

describe("bug: pending-invoice-cap — the sweep itself", () => {
  it("a failure mid-tick keeps the cursor; the next tick resumes and finishes", async () => {
    const business = await seedLinkedBusiness();
    const now = new Date();
    await wakeSweep(drizzle(env.DB), business.id, "pending", `${WISPHUB_ORIGIN}/api`, now);
    const pages = sevenPagesWithMine();
    mockPages(pages, { to: 3, last: false });
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("offset=300") })
      .reply(500, "boom");

    const first = await sweepWispHubLists(testEnv, now);
    expect(first).toMatchObject({ lists: 1, pages: 3, finished: 0, failed: 1 });
    let row = await sweepRow(business.id);
    expect(row.livePages).toBe(3);
    expect(row.liveCursor).toContain("offset=300");
    expect(row.lastError).toBe("WISPHUB_UNAVAILABLE");
    expect(row.servedPassId).toBeNull();
    expect(row.claimedUntil).toBeNull();

    const later = new Date(now.getTime() + 60_000);
    mockPages(pages, { from: 3 });
    const second = await sweepWispHubLists(testEnv, later);
    expect(second).toMatchObject({ lists: 1, pages: 4, finished: 1, failed: 0 });
    row = await sweepRow(business.id);
    expect(row.servedPages).toBe(7);
    expect(row.lastError).toBeNull();
    const stored = await drizzle(env.DB).select().from(wisphubPages);
    expect(stored).toHaveLength(7);
  });

  it("a tick reads at most SWEEP_PAGES and continues next minute", async () => {
    const business = await seedLinkedBusiness();
    const now = new Date();
    await wakeSweep(drizzle(env.DB), business.id, "pending", `${WISPHUB_ORIGIN}/api`, now);
    const pages = Array.from({ length: SWEEP_PAGES + 2 }, (_, p) => strangers(p));
    mockPages(pages, { to: SWEEP_PAGES, last: false });
    expect(await sweepWispHubLists(testEnv, now)).toMatchObject({ pages: SWEEP_PAGES, finished: 0 });

    mockPages(pages, { from: SWEEP_PAGES });
    expect(await sweepWispHubLists(testEnv, new Date(now.getTime() + 60_000))).toMatchObject({
      pages: 2,
      finished: 1,
    });
    expect((await sweepRow(business.id)).servedPages).toBe(SWEEP_PAGES + 2);
  });

  it("a tenant that fits the live budget rests, and its readers keep reading live", async () => {
    const business = await seedLinkedBusiness();
    const now = new Date();
    await sweptTenant(business.id, [[mine(42, 499)]], now);
    const row = await sweepRow(business.id);
    expect(row.servedPages).toBe(1);
    expect(row.restUntil!.getTime()).toBe(now.getTime() + REST_MS);

    /* resting: the next minute reads nothing */
    expect(await sweepWispHubLists(testEnv, new Date(now.getTime() + 60_000))).toMatchObject({ lists: 0 });

    /* and the page still asks WispHub itself — the mock below is consumed */
    mockCustomerLookup([wisphubCustomer()]);
    mockPages([[mine(42, 499)]]);
    const { data } = await (await getPage()).json();
    expect(data.status).toBe("debt");
    expect(data.invoiceCents).toBe(49900);
  });

  it("a disconnected tenant rests instead of failing every minute", async () => {
    const business = await seedBusiness({ wisphubApiKey: null });
    const now = new Date();
    await wakeSweep(drizzle(env.DB), business.id, "pending", `${WISPHUB_ORIGIN}/api`, now);
    expect(await sweepWispHubLists(testEnv, now)).toMatchObject({ lists: 1, pages: 0, failed: 0 });
    const row = await sweepRow(business.id);
    expect(row.lastError).toBe("WISPHUB_NOT_CONFIGURED");
    expect(row.restUntil!.getTime()).toBe(now.getTime() + REST_MS);
  });
});

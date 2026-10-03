import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { cepRecords, paymentLinks, payments, validations } from "../src/db/schema";
import { sweepDirectPayments } from "../src/direct-payments/validation";
import type { Bindings } from "../src/env";
import { app, fakeProofs, seedBusiness } from "./helpers";
import { wallClockMs } from "../src/time/business-day";
import {
  bundleOf,
  noneAnswer,
  SENDER_4417,
  SENDER_8301,
  severalAnswer,
  validAnswer,
  type SyntheticTransfer,
} from "./consta/bundle-fixtures";

/* payment-without-receipt (tasks T007) — what the reference and the
   confirmation suites share: a business with the feature on and a
   registered CLABE; WispHub's customers with their phones, answered at the
   pinned origin (by usuario, and by `telefono__contains`); apiCEP's four
   answers to a search by reference — valid, several (a bundle built with
   `bundle-fixtures.ts`), not found and 429 — keyed by reference and day;
   a clock that steps a payment through its slots; and a count of the
   provider calls it spent. */

export const APICEP = "https://api.apicep.cloud";
export const STORAGE = "https://storage.apicep.cloud";
export const WISPHUB = "https://api.wisphub.net";

export const testEnv = { ...env, PROOFS: fakeProofs() } as typeof env & Bindings;
export const db = () => drizzle(env.DB);

/* The business's CLABE; its last seven digits (0089784… → 9784417 is
   Azteca's default reference) are never anyone's reference (D3) */
export const BUSINESS_CLABE = "012180000089784417";
export const ACCOUNT = { kind: "clabe", value: BUSINESS_CLABE, bank: "BBVA MEXICO" } as const;

let seq = 0;
/* A business with the feature on (D20), a WispHub key and a CLABE whose
   bank the provider knows. Unique per call: the owner is unique by email. */
export async function seedReferenceBusiness(over: Parameters<typeof seedBusiness>[0] = {}) {
  seq += 1;
  return seedBusiness({
    email: `negocio-${seq}-${crypto.randomUUID().slice(0, 6)}@devolada.test`,
    wisphubApiKey: "wh-key-1",
    serviceFeeCents: 150,
    speiClabe: BUSINESS_CLABE,
    speiBank: "BBVA MEXICO",
    speiBeneficiaryName: "WifiPlus SA de CV",
    payByReference: true,
    ...over,
  });
}

/* A link row, as the panel's act or the /v1 create writes one */
export async function seedPanelLink(business: { id: string }, usuario: string, wisphubId = 6) {
  const [link] = await db()
    .insert(paymentLinks)
    .values({
      businessId: business.id,
      token: `tok${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      wisphubCustomerId: String(wisphubId),
      customerUsuario: usuario,
    })
    .returning();
  return link;
}

export async function seedApiLink(
  business: { id: string },
  customerRef: string,
  over: Partial<typeof paymentLinks.$inferInsert> = {},
) {
  const [link] = await db()
    .insert(paymentLinks)
    .values({
      businessId: business.id,
      token: `tok${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      source: "api",
      mode: "reusable",
      customerRef,
      askCents: 35000,
      ...over,
    })
    .returning();
  return link;
}

/* ---- WispHub ---- */

export type FakeCustomer = {
  usuario: string;
  telefono?: string | null;
  nombre?: string;
  apellido?: string;
  id?: number;
  estado?: string;
};

const json = (body: unknown) => [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

const listItem = (c: FakeCustomer) => ({
  id_servicio: c.id ?? 6,
  usuario: c.usuario,
  nombre: c.nombre ?? "Cliente",
  apellido: c.apellido ?? "",
  telefono: c.telefono ?? null,
  estado: c.estado ?? "Activo",
  estado_facturas: "Pendiente de Pago",
  precio_plan: "350.00",
  saldo: "0.00",
  zona: { id: 1, nombre: "Zona 1" },
});

/* `GET /clientes/?usuario=` — one customer, by its identity */
export function mockCustomer(c: FakeCustomer, times = 1) {
  fetchMock
    .get(WISPHUB)
    .intercept({
      method: "GET",
      /* the interceptor sees the query sorted, so the identity may end it */
      path: (p) => p.startsWith("/api/clientes/?") && new RegExp(`[?&]usuario=${encodeURIComponent(c.usuario)}(&|$)`).test(p),
    })
    .reply(...json({ count: 1, next: null, results: [listItem(c)] }))
    .times(times);
}

/* `GET /clientes/?telefono__contains=<last seven>` — every customer whose
   phone holds those digits, as WispHub answers (whatever the spelling), in
   pages of 50. `seen` counts the calls. */
export function mockPhoneSearch(tail: string, customers: FakeCustomer[], opts: { pageSize?: number; seen?: Set<string> } = {}) {
  const size = opts.pageSize ?? 50;
  const pages = Math.max(1, Math.ceil(customers.length / size));
  for (let i = 0; i < pages; i++) {
    const offset = i * size;
    fetchMock
      .get(WISPHUB)
      .intercept({
        method: "GET",
        path: (p) => {
          const hit =
            p.startsWith("/api/clientes/?") && p.includes(`telefono__contains=${tail}`) && new RegExp(`[?&]offset=${offset}(&|$)`).test(p);
          /* the matcher may be asked more than once per request, with the
             query in either order: the page is what is counted */
          if (hit) opts.seen?.add(`offset=${offset}`);
          return hit;
        },
      })
      .reply(
        ...json({
          count: customers.length,
          next: i < pages - 1 ? `https://api.wisphub.net/api/clientes/?telefono__contains=${tail}&limit=50&offset=${offset + size}` : null,
          results: customers.slice(offset, offset + size).map(listItem),
        }),
      );
  }
}

export function mockPhoneSearchFails(tail: string, status = 503) {
  fetchMock
    .get(WISPHUB)
    .intercept({ method: "GET", path: (p) => p.includes(`telefono__contains=${tail}`) })
    .reply(status, "{}");
}

/* ---- apiCEP ---- */

export type Search = {
  referenceNumber?: string;
  trackingKey?: string;
  date?: string;
  amount?: number;
  bank?: string;
};

/* One answer to the next `/validate-transfer`, optionally only for the
   search it names (reference and day); `seen` receives what was asked */
export function mockApiCep(
  answer: unknown,
  opts: { status?: number; headers?: Record<string, string>; when?: (s: Search) => boolean; seen?: Search[] } = {},
) {
  fetchMock
    .get(APICEP)
    .intercept({
      method: "POST",
      path: "/validate-transfer",
      body: (raw) => {
        const body = JSON.parse(String(raw)) as { sender?: Record<string, unknown> } & Record<string, unknown>;
        const sender = (body.sender ?? {}) as Record<string, unknown>;
        const search: Search = {
          referenceNumber: (sender.referenceNumber as string | undefined) ?? undefined,
          trackingKey: (sender.trackingKey as string | undefined) ?? undefined,
          date: (body.date as string | undefined) ?? (sender.date as string | undefined),
          amount: sender.amount as number | undefined,
          bank: sender.bank as string | undefined,
        };
        const hit = opts.when ? opts.when(search) : true;
        if (hit) opts.seen?.push(search);
        return hit;
      },
    })
    .reply(opts.status ?? 200, JSON.stringify(answer), {
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    });
}

export const mockFound = (t: SyntheticTransfer, opts: Parameters<typeof mockApiCep>[1] & { previouslyValidated?: boolean | null } = {}) =>
  mockApiCep(validAnswer(t, { previouslyValidated: opts.previouslyValidated }), opts);
export const mockNotFound = (opts: Parameters<typeof mockApiCep>[1] = {}) => mockApiCep(noneAnswer(), opts);
export const mockRateLimited = (remaining = "0", opts: Parameters<typeof mockApiCep>[1] = {}) =>
  mockApiCep({ error: "Rate limit exceeded" }, { status: 429, headers: { "X-RateLimit-Remaining": remaining }, ...opts });

let bundles = 0;
/* A several answer and the ZIP its link downloads */
export function mockSeveral(transfers: SyntheticTransfer[], opts: Parameters<typeof mockApiCep>[1] = {}) {
  bundles += 1;
  const path = `/bundle-${bundles}-${crypto.randomUUID().slice(0, 6)}.pdf`;
  mockApiCep(severalAnswer(`${STORAGE}${path}`), opts);
  fetchMock
    .get(STORAGE)
    .intercept({ method: "GET", path })
    .reply(200, bundleOf(transfers), { headers: { "Content-Type": "application/pdf" } });
}

/* ---- the payer's doors ---- */

export async function linkRead(token: string, bindings: typeof env & Bindings = testEnv) {
  const res = await (await app()).request(`/direct-payments/links/${token}`, {}, bindings);
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: Record<string, any>; error?: { code: string } } };
}

/* No execution context: the inline attempt is awaited, so the answer
   already carries the first round (two-eyes-receipt D4's test path) */
export async function pay(token: string, body: unknown, bindings: typeof env & Bindings = testEnv) {
  const res = await (await app()).request(
    `/direct-payments/links/${token}/pay`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    bindings,
  );
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: Record<string, any>; error?: { code: string } } };
}

export async function status(id: string, bindings: typeof env & Bindings = testEnv) {
  const res = await (await app()).request(`/direct-payments/${id}/status`, {}, bindings);
  return (await res.json()) as { success: boolean; data: Record<string, any> };
}

/* ---- the clock and the bill ---- */

export const rowById = async (id: string) => (await db().select().from(payments).where(eq(payments.id, id)))[0];

/* Runs the sweep as if `minutes` had passed since the row was born — the
   slots count from `created_at` (schedule.ts) */
export async function stepTo(paymentId: string, minutes: number, bindings: typeof env & Bindings = testEnv) {
  const row = await rowById(paymentId);
  return sweepDirectPayments(bindings, new Date(row.createdAt.getTime() + minutes * 60_000 + 1_000));
}

/* The provider calls spent: one `validations` row per paid call */
export const providerCalls = async () => (await db().select().from(validations)).length;

/* What each paid call searched, in the order they were made — the
   engine's own log, so a request is counted once */
export async function searches(): Promise<{ date: string | null; referenceNumber: string | null; amountCents: number | null }[]> {
  return db()
    .select({ date: validations.transferDate, referenceNumber: validations.referenceNumber, amountCents: validations.amountCents })
    .from(validations)
    .orderBy(sql`rowid`);
}

/* Today in Mexico City, the business's default zone, as an ISO day */
export function businessToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(now);
}

export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* `GET /facturas/?estado=1…` — the open invoices a panel link's debt is
   read from: one invoice per usuario given, in pesos */
export function mockPendingInvoices(invoices: { usuario: string; total: number; id?: number }[], times = 1) {
  fetchMock
    .get(WISPHUB)
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
    .reply(
      ...json({
        next: null,
        count: invoices.length,
        results: invoices.map((f, i) => ({ id_factura: f.id ?? 42 + i, cliente: { usuario: f.usuario }, total: f.total })),
      }),
    )
    .times(times);
}

/* A panel confirmation's WispHub half (direct-payment D6, D14): the fresh
   debt re-check, then auto-activate → payment method → register → verify.
   `again`: the payment method is cached per tenant after the first. */
export function mockPanelSettle(customer: FakeCustomer, total = 3.5, opts: { again?: boolean; invoiceId?: number } = {}) {
  const invoiceId = opts.invoiceId ?? 42;
  mockCustomer({ ...customer, estado: "Suspendido" });
  mockPendingInvoices([{ usuario: customer.usuario, total, id: invoiceId }]);
  /* bug: transferred-invoice-paid — the invoice is asked about before any
     money moves (the detail route's measured shape) */
  fetchMock
    .get(WISPHUB)
    .intercept({ method: "GET", path: `/api/facturas/${invoiceId}/` })
    .reply(...json({ id_factura: invoiceId, estado: "Pendiente de Pago" }));
  fetchMock
    .get(WISPHUB)
    .intercept({ method: "PATCH", path: `/api/clientes/${customer.id ?? 6}/` })
    .reply(...json({ id_servicio: customer.id ?? 6, auto_activar_servicio: true }));
  if (!opts.again) {
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  }
  fetchMock
    .get(WISPHUB)
    .intercept({ method: "POST", path: `/api/facturas/${invoiceId}/registrar-pago/` })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
  mockCustomer({ ...customer, estado: "Activo" });
}

/* ---- confirmation-hierarchy (tasks T004) ---- */

let paidSeq = 0;
/* A confirmed payment on `link` that adopted `clave`, whose `cep_records`
   row sends from `account` — what makes the account learned for that
   customer (012 D12). Seeded on two people's links, it is an account that
   has paid for several people (confirmation-hierarchy D4). The money and
   the day are a past month's; nothing here is searched. */
export async function seedPaidBy(
  database: ReturnType<typeof db>,
  opts: {
    businessId: string;
    link: { id: string };
    account: string;
    accountType?: string;
    clave?: string;
    day?: string;
  },
) {
  paidSeq += 1;
  const clave = opts.clave ?? `PAIDBY${String(paidSeq).padStart(6, "0")}${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const day = opts.day ?? "2026-08-15";
  await database.insert(cepRecords).values({
    businessId: opts.businessId,
    clave,
    bundleId: null,
    operationDate: day,
    creditDate: day,
    creditTime: "09:30:00",
    creditedAt: new Date(wallClockMs("America/Mexico_City", day, "09:30:00")),
    senderBank: "AZTECA",
    senderAccountType: opts.accountType ?? "40",
    senderAccount: opts.account,
    receiverSpeiCode: "40012",
    receiverAccountType: "40",
    receiverAccount: BUSINESS_CLABE,
    amountCents: 35150,
    certificateNumber: "00001000000999999999",
    seal: "c2VhbA==",
  });
  const [payment] = await database
    .insert(payments)
    .values({
      paymentLinkId: opts.link.id,
      businessId: opts.businessId,
      amountCents: 35150,
      invoiceCents: 35000,
      serviceFeeCents: 150,
      proofMode: "transfer",
      status: "confirmed",
      trackingKey: clave,
      senderBank: "AZTECA",
      transferDate: day,
      receivedCents: 35150,
      confirmedAt: new Date(`${day}T16:00:00Z`),
      customerName: "Cliente",
    })
    .returning();
  return { clave, payment };
}

/* The sandbox's three tie-break scenarios (quickstart "Sandbox additions"),
   as apiCEP answers them at the pinned origin: `…44` — two transfers from
   8301 and 4417, claves ending …977I and …0412; `…55` — the same two
   accounts, claves sharing their last four (…5510); `…66` — one transfer
   from 8301, clave ending …3O10. `day` is the day searched. */
export function tieBreakTransfers(scenario: "44" | "55" | "66", day: string, amount = "351.50"): SyntheticTransfer[] {
  const base = (creditTime: string, senderAccount: string, end: string): SyntheticTransfer => ({
    clave: `MOCKREF${scenario}${day.replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}${end}`,
    operationDay: day,
    creditDay: day,
    creditTime,
    senderAccount,
    beneficiaryAccount: BUSINESS_CLABE,
    amount,
  });
  if (scenario === "44") return [base("07:11:20", SENDER_8301, "977I"), base("11:40:47", SENDER_4417, "0412")];
  if (scenario === "55") return [base("07:11:20", SENDER_8301, "A5510"), base("11:40:47", SENDER_4417, "B5510")];
  return [base("09:02:31", SENDER_8301, "3O10")];
}

/* apiCEP's answer for a scenario: a bundle for several, a single `valid`
   (with its cadena, so the record reads) for `…66` */
export function mockTieBreakSearch(scenario: "44" | "55" | "66", day: string, opts: Parameters<typeof mockApiCep>[1] = {}) {
  const transfers = tieBreakTransfers(scenario, day);
  if (scenario === "66") mockFound(transfers[0], opts);
  else mockSeveral(transfers, opts);
  return transfers;
}

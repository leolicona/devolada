import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, paymentLinks, payments, stores, user as userTable } from "../src/db/schema";
import { makeAuth } from "../src/auth/better";
import type { Bindings } from "../src/env";
import { PASSWORD, seedSession, sessionCookieHeader } from "./helpers";
import { WISPHUB, type FakeCustomer } from "./payer-helpers";

/* cash-at-stores T013 — what the store suites share: a store and its
   shopkeeper's session, the channel switched on for a business, and
   WispHub answering the counter's two questions (the search and one
   customer's debt) at its pinned origin. A shopkeeper is a real Better
   Auth user whose `username` is written in the DB, exactly as the
   acceptance route writes it (D3, D5). */

const db = () => drizzle(env.DB);
const auth = () => makeAuth(env as unknown as Bindings);

let seq = 0;
let phoneSeq = 0;
const unique = () => `${++seq}-${crypto.randomUUID().slice(0, 6)}`;

/* A user created through the server's door, verified, with no business */
async function seedPlainUser(email: string, name = "Persona") {
  const { response } = await auth().api.signUpEmail({ body: { name, email, password: PASSWORD }, returnHeaders: true });
  await db().update(userTable).set({ emailVerified: true }).where(eq(userTable.id, response.user.id));
  return response.user.id;
}

/* A store row as the operator's create writes it (D6). `invited` by
   default; `storeSession` gives it a shopkeeper. */
export async function seedStore(
  opts: { status?: "invited" | "active" | "suspended"; phone?: string; name?: string; createdByUserId?: string } = {},
) {
  const createdByUserId = opts.createdByUserId ?? (await seedPlainUser(`operador-${unique()}@devolada.test`, "Operador"));
  const [store] = await db()
    .insert(stores)
    .values({
      name: opts.name ?? "Abarrotes Lupita",
      address: "Av. Juárez 12, Centro",
      shopkeeperName: "Lupita Hernández",
      phone: opts.phone ?? `55${String(10_000_000 + ++phoneSeq * 7919).slice(-8)}`,
      status: opts.status ?? "invited",
      createdByUserId,
    })
    .returning();
  return store;
}

/* The shopkeeper behind a store: a verified user with `username` = the
   store's phone (D3), linked by `stores.user_id`, and a session cookie.
   An `invited` store keeps its status unless `activate` (the acceptance's
   own write) — so a test can meet the half-accepted store. */
export async function storeSession(
  store: typeof stores.$inferSelect,
  opts: { email?: string; activate?: boolean } = {},
) {
  const email = opts.email ?? `tienda-${unique()}@devolada.test`;
  const userId = await seedPlainUser(email, store.shopkeeperName);
  await db().update(userTable).set({ username: store.phone, displayUsername: store.phone }).where(eq(userTable.id, userId));
  await db()
    .update(stores)
    .set({ userId, ...(opts.activate === false ? {} : store.status === "invited" ? { status: "active" as const } : {}) })
    .where(eq(stores.id, store.id));
  await seedSession(userId, email);
  return { userId, email, cookie: await sessionCookieHeader(email) };
}

/* An active store with its shopkeeper signed in, in one call */
export async function seedActiveStore(opts: Parameters<typeof seedStore>[0] = {}) {
  const store = await seedStore({ ...opts, status: "invited" });
  const session = await storeSession(store);
  const [fresh] = await db().select().from(stores).where(eq(stores.id, store.id));
  return { store: fresh, ...session, headers: { Cookie: session.cookie } };
}

/* D7: the operator's switch, as its handler writes it */
export async function seedStoreChannel(business: { id: string }, at = new Date()) {
  await db().update(businesses).set({ storeChannelOn: true, storeChannelSince: at }).where(eq(businesses.id, business.id));
}

/* A cash payment as the store's record writes it (D11, D13), for suites
   that need one without walking the counter (US2, US4, US5) */
export async function seedCashPayment(
  business: { id: string },
  store: { id: string; userId: string | null },
  over: Partial<typeof payments.$inferInsert> = {},
) {
  const usuario = over.customerUsuario ?? "greyes@wifiplus";
  let [link] = await db().select().from(paymentLinks).where(eq(paymentLinks.customerUsuario, usuario));
  if (!link || link.businessId !== business.id) {
    [link] = await db()
      .insert(paymentLinks)
      .values({
        businessId: business.id,
        token: `tok${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        wisphubCustomerId: "6",
        customerUsuario: usuario,
      })
      .returning();
  }
  const [payment] = await db()
    .insert(payments)
    .values({
      paymentLinkId: link.id,
      businessId: business.id,
      channel: "store",
      proofMode: "none",
      storeId: store.id,
      storeUserId: store.userId,
      storeFeeCents: 1500,
      collectionKey: crypto.randomUUID(),
      amountCents: 49900,
      receivedCents: 49900,
      invoiceCents: 49900,
      carriedBalanceCents: 0,
      serviceFeeCents: 0,
      registeredCents: 49900,
      status: "confirmed",
      reconciliationClass: "exact",
      confirmedAt: new Date(),
      folio: `DV-S${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      wisphubCustomerId: "6",
      customerUsuario: usuario,
      customerName: "Guadalupe Reyes",
      customerZone: "Centro",
      actionOutcome: "done",
      ...over,
    })
    .returning();
  return payment;
}

/* ---- WispHub, at its pinned origin ---- */

const json = (body: unknown) => [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

export type SearchCustomer = FakeCustomer & { zona?: string | null };

const listItem = (c: SearchCustomer) => ({
  id_servicio: c.id ?? 6,
  usuario: c.usuario,
  nombre: c.nombre ?? "Cliente",
  apellido: c.apellido ?? "",
  telefono: c.telefono ?? null,
  estado: c.estado ?? "Suspendido",
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: c.zona === null ? null : { id: 1, nombre: c.zona ?? "Centro" },
});

const SEARCH_FIELDS = ["nombre", "apellido", "usuario", "telefono"] as const;

/* D8: the counter's search is the Links search's provider question — the
   four `__contains` filters at once (links-on-demand-search D4). `rows`
   answer the `nombre` filter unless `byField` says otherwise; `more`
   names the filters whose own `next` says they have more. */
export function mockCustomerSearch(
  rows: SearchCustomer[],
  opts: { byField?: Partial<Record<(typeof SEARCH_FIELDS)[number], SearchCustomer[]>>; more?: (typeof SEARCH_FIELDS)[number][] } = {},
) {
  for (const field of SEARCH_FIELDS) {
    const results = opts.byField?.[field] ?? (field === "nombre" ? rows : []);
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/?") && p.includes(`${field}__contains=`) })
      .reply(
        ...json({
          count: results.length,
          next: opts.more?.includes(field) ? `https://api.wisphub.net/api/clientes/?${field}__contains=x&limit=10&offset=10` : null,
          results: results.map(listItem),
        }),
      );
  }
}

export function mockCustomerSearchFails(status = 503) {
  for (const field of SEARCH_FIELDS) {
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/?") && p.includes(`${field}__contains=`) })
      .reply(status, "{}");
  }
}

/* cobros-in-links D9/D10: what one customer owes, as the adapter reads it
   — the record by exact `usuario=` (its `saldo` is the carried balance),
   then that customer's open invoices from `/clientes/{id}/saldo/`. */
export function mockCustomerDebt(
  customer: SearchCustomer & { saldo?: string },
  invoices: { id: number; total: string; fecha_emision?: string }[],
  times = 1,
) {
  fetchMock
    .get(WISPHUB)
    .intercept({
      method: "GET",
      path: (p) =>
        p.startsWith("/api/clientes/?") && new RegExp(`[?&]usuario=${encodeURIComponent(customer.usuario)}(&|$)`).test(p),
    })
    .reply(...json({ count: 1, next: null, results: [{ ...listItem(customer), saldo: customer.saldo ?? "0.00" }] }))
    .times(times);
  fetchMock
    .get(WISPHUB)
    .intercept({ method: "GET", path: `/api/clientes/${customer.id ?? 6}/saldo/` })
    .reply(
      ...json({
        facturas: invoices.map((f) => ({
          id: f.id,
          fecha_emision: f.fecha_emision ?? "2026-09-15 00:00:00",
          fecha_vencimiento: "2026-09-20 00:00:00",
          total: f.total,
        })),
      }),
    )
    .times(times);
}

/* The record's first action attempt (reconnection D8/D9): the opt-in,
   the cash method (cached once read), registrar-pago with its `accion`
   captured, and the verify read only when the router was asked */
export function mockAction(opts: { invoiceId?: number; verify?: "Activo" | "Suspendido" | false; formas?: boolean; fail?: number } = {}) {
  const captured: { accion?: number; totalCobrado?: number } = {};
  const invoiceId = opts.invoiceId ?? 42;
  fetchMock
    .get(WISPHUB)
    .intercept({ method: "PATCH", path: (p) => /^\/api\/clientes\/\d+\/$/.test(p) })
    .reply(...json({ auto_activar_servicio: true }));
  if (opts.formas ?? true) {
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  }
  const pay = fetchMock.get(WISPHUB).intercept({
    method: "POST",
    path: `/api/facturas/${invoiceId}/registrar-pago/`,
    body: (raw) => {
      const b = JSON.parse(String(raw));
      captured.accion = b.accion;
      captured.totalCobrado = b.total_cobrado;
      return true;
    },
  });
  if (opts.fail) {
    pay.reply(opts.fail, "{}");
    return captured;
  }
  pay.reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
  if (opts.verify !== false) {
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/?") && p.includes("usuario=") })
      .reply(...json({ count: 1, next: null, results: [{ ...listItem({ usuario: "greyes@wifiplus" }), estado: opts.verify ?? "Activo" }] }));
  }
  return captured;
}

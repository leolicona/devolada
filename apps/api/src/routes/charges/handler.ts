import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { charges, isps, stores } from "../../db/schema";
import { and, count, desc, gte, lt, lte, sum } from "drizzle-orm";
import { recordChargeEntries, storeBalanceCents } from "../../ledger";
import {
  WispHub,
  WispHubError,
  type PendingInvoices,
  type WispHubCustomer,
} from "../../wisphub/client";
import { attemptReconnection } from "../../wisphub/reconnection";
import { startOfBusinessDayMs } from "../../time/business-day";
import { firstAttemptSchedule } from "../../reconnection/queue";
import { receiptText, toWhatsAppPhone, whatsAppLink } from "../../receipt";
import type {
  ChargeResponse,
  CustomerQuoteResponse,
  CustomerResult,
  CustomerSearchResponse,
  ReceiptResponse,
} from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* Shared guard: store actor + its ISP with a working key, or an error response. */
async function storeContext(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "store") {
    return { error: c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403) };
  }
  const db = drizzle(c.env.DB);
  const [isp] = await db.select().from(isps).where(eq(isps.id, actor.ispId));
  if (!isp?.wisphubApiKey) {
    return { error: c.json({ success: false, error: { code: "WISPHUB_NOT_CONFIGURED" } }, 503) };
  }
  return { actor, isp, db, wisphub: new WispHub(isp.wisphubApiKey) };
}

function wisphubFailure(c: Ctx, e: unknown) {
  if (e instanceof WispHubError) {
    console.error("wisphub failure:", e.code, e.message);
    /* D3: a rejected key surfaces as a setup problem, like a missing key */
    const code = e.code === "WISPHUB_AUTH_FAILED" ? "WISPHUB_NOT_CONFIGURED" : e.code;
    return c.json({ success: false, error: { code } }, 503);
  }
  throw e;
}

/* Debt truth (debt-truth spec D1, D6): the pending-invoice list decides
   `billingStatus`, in both directions — WispHub's `estado_facturas`
   label lags real payments and real new invoices alike (measured live).
   D4: a truncated list only proves debts, never their absence, so a
   customer missing from an incomplete list keeps the label. */
function invoiceBillingStatus(
  customer: WispHubCustomer,
  pending: PendingInvoices,
): WispHubCustomer["billingStatus"] {
  if (pending.invoices.some((f) => f.usuario === customer.usuario)) return "due";
  return pending.complete ? "paid" : customer.billingStatus;
}

/* The wire contract is the allow-list (customer-search D2). The adapter
   also carries the customer's phone, which the charge stores for its
   receipt (receipt D4) but the frontend never needs — so it stops here. */
const toCustomerResult = (customer: WispHubCustomer, pending: PendingInvoices): CustomerResult => ({
  wisphubId: customer.wisphubId,
  usuario: customer.usuario,
  name: customer.name,
  zone: customer.zone,
  serviceStatus: customer.serviceStatus,
  billingStatus: invoiceBillingStatus(customer, pending),
  monthlyFeeCents: customer.monthlyFeeCents,
});

export async function searchCustomers(c: Ctx, q: string) {
  const ctx = await storeContext(c);
  if ("error" in ctx) return ctx.error;

  try {
    const customers = await ctx.wisphub.searchCustomers(q);
    /* One pending-list fetch marks every result (debt-truth spec D2) */
    const pending = customers.length
      ? await ctx.wisphub.pendingInvoices(new Date())
      : { invoices: [], complete: true };
    const data: CustomerSearchResponse = {
      customers: customers.map((customer) => toCustomerResult(customer, pending)),
    };
    return c.json({ success: true, data });
  } catch (e) {
    return wisphubFailure(c, e);
  }
}

/* The quote for the confirm screen (charge-confirm spec D2):
   customer + server-computed breakdown + balance-cap state. */
export async function getCustomerQuote(c: Ctx, usuario: string) {
  const ctx = await storeContext(c);
  if ("error" in ctx) return ctx.error;

  try {
    const customer = await ctx.wisphub.getCustomer(usuario);
    if (!customer) {
      return c.json({ success: false, error: { code: "CUSTOMER_NOT_FOUND" } }, 404);
    }
    const pending = await ctx.wisphub.pendingInvoices(new Date());

    const [store] = await ctx.db.select().from(stores).where(eq(stores.id, ctx.actor.id));
    const serviceFeeCents = ctx.isp.serviceFeeCents;
    const balanceCents = await storeBalanceCents(ctx.db, ctx.actor.id);
    const capCents = store.balanceCapCents;

    const data: CustomerQuoteResponse = {
      customer: toCustomerResult(customer, pending),
      quote: {
        monthlyFeeCents: customer.monthlyFeeCents,
        serviceFeeCents,
        totalCents: customer.monthlyFeeCents + serviceFeeCents,
      },
      cap: { balanceCents, capCents, blocked: balanceCents >= capCents },
    };
    return c.json({ success: true, data });
  } catch (e) {
    return wisphubFailure(c, e);
  }
}

/* Shared with the direct SPEI channel: one folio format, one guard */
export function makeFolio(): string {
  /* DV- + 6 uppercase base36 chars; the unique index is the real guard */
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of bytes) out += chars[b % 36];
  return `DV-${out}`;
}

const toChargeResponse = (row: typeof charges.$inferSelect): ChargeResponse => ({
  id: row.id,
  folio: row.folio,
  reconnectionStatus: row.reconnectionStatus,
  totalCents: row.totalCents,
  customerName: row.customerName,
});

export async function recordCharge(c: Ctx, usuario: string) {
  const ctx = await storeContext(c);
  if ("error" in ctx) return ctx.error;

  const now = new Date();
  let customer;
  let pending;
  try {
    customer = await ctx.wisphub.getCustomer(usuario);
    if (!customer) {
      return c.json({ success: false, error: { code: "CUSTOMER_NOT_FOUND" } }, 404);
    }
    pending = await ctx.wisphub.pendingInvoices(now);
  } catch (e) {
    return wisphubFailure(c, e);
  }

  /* D4 (charge-record) still: server-side guards; the UI is not a
     security layer. What changed is the question (debt-truth spec D5):
     the guard asks the invoices, not the label, and resolves the one
     this charge will pay — oldest first. */
  const mine = pending.invoices.filter((f) => f.usuario === usuario);
  const pendingInvoiceId = mine.length ? Math.min(...mine.map((f) => f.invoiceId)) : null;
  if (pendingInvoiceId === null) {
    if (pending.complete) {
      return c.json({ success: false, error: { code: "NOTHING_DUE" } }, 409);
    }
    /* Debt-truth D4: a truncated list cannot prove "owes nothing", so
       the label decides — the old behavior, logged because it carries
       the residual double-charge risk. */
    console.warn(`pending-invoice list truncated; label guard used for ${usuario}`);
    if (customer.billingStatus === "paid") {
      return c.json({ success: false, error: { code: "NOTHING_DUE" } }, 409);
    }
  }
  const [store] = await ctx.db.select().from(stores).where(eq(stores.id, ctx.actor.id));
  const balanceCents = await storeBalanceCents(ctx.db, ctx.actor.id);
  if (balanceCents >= store.balanceCapCents) {
    return c.json({ success: false, error: { code: "BALANCE_CAP_EXCEEDED" } }, 409);
  }

  const totalCents = customer.monthlyFeeCents + ctx.isp.serviceFeeCents;
  const commissionCents = store.commissionCents ?? ctx.isp.storeCommissionCents;

  /* D2: record first — the money is safe before any WispHub call */
  const [charge] = await ctx.db
    .insert(charges)
    .values({
      ispId: ctx.isp.id,
      storeId: ctx.actor.id,
      folio: makeFolio(),
      wisphubCustomerId: String(customer.wisphubId),
      /* The usuario the retries will look the customer up by
         (reconnection-queue D8): the numeric id above is not a usuario */
      customerUsuario: customer.usuario,
      customerName: customer.name,
      customerZone: customer.zone,
      customerPhone: customer.phone,
      monthlyFeeCents: customer.monthlyFeeCents,
      serviceFeeCents: ctx.isp.serviceFeeCents,
      totalCents,
    })
    .returning();
  await recordChargeEntries(ctx.db, {
    storeId: ctx.actor.id,
    chargeId: charge.id,
    totalCents,
    commissionCents,
  });

  /* D3: one immediate attempt, then the queue takes over
     (reconnection-queue spec): the same rules decide when it retries.
     The invoice the guard resolved rides along (debt-truth D5), so the
     attempt never creates one on this path. */
  const attempt = await attemptReconnection(
    ctx.wisphub,
    { usuario, wisphubId: String(customer.wisphubId) },
    customer.monthlyFeeCents,
    now,
    { invoiceId: pendingInvoiceId, paymentRegistered: false },
  );
  const schedule = firstAttemptSchedule(attempt, now);
  const [updated] = await ctx.db
    .update(charges)
    .set({
      reconnectionStatus: attempt.status,
      reconnectionAttempts: schedule.attempts,
      wisphubInvoiceId: attempt.invoiceId,
      paymentRegisteredAt: attempt.paymentRegistered ? now : null,
      nextAttemptAt: schedule.nextAttemptAt,
      lastError: attempt.error,
      ...(attempt.status === "reconnected" ? { reconnectedAt: now } : {}),
    })
    .where(eq(charges.id, charge.id))
    .returning();

  return c.json({ success: true, data: toChargeResponse(updated) }, 201);
}

export async function getCharge(c: Ctx, chargeId: string) {
  const actor = c.get("actor");
  if (actor.type !== "store") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(charges).where(eq(charges.id, chargeId));
  /* Own charges only: a foreign charge looks like it does not exist */
  if (!row || row.storeId !== actor.id) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  return c.json({ success: true, data: toChargeResponse(row) });
}

/* The receipt for one charge (receipt spec). Own charges only, like
   getCharge: a foreign folio must not be readable. */
export async function getReceipt(c: Ctx, chargeId: string) {
  const actor = c.get("actor");
  if (actor.type !== "store") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(charges).where(eq(charges.id, chargeId));
  if (!row || row.storeId !== actor.id) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }

  const [store] = await db.select().from(stores).where(eq(stores.id, actor.id));
  /* D5: built now, so a retry that succeeded changes what the customer reads */
  const text = receiptText(row, store.name);
  const phone = toWhatsAppPhone(row.customerPhone);
  const data: ReceiptResponse = {
    folio: row.folio,
    customerName: row.customerName,
    totalCents: row.totalCents,
    monthlyFeeCents: row.monthlyFeeCents,
    serviceFeeCents: row.serviceFeeCents,
    reconnectionStatus: row.reconnectionStatus,
    text,
    waLink: whatsAppLink(text, phone),
    phone,
  };
  return c.json({ success: true, data });
}

/* The ISP's live feed (charge-feed spec). Tenant isolation by ispId (D6). */
export async function listChargeFeed(
  c: Ctx,
  q: {
    cursor?: number;
    status?: "queued" | "reconnected" | "failed";
    storeId?: string;
    from?: number;
    to?: number;
  },
) {
  const actor = c.get("actor");
  if (actor.type !== "isp") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const PAGE = 20;

  const filters = [
    eq(charges.ispId, actor.id),
    ...(q.cursor ? [lt(charges.createdAt, new Date(q.cursor))] : []),
    ...(q.status ? [eq(charges.reconnectionStatus, q.status)] : []),
    ...(q.storeId ? [eq(charges.storeId, q.storeId)] : []),
    ...(q.from ? [gte(charges.createdAt, new Date(q.from))] : []),
    ...(q.to ? [lte(charges.createdAt, new Date(q.to))] : []),
  ];

  /* leftJoin: a direct SPEI charge has no store (direct-payment D6) and
     must still appear in the feed */
  const rows = await db
    .select({ charge: charges, storeName: stores.name })
    .from(charges)
    .leftJoin(stores, eq(charges.storeId, stores.id))
    .where(and(...filters))
    .orderBy(desc(charges.createdAt))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);

  /* Settings D5: the ISP's timezone decides where its day starts */
  const todayStartMs = startOfBusinessDayMs(actor.timezone);
  const [t] = await db
    .select({ count: count(), total: sum(charges.totalCents) })
    .from(charges)
    .where(and(eq(charges.ispId, actor.id), gte(charges.createdAt, new Date(todayStartMs))));
  const today = {
    count: Number(t?.count ?? 0),
    totalCents: Number(t?.total ?? 0),
    startedAtMs: todayStartMs,
  };

  return c.json({
    success: true,
    data: {
      charges: page.map(({ charge, storeName }) => ({
        id: charge.id,
        folio: charge.folio,
        channel: charge.channel,
        reconnectionStatus: charge.reconnectionStatus,
        totalCents: charge.totalCents,
        monthlyFeeCents: charge.monthlyFeeCents,
        serviceFeeCents: charge.serviceFeeCents,
        customerName: charge.customerName,
        storeName,
        createdAt: charge.createdAt.getTime(),
        reconnectedAt: charge.reconnectedAt?.getTime() ?? null,
        attempts: charge.reconnectionAttempts,
        lastError: charge.lastError,
      })),
      nextCursor: rows.length > PAGE ? page[page.length - 1].charge.createdAt.getTime() : null,
      today,
    },
  });
}

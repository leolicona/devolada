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
import { billingStatusOf, debtOf } from "../../wisphub/debt";
import {
  invalidatePendingInvoices,
  pendingInvoicesForDisplay,
} from "../../wisphub/cache";
import { startOfBusinessDayMs } from "../../time/business-day";
import { firstAttemptSchedule } from "../../reconnection/queue";
import { receiptText, toWhatsAppPhone, whatsAppLink } from "../../receipt";
import {
  capturedPhone,
  capturedPhones,
  normalizePhone,
  rememberPhone,
} from "../../customer-contacts";
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
  /* provider-latency D7: the configured base, like every other path.
     Without it the two most-used surfaces were the only ones that
     silently ignored WISPHUB_BASE_URL. */
  return { actor, isp, db, wisphub: new WispHub(isp.wisphubApiKey, c.env.WISPHUB_BASE_URL) };
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

/* The wire contract is the allow-list (customer-search D2). The adapter
   also carries the customer's phone, which the charge stores for its
   receipt (receipt D4) but the frontend never needs — so the number
   stops here; only whether one exists crosses the wire (phone D4). */
const toCustomerResult = (
  customer: WispHubCustomer,
  pending: PendingInvoices,
  hasPhone: boolean,
): CustomerResult => {
  /* debt-truth D7: the invoices are half the answer and `saldo` is the
     other half. Both already rode in responses we fetched. */
  const debt = debtOf(customer, pending);
  return {
    wisphubId: customer.wisphubId,
    usuario: customer.usuario,
    name: customer.name,
    zone: customer.zone,
    serviceStatus: customer.serviceStatus,
    billingStatus: billingStatusOf(customer, pending, debt),
    invoiceCents: debt.invoiceCents,
    carriedBalanceCents: debt.carriedBalanceCents,
    hasPhone,
  };
};

/* provider-latency D2: the customer lookup and the pending list race,
   but their answers are still read in the old order. Both callers below
   used to return 404 before the pending fetch ever happened, so a
   `Promise.all` would have turned "this customer does not exist" into
   "the provider is down" whenever both went wrong at once. The race is
   the point; the precedence is not negotiable. */
async function customerAndPending(
  lookup: Promise<WispHubCustomer | null>,
  pending: Promise<PendingInvoices>,
): Promise<{ customer: WispHubCustomer | null; pending: PendingInvoices }> {
  const [found, listed] = await Promise.allSettled([lookup, pending]);
  if (found.status === "rejected") throw found.reason;
  if (found.value === null) return { customer: null, pending: { invoices: [], complete: true } };
  if (listed.status === "rejected") throw listed.reason;
  return { customer: found.value, pending: listed.value };
}

export async function searchCustomers(c: Ctx, q: string) {
  const ctx = await storeContext(c);
  if ("error" in ctx) return ctx.error;

  try {
    const customers = await ctx.wisphub.searchCustomers(q);
    /* One pending-list fetch marks every result (debt-truth spec D2).
       Display only, so it may be up to 30s old (provider-latency D3):
       search is the most frequent screen in the product and every
       debounced keystroke was paying for a tenant-wide invoice fetch.
       The guard that refuses a charge still reads fresh. */
    const pending = customers.length
      ? await pendingInvoicesForDisplay(ctx.isp.id, ctx.wisphub, new Date())
      : { invoices: [], complete: true };
    /* One lookup for the whole page, and only for the customers WispHub
       had no number for (phone D4) */
    const captured = await capturedPhones(
      ctx.db,
      ctx.isp.id,
      customers.filter((customer) => !customer.phone).map((customer) => String(customer.wisphubId)),
    );
    const data: CustomerSearchResponse = {
      customers: customers.map((customer) =>
        toCustomerResult(
          customer,
          pending,
          Boolean(customer.phone) || captured.has(String(customer.wisphubId)),
        ),
      ),
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
    /* provider-latency D2: two independent reads, one wait. D3: the
       quote renders, it does not decide — the charge guard below is
       what refuses, and it reads fresh. */
    const now = new Date();
    const { customer, pending } = await customerAndPending(
      ctx.wisphub.getCustomer(usuario),
      pendingInvoicesForDisplay(ctx.isp.id, ctx.wisphub, now),
    );
    if (!customer) {
      return c.json({ success: false, error: { code: "CUSTOMER_NOT_FOUND" } }, 404);
    }

    const [store] = await ctx.db.select().from(stores).where(eq(stores.id, ctx.actor.id));
    const serviceFeeCents = ctx.isp.serviceFeeCents;
    const balanceCents = await storeBalanceCents(ctx.db, ctx.actor.id);
    const capCents = store.balanceCapCents;
    const hasPhone =
      Boolean(customer.phone) ||
      (await capturedPhone(ctx.db, ctx.isp.id, String(customer.wisphubId))) !== null;

    /* D8: the amount comes from the invoice, never from `precio_plan` —
       prorations, discounts and any reconnection charge are already
       inside it. D11 keeps the carried part on its own line. */
    const debt = debtOf(customer, pending);
    const data: CustomerQuoteResponse = {
      customer: toCustomerResult(customer, pending, hasPhone),
      quote: {
        invoiceCents: debt.invoiceCents,
        carriedBalanceCents: debt.carriedBalanceCents,
        serviceFeeCents,
        totalCents: debt.totalCents + serviceFeeCents,
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

export async function recordCharge(c: Ctx, usuario: string, submittedPhone?: string) {
  const ctx = await storeContext(c);
  if ("error" in ctx) return ctx.error;

  const now = new Date();
  let customer;
  let pending;
  try {
    /* provider-latency D2: independent reads, one wait. D3: **fresh**,
       never the display cache — this is the guard that decides whether
       money may be taken, and debt-truth D1/D5 rest on it asking
       WispHub every time. */
    ({ customer, pending } = await customerAndPending(
      ctx.wisphub.getCustomer(usuario),
      ctx.wisphub.pendingInvoices(now),
    ));
    if (!customer) {
      return c.json({ success: false, error: { code: "CUSTOMER_NOT_FOUND" } }, 404);
    }
  } catch (e) {
    return wisphubFailure(c, e);
  }

  /* D4 (charge-record) still: server-side guards; the UI is not a
     security layer. What changed is the question (debt-truth spec D5):
     the guard asks the invoices, not the label, and resolves the one
     this charge will pay — oldest first. */
  /* D5, now asking D7's question: the guard reads the whole debt, not
     just the invoice list. A customer whose invoice closed on a short
     payment owes a carried balance and no longer appears in that list —
     refusing them here is what made a real debt uncollectable. */
  const debt = debtOf(customer, pending);
  if (debt.totalCents === 0) {
    if (pending.complete || customer.carriedBalanceCents < 0) {
      return c.json({ success: false, error: { code: "NOTHING_DUE" } }, 409);
    }
    /* D4, narrowed by D14: a truncated list cannot prove "owes nothing",
       and `saldo` — read from the customer record, which is never
       truncated — said nothing either. Only then does the label decide. */
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

  /* What the shopkeeper collects: the ISP's debt (D7) plus our fee. The
     three parts stay separate on the row so the confirm screen and the
     receipt can show them as separate lines (D11). */
  /* The only case where the plan's price is still used: D4's truncation
     fallback let the charge through without our ever seeing the debt. A
     debt of zero here is not "no information", it is that path — and a
     carried balance with no pending invoice is a real zero we must keep
     (D15), which is why this asks the total and not the invoice line. */
  const debtUnknown = debt.totalCents === 0;
  const ispDebtCents = debtUnknown ? customer.planPriceCents : debt.totalCents;
  const totalCents = ispDebtCents + ctx.isp.serviceFeeCents;
  const commissionCents = store.commissionCents ?? ctx.isp.storeCommissionCents;

  /* Phone for the receipt (customer-phone D4): WispHub's own number wins;
     ours only fills its gaps. A submitted number is remembered for the
     next charge (D3) and copied onto this one, so the receipt about to be
     sent already links to the chat. */
  const wisphubCustomerId = String(customer.wisphubId);
  let customerPhone = customer.phone;
  if (!customerPhone) {
    const submitted = normalizePhone(submittedPhone);
    if (submitted) {
      await rememberPhone(ctx.db, ctx.isp.id, wisphubCustomerId, submitted);
      customerPhone = submitted;
    } else {
      customerPhone = await capturedPhone(ctx.db, ctx.isp.id, wisphubCustomerId);
    }
  }

  /* D2: record first — the money is safe before any WispHub call */
  const [charge] = await ctx.db
    .insert(charges)
    .values({
      ispId: ctx.isp.id,
      storeId: ctx.actor.id,
      folio: makeFolio(),
      wisphubCustomerId,
      /* The usuario the retries will look the customer up by
         (reconnection-queue D8): the numeric id above is not a usuario */
      customerUsuario: customer.usuario,
      customerName: customer.name,
      customerZone: customer.zone,
      customerPhone,
      invoiceCents: debtUnknown ? ispDebtCents : debt.invoiceCents,
      carriedBalanceCents: debtUnknown ? 0 : debt.carriedBalanceCents,
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
  /* provider-latency D4: this charge just changed the answer the display
     cache holds. Drop it before the attempt, so the re-search a
     shopkeeper does seconds later reads "al corriente" — the behaviour
     debt-truth verified live, which a 30s cache would otherwise undo. */
  invalidatePendingInvoices(ctx.isp.id);

  const attempt = await attemptReconnection(
    ctx.wisphub,
    ctx.isp.id,
    { usuario, wisphubId: String(customer.wisphubId) },
    ispDebtCents,
    now,
    { invoiceId: debt.invoiceId, paymentRegistered: false },
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
    invoiceCents: row.invoiceCents,
    carriedBalanceCents: row.carriedBalanceCents,
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
    status?: "queued" | "reconnected" | "failed" | "withheld";
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
        invoiceCents: charge.invoiceCents,
        carriedBalanceCents: charge.carriedBalanceCents,
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

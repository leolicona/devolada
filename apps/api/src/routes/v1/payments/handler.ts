import type { Context } from "hono";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../../env";
import { paymentLinks, payments } from "../../../db/schema";
import { isApiLink, type ApiLink } from "../../../direct-payments/links";
import { paymentFacts } from "../../../webhooks/events";
import { nextIsoDate, startOfIsoDateMs } from "../../../time/business-day";
import type { PaymentStatus } from "../webhook/schema";
import { fail, ok } from "../envelope";
import type { ApiPayment, ListTransfersQuery, TransferList } from "./schema";

/* GET /v1/payments/:id · GET /v1/payments?customerRef= (automated-
   collections-api US3, FR-019, FR-023) and GET /v1/transfers (US4,
   FR-020 – FR-022). The safety net under the
   webhook: whatever a caller missed, the state can always be asked for.
   Every query filters by the credential's business and mode
   (constitution V, research D12), and a payment of another business —
   or of a panel link, which speaks ISP — answers NOT_FOUND exactly like
   one that never existed. */

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;
type DirectPayment = typeof payments.$inferSelect;

/* receipt-triage D31 (FR-020a): a payment held for the business's decision
   has no verdict on this door yet. Its webhook is held too, and an
   integration that polls instead of listening must not act on a
   confirmation the business has not accepted — so the row reads as it did
   before the verdict, `validating` with the verdict fields absent, until
   the accept (which announces it) or the reject (`invalid`). */
const heldAsValidating = (payment: DirectPayment): DirectPayment =>
  payment.actionOutcome === "review" ? { ...payment, status: "validating" } : payment;

export function toPublic(row: DirectPayment, link: ApiLink): ApiPayment {
  const payment = heldAsValidating(row);
  /* the same facts the webhook carries, rendered by the same function
     so the two can never disagree (FR-014, FR-019) */
  const { paymentId: _paymentId, ...facts } = paymentFacts(payment, link);
  return {
    id: payment.id,
    status: payment.status as PaymentStatus,
    createdAt: payment.createdAt.getTime(),
    ...facts,
  };
}

/* The rows this credential may read: its business, its mode, API links
   only. The join is the filter — a payment row of a panel link carries
   no `customer_ref` and must never surface on this door (FR-028). */
function ownPayments(c: Ctx) {
  const { businessId, isTest } = c.get("apiClient");
  return {
    db: drizzle(c.env.DB),
    scope: and(
      eq(payments.businessId, businessId),
      eq(payments.isTest, isTest),
      eq(paymentLinks.source, "api"),
      eq(paymentLinks.isTest, isTest),
    ),
  };
}

export async function getPayment(c: Ctx, id: string) {
  const { db, scope } = ownPayments(c);
  const [row] = await db
    .select({ payment: payments, link: paymentLinks })
    .from(payments)
    .innerJoin(paymentLinks, eq(payments.paymentLinkId, paymentLinks.id))
    .where(and(scope, eq(payments.id, id)));
  if (!row || !isApiLink(row.link)) return fail(c, "NOT_FOUND");
  return ok(c, toPublic(row.payment, row.link));
}

/* FR-019 / US3 scenario 3: a reference with nothing received answers an
   empty list, never NOT_FOUND — "nothing arrived" is an answer, not an
   error. Newest first, so the payment that matters today reads first. */
export async function listPayments(c: Ctx, customerRef: string) {
  const { db, scope } = ownPayments(c);
  const rows = await db
    .select({ payment: payments, link: paymentLinks })
    .from(payments)
    .innerJoin(paymentLinks, eq(payments.paymentLinkId, paymentLinks.id))
    .where(and(scope, eq(paymentLinks.customerRef, customerRef)))
    .orderBy(desc(payments.createdAt), desc(payments.id));
  return ok(c, {
    payments: rows.flatMap((row) => (isApiLink(row.link) ? [toPublic(row.payment, row.link)] : [])),
  });
}

/* ---- GET /v1/transfers (US4) ---- */

/* What "a transfer received" means here (FR-022, research D16): money
   Banxico confirmed arrived — covering the ask, falling short of it, or
   applied to nothing because the link had closed. A claim still being
   validated, a contradicted one, an expired one or a superseded reading
   is not money and is not in the history. Nothing here comes from a
   bank feed: every row was entered by a payer and validated by Devolada. */
const RECEIVED: PaymentStatus[] = ["confirmed", "partial", "unapplied"];

/* FR-020: the page boundary is the row itself — its verdict moment and
   its id — never an offset. A payment confirmed while the caller walks
   lands after the boundary (its verdict moment is now), so it is seen
   once, on a later page; an offset would have shifted every later page
   under the caller's feet. Opaque on the wire: base64url of the pair. */
type Boundary = { confirmedAtMs: number; id: string };

function encodeCursor(b: Boundary): string {
  return btoa(`${b.confirmedAtMs}:${b.id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(cursor: string): Boundary | null {
  try {
    const raw = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    const sep = raw.indexOf(":");
    if (sep <= 0) return null;
    const confirmedAtMs = Number(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (!Number.isInteger(confirmedAtMs) || !id) return null;
    return { confirmedAtMs, id };
  } catch {
    return null;
  }
}

export async function listTransfers(c: Ctx, q: ListTransfersQuery) {
  const { db, scope } = ownPayments(c);
  const { business } = c.get("apiClient");

  /* FR-021: `from` and `to` are days on the business's wall clock, the
     one helper the panel's feed and "today" already use (settings D5,
     payments-and-classes D4) — never the caller's zone, never UTC.
     Inclusive `to`: everything before the next day's midnight. */
  const fromMs = startOfIsoDateMs(business.timezone, q.from);
  const toMs = startOfIsoDateMs(business.timezone, nextIsoDate(q.to));

  const after = q.cursor ? decodeCursor(q.cursor) : null;
  if (q.cursor && !after) return fail(c, "VALIDATION_ERROR", "cursor: not one this history handed out");

  const rows = await db
    .select({ payment: payments, link: paymentLinks })
    .from(payments)
    .innerJoin(paymentLinks, eq(payments.paymentLinkId, paymentLinks.id))
    .where(
      and(
        scope,
        inArray(payments.status, RECEIVED),
        /* receipt-triage D31: held money is not received until the
           business accepts it */
        or(isNull(payments.actionOutcome), ne(payments.actionOutcome, "review")),
        gte(payments.confirmedAt, new Date(fromMs)),
        lt(payments.confirmedAt, new Date(toMs)),
        ...(after
          ? [
              or(
                gt(payments.confirmedAt, new Date(after.confirmedAtMs)),
                and(eq(payments.confirmedAt, new Date(after.confirmedAtMs)), gt(payments.id, after.id)),
              ),
            ]
          : []),
      ),
    )
    .orderBy(asc(payments.confirmedAt), asc(payments.id))
    /* one past the page tells whether there is a next one */
    .limit(q.limit + 1);

  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const body: TransferList = {
    transfers: page.flatMap((row) => (isApiLink(row.link) ? [toPublic(row.payment, row.link)] : [])),
    nextCursor:
      rows.length > q.limit && last?.payment.confirmedAt
        ? encodeCursor({ confirmedAtMs: last.payment.confirmedAt.getTime(), id: last.payment.id })
        : null,
  };
  return ok(c, body);
}

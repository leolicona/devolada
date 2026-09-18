import type { Context } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../../env";
import { paymentLinks, payments } from "../../../db/schema";
import { isApiLink, type ApiLink } from "../../../direct-payments/links";
import { paymentFacts } from "../../../webhooks/events";
import type { PaymentStatus } from "../webhook/schema";
import { fail, ok } from "../envelope";
import type { ApiPayment } from "./schema";

/* GET /v1/payments/:id · GET /v1/payments?customerRef= (automated-
   collections-api US3, FR-019, FR-023). The safety net under the
   webhook: whatever a caller missed, the state can always be asked for.
   Every query filters by the credential's business and mode
   (constitution V, research D12), and a payment of another business —
   or of a panel link, which speaks ISP — answers NOT_FOUND exactly like
   one that never existed. */

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;
type DirectPayment = typeof payments.$inferSelect;

function toPublic(payment: DirectPayment, link: ApiLink): ApiPayment {
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

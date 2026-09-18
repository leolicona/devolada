import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../../env";
import { paymentLinks, payments } from "../../../db/schema";
import { classifyPayment } from "../../../direct-payments/classes";
import { isApiLink, type ApiLink } from "../../../direct-payments/links";
import { advanceTestPayment as writeAdvance, type TestAdvance } from "../../../direct-payments/validation";
import { deferOf } from "../../defer";
import { fail, ok } from "../envelope";
import { toPublic } from "../payments/handler";
import type { AdvanceTestPaymentRequest } from "./schema";

/* POST /v1/test/payments/:id/advance (automated-collections-api D12,
   FR-034, contracts/public-api.md). Test mode's one honest simulation:
   there is no way to fake a Banxico CEP, so the developer names the
   verdict and Devolada writes it exactly as the validation would have —
   the same row, the same fields, the same webhook through the same
   queue — lying about nothing except the transfer. The router lets only
   a test credential in (requireTestCredential); here the payment must
   also be that business's, and a test one: a real payment answers
   NOT_FOUND like one that never existed. */

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;
type DirectPayment = typeof payments.$inferSelect;

/* The verdicts, once written, are final — in test mode too. A row that
   could go `confirmed` and then `expired` would teach the caller's
   integration a history no real payment has. */
const FINAL = new Set<DirectPayment["status"]>(["confirmed", "partial", "unapplied", "invalid", "expired", "superseded"]);

const MONEY = new Set<AdvanceTestPaymentRequest["to"]>(["confirmed", "partial", "unapplied"]);

/* What the request asks for, checked against the row: the request must
   tell one story, and the classifier that decides `match` in a real
   validation decides it here (payments-and-classes D1/D3). A refusal
   names the field, like every VALIDATION_ERROR on this surface (FR-025). */
function plan(
  payment: DirectPayment,
  link: ApiLink,
  business: { toleranceCents: number },
  body: AdvanceTestPaymentRequest,
): TestAdvance | { refused: string } {
  if (FINAL.has(payment.status)) return { refused: `to: the payment already ended ${payment.status}` };
  if (body.to === payment.status) return { refused: `to: the payment is already ${payment.status}` };
  if (!MONEY.has(body.to)) {
    if (body.receivedCents !== undefined) return { refused: `receivedCents: only confirmed, partial or unapplied carry an amount` };
    return { status: body.to as Exclude<TestAdvance["status"], "confirmed" | "partial" | "unapplied"> };
  }
  /* the ask the real path settles against: what was asked, plus the fee
     the payer was shown (direct-payments/validation.ts settleApiPayment) */
  const askedCents = (payment.askedCents ?? link.askCents) + payment.serviceFeeCents;
  if (body.to === "partial" && body.receivedCents === undefined) {
    return { refused: `receivedCents: a partial verdict needs the amount that arrived, below ${askedCents}` };
  }
  const receivedCents = body.receivedCents ?? askedCents;
  const match = classifyPayment({ receivedCents, askedCents, toleranceCents: business.toleranceCents });
  if (body.to === "confirmed" && match === "short") {
    return { refused: `receivedCents: ${receivedCents} is below the ask of ${askedCents} — that verdict is partial` };
  }
  if (body.to === "partial" && match !== "short") {
    return { refused: `receivedCents: ${receivedCents} covers the ask of ${askedCents} — that verdict is confirmed` };
  }
  /* research D16: unapplied is validated money that settled nothing;
     the real path classes it `over` whatever arrived */
  return { status: body.to, receivedCents, match: body.to === "unapplied" ? "over" : match };
}

export async function advanceTestPayment(c: Ctx, id: string, body: AdvanceTestPaymentRequest) {
  const { businessId, business } = c.get("apiClient");
  const db = drizzle(c.env.DB);
  const [row] = await db
    .select({ payment: payments, link: paymentLinks })
    .from(payments)
    .innerJoin(paymentLinks, eq(payments.paymentLinkId, paymentLinks.id))
    .where(
      and(
        eq(payments.id, id),
        eq(payments.businessId, businessId),
        eq(payments.isTest, true),
        eq(paymentLinks.isTest, true),
        eq(paymentLinks.source, "api"),
      ),
    );
  if (!row || !isApiLink(row.link)) return fail(c, "NOT_FOUND");

  const next = plan(row.payment, row.link, business, body);
  if ("refused" in next) return fail(c, "VALIDATION_ERROR", next.refused);

  /* FR-017 holds here too: the answer never waits on the caller's endpoint */
  const advanced = await writeAdvance(c.env, db, row.payment, row.link, next, new Date(), { defer: deferOf(c) });
  return ok(c, toPublic(advanced, row.link));
}

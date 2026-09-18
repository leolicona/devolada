import { z } from "zod";
import { PAYMENT_STATUSES } from "../webhook/schema";

/* POST /v1/test/payments/:id/advance (contracts/public-api.md,
   automated-collections-api D12, FR-034). The one request of the
   test-mode door: which state the test payment should enter next, and —
   for a verdict that carries money — what Banxico would have said
   arrived. The answer is the payment as GET /v1/payments/:id reads it
   (`apiPayment` in ../payments/schema), so the developer's own polling
   parses both the same way. */
export const advanceTestPaymentRequest = z.object({
  /* the row's own word (D17): the same eight the webhook announces */
  to: z.enum(PAYMENT_STATUSES),
  /* integer cents. Read by `confirmed`, `partial` and `unapplied`;
     refused on any other state, because there it would be a lie */
  receivedCents: z.number().int().positive().optional(),
});

export type AdvanceTestPaymentRequest = z.infer<typeof advanceTestPaymentRequest>;

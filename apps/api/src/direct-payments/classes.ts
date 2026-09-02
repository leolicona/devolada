import type { businesses } from "../db/schema";
import { WISPHUB_CAPABILITIES } from "../wisphub/client";

/* The reconciliation class and the surplus treatment
   (payments-and-classes D1–D3). Pure functions: the class is computed
   once, at the verdict, against the fresh ask — never recomputed when
   the policy changes later (scenario 1). */

export type ReconciliationClass = "exact" | "short" | "over";
export type OverTreatment = "flag" | "credit";

/* D1/D3: what arrived against what was asked at the verdict — the fresh
   debt plus the service fee, the same ask the payer's page quoted.
   Within the tolerance is `exact`; below is `short`, above is `over`.
   The default tolerance is $0: SPEI is exact to the cent, so a $1
   difference is a real short payment, not rounding. */
export function classifyPayment(input: {
  receivedCents: number;
  askedCents: number;
  toleranceCents: number;
}): ReconciliationClass {
  const diff = input.receivedCents - input.askedCents;
  if (Math.abs(diff) <= input.toleranceCents) return "exact";
  return diff < 0 ? "short" : "over";
}

type Policy = Pick<typeof businesses.$inferSelect, "overTreatment">;
type Connected = { apiKey: string | null } | null;

/* D2: an integration that absorbs surplus turns `flag` into `credit` —
   not a loosening of the business's rule but a fact about where the
   money already went. A business with no integration keeps its policy.
   (The key moved to the integration row — integrations-hub D2.) */
export function effectiveOverTreatment(business: Policy, integration: Connected): OverTreatment {
  if (integration?.apiKey && WISPHUB_CAPABILITIES.absorbsOverpayment) return "credit";
  return business.overTreatment;
}

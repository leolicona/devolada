/* The claims the page makes about the product, and what makes each one
   true (landing-page D11; spec FR-013, SC-008).

   This list is the SOURCE of every claim on the page, not a document
   beside it: a component renders a claim by id, the browser layer asserts
   every `text` appears on the page once under `[data-claim="<id>"]`, and
   the unit test refuses an entry without a `basis`. Removing a claim here
   removes it from the page in the same change. A tile or headline that
   shortens one of these carries `data-claim-echo` and is not a claim.

   `text` is es-MX exactly as the canvas (v13, 2026-09-20) says it. `basis`
   is the decision, requirement, file or measurement behind it — read
   against the product by a person before each publication (quickstart,
   Pre-flight). No claim names a vendor (D24) and no claim carries a figure
   the operator can change (FR-014). */

export interface Claim {
  readonly id: string;
  readonly text: string;
  readonly basis: string;
}

export const CLAIMS: readonly Claim[] = Object.freeze([
  {
    id: "money-never-touches",
    text: "Directo a tu CLABE. Devolada nunca lo toca.",
    basis:
      "direct-payment D3/D4 — the customer transfers to the business's own CLABE (businesses.clabe); the platform holds no account in the flow and never receives the money.",
  },
  {
    id: "system-stays-record",
    text: "Cuando un pago se verifica, Devolada le avisa a tu sistema y él reactiva el servicio. Tú no cambias nada.",
    basis:
      "reconnection-queue D2; apps/api/src/reconnection/queue.ts — a confirmed payment fires the reconnection in the business's own system, which stays the record; nothing is re-entered by hand.",
  },
  {
    id: "spei-verified",
    text: "Cada transferencia SPEI se verifica contra Banxico, llega a tu CLABE y nadie revisa capturas a mano.",
    basis:
      "consta/validate.ts — every transfer proof is checked against Banxico's CEP through the validation engine (consta-api-merge D1); a payment is `confirmed` only on that answer.",
  },
  {
    id: "auto-reactivation",
    text: "Se verifica el pago y el internet vuelve solo.",
    basis:
      "reconnection-queue D2; apps/api/src/reconnection/queue.ts — the reconnection action fires on the verdict, with no operator step in between (actionOutcome `done`, StatusBadge `reconnected`).",
  },
  {
    id: "no-fake-receipts",
    text: "Lo inventado, lo editado y lo repetido no pasan.",
    basis:
      "direct-payment D8/D17 — a receipt Banxico does not know answers `invalid`; a reused tracking key is refused at the unique index (proof_rejections, provisional-release D6); two-eyes-receipt D3/D5 compares the reading with the provider's.",
  },
  {
    id: "partial-visible",
    text: "Si te pagan de menos, lo ves como parcial.",
    basis:
      "payments-and-classes D1 — the reconciliation class `short` and the status `partial` (StatusBadge `paymentPartial`, `classShort`) are shown on the payment, never folded into a total.",
  },
  {
    id: "verification-time",
    text: "Devolada le pregunta a Banxico en cuanto llega el comprobante e insiste durante horas si hace falta.",
    basis:
      "direct-payment D4 (the pay request answers before the first provider call, which runs at once under waitUntil) and the re-validation slots of the every-minute sweep (apps/api/src/direct-payments/validation.ts, platform setting `retry_schedule`).",
  },
  {
    id: "any-bank",
    text: "No. Cualquier CLABE de cualquier banco.",
    basis:
      "scripts/banks.data.md → apps/api/src/direct-payments/banks.ts — the CLABE prefix table covers every bank Banxico lists; the business chooses its own account (business-and-memberships D5).",
  },
  {
    id: "system-down",
    text: "El pago se verifica igual. La reactivación espera en cola, a la vista.",
    basis:
      "reconnection-queue D2 — a provider failure never rejects a payment; the action is queued (actionOutcome `queued`, StatusBadge `queued` 'Reconexión en cola') and retried by the sweep, visible on the payment.",
  },
  {
    id: "pricing-model",
    text: "Prepago. Por pago verificado. Sin mensualidad ni contrato. Los primeros pagos son gratis.",
    basis:
      "prepaid-credit D2/D4 — credit is debited per confirmed validation (validation_fee_cents), never monthly; the welcome allowance (welcome_bonus_validations) makes the first payments free. Figures live in apps/api/src/platform/settings.ts and stay off the page (FR-014).",
  },
  {
    id: "reply-sla",
    text: "Te escribimos en menos de un día hábil. Sin spam.",
    basis:
      "landing-page FR-016 and the activation workflow, step 2 (spec §The workflow the page starts) — the creator's own promise, measured by the answered-within-a-business-day count.",
  },
  {
    id: "activation-together",
    text: "Lo activamos contigo, hasta tu primer pago verificado.",
    basis:
      "spec §The workflow the page starts, steps 2–4 — the creator walks each prospect to the first verified payment over WhatsApp; measured by first verified payment within 7 days.",
  },
]);

/* How a component asks for a claim. Throws at build for an id that is not
   on the list — a claim that is not here is not on the page. */
export function claim(id: string): Claim {
  const found = CLAIMS.find((c) => c.id === id);
  if (!found) throw new Error(`landing-page D11: no claim with id "${id}" — add it to claims.ts with its basis, or do not say it`);
  return found;
}

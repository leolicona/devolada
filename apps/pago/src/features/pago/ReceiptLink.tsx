import { Button } from "@devolada/ui";

/* The receipt, as option 3 of a page with a reference (confirmation-hierarchy
   D2; spec FR-004, clarified 2026-09-30): a quiet action — no fill and no
   border at rest, small text, a light background when touched, 48px high,
   full width, always the last action of its view.

   It is the recipe of the receipt step's own quiet door, "No tengo el
   comprobante a la mano" (`PaymentPage`'s receipt view): the receipt and
   that door swap places on a page with a reference, and no new recipe is
   made. Not the `link` variant: that one has no box and drops its height
   (`h-auto p-0`), so it is no 48px target (constitution VI, research R7).

   Where it appears is spec FR-005's list (contracts/payment-page.md, the
   `ReceiptLink` table): the confirmation, option 2's form, every ask,
   "Ya se usó para…", every refusal and the expired view — never the plain
   wait of the first rounds, which asks nothing. */
export function ReceiptLink({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" className="h-12 w-full text-sm" onClick={onClick}>
      Subir foto del comprobante
    </Button>
  );
}

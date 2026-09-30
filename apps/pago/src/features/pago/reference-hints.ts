import { groupReferenceDigits } from "@devolada/api/direct-payments-schema";
import type { Bank } from "@devolada/api/direct-payments-schema";

/* payment-without-receipt D21 (FR-004) — where each bank's app takes the
   payer's reference when they send a transfer, in the payer's words.

   The rule is receipt-triage D19's, the one `BANK_HINTS` keeps: an entry is
   added only from the bank's own app or documentation, checked by a person,
   and it says which and when. A line that sends a payer to a field their
   bank does not have costs a payment that cannot be found by its reference,
   which is worse than the general sentence. So the record starts empty and
   Banco Azteca is the first entry, once it is verified by hand before
   launch (tasks T002, T052). Keyed by `Bank`, the vocabulary the schema
   re-exports (gen-banks), so a name outside it does not compile.

   Which bank: the payer's most recent learned bank (D12). A payer with no
   learned bank reads the general sentence. */

export type ReferenceHint = {
  /* The whole sentence as the payer reads it, the bank in its everyday
     spelling and the final period included — "En Azteca, escríbela en
     «Referencia numérica», no en «Concepto»." */
  text: string;
  /* What it was verified against */
  source: string;
  /* YYYY-MM-DD */
  verified: string;
};

export const REFERENCE_HINTS: Partial<Record<Bank, ReferenceHint>> = {};

/* When the bank has no verified entry, or the payer has no learned bank */
export const GENERAL_REFERENCE_HINT = "Escríbela en «Referencia numérica», no en «Concepto».";

export function referenceHint(bank: string | null | undefined): string {
  return (bank ? REFERENCE_HINTS[bank as Bank]?.text : undefined) ?? GENERAL_REFERENCE_HINT;
}

/* The reference inside a sentence: grouped as everywhere (D21/D22), with
   a no-break space so a line never ends between "234" and "5678" — split,
   it reads as two numbers (seen at 360px, 2026-09-30). A value on its own
   row keeps the plain space. */
export function inlineReference(digits: string): string {
  return groupReferenceDigits(digits).replace(" ", "\u00a0");
}

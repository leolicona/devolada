import type { Bank } from "@devolada/api/direct-payments-schema";

/* receipt-triage D19 — where each bank's app shows the clave de rastreo
   and the número de referencia, in the payer's words.

   An entry is added only from a real receipt or the bank's own
   documentation, read by a person, and it says which and when: a hint
   that sends a payer to a screen their bank does not have is worse than
   the general sentence. Keyed by `Bank`, the vocabulary the schema
   re-exports (gen-banks), so a name outside it does not compile.

   Used by the ask (Story 2, FR-010), the later asks (D6) and the capture
   guide's tips (Story 4, FR-025). */

export type BankHint = {
  /* Completes "En {banco}, …" — lower-case start, no final period */
  where: string;
  /* What it was verified against */
  source: string;
  /* YYYY-MM-DD */
  verified: string;
};

export const BANK_HINTS: Partial<Record<Bank, BankHint>> = {
  BANORTE: {
    where: "toca «Ver más detalles» y captura esa pantalla",
    source: "receipt 1, receipt-triage spec",
    verified: "2026-09-23",
  },
};

/* When the bank has no verified entry, or the reader named none */
export const GENERAL_HINT =
  "Abre el detalle de la transferencia en tu app y captura la pantalla donde aparecen estos datos.";

/* The bank's display name for "En {banco}, …": the vocabulary's own
   spelling, which is how the payer picked it in the form */
export function bankHint(bank: string | null | undefined): { bank: string; hint: BankHint } | null {
  if (!bank) return null;
  const hint = BANK_HINTS[bank as Bank];
  return hint ? { bank: bankLabel(bank), hint } : null;
}

/* "BANORTE" reads as a shout in a sentence; the few names the hints
   carry get their everyday spelling.
   payment-without-receipt D21: the confirmation reads back a sentence too
   ("…desde Banco Azteca, hoy martes 29.") and offers the payer's banks as
   choices, so the banks payers use most get theirs. A name not listed
   keeps the vocabulary's own spelling, which is still the right bank. */
const LABELS: Partial<Record<Bank, string>> = {
  AZTECA: "Banco Azteca",
  BAJIO: "BanBajío",
  BANAMEX: "Banamex",
  BANCOPPEL: "BanCoppel",
  BANORTE: "Banorte",
  BANREGIO: "Banregio",
  "BBVA MEXICO": "BBVA",
  "HEY BANCO": "Hey Banco",
  INBURSA: "Inbursa",
  "Mercado Pago W": "Mercado Pago",
  NUBANK: "Nu",
  SANTANDER: "Santander",
  SCOTIABANK: "Scotiabank",
  "SPIN BY OXXO": "Spin by OXXO",
};
export function bankLabel(bank: string): string {
  return LABELS[bank as Bank] ?? bank;
}

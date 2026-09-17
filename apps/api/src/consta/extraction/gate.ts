import { BANKS, type Bank } from "../../direct-payments/banks";
import { amountToCents } from "../../wisphub/money";
import type { Reading } from "./reader";

/* D4 — the gate is a range and a vocabulary, not a fixed length.

   This is the whole point of reading at our edge (D1): a reading we hold
   can be checked before a credit is spent, and both of these failures are
   invisible afterwards. apiCEP answers a malformed clave and an unknown
   bank with the same faceless `invalid` a nonexistent transfer gets
   (validation.spec.md D11, `not_found`), so nothing downstream will ever
   tell the caller which field was wrong. Here, we can. */

export type FieldGate = "ok" | "malformed" | "missing" | "unknown";

export type Gate = {
  trackingKey: Extract<FieldGate, "ok" | "malformed" | "missing">;
  senderBank: Extract<FieldGate, "ok" | "unknown" | "missing">;
  /* apiCEP's direct mode requires `sender.amount`, so a reading without a
     readable amount cannot buy a lookup at all (docs/legacy/integrations/apicep.md,
     required fields). It is a **search criterion here and nothing more** —
     D3 stands: what decides money is `cepDetails.amount`, which is also
     what lets a caller catch the $1-receipt that this one would otherwise
     wave through (direct-payment D11). */
  amount: Extract<FieldGate, "ok" | "malformed" | "missing">;
};

export type GatedReading = {
  gate: Gate;
  trackingKey: string | null;
  senderBank: Bank | null;
  amountCents: number | null;
  /* True when everything a direct-mode call needs is present and sane */
  passes: boolean;
};

/* validation.spec.md D13, verbatim: the check that catches the receipt
   printing its clave across two lines, and llama's measured 27-character
   misread, for free. A range — apiCEP's own example carries ten
   characters and Nu's carries 28. */
const TRACKING_KEY = /^[A-Za-z0-9]{6,30}$/;

const BY_NORMALISED = new Map<string, Bank>(BANKS.map((b) => [normalise(b), b]));

/* Accents, punctuation and case are noise on a bank name; anything else
   is a difference we must not paper over. "Nu" is NOT resolved to
   "NUBANK" here on purpose — the prompt asks the model to choose from the
   vocabulary, and a name that still does not fit is a question for the
   payer, not a guess for us to make (D4). apiCEP's own aliasing is
   undocumented, measured once, and silent when it runs out. */
function normalise(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function resolveBank(value: string | null): Bank | null {
  if (!value) return null;
  return BY_NORMALISED.get(normalise(value)) ?? null;
}

export function gateReading(reading: Reading): GatedReading {
  const key = reading.trackingKey?.trim() ?? null;
  const trackingKey = key && TRACKING_KEY.test(key) ? key : null;
  const senderBank = resolveBank(reading.senderBank);
  /* Pesos at the model's edge, cents at ours (validation spec D7) — by
     string parsing, never `× 100` (constitution II, consta-api-merge D18) */
  const amountCents =
    reading.amount != null && reading.amount > 0 ? amountToCents(reading.amount) : null;

  const gate: Gate = {
    trackingKey: !key ? "missing" : trackingKey ? "ok" : "malformed",
    senderBank: !reading.senderBank ? "missing" : senderBank ? "ok" : "unknown",
    amount: reading.amount == null ? "missing" : amountCents ? "ok" : "malformed",
  };

  return {
    gate,
    trackingKey,
    senderBank,
    amountCents,
    passes: gate.trackingKey === "ok" && gate.senderBank === "ok" && gate.amount === "ok",
  };
}

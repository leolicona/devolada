import { BANKS, type Bank } from "../../direct-payments/banks";
import { amountToCents } from "../../wisphub/money";
import type { Reading } from "./reader";
import { isGenericReference } from "../../routes/direct-payments/schema";

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
  /* receipt-triage D12: `ok` iff 1–7 digits as printed; `generic` is a
     well-formed reference many transfers share (D2) — no key. The
     engine's request guard stays at 20 digits for other callers. */
  referenceNumber: Extract<FieldGate, "ok" | "malformed" | "missing"> | "generic";
};

export type GatedReading = {
  gate: Gate;
  trackingKey: string | null;
  /* receipt-triage D12: only when the gate said `ok`, exactly as printed */
  referenceNumber: string | null;
  senderBank: Bank | null;
  amountCents: number | null;
  /* True when everything a direct-mode call needs is present and sane */
  passes: boolean;
  /* receipt-reader-tuning D14: the bank the money went to, through the
     same vocabulary as the sender's. A sibling of `gate`, not a field of
     it: `Gate` is what the payer page receives, and it does not move.
     Nothing reads `sameBank` to change the flow, and the gate never
     changes `senderBank` because of the receiver (spec D5, FR-012) —
     the same-institution guard is validation spec D17's, in request.ts. */
  receiving: ReceivingBank;
};

export type ReceivingBank = {
  bank: Bank | null;
  verdict: "ok" | "unknown" | "missing";
  sameBank: boolean;
};

/* receipt-reader-tuning D14: the verdict like the sender's — `missing`
   when not read, `unknown` when outside the vocabulary — and the flag
   only when both banks resolved to the same institution. `recentReading`
   rebuilds it through here from the stored columns (D15). */
export function receivingOf(
  receivingBank: string | null,
  sender: { bank: Bank | null; verdict: Gate["senderBank"] },
): ReceivingBank {
  const bank = resolveBank(receivingBank);
  const verdict = !receivingBank ? "missing" : bank ? "ok" : "unknown";
  return {
    bank,
    verdict,
    sameBank: sender.verdict === "ok" && verdict === "ok" && sender.bank === bank,
  };
}

/* validation.spec.md D13, verbatim: the check that catches the receipt
   printing its clave across two lines, and llama's measured 27-character
   misread, for free. A range — apiCEP's own example carries ten
   characters and Nu's carries 28. */
const TRACKING_KEY = /^[A-Za-z0-9]{6,30}$/;

/* The clave's verdict on its own. cep-bundle-match D9 asks it of the
   provider's reading too: a receipt whose clave either side read is a
   clave search, and its CEP is the payer's. */
export function gateTrackingKey(value: string | null | undefined): Gate["trackingKey"] {
  const key = value?.trim() ?? "";
  if (!key) return "missing";
  return TRACKING_KEY.test(key) ? "ok" : "malformed";
}

/* receipt-triage D12: apiCEP's own example carries seven digits, and a
   longer number on a receipt is a folio or an authorisation number */
const REFERENCE = /^\d{1,7}$/;

/* receipt-triage D12: the reference's verdict on its own, re-derivable
   from the stored text — `recentReading` rebuilds it this way (D28) */
export function gateReference(value: string | null): Gate["referenceNumber"] {
  const ref = value?.trim() ?? "";
  if (!ref) return "missing";
  if (!REFERENCE.test(ref)) return "malformed";
  return isGenericReference(ref) ? "generic" : "ok";
}

/* receipt-triage D11: a direct-mode call needs one key — the clave or a
   reference — plus the bank and the amount */
export function passesGate(gate: Gate): boolean {
  return (
    (gate.trackingKey === "ok" || gate.referenceNumber === "ok") &&
    gate.senderBank === "ok" &&
    gate.amount === "ok"
  );
}

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
    referenceNumber: gateReference(reading.referenceNumber),
  };

  return {
    gate,
    trackingKey,
    referenceNumber: gate.referenceNumber === "ok" ? reading.referenceNumber!.trim() : null,
    senderBank,
    amountCents,
    passes: passesGate(gate),
    receiving: receivingOf(reading.receivingBank, { bank: senderBank, verdict: gate.senderBank }),
  };
}

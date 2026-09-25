import type { ExtractionResult } from "./index";
import type { RegisteredAccount } from "../index";
import { tieDestination } from "./destination";

/* receipt-triage D4, D15, D16 — the one rule that stops a capture before
   a credit is spent, narrowing two-eyes-receipt D2/FR-005 ("a hole never
   refuses") for exactly two cases.

   `/read` reports it and the page renders it; the receipt door enforces
   it, so a client that skips the page buys nothing (D15). It fires only
   on a reading we can be *certain* of — a picture the reader called
   `completa`, or a PDF's own text (D16). A partly legible picture, one
   whose legibility the model did not judge, and a malformed clave all go
   to the provider as today: a wrongly stopped capture costs the payer a
   step, and those are exactly the readings where the provider's eyes may
   still find what ours missed (FR-015).

   1. `wrong_destination` (D24): the receipt's last visible digits fit
      none of the ISP's registered accounts, current or retired. Checked
      first — no key would make that transfer the ISP's.
   2. `no_key` (D4, D2): the gate found no clave and no reference, a
      generic reference counting as none. The fields name the key first,
      then every other field the typing form needs that the capture did
      not show, in the form's order. Never the account: the form does not
      ask for one (re-planned 2026-09-24, FR-018).

   Pure: the accounts are passed in. */

export type AskField = "key" | "amount" | "date" | "senderBank";

export type Ask =
  | null
  | { reason: "no_key"; fields: AskField[] }
  | { reason: "wrong_destination" };

export function isClearReading(extracted: ExtractionResult | null): boolean {
  if (!extracted || extracted.route !== "reader") return false;
  /* D16: a PDF's text has no photograph to be blurry; a picture must be
     called `completa` in so many words */
  return extracted.proof.kind === "pdf" || extracted.reading.legibility === "full";
}

export function askBeforeCredit(
  extracted: ExtractionResult | null,
  /* Omitted → the destination is never judged (a caller with no
     accounts to tie against) */
  accounts?: RegisteredAccount[] | null,
): Ask {
  if (!extracted || extracted.route !== "reader") return null;
  const { reading, gated } = extracted;
  if (!reading.isReceipt || !isClearReading(extracted)) return null;

  if (accounts?.length && tieDestination(reading.destination, accounts) === "none") {
    return { reason: "wrong_destination" };
  }

  const { gate } = gated;
  if (gate.trackingKey !== "missing") return null;
  if (gate.referenceNumber !== "missing" && gate.referenceNumber !== "generic") return null;

  const fields: AskField[] = ["key"];
  if (gate.amount !== "ok") fields.push("amount");
  if (!reading.date) fields.push("date");
  if (gate.senderBank !== "ok") fields.push("senderBank");
  return { reason: "no_key", fields };
}

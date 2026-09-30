import type { RegisteredAccount } from "../index";

/* cep-bundle-match — the shapes the bundle reader, the records and the
   matcher share (data-model.md "The matcher's types"). Pure types: the
   admin never imports them, and nothing here touches the database. */

/* D4, D5: one transfer as Banxico's CEP states it — a row of
   `cep_records` in camelCase. No name, no RFC/CURP, no concept: the
   parser never returns them, so no record can carry them (FR-006,
   FR-010). */
export type CepRecord = {
  id: string;
  clave: string;
  /* The bundle it was first read from; null for a single `valid` */
  bundleId: string | null;
  /* YYYY-MM-DD — the day Banxico files the transfer under */
  operationDate: string;
  /* YYYY-MM-DD — the printed day, the CEP's fecha de abono */
  creditDate: string;
  /* HH:MM:SS, Mexico City time (the CEP's own footnote) */
  creditTime: string;
  /* creditDate + creditTime in America/Mexico_City, epoch ms (D4) */
  creditedAt: number;
  senderBank: string;
  /* SPEI's account type: `40` CLABE, `3` debit card, `10` phone (D7) */
  senderAccountType: string;
  /* Whole, under the business only (FR-010) */
  senderAccount: string;
  receiverSpeiCode: string;
  receiverAccountType: string;
  receiverAccount: string;
  amountCents: number;
  certificateNumber: string;
  /* D2: kept with the record, never verified (R2) */
  seal: string;
  sealStatus: "not_verified";
};

/* D4: what the cadena original states — the record minus what the cadena
   does not carry (the clave and the reference are not in it, R5) and
   minus what this database adds (the id, the bundle, the seal) */
export type CadenaFacts = Omit<CepRecord, "id" | "clave" | "bundleId" | "seal" | "sealStatus">;

/* D6–D8: the receipt's side of a match — what the payer's receipt said,
   or (spec 012, FR-012) a bank statement standing in for it */
export type ReceiptSide = {
  /* "HH:MM" or "HH:MM:SS", read as Mexico City time; null when the
     receipt printed none */
  time: string | null;
  /* YYYY-MM-DD, the printed day the time belongs to */
  day: string | null;
  /* The sender account's visible digits, three or more; null otherwise */
  tail: string | null;
  /* The search's amount — the integrity check's yardstick. Null only when
     no side knows what the search used: the check is then skipped rather
     than guessed from the debt */
  amountCents: number | null;
  /* The payment's registered accounts (receipt-triage D30): a CEP whose
     destination ties to none of them is not this business's transfer */
  accounts: RegisteredAccount[];
  /* payment-without-receipt D10/D11: whole sending accounts learned for
     the service being confirmed — compared before the tail, in the `own`
     and `typed` modes only */
  knownAccounts?: string[];
  /* payment-without-receipt D26 (FR-041): during a transition, the
     previous holder's learned accounts — never chosen for the new owner.
     Present (even empty) means a transition is running: a candidate from
     an account not in `knownAccounts` is then held, and the four digits
     are asked before it confirms. */
  excludedAccounts?: string[];
};

/* payment-without-receipt D10, D11: how the candidates are judged.
   `receipt` — what a receipt said (cep-bundle-match D8), exactly as it
   was; `own` — the payer's own reference: every transfer found is theirs;
   `typed` — a reference the payer typed ("No puse la referencia"): only
   a learned account or the typed four digits may tie a transfer to them. */
export type MatchMode = "receipt" | "own" | "typed";

/* D6: the window around the receipt's time and the margin under which
   the two nearest candidates are too close to tell apart */
export type MatchPolicy = { beforeS: number; afterS: number; marginS: number };

/* D10: why a match did not decide — the words `match_trail.reason`
   carries. `unreadable` and `too_large` are the bundle's own (D16); the
   matcher itself only ever says the first four. */
export type UndecidedReason = "all_used" | "no_signal" | "too_close" | "none_fit" | "unreadable" | "too_large";

/* FR-013: why a candidate was not chosen. `farther` is a candidate inside
   the window that another one, nearer the receipt's time, beat (D6) —
   "outside the window" would tell the operator something false about it. */
export type TrailWhy =
  | "used"
  | "tail"
  | "window"
  | "farther"
  | "too_close"
  | "amount"
  | "account"
  | "unreadable"
  /* payment-without-receipt D26: sent from the previous holder's account */
  | "excluded";

/* FR-013: one candidate's fate, as the operator reads it — by clave and
   the last four digits of the sender's account, never by name (FR-010).
   An entry that could not be read has no record: no id, no time, no tail. */
export type TrailCandidate = {
  cepId: string | null;
  clave: string;
  creditTime: string | null;
  tail: string | null;
  fate: "chosen" | "dropped" | "kept";
  why: TrailWhy | null;
  /* D6: credit − receipt, in whole seconds, when the receipt showed a
     time and the candidate reached the window */
  distanceS?: number | null;
  /* bug: single-cep-unreadable (D19): how Banxico's document did not read
     — an unreadable bundle entry's reason, or the check a single's cadena
     failed. Absent when it read. Kept on the payment for whoever asks why;
     no response schema carries it. */
  readWhy?: string;
};

export type MatchResult =
  | {
      decided: "chosen";
      chosen: CepRecord;
      /* Which of tail and time dropped something; `none` when neither was
         needed. `clave` is the lifecycle's word for a D11 fit, never the
         matcher's. payment-without-receipt D10/D11 add what decided the
         `own` and `typed` modes: an account learned for the service, the
         earliest of the payer's own transfers, the four digits typed. */
      by: "tail" | "time" | "both" | "none" | "learned_account" | "earliest" | "sender_tail";
      /* D6: whenever the receipt showed a time — even when the tail alone
         decided */
      distanceS: number | null;
      trail: TrailCandidate[];
    }
  | { decided: "undecided"; reason: UndecidedReason; trail: TrailCandidate[] };

/* D16: a bundle's life — `pending` until read */
export type BundleStatus = "pending" | "read" | "unreadable" | "too_large";

/* data-model.md `match_trail`, as the lifecycle writes it */
export type MatchTrail = {
  source: "several" | "single";
  bundleId: string | null;
  decided: "chosen" | "undecided";
  /* payment-without-receipt D17: `clave_tail` — the clave's last four
     characters chose among the kept candidates */
  by: "tail" | "time" | "both" | "none" | "clave" | "learned_account" | "earliest" | "sender_tail" | "clave_tail" | null;
  reason: UndecidedReason | null;
  receipt: { time: string | null; tail: string | null };
  candidates: TrailCandidate[];
};

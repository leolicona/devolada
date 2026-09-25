/* Consta, the SPEI validation engine — a module of this API since
   consta-api-merge (D1, D17). Until then it was a Worker of its own with
   its own database, a key per business and a network hop inside every
   validation; the constitution recorded the cost (no prod env, so the
   channel said "unavailable" in production). Every decision the engine
   carries — validation spec D<n>, proof-extraction D<n>, trust-layer D<n>,
   learned-retry D<n> — still resolves in the archive
   (docs/legacy/consta/…) under the same names, which is why the module
   keeps the name.

   D2: the facade keeps the shape the payment lifecycle already programs
   against — `validate(request) → ConstaVerdict`, `extract(…) →
   ConstaReading` — as a function over `(env, db, owner)` instead of a
   class over `(baseUrl, apiKey)`, so the three callers changed one line
   each and the money decisions in `direct-payments/validation.ts` moved
   not at all.

   D6: a failure is a `ConstaError` carrying the engine's own code and
   whether waiting can help; every caller still rides the schedule on any
   of them (FR-011). Contract in specs/004-consta-api-merge/contracts/engine.md.

   Consta reports `alreadyValidated` without blocking (its D4): the replay
   policy is ours (direct-payment D8), applied by the caller.

   consta-api-merge D10: the HTTP client's 30 s deadline left with the
   client. One process, one listener — the engine's 25 s (validation spec
   D16) is the deadline a provider call carries.

   two-eyes-receipt D3/D11: the receipt door turned around. It used to
   read the file here, gate it, and spend the first credit on the
   provider's *transfer* door with our reading — so the provider's own
   eyes arrived only on a second credit, a minute later. Now the first
   credit sends the file to the provider's **image door** with our
   reading kept beside it: the provider's eyes first, ours beside them.
   When Banxico has nothing yet (`not_found`), the two readings are
   compared on the spot (`extraction/compare.ts`), the bank's learned
   clave shape breaks a tie, and the verdict carries what was accepted —
   so the *lifecycle* only has to store an answer, never compute one.
   The comparison lives here and not in the lifecycle because every
   ingredient is here (the gate, the shape rules, both readings), and
   because that gives top-ups the same flow for nothing (D18). */

import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Bank } from "../direct-payments/banks";
import type { Bindings } from "../env";
import { validate } from "./validate";
import { extract } from "./extract";

export { ConstaError, type ConstaErrorCode } from "./failure";

/* D3: who every row this engine writes belongs to. A business's
   validation or reading carries its id; the platform's own top-up
   (prepaid-credit D6) carries NULL. There is no key, no token, and no
   third kind of owner. */
export type Owner = { businessId: string } | { platform: true };

export function ownerId(owner: Owner): string | null {
  return "businessId" in owner ? owner.businessId : null;
}

/* receipt-triage D9/D22: an ISP is paid at a CLABE, a debit card or a
   phone — exactly the three shapes the request guard (`request.ts`)
   already validates and the adapter already passes through. The
   same-institution guard (validation spec D17) applies to all three. */
export type ConstaBeneficiary =
  | { bank: string; clabe: string; name?: string } // 18 digits
  | { bank: string; cardNumber: string; name?: string } // 16 digits
  | { bank: string; phoneNumber: string; name?: string }; // 10 digits

/* receipt-triage D30: one of the ISP's registered accounts, flagged when
   the ISP removed it after the payment was submitted — or before, when a
   receipt shows it anyway */
export type RegisteredAccount = ConstaBeneficiary & { retired?: true };

export type ConstaRequest = (
  | {
      transfer: {
        date: string;
        amountCents: number;
        senderBank: string;
        /* receipt-triage D1/D11: exactly one key travels — the clave
           when there is one, the referencia numérica only when there is
           none. The request guard refuses a transfer with neither. */
        trackingKey?: string;
        referenceNumber?: string;
        beneficiary: ConstaBeneficiary;
      };
    }
  | {
      /* D7: a key in `PROOFS` — a direct payment's or a top-up's. The
         engine reads the bytes itself; the provider gets a short-lived
         signed link only when it must read the file (a PDF, or
         `providerOcr`). */
      receipt: { proofKey: string };
      beneficiary: ConstaBeneficiary;
      /* proof-extraction D11: skip Consta's reader — the provider's OCR
         reads the image itself. The reading-check cross (US-D14) sets
         this: the same model checking itself is no second opinion.
         two-eyes-receipt D16: the product sets it on one path only now —
         the minute-two cross of a payment born before the cut-over. A
         request without it takes the provider-first flow, which reads
         here *and* asks the image door, so it needs no flag. */
      providerOcr?: true;
      /* receipt-triage D30: the payment's registered accounts at
         submission, current and retired — what the receipt's destination
         is tied against (D24). Never sent to the provider. Omitted by a
         top-up, whose one CLABE is `beneficiary`. */
      receivingAccounts?: RegisteredAccount[];
      /* receipt-triage D27 (FR-027): a payment born before this feature —
         the engine reads as today but skips the ask and the destination
         tie, so the row finishes under the flow it started in */
      legacy?: true;
    }
) & {
  /* provisional-release D4 / trust-layer D1: history refs, sent on every
     call from day one, toggle state irrespective — history only
     accumulates forward. consta-api-merge D5: `customerRef` is the
     link's own customer identity, undisguised — the usuario for a panel
     link, the caller's reference for an API link — now that the row
     sits in the same database as the link; `paymentRef` is the
     payments id, chaining the attempts of one payment. */
  customerRef?: string;
  paymentRef?: string;
};

/* trust-layer US-V15: the payer's measured history, attached by the
   engine on `pending`/`not_found` verdicts when a `customerRef`
   traveled — evidence next to the verdict, never instead of it. The
   lifecycle stores it verbatim (provisional-release D12, the shadow)
   and decides nothing with it; the shape is the engine's `TrustBlock`. */
export type ConstaTrust = {
  customerRef: string;
  sample: { chains: number; effectiveN: number; halfLifeDays: number };
  eventualValidRate: number | null;
  raw: {
    resolvedValid: number;
    abandoned: number;
    contradicted: number;
    alreadyUsedAttempts: number;
  };
  lastIncidentAt: string | null;
  medianMinutesToValid: number | null;
  tenantBaseline: { eventualValidRate: number | null; chains: number; effectiveN: number };
};

export type ConstaVerdict = {
  /* validations.id — a local key now (D1) */
  validationId: string;
  /* proof-extraction D2: which door actually read the file */
  source?: "reader" | "provider-ocr";
  extractionId?: string;
  /* proof-extraction D15: a field, never a refusal */
  shape?: "ok" | "mismatch" | "unknown";
  status: "valid" | "pending" | "invalid";
  /* Consta D11: which kind of `invalid`. Optional, and a missing value
     is read as the ambiguous one — an unverifiable payment must never
     turn back into a refusal. */
  reason?: "contradicted" | "not_found";
  hint?: "verify_inputs";
  /* learned-retry (consta US-V16): when Banxico's answer is "not yet",
     the moment when asking again stops being spending in vain — learned
     from measured traffic per bank cell, omitted in cold start. A
     suggestion, never a promise: D7's schedule stays floor and tail. */
  retryAfter?: string;
  /* Consta D18: Banxico's word on a `contradicted`, when it said one */
  cepStatus?: string;
  /* trust-layer D5: present exactly when the caller is deciding whether
     to wait — `pending`/`not_found` with a customerRef — never on
     `valid` or `contradicted`. */
  trust?: ConstaTrust;
  alreadyValidated: boolean;
  /* receipt-triage FR-006: the provider's replay flag as it answered —
     `true`, `false`, or `null` when it could not say. `alreadyValidated`
     above folds `null` into `false`, which is right for the replay rule
     (D8) and wrong for the one guard that must tell "never validated"
     from "unknown": a confirmation whose CEP carried no clave. */
  previouslyValidated?: boolean | null;
  /* receipt-triage D22/D30: the account the provider call named on the
     receipt door, `retired` when it was one the ISP removed; absent on
     the transfer door, whose caller chose. The lifecycle stores it on the
     payment (D25) and holds a `retired` confirmation for the ISP (D31). */
  beneficiaryUsed?: RegisteredAccount | null;
  cep?: {
    trackingKey: string | null;
    amountCents: number | null;
    date: string | null;
    senderBank: string | null;
    senderName: string | null;
    receiverBank: string | null;
    beneficiaryName: string | null;
    digitalSignature?: string | null;
    /* receipt-triage D22: Banxico's own word on the receiving account —
       documented by the provider, dropped by the adapter until now.
       Whole or masked is unmeasured, so the lifecycle ties it with
       `tieDestination` rather than comparing it whole. */
    beneficiaryAccount?: string | null;
    beneficiaryAccountType?: string | null;
  };
  /* proof-extraction D11: what the provider's OCR read off the image —
     a reading, never a verdict. Present on provider-OCR calls only, and
     it survives failure (measured 2026-08-26), which is exactly when the
     reading-check comparison needs it. */
  reading?: {
    trackingKey: string | null;
    amountCents: number | null;
    date: string | null;
    senderBank: string | null;
    referenceNumber: string | null;
  } | null;
  /* ---- two-eyes-receipt: what the engine read, and what the two
     readings settled between them. Present exactly when a provider-first
     receipt call came back `not_found`, or the provider itself read
     nothing (D12); absent on `valid`, `pending`, `contradicted`, on the
     transfer door, and on a legacy `providerOcr` cross, whose caller
     classifies for itself (D16). ---- */
  /* D3: our reading of the same file, gated — the other half of the
     pair the classification compares. A field is null unless the gate
     said `ok` for it, so a malformed clave of ours never argues with
     the provider (D5). Null when nothing here could read the file. */
  ourReading?: {
    trackingKey: string | null;
    senderBank: Bank | null;
    amountCents: number | null;
    date: string | null;
    legibility: "full" | "partial" | "none" | null;
    /* receipt-triage D12: our reference, only when the gate said `ok` */
    referenceNumber?: string | null;
  } | null;
  /* D5: the three words, taken at minute zero. `agreed` — both read the
     same clave and the same cents, which is evidence (D6) and stops the
     spending; `disputed` — they differ; `blind` — one side read nothing. */
  readingCheck?: "agreed" | "disputed" | "blind";
  /* D8: the fields to ask the payer for, and only those. Set when
     nothing could break a tie — and, whatever the check said, carrying
     `"date"` when the accepted data has no date on either side (D20). */
  /* receipt-triage D13: `"referenceNumber"` joins them */
  disputedFields?: ("trackingKey" | "referenceNumber" | "amount" | "date")[];
  /* D5: which side read nothing, on `blind` only */
  blindSide?: "provider" | "reader" | "both";
  /* D6/D7: the data later attempts carry through the provider's
     transfer door. Null when the payer has to be asked. A null `date`
     here is not a hole to paper over — `disputedFields` carries
     `"date"` and the transfer door waits for the payer's answer (D20):
     it is never called with a date nobody read. */
  /* receipt-triage D13: the accepted data carries both keys, at least one
     of them set — the clave when either reading found one, else a
     reference both sides could stand behind */
  accepted?: {
    trackingKey: string | null;
    referenceNumber: string | null;
    senderBank: Bank;
    amountCents: number;
    date: string | null;
  } | null;
  /* D7: which reading the accepted data came from — `agreed` when they
     said the same, `reader`/`provider` when the shape rules broke the
     tie for that side */
  acceptedFrom?: "agreed" | "reader" | "provider";
  downloads?: { cepXml?: string; cepPdf?: string };
};

/* proof-extraction D6: the reading, before a credit is spent. This is
   the half of Consta that exists so a human can look at what a machine
   read and say "that clave is wrong" in three seconds, instead of
   watching a spinner for six hours because nothing downstream can tell a
   misread from a transfer that never happened. */
export type ConstaGate = {
  trackingKey: "ok" | "malformed" | "missing";
  senderBank: "ok" | "unknown" | "missing";
  amount: "ok" | "malformed" | "missing";
  /* receipt-triage D12: `generic` is a well-formed reference that many
     transfers share — no key (D2) */
  referenceNumber: "ok" | "malformed" | "generic" | "missing";
  /* proof-extraction D15: the shape verdict rides the gate as a field */
  shape: "ok" | "mismatch" | "unknown";
};

export type ConstaReading = {
  extractionId: string;
  /* two-eyes-receipt D1: a PDF with text is `reader` now — it is turned
     into text at the edge and read by the same model. `provider-ocr`
     means what it always meant on the wire, "nothing here read this
     file", but the cases changed: no binding, a PDF the conversion
     yielded nothing for, or an answer that could not be parsed. */
  source: "reader" | "provider-ocr";
  isReceipt: boolean | null;
  trackingKey: string | null;
  senderBank: string | null;
  amountCents: number | null;
  date: string | null;
  receiptStatus: string | null;
  gate: ConstaGate;
  /* two-eyes-receipt D2 (R7): the reader's own verdict on the picture.
     `none` is the only one that refuses before a credit is spent — and
     the page refuses on it, this door only reports (FR-004). Null for a
     text reading (a PDF has no photograph to judge, D15) and when the
     model omitted the field, which is read as `full`: the bias is to let
     files through (FR-005). */
  legibility: "full" | "partial" | "none" | null;
  /* proof-extraction D16: to confirm, never to send */
  suggestedBank?: string;
  /* receipt-triage D12: only when the gate said `ok` — 1 to 7 digits, as
     printed */
  referenceNumber: string | null;
  /* receipt-triage D24: the receiving account as the reading saw it.
     Never sent to the page — `destinationSeen` is (payment-page contract). */
  destination: { kind: "clabe" | "card" | "phone" | "account" | null; digits: string | null };
  /* receipt-triage D15: the one rule, reported. Null when the capture may
     go on to the paid call. This door never throws on it. */
  ask:
    | null
    | { reason: "no_key"; fields: ("key" | "amount" | "date" | "senderBank")[] }
    | { reason: "wrong_destination" };
  /* receipt-triage D24/D30: the account the destination tied to, when it
     did — the pay handler snapshots it as the payment's `beneficiary`.
     Never sent to the page. */
  tiedAccount: RegisteredAccount | null;
};

/* receipt-triage D7 (FR-007, converge T060): what only the caller can
   know. The engine has no links and no payments; the lifecycle does, so it
   hands the engine the one question the receipt door must ask before a
   paid call — is this reference already another payment's? Omitted (a
   top-up, the `/read` door) → never asked. */
export type ConstaHooks = {
  referenceTaken?: (reading: {
    referenceNumber: string;
    date: string;
    senderBank: string;
    amountCents: number;
    account: RegisteredAccount;
  }) => Promise<boolean>;
};

export type ConstaEngine = {
  validate(request: ConstaRequest): Promise<ConstaVerdict>;
  extract(input: {
    proofKey: string;
    /* receipt-triage D15: the ISP's accounts, so the ask can judge the
       destination. Omitted → the destination is never a mismatch. */
    receivingAccounts?: RegisteredAccount[];
  }): Promise<ConstaReading>;
};

/* Obtain an engine for one owner. It reads `APICEP_*`, `AI`,
   `EXTRACTION_MODEL` and `PROOFS` from the env, and `API_BASE_URL` +
   `BETTER_AUTH_SECRET` only to sign a proof link for the provider. */
export function consta(
  env: Bindings,
  /* The callers hold their Drizzle handle under two schema generics
     (the top-up lifecycle's is `Record<string, unknown>`); the engine
     touches only its own two tables, so either is fine here. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: DrizzleD1Database<any>,
  owner: Owner,
  hooks: ConstaHooks = {},
): ConstaEngine {
  const handle = db as DrizzleD1Database;
  return {
    validate: (request) => validate(env, handle, owner, request, hooks),
    extract: (input) => extract(env, handle, owner, input),
  };
}

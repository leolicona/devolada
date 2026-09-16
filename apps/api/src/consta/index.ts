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
   D16) is the deadline a provider call carries. */

import type { DrizzleD1Database } from "drizzle-orm/d1";
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

export type ConstaBeneficiary = {
  bank: string;
  clabe: string;
  name?: string;
};

export type ConstaRequest = (
  | {
      transfer: {
        date: string;
        amountCents: number;
        senderBank: string;
        trackingKey: string;
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
         this: the same model checking itself is no second opinion. */
      providerOcr?: true;
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
  cep?: {
    trackingKey: string | null;
    amountCents: number | null;
    date: string | null;
    senderBank: string | null;
    senderName: string | null;
    receiverBank: string | null;
    beneficiaryName: string | null;
    digitalSignature?: string | null;
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
  /* proof-extraction D15: the shape verdict rides the gate as a field */
  shape: "ok" | "mismatch" | "unknown";
};

export type ConstaReading = {
  extractionId: string;
  source: "reader" | "provider-ocr";
  isReceipt: boolean | null;
  trackingKey: string | null;
  senderBank: string | null;
  amountCents: number | null;
  date: string | null;
  receiptStatus: string | null;
  gate: ConstaGate;
  /* proof-extraction D16: to confirm, never to send */
  suggestedBank?: string;
};

export type ConstaEngine = {
  validate(request: ConstaRequest): Promise<ConstaVerdict>;
  extract(input: { proofKey: string }): Promise<ConstaReading>;
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
): ConstaEngine {
  const handle = db as DrizzleD1Database;
  return {
    validate: (request) => validate(env, handle, owner, request),
    extract: (input) => extract(env, handle, owner, input),
  };
}

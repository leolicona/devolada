import type { DrizzleD1Database } from "drizzle-orm/d1";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { extractions } from "../db/schema";
import type { Bindings } from "../env";
import { PROOF_URL_TTL_MINUTES } from "../direct-payments/proofs";
import {
  askBeforeCredit,
  checkShape,
  extractProof,
  gateReference,
  passesGate,
  tieDestination,
  loadShapeRules,
  ProofFetchError,
  readerPlan,
  readProofFromBucket,
  ReaderError,
  receivingBankTie,
  receivingOf,
  suggestBank,
  type ExtractionResult,
  type Gate,
  type GatedReading,
  type LoadedProof,
  type Reading,
  type ShapeVerdict,
} from "./extraction";
import type { Bank } from "../direct-payments/banks";
import type { Classification, OurReading, ProviderReading } from "./extraction/compare";
import { ConstaError, type ConstaErrorCode } from "./failure";
import { ownerId, type ConstaReading, type Owner, type RegisteredAccount } from "./index";
import type { Ask } from "./extraction/ask";
import { amountToCents } from "../money";

/* The reading door (proof-extraction D6): read without spending a
   credit, so a caller can show a customer what was read before money
   moves. Was `POST /extract` while the engine was a service; a function
   since consta-api-merge D2, called by the payment page's `/read` route
   for the business that owns the link. */

/* two-eyes-receipt D2: `illegible` is the sibling of `not_a_receipt` —
   the model could read no field at all, so the file was refused before a
   credit was spent. Countable apart from it, because the two ask the
   payer for different things. */
type Outcome =
  | "passed"
  | "gated"
  | "not_a_receipt"
  | "unreadable"
  | "refused"
  | "routed"
  | "illegible"
  /* receipt-triage D15: the two stops before any credit — a clear reading
     with no key, and one whose destination fits none of the ISP's
     accounts. Recorded by `/read` (the draft) and by the receipt door
     when a client skipped the page; either way with no validation id. */
  | "key_missing"
  | "wrong_destination";

export type ShapeSignals = { shape: ShapeVerdict; suggestedBank: Bank | null };

/* D15/D16 — the shape rules act on a reading, and only on a clave that
   passed the gate: a malformed clave already has a louder answer. The
   suggestion exists only when the reading named no usable bank. */
export async function shapeSignals(db: DrizzleD1Database, result: ExtractionResult): Promise<ShapeSignals> {
  if (result.route !== "reader" || result.gated.gate.trackingKey !== "ok") {
    return { shape: "unknown", suggestedBank: null };
  }
  const { gated } = result;
  const rules = await loadShapeRules(db);
  return {
    shape: checkShape(rules, gated.senderBank, gated.trackingKey),
    suggestedBank: gated.gate.senderBank === "ok" ? null : suggestBank(rules, gated.trackingKey),
  };
}

/* D9 — a rejection at the edge is logged but never billed. Every path out
   of here writes exactly one `extractions` row, including the ones that
   spend nothing: the refusal rate is the number this feature exists to
   drive down, and a rate nobody records is a rate nobody improves.
   consta-api-merge D3: the row is attributed to its owner — the business,
   or NULL for the platform's own top-up. */
export async function recordExtraction(
  db: DrizzleD1Database,
  owner: Owner,
  outcome: Outcome,
  result: ExtractionResult | null,
  extra: {
    validationId?: string | null;
    note?: string;
    signals?: ShapeSignals;
    /* two-eyes-receipt D19: the comparison and the other machine's
       reading, recorded beside our own on the row of the paid call. This
       is what makes "who was right" a row-by-row query instead of a
       reconstruction — and it is the only place a top-up's
       classification lives, since a top-up has no payment row. */
    classification?: Classification | null;
    providerReading?: ProviderReading | null;
    /* Only for the row of a call where nothing was even loaded (no AI
       binding): there is no `ExtractionResult` to read the door from,
       and the row must still say the file went to the provider. */
    source?: "reader" | "provider-ocr";
    /* receipt-triage D21: the proof this row read, so an ask can be
       followed to how it ended */
    proofKey?: string | null;
    /* receipt-reader-tuning D14: the receiving bank against the tied
       account's, from the tie the caller already computed */
    receivingBankTie?: "match" | "mismatch" | null;
    /* receipt-reader-tuning D11: on a row that read nothing because the
       chosen model and then the default both failed */
    fallbackFrom?: string | null;
  } = {},
): Promise<string> {
  const proof = result?.proof ?? null;
  const reading = result?.route === "reader" ? result.reading : null;
  const gated = result?.route === "reader" ? result.gated : null;
  const classification = extra.classification ?? null;

  const [row] = await db
    .insert(extractions)
    .values({
      businessId: ownerId(owner),
      source: extra.source ?? (result?.route === "provider-ocr" ? "provider-ocr" : "reader"),
      outcome,
      model: reading?.model ?? null,
      proofSha256: proof?.sha256 ?? null,
      mediaType: proof?.mediaType ?? null,
      byteSize: proof?.bytes.byteLength ?? null,
      trackingKey: gated?.trackingKey ?? null,
      senderBank: gated?.senderBank ?? null,
      /* Pesos at the model's edge, cents at ours (validation spec D7) —
         by string parsing, never `× 100` (constitution II,
         consta-api-merge D18) */
      amountCents: reading?.amount != null ? amountToCents(reading.amount) : null,
      transferDate: reading?.date ?? null,
      /* bug: spei-date-rollover — the printed time; since bug:
         reference-search-printed-day it no longer picks the search day */
      transferTime: reading?.time ?? null,
      receiptStatus: reading?.status ?? null,
      gateTrackingKey: gated?.gate.trackingKey ?? null,
      gateSenderBank: gated?.gate.senderBank ?? null,
      shape: extra.signals?.shape ?? null,
      suggestedBank: extra.signals?.suggestedBank ?? null,
      /* two-eyes-receipt D2 */
      legibility: reading?.legibility ?? null,
      /* D19: what the comparison decided, and what the provider read */
      readingCheck: classification?.readingCheck ?? null,
      disputedFields: classification?.disputedFields?.length
        ? JSON.stringify(classification.disputedFields)
        : null,
      blindSide: classification?.blindSide ?? null,
      /* `human` is a `payments` value only — a typed correction reads
         nothing, so it never writes a row here (data-model) */
      acceptedFrom: classification?.acceptedFrom ?? null,
      providerTrackingKey: extra.providerReading?.trackingKey ?? null,
      providerAmountCents: extra.providerReading?.amountCents ?? null,
      /* receipt-triage D21: ours as read (gate or no gate — the count of
         folios taken for references needs the rejects too), the
         provider's on the paid call, and what the reading saw as the
         destination. Never the ISP's own accounts. */
      proofKey: extra.proofKey ?? null,
      referenceNumber: reading?.referenceNumber ?? null,
      providerReferenceNumber: extra.providerReading?.referenceNumber ?? null,
      destinationKind: reading?.destination.kind ?? null,
      destinationDigits: reading?.destination.digits ?? null,
      /* receipt-reader-tuning D11, D12: which questions, how long, and
         whether the default read in place of a chosen model that failed.
         `model` above is the model that produced the reading. */
      questionVersion: reading?.questionVersion ?? null,
      readerMs: reading?.ms ?? null,
      fallbackFrom:
        reading?.fallbackFrom ??
        (result?.route === "provider-ocr" ? (result.fallbackFrom ?? null) : null) ??
        extra.fallbackFrom ??
        null,
      /* receipt-reader-tuning D14: both banks, each as read — never one
         changed because of the other (FR-012) */
      receivingBank: gated?.receiving.bank ?? null,
      gateReceivingBank: gated?.receiving.verdict ?? null,
      /* 1 or 0 only when both resolved; NULL when either did not (D14) */
      sameBank:
        gated?.gate.senderBank === "ok" && gated.receiving.verdict === "ok" ? gated.receiving.sameBank : null,
      receivingBankTie: extra.receivingBankTie ?? null,
      /* A row that read nothing says *why* instead of leaving the column
         empty — "handed over unread" is countable by cause (D19). */
      rawOutput:
        reading?.raw ?? extra.note ?? (result?.route === "provider-ocr" ? result.reason : null),
      validationId: extra.validationId ?? null,
    })
    .returning({ id: extractions.id });
  return row.id;
}

/* two-eyes-receipt D14 — the paid attempt reuses the draft's reading.

   Before this feature one Workers AI call served a receipt: the page's
   `/read` read it, and the pay request carried the *reading* as transfer
   data. D13 stopped that — a machine reading now travels as the file
   alone — so without this the engine would read the same bytes a second
   time, ~2.7 s and one call later, to learn what it already knew.

   The match is on the owner and the bytes, never on anything the client
   said (research R8): a `proofId` names a file, and the hash is computed
   on load anyway. Constitution V: the read is owner-scoped like every
   other — a business sees its own rows, the platform's top-ups see the
   NULL-owner ones, and the two never meet.

   The window is the proof link's own lifetime. Past it the payer is
   uploading again anyway, and a reading old enough to have been
   superseded is worth less than a fresh one.

   The `/read` door itself never reuses (R8): a payer re-reading their
   receipt is the flow working, and every row is the measurement. */
const REUSE_WINDOW_MS = PROOF_URL_TTL_MINUTES * 60_000;

export async function recentReading(
  db: DrizzleD1Database,
  owner: Owner,
  proof: LoadedProof,
  now: Date,
): Promise<{ id: string; result: ExtractionResult } | null> {
  const businessId = ownerId(owner);
  const [row] = await db
    .select()
    .from(extractions)
    .where(
      and(
        businessId === null ? isNull(extractions.businessId) : eq(extractions.businessId, businessId),
        eq(extractions.proofSha256, proof.sha256),
        eq(extractions.source, "reader"),
        /* Only rows that actually hold a reading. `gated` counts: since
           D3 a hole does not refuse, it goes to the provider, and the
           fields it *did* read are still worth reusing.
           receipt-triage D28: so do the two new stops — a pay that
           carries the file `/read` just stopped must meet the same stop
           without a second model call. */
        inArray(extractions.outcome, ["passed", "gated", "key_missing", "wrong_destination"]),
        gt(extractions.createdAt, new Date(now.getTime() - REUSE_WINDOW_MS)),
      ),
    )
    .orderBy(desc(extractions.createdAt))
    .limit(1);
  if (!row) return null;

  /* The gate verdicts are the stored ones, not re-derived: the row kept
     what the gate said about each field, and rebuilding them from the
     values it also stored would lose the difference between a field that
     was missing and one that was malformed. */
  const gate: Gate = {
    trackingKey: (row.gateTrackingKey as Gate["trackingKey"]) ?? (row.trackingKey ? "ok" : "missing"),
    senderBank: (row.gateSenderBank as Gate["senderBank"]) ?? (row.senderBank ? "ok" : "missing"),
    /* The amount gate was never stored — it is implied exactly: the
       column holds `amountToCents` of what the model said, and the gate
       calls anything not strictly positive malformed (gate.ts). */
    amount: row.amountCents == null ? "missing" : row.amountCents > 0 ? "ok" : "malformed",
    /* receipt-triage D28: the reference is stored as read, so its verdict
       is re-derived by the gate's own function — rebuilding it any other
       way would silently drop receipt 2's key on the paid attempt */
    referenceNumber: gateReference(row.referenceNumber),
  };
  const gated: GatedReading = {
    gate,
    trackingKey: gate.trackingKey === "ok" ? row.trackingKey : null,
    referenceNumber: gate.referenceNumber === "ok" ? row.referenceNumber!.trim() : null,
    senderBank: gate.senderBank === "ok" ? (row.senderBank as Bank | null) : null,
    amountCents: gate.amount === "ok" ? row.amountCents : null,
    passes: passesGate(gate),
    /* receipt-reader-tuning D15: rebuilt from the stored receiving bank
       through the gate's own function, so the flag is re-derived rather
       than trusted. The stored verdict keeps `unknown` apart from
       `missing`, which the resolved bank alone cannot. */
    receiving: (() => {
      const rebuilt = receivingOf(row.receivingBank, {
        bank: gate.senderBank === "ok" ? (row.senderBank as Bank | null) : null,
        verdict: gate.senderBank,
      });
      return row.gateReceivingBank ? { ...rebuilt, verdict: row.gateReceivingBank } : rebuilt;
    })(),
  };
  const reading: Reading = {
    /* The outcome filter above admits only rows the reader called a
       receipt — `not_a_receipt` and `illegible` never get this far. */
    isReceipt: true,
    legibility: row.legibility,
    trackingKey: row.trackingKey,
    senderBank: row.senderBank,
    /* Cents came out of the model's pesos by string parsing; going back
       is the one division the money law allows, the same one the
       outbound provider call makes (constitution II). */
    amount: row.amountCents == null ? null : row.amountCents / 100,
    date: row.transferDate,
    /* bug: spei-date-rollover */
    time: row.transferTime,
    status: row.receiptStatus,
    /* receipt-triage D28 */
    referenceNumber: row.referenceNumber,
    destination: {
      kind: row.destinationKind ?? null,
      digits: row.destinationDigits ?? null,
    },
    /* The new row says where its reading came from rather than copying a
       raw model answer that was never produced for this call. */
    raw: `reused from extraction ${row.id}`,
    /* receipt-reader-tuning D15: the model and questions that read it —
       a reused reading is never re-read with a newly chosen model (spec
       US1 scenario 6) */
    model: row.model ?? "",
    questionVersion: row.questionVersion ?? "",
    ms: row.readerMs ?? 0,
    fallbackFrom: row.fallbackFrom ?? null,
    /* The stored bank is already resolved; the gate resolves it again */
    receivingBank: row.receivingBank ?? null,
  };
  return { id: row.id, result: { route: "reader", proof, reading, gated } };
}

/* Proof and reader failures, mapped once so both doors answer alike.
   The split is "must the request change?" — a file we cannot find or
   recognise will never work, while a stumbling model may. D19: every
   error says whether waiting can help — the 422/502 HTTP pair the
   service answered with is now the `retryable` flag on the in-process
   failure (consta-api-merge D6), and the law is the same. */
export function extractionFailure(err: unknown): { code: ConstaErrorCode; retryable: boolean } | null {
  if (err instanceof ProofFetchError) return { code: err.code, retryable: false };
  if (err instanceof ReaderError) return { code: err.code, retryable: true };
  return null;
}

export function readingPayload(
  result: ExtractionResult,
  signals: ShapeSignals = { shape: "unknown", suggestedBank: null },
): Omit<ConstaReading, "extractionId"> {
  if (result.route === "provider-ocr") {
    /* Nothing here could read the file (two-eyes-receipt D15): no AI
       binding, a PDF whose text conversion yielded nothing (a scan), or
       a model answer with no JSON in it. A PDF *with* text takes the
       reader branch below and answers like a picture (D1). It used to mean "a PDF, deliberately
       not read here" — D1 retired that case by reading PDFs too.
       Saying so is more useful than inventing empty fields, and the
       caller treats it exactly as it treats a reader that is down. */
    return {
      source: "provider-ocr" as const,
      isReceipt: null,
      trackingKey: null,
      senderBank: null,
      amountCents: null,
      date: null,
      receiptStatus: null,
      gate: {
        trackingKey: "missing" as const,
        senderBank: "missing" as const,
        amount: "missing" as const,
        referenceNumber: "missing" as const,
        shape: "unknown" as const,
      },
      referenceNumber: null,
      destination: { kind: null, digits: null },
      /* receipt-triage FR-015: nothing read, nothing asked */
      ask: null,
      tiedAccount: null,
      /* Nothing here saw the file, so there is no legibility to report
         (two-eyes-receipt D15). The page reads this branch exactly as it
         reads a reader that is down, and never refuses on it. */
      legibility: null,
    };
  }
  const { reading, gated } = result;
  return {
    source: "reader" as const,
    isReceipt: reading.isReceipt,
    /* two-eyes-receipt D2: reported here, acted on by the page — this
       door refuses nobody (FR-004) */
    legibility: reading.legibility,
    trackingKey: gated.trackingKey,
    senderBank: gated.senderBank,
    /* D3: reported, never authoritative. `cepDetails` remains the only
       source of the amount and date that decide money. */
    amountCents: gated.amountCents,
    date: reading.date,
    receiptStatus: reading.status,
    /* D15: a field, never a refusal — the caller decides what a
       mismatch is worth before spending */
    gate: { ...gated.gate, shape: signals.shape },
    /* D16: to confirm, never to send */
    ...(signals.suggestedBank ? { suggestedBank: signals.suggestedBank } : {}),
    /* receipt-triage D12: only a reference the gate passed */
    referenceNumber: gated.referenceNumber,
    destination: reading.destination,
    /* Filled by the caller that holds the accounts (`extract`) */
    ask: null,
    tiedAccount: null,
  };
}

/* receipt-triage D15: the outcome a stop is recorded under */
export function askOutcome(ask: Ask): Outcome | null {
  if (!ask) return null;
  return ask.reason === "no_key" ? "key_missing" : "wrong_destination";
}

export async function extract(
  env: Bindings,
  db: DrizzleD1Database,
  owner: Owner,
  { proofKey, receivingAccounts }: { proofKey: string; receivingAccounts?: RegisteredAccount[] },
): Promise<ConstaReading> {
  let result: ExtractionResult;
  try {
    /* consta-api-merge D7: the bytes come from the product's own bucket.
       receipt-reader-tuning D9: the model is the operator's choice,
       resolved on every reading with no cache (SC-003). */
    result = await extractProof(env, await readProofFromBucket(env.PROOFS, proofKey), await readerPlan(env, db));
  } catch (err) {
    const failure = extractionFailure(err);
    if (!failure) throw err;
    await recordExtraction(db, owner, failure.code === "READER_UNREADABLE" ? "unreadable" : "refused", null, {
      note: `${failure.code}: ${String((err as Error).message)}`,
      proofKey,
      /* receipt-reader-tuning D11: both models failed */
      fallbackFrom: err instanceof ReaderError ? (err.fallbackFrom ?? null) : null,
    });
    throw new ConstaError(failure.code, failure.retryable, String((err as Error).message));
  }

  const signals = await shapeSignals(db, result);
  const payload = readingPayload(result, signals);
  /* receipt-triage D15, D24: the ask and the tie, reported — this door
     never throws on either (it "cannot reject anybody", two-eyes D2); the
     receipt door is what enforces the ask */
  const ask = askBeforeCredit(result, receivingAccounts);
  const tie =
    result.route === "reader" && receivingAccounts?.length
      ? tieDestination(result.reading.destination, receivingAccounts)
      : "unknown";
  /* two-eyes-receipt D2: `illegible` is recorded here too, so the
     refusal rate is countable from one table whichever door met it —
     but this door still throws nobody out (FR-004): it reports what the
     reader said and the *page* refuses. */
  const outcome: Outcome =
    result.route === "provider-ocr"
      ? "routed"
      : !result.reading.isReceipt
        ? "not_a_receipt"
        : result.reading.legibility === "none"
          ? "illegible"
          : (askOutcome(ask) ??
            (result.gated.passes
              ? "passed"
              : "gated"));

  const extractionId = await recordExtraction(db, owner, outcome, result, {
    signals,
    proofKey,
    /* receipt-reader-tuning D14 */
    receivingBankTie: result.route === "reader" ? receivingBankTie(result.gated, tie === "unknown" ? null : tie) : null,
  });
  /* No apiCEP call happened on this path at all — that is the contract
     of this door, not an implementation detail (D6). */
  return {
    extractionId,
    ...payload,
    ask,
    tiedAccount: typeof tie === "object" ? tie.tied : null,
  };
}

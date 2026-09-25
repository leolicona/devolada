import type { DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { extractions, validations } from "../db/schema";
import type { Bindings } from "../env";
import { apiCepProvider } from "./provider/apicep";
import { ProviderFailure, type ReceiptInput, type TransferInput } from "./provider/types";
import {
  askBeforeCredit,
  asBeneficiary,
  extractProof,
  readProofFromBucket,
  tieDestination,
  type ExtractionResult,
  type LoadedProof,
} from "./extraction";
import {
  askOutcome,
  extractionFailure,
  readingPayload,
  recentReading,
  recordExtraction,
  shapeSignals,
  type ShapeSignals,
} from "./extract";
import { checkShape, loadShapeRules, type ShapeVerdict } from "./extraction";
import {
  compareReadings,
  type Classification,
  type OurReading,
  type ProviderReading,
} from "./extraction/compare";
import type { Bank } from "../direct-payments/banks";
import { trustBlock } from "./trust/history";
import { suggestRetryAfter } from "./retry/suggest";
import { validateRequestSchema } from "./request";
import { signedProofUrl } from "../direct-payments/proofs";
import { ConstaError } from "./failure";
import { ownerId, type ConstaRequest, type ConstaVerdict, type Owner, type RegisteredAccount } from "./index";

/* The validation door (validation spec D1): one call, two doors —
   transfer data, or a receipt. Was `POST /validate` while the engine was
   a service; a function since consta-api-merge D2, with the same body
   and every decision it carried. The HTTP envelope it answered with
   became the `ConstaError` it throws (D6). */

/* two-eyes-receipt D3: what the engine read, shaped for the verdict.
   Gated fields only — a field the gate did not pass is null here, so a
   caller can never mistake our misread for a reading (D5). */
function ourReadingPayload(ours: OurReading | null): ConstaVerdict["ourReading"] {
  if (!ours) return null;
  return {
    trackingKey: ours.gate.trackingKey === "ok" ? ours.trackingKey : null,
    senderBank: ours.gate.senderBank === "ok" ? ours.senderBank : null,
    amountCents: ours.gate.amount === "ok" ? ours.amountCents : null,
    date: ours.date,
    legibility: ours.legibility ?? null,
    /* receipt-triage D12 */
    referenceNumber: ours.gate.referenceNumber === "ok" ? ours.referenceNumber : null,
  };
}

/* The classification, shaped for the verdict: the contract carries these
   as optional fields present exactly when a comparison ran (D5), so the
   nulls that mean "not applicable" on the in-memory result are dropped
   rather than travelling as explicit nulls. */
function classificationPayload(c: Classification): Partial<ConstaVerdict> {
  return {
    readingCheck: c.readingCheck,
    disputedFields: c.disputedFields,
    ...(c.blindSide ? { blindSide: c.blindSide } : {}),
    accepted: c.accepted,
    ...(c.acceptedFrom ? { acceptedFrom: c.acceptedFrom } : {}),
  };
}

export async function validate(
  env: Bindings,
  db: DrizzleD1Database,
  owner: Owner,
  request: ConstaRequest,
): Promise<ConstaVerdict> {
  /* consta-api-merge D8: the guard runs first, in-process, before any
     credit. D12/D13: refusing here is the point — a bank name or a
     tracking key that cannot possibly validate must cost a refusal, not
     a credit and a faceless `invalid`. The issues say which field.
     Nothing is written: a refused request never reached the provider.
     (The vocabulary that rode a bank refusal was a door feature for
     integrators; the one caller left imports the same constant.) */
  const parsed = validateRequestSchema.safeParse(request);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    /* D19: every error says whether waiting can help */
    throw new ConstaError("REQUEST_REJECTED", false, issues.map((i) => `${i.path}: ${i.message}`).join("; "), {
      issues,
    });
  }
  const body = parsed.data;

  /* The credential absent in this environment (constitution VIII,
     consta-api-merge D9): the callers gate on `validationAvailable`
     first (automated-collections-api D5 split it out of the old
     `speiAvailable`), so a payer never reaches this; a payment already
     in flight can, and it rides the schedule. Retryable, because the fix is a secret planted,
     and nothing was billed. */
  if (!env.APICEP_TOKEN) {
    throw new ConstaError("PROVIDER_NOT_CONFIGURED", true, "APICEP_TOKEN is not configured");
  }

  const businessId = ownerId(owner);
  const now = new Date();

  /* proof-extraction D1/D2, turned around by two-eyes-receipt D3/D11.

     The receipt door used to read the file here, gate it, and spend the
     first credit on the provider's *transfer* door with our reading — so
     the provider's own eyes arrived only on a second credit a minute
     later, and only after a "not found". Now the file is read here *and*
     sent to the provider's image door on the same first credit: the
     provider's eyes first, ours beside them. When Banxico has nothing
     yet, both readings exist at minute zero and are compared on the spot
     (`extraction/compare.ts`), so the payer is asked only when the two
     machines and the bank's learned clave shape all run out of ways to
     tell (D5–D8).

     Exactly two things still refuse before a credit is spent (D2, FR-004):
     the file is not a receipt at all, and the file cannot be read at all.
     A *hole* no longer refuses (FR-005) — a missing clave used to throw
     `RECEIPT_INCOMPLETE` and send the payer to a form before anything had
     been asked of anybody; now it goes to the provider, whose reading may
     fill it for free. That refusal is what the gate exists for is still
     true of the two that remain: apiCEP cannot tell a caller which field
     was wrong, because a malformed clave, an unknown bank and a transfer
     that never happened are the same faceless `invalid` (D11).

     If the reader is unavailable, or its answer will not parse, the file
     still goes to the provider with an empty reading on our side, and the
     reading record says why (D19): a door that still works beats a 502. */
  let extractionId: string | null = null;
  /* Which door read the file for *this verdict* (D2). The transfer door
     has no file and no source. Every receipt-door call is `provider-ocr`
     now, because the provider's image door is where the credit went —
     what we read rides the verdict separately, as `ourReading` (D3). */
  let source: "reader" | "provider-ocr" | null = body.receipt ? "provider-ocr" : null;
  /* D15: the shape verdict on whatever clave is about to be spent —
     the reader's on the image door, the caller's on the transfer door.
     Null when nothing here read a clave (the provider's OCR route). */
  let shape: ShapeVerdict | null = null;
  /* two-eyes-receipt D3: our reading, gated, kept aside while the
     provider reads the same file. Null when nothing here could read it —
     no binding, a PDF with no text, an answer with no JSON — which is a
     `blind` classification on our side and never a failure (D15). */
  let ours: OurReading | null = null;
  /* The reading record for this call, written once the provider has
     answered so the classification can ride the same row (D19). */
  let extracted: ExtractionResult | null = null;
  let signals: ShapeSignals = { shape: "unknown", suggestedBank: null };
  let reusedFrom: string | null = null;

  /* consta-api-merge D7: the provider gets a short-lived signed link
     (direct-payment D12) only when it must read the file itself — the
     link exists for the provider; the engine's own reader takes the
     bytes from the bucket. Built lazily so the transfer door never
     signs anything. */
  const receiptUrl = async () => signedProofUrl(env, body.receipt!.proofKey, now);

  let input: TransferInput | ReceiptInput = body.transfer
    ? { mode: "transfer", ...body.transfer }
    : {
        mode: "receipt",
        receiptUrl: await receiptUrl(),
        beneficiary: body.beneficiary,
        potentialBeneficiaries: body.potentialBeneficiaries,
      };

  /* `potentialBeneficiaries` is an OCR-mode feature: apiCEP matches the
     image against a list of candidate accounts, and a direct-mode call
     takes exactly one beneficiary. So a caller using it keeps the OCR
     door — that is this spec's answer to its own open question, rather
     than quietly dropping a field from the contract. */
  /* D11: `providerOcr` sends the image to the provider's image door and
     skips our reader — a caller that already holds a reading wants the
     provider's eyes, not a second pass of the same model.
     two-eyes-receipt D16: one caller sets it, the minute-two cross of a
     payment born before the cut-over. Without it the file goes to the
     same image door *and* is read here, which is the flow every new row
     takes (D3), so the flag now means "read nothing here" rather than
     "use the other door". */
  const readable = input.mode === "receipt" && Boolean(body.beneficiary) && !body.providerOcr;
  /* receipt-triage D22/D30: the account the provider call names on the
     receipt door — the caller's `beneficiary` (the cuenta de cobro)
     unless the receipt's own digits name another registered account.
     Reported on the verdict as `beneficiaryUsed`. */
  let beneficiaryUsed: RegisteredAccount | null =
    body.receipt && body.beneficiary ? (body.beneficiary as RegisteredAccount) : null;
  /* What the ask and the tie judge the destination against: the
     payment's registered accounts, or the one beneficiary (a top-up's
     platform CLABE, spec Edge Cases). A legacy row skips both (D27). */
  const accounts: RegisteredAccount[] | null = body.legacy
    ? null
    : ((body.receivingAccounts as RegisteredAccount[] | undefined) ??
      (body.beneficiary ? [body.beneficiary as RegisteredAccount] : null));
  /* With no binding nothing here can read anything, so the bytes are not
     fetched at all — and, importantly, not sniffed either: a file whose
     magic bytes this engine does not recognise still reaches the
     provider on this path, exactly as before (constitution VIII, a door
     that still works). The call is still recorded, without a hash
     (FR-017, D19): a paid call with no reading record at all would be a
     hole in the measurement. */
  if (readable && input.mode === "receipt" && env.AI) {
    let proof: LoadedProof | null = null;
    try {
      proof = await readProofFromBucket(env.PROOFS, body.receipt!.proofKey);
      /* D14: the draft's reading, if the page just made one of this same
         file for this same owner. Saves the second model call that D13
         would otherwise cost — the pay now carries the file, not the
         reading. */
      const reused = await recentReading(db, owner, proof, now);
      if (reused) {
        extracted = reused.result;
        reusedFrom = reused.id;
      } else {
        extracted = await extractProof(env, proof);
      }
    } catch (err) {
      const failure = extractionFailure(err);
      if (!failure) throw err;
      /* D15/FR-005: a reader that is down or answering nonsense is our
         problem, never the payer's. The file goes to the provider anyway,
         with no reading of ours beside it, and the reading record says
         which of the two it was (D19) rather than going missing — a call
         with no row at all is a hole in the measurement. */
      if (proof && (failure.code === "READER_UNAVAILABLE" || failure.code === "READER_UNREADABLE")) {
        console.error(`reader ${failure.code}, going to the provider with no reading of ours`);
        extracted = {
          route: "provider-ocr",
          proof,
          reason: failure.code === "READER_UNAVAILABLE" ? "no-binding" : "unreadable",
        };
      } else {
        /* The *file* is unusable — too large, unrecognised bytes, not in
           the bucket. No provider call can fix that, so it is refused
           here as it always was, and nothing is billed. */
        await recordExtraction(db, owner, "refused", null, {
          note: `${failure.code}: ${String((err as Error).message)}`,
        });
        throw new ConstaError(failure.code, failure.retryable, String((err as Error).message));
      }
    }

    if (extracted && extracted.route === "reader") {
      const { reading, gated } = extracted;
      /* D15/D16: computed once, recorded on every outcome, and blocking
         none of them — a mismatch rides into the paid call below */
      signals = await shapeSignals(db, extracted);
      shape = signals.shape;
      /* The lead case: measured live, an image with no receipt in it
         makes apiCEP answer `error`, which is retryable, so the payment
         rides Devolada's whole six-hour schedule at up to seven paid
         calls. It stops here for the price of one Workers AI call. */
      /* two-eyes-receipt D2: and its sibling — a picture with a receipt
         in it that no field can be read from. Narrowly defined on
         purpose (`reader.ts`): a *partial* legibility goes through with
         its hole, because a wrongly blocked photo costs the payer a step
         while a wrongly passed one costs a credit the comparison may
         still salvage (FR-004, FR-005). */
      if (!reading.isReceipt || reading.legibility === "none") {
        await recordExtraction(
          db,
          owner,
          reading.isReceipt ? "illegible" : "not_a_receipt",
          extracted,
          { signals },
        );
        throw new ConstaError(
          "RECEIPT_UNREADABLE",
          false,
          reading.isReceipt ? "nothing on the receipt could be read" : "the image is not a receipt",
          { reading: readingPayload(extracted, signals) },
        );
      }
      /* receipt-triage D4/D15/D16 — the one narrowing of two-eyes D2/FR-005.
         A clear capture (a `completa` picture, or a PDF's text) that
         shows neither key — a generic reference counting as none — or
         whose destination fits none of the ISP's accounts is stopped
         here, before the provider is paid, exactly as `/read` reported
         it to the page. A client that skipped the page buys nothing. A
         partly legible or unjudged picture, and a malformed clave, still
         go through with their hole (FR-015). A legacy row finishes under
         the flow it started in (D27). */
      if (accounts) {
        const ask = askBeforeCredit(extracted, accounts);
        if (ask) {
          await recordExtraction(db, owner, askOutcome(ask)!, extracted, {
            signals,
            proofKey: body.receipt!.proofKey,
            ...(reusedFrom ? { note: `reused from extraction ${reusedFrom}` } : {}),
          });
          throw ask.reason === "no_key"
            ? new ConstaError("RECEIPT_INCOMPLETE", false, "the receipt shows neither a clave nor a reference", {
                reading: readingPayload(extracted, signals),
                missingFields: ask.fields,
              })
            : new ConstaError(
                "RECEIPT_WRONG_DESTINATION",
                false,
                "the receipt's destination fits none of the business's accounts",
                { reading: readingPayload(extracted, signals) },
              );
        }
        /* receipt-triage D24/D30: the receipt's digits name the account
           the provider is asked about — a registered one other than the
           cuenta de cobro, or a retired one (FR-020a). Unknown — fewer
           than three digits, or two fits — keeps the cuenta de cobro, and
           no credit is spent trying accounts one after another (FR-019). */
        const tie = tieDestination(reading.destination, accounts);
        if (typeof tie === "object") {
          beneficiaryUsed = tie.tied;
          input = { ...input, beneficiary: asBeneficiary(tie.tied) } as ReceiptInput;
        }
      }
      /* two-eyes-receipt D3: the reading no longer *becomes* the request.
         It is kept beside it — the file itself is what the provider gets
         (`input` stays in receipt mode below), and the two readings meet
         after the answer. A hole rides along rather than refusing: the
         provider may read what we could not (FR-005). */
      ours = { ...gated, date: reading.date, legibility: reading.legibility };
    }
  }

  /* The transfer door is where Azteca's credits were actually lost
     (2026-08-30: the dropped trailing I, the I typed as 1 — all
     hand-typed). The verdict rides the response; the call still spends. */
  if (shape === null && input.mode === "transfer" && source === null) {
    shape = checkShape(await loadShapeRules(db), input.senderBank as Bank, input.trackingKey ?? null);
  }

  /* learned-retry D2: the receiving side of the transfer, recorded at
     last — the request always carried it and the log dropped it. A
     receipt matched against a candidate list has no single receiver. */
  const beneficiaryBank =
    input.mode === "transfer" ? input.beneficiary.bank : (input.beneficiary?.bank ?? null);

  /* two-eyes-receipt D5/D19: the comparison, and the one reading record
     this call leaves behind. Written after the provider answers so the
     row carries both readings and what they settled — one row, one
     query, for a business payment and a platform top-up alike. */
  const providerFirst = readable && input.mode === "receipt";
  const recordCall = async (
    validationId: string,
    classification: Classification | null,
    theirs: ProviderReading | null,
  ) => {
    extractionId = await recordExtraction(
      db,
      owner,
      !extracted || extracted.route === "provider-ocr"
        ? "routed"
        : extracted.gated.passes
          ? "passed"
          : "gated",
      extracted,
      {
        signals,
        validationId,
        classification,
        providerReading: theirs,
        /* No `extracted` at all means no binding: nothing was fetched,
           so the row carries no hash — but it exists, it says why, and
           it links to the call it rode on (D19). */
        ...(extracted ? {} : { source: "provider-ocr" as const, note: "no-binding" }),
        /* D14: which draft this reading came from, when it was not read
           again. A note rather than a column — the pair is an audit
           trail, not something any query groups by. */
        ...(reusedFrom ? { note: `reused from extraction ${reusedFrom}` } : {}),
        /* receipt-triage D21 */
        ...(body.receipt ? { proofKey: body.receipt.proofKey } : {}),
      },
    );
  };

  let verdict;
  try {
    verdict = await apiCepProvider(env).validate(input);
  } catch (err) {
    if (err instanceof ProviderFailure) {
      console.error(`provider failure [${err.code}]:`, err.message);
      /* D15 — the log records billed calls, not successful ones. A
         response came back, so apiCEP (probably) charged for it; a row
         with `status: null` is how the invoice stays a SUM over this
         table. No response (network, deadline) → nothing was measured
         → no row. */
      if (err.extra.telemetry) {
        const [row] = await db
          .insert(validations)
          .values({
            businessId,
            mode: input.mode,
            status: null,
            trackingKey: (input.mode === "transfer" ? input.trackingKey : null) ?? null,
            senderBank: input.mode === "transfer" ? input.senderBank : null,
            referenceNumber: input.mode === "transfer" ? (input.referenceNumber ?? null) : null,
            amountCents: input.mode === "transfer" ? input.amountCents : null,
            transferDate: input.mode === "transfer" ? input.date : null,
            beneficiaryBank,
            /* Scenario 12: the envelope-shaped 400 carries the id of a
               call we were billed for — recorded even though it failed */
            providerValidationId: err.extra.providerValidationId ?? null,
            providerHttpStatus: err.extra.telemetry.httpStatus,
            providerMs: err.extra.telemetry.providerMs,
            quotaRemaining: err.extra.telemetry.quotaRemaining,
            /* trust-layer D1: failed rows keep their refs too — a chain
               whose attempts vanish on failure would lie about itself */
            customerRef: body.customerRef ?? null,
            paymentRef: body.paymentRef ?? null,
          })
          .returning({ id: validations.id });

        /* two-eyes-receipt D12: apiCEP's one named OCR failure
           (`status: "error"` with `missingFields`) is not a failure of
           *ours* on a provider-first call — it is the provider saying it
           read nothing. Before this it threw, the lifecycle recorded a
           code and rode the schedule, and nothing ever learned that the
           provider had been blind. Now it is a `not_found` verdict with a
           blind classification: our reading, if complete, takes the
           transfer door at the next slot (FR-013); if not, the payer is
           asked. Semantically honest — the provider found nothing,
           because it read nothing. The billed row above is written
           either way (validation spec D15).

           The legacy `providerOcr` cross keeps throwing: its caller has a
           reading of its own and classifies for itself (D16). */
        if (providerFirst && err.code === "RECEIPT_UNREADABLE") {
          const classification = compareReadings(ours, null, await loadShapeRules(db));
          await recordCall(row.id, classification, null);
          return {
            validationId: row.id,
            ...(source ? { source } : {}),
            ...(extractionId ? { extractionId } : {}),
            ...(shape ? { shape } : {}),
            status: "invalid" as const,
            reason: "not_found" as const,
            hint: "verify_inputs" as const,
            alreadyValidated: false,
            ...(beneficiaryUsed ? { beneficiaryUsed } : {}),
            ourReading: ourReadingPayload(ours),
            ...classificationPayload(classification),
          };
        }

        if (extractionId) {
          await db.update(extractions).set({ validationId: row.id }).where(eq(extractions.id, extractionId));
        }
      }
      /* D9 — the failure says whether waiting can help, so the caller
         stops guessing. The taxonomy that wore an HTTP status on the
         wire (503 rate-limited with Retry-After, 422 when the request
         itself must change, 502 for everything Consta cannot promise
         anything about) is now the code and `retryable` on the
         in-process failure (consta-api-merge D6). */
      throw new ConstaError(err.code, err.retryable, err.message, {
        retryAfter: err.extra.retryAfter ?? null,
        hint: err.extra.hint ?? null,
        missingFields: err.extra.missingFields ?? null,
      });
    }
    throw err;
  }

  /* Append-only log (spec D6): the row is the billable event */
  const [row] = await db
    .insert(validations)
    .values({
      businessId,
      mode: input.mode,
      status: verdict.status,
      reason: verdict.reason,
      alreadyValidated: verdict.alreadyValidated,
      trackingKey: (input.mode === "transfer" ? input.trackingKey : verdict.cep?.trackingKey) ?? null,
      /* proof-extraction D13: the pair (bank, clave) is what per-bank
         clave shape is derived from, and only `valid` rows count */
      senderBank: (input.mode === "transfer" ? input.senderBank : verdict.cep?.senderBank) ?? null,
      referenceNumber: input.mode === "transfer" ? (input.referenceNumber ?? null) : null,
      amountCents: (input.mode === "transfer" ? input.amountCents : verdict.cep?.amountCents) ?? null,
      transferDate: (input.mode === "transfer" ? input.date : verdict.cep?.date) ?? null,
      beneficiaryBank,
      providerValidationId: verdict.providerValidationId,
      cepStatus: verdict.cepStatus,
      /* D14: cost and latency ride every row. `providerMs` on a
         faceless `invalid` is the one clue whether Banxico was ever
         asked (1–2 s early fail vs 6–7 s real lookup). */
      providerHttpStatus: verdict.telemetry.httpStatus,
      providerMs: verdict.telemetry.providerMs,
      quotaRemaining: verdict.telemetry.quotaRemaining,
      /* trust-layer D1: the refs, stored verbatim */
      customerRef: body.customerRef ?? null,
      paymentRef: body.paymentRef ?? null,
    })
    .returning({ id: validations.id });

  /* two-eyes-receipt D5: the comparison, at minute zero.

     It runs on exactly one answer — `not_found`, the faceless `invalid`
     that means Banxico has nothing under that record *yet*. That is the
     answer the payer used to wait six hours behind, and the one where a
     second reading is worth something: `valid` needs no second opinion
     (the CEP decided), `pending` and `contradicted` are Banxico's own
     word, and the transfer door read no image at all. */
  const classification =
    providerFirst && verdict.status === "invalid" && verdict.reason === "not_found"
      ? compareReadings(ours, verdict.reading ?? null, await loadShapeRules(db))
      : null;

  /* D8: tie the reading to the paid call it bought, so the audit trail
     runs both ways — from a verdict back to what was read, and from a
     reading forward to what it cost. On a provider-first call the row is
     written here rather than before the call, so it can carry both
     readings and what they settled on one line (D19). */
  if (providerFirst) {
    await recordCall(row.id, classification, verdict.reading ?? null);
  } else if (extractionId) {
    await db
      .update(extractions)
      .set({ validationId: row.id })
      .where(eq(extractions.id, extractionId));
  }

  /* trust-layer D5: the payer's measured history rides the verdicts
     where the caller is deciding whether to wait — pending and the
     faceless not_found — and only when the caller named the payer.
     Never on valid (redundant) or contradicted (a real DEVUELTO is
     not bridged by history). The row just written belongs to the
     chain in flight, which D3 excludes from its own evidence.
     consta-api-merge D3: history is per business; the platform's own
     top-ups name no payer and get no block. */
  const wantsTrust =
    body.customerRef &&
    businessId !== null &&
    (verdict.status === "pending" ||
      (verdict.status === "invalid" && verdict.reason === "not_found"));
  const trust = wantsTrust
    ? await trustBlock(
        db,
        businessId!,
        body.customerRef!,
        {
          paymentRef: body.paymentRef ?? null,
          trackingKey:
            (input.mode === "transfer" ? input.trackingKey : verdict.cep?.trackingKey) ?? null,
        },
        new Date(),
      )
    : null;

  /* learned-retry D1/D3: the moment when asking again stops being
     spending in vain, on exactly the verdicts where the caller is
     deciding when to ask again. Omitted in cold start and past the
     learned range — silence, never a guess (D5). Rides the same
     verdicts as the trust block, and for the same reason. */
  const retryAfter =
    verdict.status === "pending" ||
    (verdict.status === "invalid" && verdict.reason === "not_found")
      ? await suggestRetryAfter(db, {
          trackingKey:
            (input.mode === "transfer" ? input.trackingKey : verdict.cep?.trackingKey) ?? null,
          senderBank:
            (input.mode === "transfer" ? input.senderBank : verdict.cep?.senderBank) ?? null,
          beneficiaryBank,
          /* D4 rule 2: the elapsed anchor counts only attempts that
             asked with these same inputs */
          amountCents: input.mode === "transfer" ? input.amountCents : null,
          transferDate: input.mode === "transfer" ? input.date : null,
          now: new Date(),
        })
      : null;

  return {
    validationId: row.id,
    /* D2, so a caller can see which door actually read the file */
    ...(source ? { source } : {}),
    ...(extractionId ? { extractionId } : {}),
    /* D15: a field, never a refusal */
    ...(shape ? { shape } : {}),
    status: verdict.status,
    /* D11: `invalid` alone is not enough for the caller to act on.
       `not_found` is ambiguous by construction, so it travels with
       the only advice that is always true for it — and never with a
       licence to tell a customer their transfer does not exist. */
    ...(verdict.reason ? { reason: verdict.reason } : {}),
    ...(verdict.reason === "not_found" ? { hint: "verify_inputs" as const } : {}),
    /* learned-retry D1: a suggestion, never a promise — the caller's
       own schedule remains the floor and the tail */
    ...(retryAfter ? { retryAfter } : {}),
    /* D18: `contradicted` says which way when Banxico said it —
       "DEVUELTO" lets a caller tell its customer "your bank returned
       the transfer" instead of a generic mismatch. Banxico's word
       about the payer's own transfer, so nothing foreign leaks. */
    ...(verdict.reason === "contradicted" && verdict.cepStatus ? { cepStatus: verdict.cepStatus } : {}),
    alreadyValidated: verdict.alreadyValidated,
    /* receipt-triage FR-006: the flag as answered, null included */
    previouslyValidated: verdict.previouslyValidated,
    /* receipt-triage D22/D30: on the receipt door only */
    ...(beneficiaryUsed ? { beneficiaryUsed } : {}),
    ...(verdict.cep ? { cep: verdict.cep } : {}),
    /* D11: the provider's reading — a reading, never a verdict. It
       survives failure (measured 2026-08-26), which is exactly when a
       caller comparing readings needs it. */
    ...(verdict.reading ? { reading: verdict.reading } : {}),
    /* two-eyes-receipt D3: ours beside theirs, on every provider-first
       call — so a caller can show what was read and the measurement can
       ask "who was right" (D10). */
    ...(providerFirst ? { ourReading: ourReadingPayload(ours) } : {}),
    /* D5–D8: present exactly when the two readings were compared */
    ...(classification ? classificationPayload(classification) : {}),
    ...(verdict.downloads ? { downloads: verdict.downloads } : {}),
    ...(trust ? { trust } : {}),
  };
}

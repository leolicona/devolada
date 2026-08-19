import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { validations } from "../../db/schema";
import { requireApiKey } from "../../auth/api-key";
import { apiCepProvider } from "../../provider/apicep";
import { ProviderError, type ReceiptInput, type TransferInput } from "../../provider/types";
import type { Bindings, Variables } from "../../env";
import { BANKS } from "../../provider/banks";
import { extractions } from "../../db/schema";
import { extractProof, type ExtractionResult } from "../../extraction";
import { extractionFailure, readingPayload, recordExtraction } from "../extract";
import { validateRequestSchema } from "./schema";

export const validateRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

validateRoute.post(
  "/",
  requireApiKey,
  zValidator("json", validateRequestSchema, (result, c) => {
    if (result.success) return;
    /* D12/D13: refusing here is the point — a bank name or a tracking key
       that cannot possibly validate must cost a 400, not a credit and a
       faceless `invalid`. The issues say which field; a bank error also
       carries the vocabulary, because it is the one value a caller cannot
       guess and should not need a second round trip to learn. */
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const bankIssue = result.error.issues.some((i) => {
      const field = i.path[i.path.length - 1];
      return field === "bank" || field === "senderBank";
    });
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          issues,
          ...(bankIssue ? { acceptedBanks: BANKS } : {}),
        },
      },
      400,
    );
  }),
  async (c) => {
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const apiKeyId = c.get("apiKey").id;

    let input: TransferInput | ReceiptInput = body.transfer
      ? { mode: "transfer", ...body.transfer }
      : {
          mode: "receipt",
          receiptUrl: body.receiptUrl!,
          beneficiary: body.beneficiary,
          potentialBeneficiaries: body.potentialBeneficiaries,
        };

    /* proof-extraction D1/D2: an image is read here and validated through
       the direct door; a PDF goes to the provider's OCR untouched. Every
       refusal below spends no credit, which is the entire point — apiCEP
       cannot tell a caller which field was wrong, because a malformed
       clave, an unknown bank and a transfer that never happened are the
       same faceless `invalid` (D11). Here we can, before paying.

       If the reader is unavailable the image falls through to the OCR
       door rather than failing: a door that still works beats a 502. */
    let extractionId: string | null = null;
    /* Which door actually read the file (D2). The transfer door has no
       file and no source; the receipt door always has one, and the PDF
       route has an extraction row *and* still belongs to the provider. */
    let source: "reader" | "provider-ocr" | null = input.mode === "receipt" ? "provider-ocr" : null;
    /* `potentialBeneficiaries` is an OCR-mode feature: apiCEP matches the
       image against a list of candidate accounts, and a direct-mode call
       takes exactly one beneficiary. So a caller using it keeps the OCR
       door — that is this spec's answer to its own open question, rather
       than quietly dropping a field from the contract. */
    const readable = input.mode === "receipt" && Boolean(body.beneficiary);
    if (readable && input.mode === "receipt" && c.env.AI) {
      let extracted: ExtractionResult;
      try {
        extracted = await extractProof(c.env, input.receiptUrl);
      } catch (err) {
        const failure = extractionFailure(err);
        if (!failure) throw err;
        if (failure.code === "READER_UNAVAILABLE") {
          console.error("reader unavailable, falling back to provider OCR");
          extracted = null as unknown as ExtractionResult;
        } else {
          await recordExtraction(
            db,
            apiKeyId,
            failure.code === "READER_UNREADABLE" ? "unreadable" : "refused",
            null,
            { note: `${failure.code}: ${String((err as Error).message)}` },
          );
          return c.json(
            { success: false, error: { code: failure.code, retryable: failure.status === 502 } },
            failure.status,
          );
        }
      }

      if (extracted && extracted.route === "reader") {
        const { reading, gated } = extracted;
        /* The lead case: measured live, an image with no receipt in it
           makes apiCEP answer `error`, which is retryable, so the payment
           rides Devolada's whole six-hour schedule at up to seven paid
           calls. It stops here for the price of one Workers AI call. */
        if (!reading.isReceipt) {
          await recordExtraction(db, apiKeyId, "not_a_receipt", extracted);
          return c.json(
            { success: false, error: { code: "RECEIPT_UNREADABLE", retryable: false, ...readingPayload(extracted) } },
            422,
          );
        }
        if (!gated.passes) {
          await recordExtraction(db, apiKeyId, "gated", extracted);
          return c.json(
            { success: false, error: { code: "RECEIPT_INCOMPLETE", retryable: false, ...readingPayload(extracted) } },
            422,
          );
        }
        extractionId = await recordExtraction(db, apiKeyId, "passed", extracted);
        source = "reader";
        /* D3: the reading chose *which* Banxico record to ask about. It
           never decides whether that record pays a debt — amount and date
           still come from `cepDetails` alone. */
        input = {
          mode: "transfer",
          date: reading.date ?? new Date().toISOString().slice(0, 10),
          /* The amount apiCEP needs is a *search criterion*, and the one
             printed on the receipt is the right one to search with: it is
             what makes a $1 receipt against a $514 debt come back with a
             real CEP for $1, which the caller then refuses (direct-payment
             D11). Sending the caller's expected amount instead would turn
             that into a faceless `not_found` and a six-hour wait. */
          amountCents: gated.amountCents!,
          senderBank: gated.senderBank!,
          trackingKey: gated.trackingKey!,
          beneficiary: body.beneficiary!,
        };
      } else if (extracted) {
        extractionId = await recordExtraction(db, apiKeyId, "routed", extracted);
      }
    }

    let verdict;
    try {
      verdict = await apiCepProvider(c.env).validate(input);
    } catch (err) {
      if (err instanceof ProviderError) {
        console.error("provider error:", err.message);
        return c.json({ success: false, error: { code: "PROVIDER_ERROR" } }, 502);
      }
      throw err;
    }

    /* Append-only log (spec D6): the row is the billable event */
    const [row] = await db
      .insert(validations)
      .values({
        apiKeyId,
        mode: input.mode,
        status: verdict.status,
        reason: verdict.reason,
        alreadyValidated: verdict.alreadyValidated,
        trackingKey: (input.mode === "transfer" ? input.trackingKey : verdict.cep?.trackingKey) ?? null,
        referenceNumber: input.mode === "transfer" ? (input.referenceNumber ?? null) : null,
        amountCents: (input.mode === "transfer" ? input.amountCents : verdict.cep?.amountCents) ?? null,
        transferDate: (input.mode === "transfer" ? input.date : verdict.cep?.date) ?? null,
        providerValidationId: verdict.providerValidationId,
        cepStatus: verdict.cepStatus,
      })
      .returning({ id: validations.id });

    /* D8: tie the reading to the paid call it bought, so the audit trail
       runs both ways — from a verdict back to what was read, and from a
       reading forward to what it cost. */
    if (extractionId) {
      await db
        .update(extractions)
        .set({ validationId: row.id })
        .where(eq(extractions.id, extractionId));
    }

    return c.json({
      success: true,
      data: {
        validationId: row.id,
        /* D2, so a caller can see which door actually read the file */
        ...(source ? { source } : {}),
        ...(extractionId ? { extractionId } : {}),
        status: verdict.status,
        /* D11: `invalid` alone is not enough for the caller to act on.
           `not_found` is ambiguous by construction, so it travels with
           the only advice that is always true for it — and never with a
           licence to tell a customer their transfer does not exist. */
        ...(verdict.reason ? { reason: verdict.reason } : {}),
        ...(verdict.reason === "not_found" ? { hint: "verify_inputs" } : {}),
        alreadyValidated: verdict.alreadyValidated,
        ...(verdict.cep ? { cep: verdict.cep } : {}),
        ...(verdict.downloads ? { downloads: verdict.downloads } : {}),
      },
    });
  },
);

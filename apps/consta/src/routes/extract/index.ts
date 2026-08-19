import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { extractions } from "../../db/schema";
import { requireApiKey } from "../../auth/api-key";
import {
  extractProof,
  ProofFetchError,
  ReaderError,
  type ExtractionResult,
} from "../../extraction";
import type { Bindings, Variables } from "../../env";
import { extractRequestSchema } from "./schema";

export const extractRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

type Outcome = "passed" | "gated" | "not_a_receipt" | "unreadable" | "refused" | "routed";

/* D9 — a rejection at the edge is logged but never billed. Every path out
   of here writes exactly one `extractions` row, including the ones that
   spend nothing: the refusal rate is the number this feature exists to
   drive down, and a rate nobody records is a rate nobody improves. */
export async function recordExtraction(
  db: DrizzleD1Database,
  apiKeyId: string,
  outcome: Outcome,
  result: ExtractionResult | null,
  extra: { validationId?: string | null; note?: string } = {},
): Promise<string> {
  const proof = result?.proof ?? null;
  const reading = result?.route === "reader" ? result.reading : null;
  const gated = result?.route === "reader" ? result.gated : null;

  const [row] = await db
    .insert(extractions)
    .values({
      apiKeyId,
      source: result?.route === "provider-ocr" ? "provider-ocr" : "reader",
      outcome,
      model: reading?.model ?? null,
      proofSha256: proof?.sha256 ?? null,
      mediaType: proof?.mediaType ?? null,
      byteSize: proof?.bytes.byteLength ?? null,
      trackingKey: gated?.trackingKey ?? null,
      senderBank: gated?.senderBank ?? null,
      /* Pesos at the model's edge, cents at ours (validation spec D7) */
      amountCents: reading?.amount != null ? Math.round(reading.amount * 100) : null,
      transferDate: reading?.date ?? null,
      receiptStatus: reading?.status ?? null,
      gateTrackingKey: gated?.gate.trackingKey ?? null,
      gateSenderBank: gated?.gate.senderBank ?? null,
      rawOutput: reading?.raw ?? extra.note ?? null,
      validationId: extra.validationId ?? null,
    })
    .returning({ id: extractions.id });
  return row.id;
}

/* Fetch and reader failures, mapped once so both doors answer alike.
   The split is "must the request change?" — a URL we refuse or a file we
   cannot recognise will never work, while an unreachable host and a
   stumbling model may. */
export function extractionFailure(err: unknown): { code: string; status: 422 | 502 } | null {
  if (err instanceof ProofFetchError) {
    return err.code === "PROOF_UNREACHABLE"
      ? { code: err.code, status: 502 }
      : { code: err.code, status: 422 };
  }
  if (err instanceof ReaderError) return { code: err.code, status: 502 };
  return null;
}

export function readingPayload(result: ExtractionResult) {
  if (result.route === "provider-ocr") {
    /* A PDF was fetched and recognised, and deliberately not read here
       (D2). Saying so is more useful than inventing empty fields. */
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
      },
    };
  }
  const { reading, gated } = result;
  return {
    source: "reader" as const,
    isReceipt: reading.isReceipt,
    trackingKey: gated.trackingKey,
    senderBank: gated.senderBank,
    /* D3: reported, never authoritative. `cepDetails` remains the only
       source of the amount and date that decide money. */
    amountCents: gated.amountCents,
    date: reading.date,
    receiptStatus: reading.status,
    gate: gated.gate,
  };
}

extractRoute.post(
  "/",
  requireApiKey,
  zValidator("json", extractRequestSchema, (result, c) => {
    if (result.success) return;
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      400,
    );
  }),
  async (c) => {
    const { receiptUrl } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const apiKeyId = c.get("apiKey").id;

    let result: ExtractionResult;
    try {
      result = await extractProof(c.env, receiptUrl);
    } catch (err) {
      const failure = extractionFailure(err);
      if (!failure) throw err;
      await recordExtraction(db, apiKeyId, failure.code === "READER_UNREADABLE" ? "unreadable" : "refused", null, {
        note: `${failure.code}: ${String((err as Error).message)}`,
      });
      return c.json({ success: false, error: { code: failure.code, retryable: failure.status === 502 } }, failure.status);
    }

    const payload = readingPayload(result);
    const outcome: Outcome =
      result.route === "provider-ocr"
        ? "routed"
        : !result.reading.isReceipt
          ? "not_a_receipt"
          : result.gated.passes
            ? "passed"
            : "gated";

    const extractionId = await recordExtraction(db, apiKeyId, outcome, result);
    /* No apiCEP call happened on this path at all — that is the contract
       of this endpoint, not an implementation detail (D6). */
    return c.json({ success: true, data: { extractionId, ...payload } });
  },
);

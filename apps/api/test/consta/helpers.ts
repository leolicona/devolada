import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { extractions, validations } from "../../src/db/schema";
import type { Bindings } from "../../src/env";
import { fakeProofs, seedBusiness } from "../helpers";

/* The engine's test scaffolding, moved in with the engine
   (consta-api-merge D12): the same fixtures the standalone suite used,
   minus the API key it seeded — every engine test seeds a real business
   row instead, because `validations.business_id` is a foreign key and
   the business is the tenant identity now (D3). */

export { extractions, validations, seedBusiness, fakeProofs };

export const db = () => drizzle(env.DB);

/* The engine's env for a test: the pinned provider origin and token from
   vitest.config.ts, plus an in-memory proof bucket. `AI` is bound per
   test through `aiReturning` — the reader is the one binding tests stand
   in for (constitution IV). */
export function engineEnv(overrides: Partial<Bindings> = {}): Bindings {
  return { ...(env as unknown as Bindings), PROOFS: fakeProofs(), ...overrides };
}

/* A business to own the rows. Returns its id twice under the names the
   moved tests already use — `key` was the API key's plaintext, `id` the
   row every assertion filtered on. Both are the business id now. */
export async function seedOwner() {
  /* A unique email per owner: the isolation tests seed two businesses,
     and `businesses.email` (and the auth user behind it) are unique */
  const business = await seedBusiness({ email: `owner-${crypto.randomUUID().slice(0, 8)}@devolada.test` });
  return { id: business.id, key: business.id, business };
}

/* The log, seeded straight in — the trust block, the shape rules and the
   retry cells are arithmetic over it, so the log is the fixture. NULL
   owner is the platform's own top-up (D3). Chunked inserts: D1 bounds the
   parameters per statement. */
export async function seedValidations(
  businessId: string | null,
  rows: Omit<typeof validations.$inferInsert, "businessId">[],
) {
  for (let i = 0; i < rows.length; i += 10) {
    await db()
      .insert(validations)
      .values(rows.slice(i, i + 10).map((r) => ({ ...r, businessId })));
  }
}

/* consta-api-merge D7: the engine reads proofs from the bucket, so the
   bytes have to be put there in tests too. */
export async function putProof(bucket: R2Bucket, key: string, bytes: Uint8Array, contentType = "application/octet-stream") {
  await bucket.put(key, bytes, { httpMetadata: { contentType } });
}

/* proof-extraction D7: routing follows magic bytes, so the fixtures only
   need to carry the right first few. The rest is padding — no test here
   asserts anything about image content, because nothing in Consta reads
   it: the model does, and the model is stubbed. */
const pad = (head: number[], size = 64): Uint8Array => {
  const out = new Uint8Array(size);
  out.set(head);
  return out;
};

export const PNG = (size = 64) => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], size);
export const JPEG = (size = 64) => pad([0xff, 0xd8, 0xff, 0xe0], size);
export const PDF = (size = 64) => pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], size);
export const NOT_A_FILE = (size = 64) => pad([0x00, 0x01, 0x02, 0x03], size);

/* The reader, stubbed. Measured 2026-08-19: the real model answers with
   its JSON inside a ```json fence every single time, so the stub does
   too — a fixture that is tidier than reality tests a parser we do not
   ship. */
export const fenced = (obj: unknown) => "```json\n" + JSON.stringify(obj, null, 2) + "\n```";

export type StubbedReading = {
  esComprobante?: boolean;
  /* two-eyes-receipt D2: the model's own word on the picture, in the
     Spanish the prompt asks in. Omitted is the common case and reads as
     `full` — the bias is to let files through (FR-005). */
  legibilidad?: "completa" | "parcial" | "nula";
  claveDeRastreo?: string | null;
  banco?: string | null;
  monto?: number | null;
  fecha?: string | null;
  estatus?: string | null;
};

/* two-eyes-receipt D1/D15: what the PDF-to-text conversion would return
   for a receipt, seeded rather than converted. The binding is the one
   thing a test stands in for (constitution IV), and that covers both of
   its doors — `run` for the reading and `toMarkdown` for the text. The
   shape is a real es-MX comprobante's: labelled lines, the clave on its
   own, the amount with its currency. */
export const RECEIPT_TEXT = `Comprobante de transferencia SPEI

Banco: BBVA
Clave de rastreo: MBAN01002608190001234567
Monto: $1,250.00 MXN
Fecha de operación: 2026-08-19
Estatus: Liquidado
Beneficiario: DEVOLADA SA DE CV`;

/* `pdfText` seeds what `toMarkdown` returns: receipt text for a text
   PDF, and the empty string for a scanned one (D15) — the case where
   the conversion succeeds and there is simply nothing in it to read.
   Both go through `format: "markdown"`, because that is what the real
   binding answers; a conversion that *fails* is a separate test that
   makes the stub throw. */
export function aiReturning(
  reading: StubbedReading | string,
  calls?: unknown[],
  opts: { pdfText?: string } = {},
): Ai {
  return {
    run: async (model: string, input: unknown) => {
      calls?.push({ model, input });
      return { response: typeof reading === "string" ? reading : fenced(reading) };
    },
    toMarkdown: async (files: unknown) => {
      calls?.push({ toMarkdown: files });
      const one = Array.isArray(files) ? files : [files];
      return one.map((f) => ({
        name: (f as { name?: string })?.name ?? "receipt.pdf",
        mimeType: "application/pdf",
        format: "markdown",
        tokens: 0,
        data: opts.pdfText ?? "",
      }));
    },
  } as unknown as Ai;
}

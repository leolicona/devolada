import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { validations } from "../../db/schema";
import { requireApiKey } from "../../auth/api-key";
import { apiCepProvider } from "../../provider/apicep";
import { ProviderError, type ReceiptInput, type TransferInput } from "../../provider/types";
import type { Bindings, Variables } from "../../env";
import { validateRequestSchema } from "./schema";

export const validateRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

validateRoute.post(
  "/",
  requireApiKey,
  zValidator("json", validateRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
    }
  }),
  async (c) => {
    const body = c.req.valid("json");
    const input: TransferInput | ReceiptInput = body.transfer
      ? { mode: "transfer", ...body.transfer }
      : {
          mode: "receipt",
          receiptUrl: body.receiptUrl!,
          beneficiary: body.beneficiary,
          potentialBeneficiaries: body.potentialBeneficiaries,
        };

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
    const db = drizzle(c.env.DB);
    const [row] = await db
      .insert(validations)
      .values({
        apiKeyId: c.get("apiKey").id,
        mode: input.mode,
        status: verdict.status,
        alreadyValidated: verdict.alreadyValidated,
        trackingKey: (input.mode === "transfer" ? input.trackingKey : verdict.cep?.trackingKey) ?? null,
        referenceNumber: input.mode === "transfer" ? (input.referenceNumber ?? null) : null,
        amountCents: (input.mode === "transfer" ? input.amountCents : verdict.cep?.amountCents) ?? null,
        transferDate: (input.mode === "transfer" ? input.date : verdict.cep?.date) ?? null,
        providerValidationId: verdict.providerValidationId,
        cepStatus: verdict.cepStatus,
        confidence: verdict.confidence,
      })
      .returning({ id: validations.id });

    return c.json({
      success: true,
      data: {
        validationId: row.id,
        status: verdict.status,
        alreadyValidated: verdict.alreadyValidated,
        /* Always present, nullable (D9): an integrator deciding whether a
           verdict is trustworthy should not have to distinguish "absent"
           from "unreadable" */
        confidence: verdict.confidence,
        ...(verdict.cep ? { cep: verdict.cep } : {}),
        ...(verdict.downloads ? { downloads: verdict.downloads } : {}),
      },
    });
  },
);

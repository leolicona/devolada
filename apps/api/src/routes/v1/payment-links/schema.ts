import { z } from "zod";
import { v1Notice } from "../envelope";

/* The link contract of the public collections API (contracts/public-api.md,
   automated-collections-api US1). THE contract (constitution III): the
   handler produces it, the panel's MSW handlers and the Playwright stubs
   validate against it, and nothing here names a subscriber, a service, a
   router or WispHub (FR-028). Money is integer cents, time is ms. */

export const LINK_MODES = ["reusable", "one_time"] as const;
export const LINK_STATES = ["open", "paid", "expired"] as const;

/* The caller's own identifier: stored and echoed, never interpreted
   (data-model: no api_customers table on purpose). Trimmed so a pasted
   trailing space cannot split one customer into two reusable links. */
const customerRef = z.string().trim().min(1).max(128);

/* FR-010: whole cents, positive. `int()` refuses 499.5 and a decimal
   string alike; a caller that sends pesos gets a VALIDATION_ERROR
   naming the field rather than a link asking for 5 pesos. */
const askCents = z.number().int().positive();

/* POST /v1/payment-links */
export const createPaymentLinkRequest = z
  .object({
    customerRef,
    askCents,
    mode: z.enum(LINK_MODES).default("reusable"),
    /* ms epoch. Required for one_time, forbidden for reusable (FR-027):
       a reusable link never expires, so a deadline on one is a mistake
       worth refusing rather than ignoring. Not required to be in the
       future — a link born expired is a legitimate way to close a door. */
    expiresAt: z.number().int().positive().optional(),
    /* FR-006: what the payer sees — a display name and a description */
    label: z.string().trim().min(1).max(120).optional(),
    concept: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.mode === "one_time" && body.expiresAt === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "expiresAt is required for a one_time link" });
    }
    if (body.mode === "reusable" && body.expiresAt !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "a reusable link never expires; omit expiresAt" });
    }
  });

/* PATCH /v1/payment-links/:id (FR-030): re-price, or close. One or the
   other must be present — an empty patch is a request that asks for
   nothing, and answering it with the link would hide a caller's bug. */
export const patchPaymentLinkRequest = z
  .object({
    askCents: askCents.optional(),
    close: z.literal(true).optional(),
  })
  .refine((body) => body.askCents !== undefined || body.close !== undefined, {
    message: "send askCents to re-price or close: true to close",
  });

/* GET /v1/payment-links?customerRef= */
export const listPaymentLinksQuery = z.object({
  customerRef,
});

export const paymentLink = z.object({
  id: z.string(),
  /* The payer's page — what the caller puts in its own message */
  url: z.string().url(),
  customerRef: z.string(),
  askCents: z.number().int().positive(),
  mode: z.enum(LINK_MODES),
  /* null on a reusable link */
  expiresAt: z.number().int().nullable(),
  /* Derived from closed_at and expires_at, never stored (research D3) */
  state: z.enum(LINK_STATES),
  /* When it stopped accepting payments — set by the paying transfer or
     by the caller's `close`; null while open and forever on reusable */
  closedAt: z.number().int().nullable(),
  label: z.string().nullable(),
  concept: z.string().nullable(),
  isTest: z.boolean(),
  createdAt: z.number().int(),
  /* FR-009: empty unless a platform condition applies — Devolada's own
     validation unavailable in this environment. Never the business's to
     fix, never a refusal. */
  notices: z.array(v1Notice),
});

export const paymentLinkList = z.object({
  links: z.array(paymentLink),
});

export type CreatePaymentLinkRequest = z.infer<typeof createPaymentLinkRequest>;
export type PatchPaymentLinkRequest = z.infer<typeof patchPaymentLinkRequest>;
export type PaymentLink = z.infer<typeof paymentLink>;
export type PaymentLinkList = z.infer<typeof paymentLinkList>;

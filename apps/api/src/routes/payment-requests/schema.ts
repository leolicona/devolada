import { z } from "zod";
import { CUSTOMERS_LIMIT_DEFAULT, CUSTOMERS_LIMIT_MAX, CUSTOMERS_LIMIT_MIN } from "../direct-payments/schema";

/* Shareable contract (constitution III): the admin derives its types
   from these schemas, and MSW handlers and Playwright stubs validate
   their fixtures with them.

   cobros-in-links D1: the business's open invoices, served in BLOCKS —
   the Por cobrar view inside Links. The path is unchanged; the contract
   breaks on purpose, and only the admin consumes it. Every field speaks
   the core's words and names no provider (constitution IX, D18). */

/* D4: the block size is the Links rule — the client asks for what fills
   its viewport and the server clamps it to the same band, reused rather
   than copied. `cursor` is opaque (D2): absent means the first block. */
export const receivablesQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .default(CUSTOMERS_LIMIT_DEFAULT)
    .transform((n) => Math.min(CUSTOMERS_LIMIT_MAX, Math.max(CUSTOMERS_LIMIT_MIN, n))),
  cursor: z.string().optional(),
});

export const cobroRow = z.object({
  /* The integration's invoice id — the only id there is: Devolada
     stores nothing (cobros-live D6) */
  externalId: z.number().int(),
  customerUsuario: z.string(),
  /* Null when the integration omits it — the UI falls back to the usuario */
  customerName: z.string().nullable(),
  amountCents: z.number().int(),
  /* YYYY-MM-DD, or null when the row lacks the field */
  invoiceDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  /* cobros-in-links D5, FR-006: what the row's expansion shows — what
     this period bills, the part carried from before (*saldo anterior*)
     and the period in the integration's words. Null when the
     integration does not say, never a zero stand-in. */
  periodCents: z.number().int().nullable(),
  carriedCents: z.number().int().nullable(),
  period: z.string().nullable(),
  /* links-on-demand-search D16: no `linkUrl` and no `waLink`. Both
     buttons press `POST /direct-payments/links`, the act, which reads
     the customer fresh and carries their number, so WhatsApp opens
     their own chat (FR-025, FR-026, FR-028). */
});

export const paymentRequestsResponse = z.object({
  /* One row per invoice, in the integration's order. The client groups
     them by customer across the blocks it has loaded (D6). */
  results: z.array(cobroRow),
  /* Opaque (D2). Null when the walk has ended, or when `integration` is
     `unavailable`. */
  nextCursor: z.string().nullable(),
  /* The integration's own count of open invoices in the window, or null
     when it does not report one — the page then says nothing rather
     than print a guess (FR-007) */
  total: z.number().int().nullable(),
  /* D7: the integration being away is an ANSWER. `unavailable` with no
     rows is "could not read", never "nobody has an open invoice" —
     that is `ok` with no rows and no cursor (FR-012, SC-004). */
  integration: z.enum(["ok", "unavailable"]),
  /* cobros-in-links D1, D16: `cobros`, `complete` and `readAt` are GONE.
     `complete` meant "the whole list was cut short", and nothing is read
     whole any more. `readAt` fed "Consultado hace X", and a block is
     read when it renders (links-on-demand-search FR-027). */
});

export type ReceivablesQuery = z.infer<typeof receivablesQuery>;
export type CobroRow = z.infer<typeof cobroRow>;
export type PaymentRequestsResponse = z.infer<typeof paymentRequestsResponse>;

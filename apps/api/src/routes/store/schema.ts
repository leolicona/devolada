import { z } from "zod";

/* cash-at-stores — the shopkeeper's contract (contracts/store-api.md).
   Imported by apps/red for its types, by its MSW handlers and by the
   Playwright stubs to validate every fixture (constitution III). Browser-
   facing: errors are `{ code }` only, never `message` or `retryable`.

   The rows a store sees of a business's customers are `.strict()` on
   purpose: a fixture that slips a phone or an address into a result is
   a fixture of a shape this API never sends (FR-017, D24). */

/* ---- Session: GET /auth/me, the store branch (D2) ---- */
export const storeMeResponse = z.object({
  type: z.literal("store"),
  storeId: z.string(),
  name: z.string(),
  /* The business with the channel on, or null (FR-015) */
  businessName: z.string().nullable(),
});

/* ---- The counter ---- */

/* D24, FR-016: at most ten, from three characters */
export const STORE_SEARCH_LIMIT = 10;
export const STORE_SEARCH_MIN = 3;

/* GET /store/customers?q= — `q` is checked by the handler, which answers
   QUERY_TOO_SHORT rather than a generic VALIDATION_ERROR */
export const storeSearchQuery = z.object({ q: z.string().default("") });

export const storeCustomerRow = z
  .object({
    usuario: z.string(),
    name: z.string(),
    /* When the integration has one (FR-017) */
    zone: z.string().nullable(),
  })
  .strict();

export const storeSearchResponse = z
  .object({
    rows: z.array(storeCustomerRow).max(STORE_SEARCH_LIMIT),
    /* More matched than were shown: the app asks for a more specific
       search instead of paging (FR-016) */
    more: z.boolean(),
    /* FR-028: an outage is said, never shown as "sin resultados" */
    integration: z.enum(["ok", "unavailable"]),
  })
  .strict();

/* GET /store/customers/debt?usuario= (D14) */
export const storeQuoteQuery = z.object({ usuario: z.string().trim().min(1) });

const quoteAmounts = {
  usuario: z.string(),
  name: z.string(),
  zone: z.string().nullable(),
  invoiceCents: z.number().int().nonnegative(),
  carriedBalanceCents: z.number().int().nonnegative(),
  /* D22: the network fee, read now */
  feeCents: z.number().int().nonnegative(),
  /* debtCents + feeCents (FR-020) */
  totalCents: z.number().int().nonnegative(),
};

/* Three answers, never a guess (D14): `unavailable` carries no amount, so
   nothing downstream can render it as zero */
export const storeQuoteResponse = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("owes"),
      ...quoteAmounts,
      debtCents: z.number().int().positive(),
      /* The spec's edge case "a short payment below the business's
         threshold": the app says before confirming whether the service
         comes back. The smallest amount that brings it back under the
         business's own rule (class → mapped action, threshold, floor), or
         null when no amount does at the counter (the whole debt maps to
         register-only, or the business keeps its actions in observation).
         Added at implementation, 2026-10-01: the contract had no way to
         say it before the record. */
      reconnectsFromCents: z.number().int().positive().nullable(),
    })
    .strict(),
  z.object({ state: z.literal("none"), ...quoteAmounts, debtCents: z.literal(0) }).strict(),
  z.object({ state: z.literal("unavailable"), usuario: z.string() }).strict(),
]);

/* POST /store/collections (D11, D13–D16, D25) */
export const recordCollectionRequest = z.object({
  usuario: z.string().trim().min(1),
  amountCents: z.number().int().positive(),
  /* What the payer was shown — a check that the payer saw the numbers the
     server computes, never the numbers themselves (D14) */
  expectedDebtCents: z.number().int().nonnegative(),
  expectedFeeCents: z.number().int().nonnegative(),
  /* D15: generated once per confirm screen */
  collectionKey: z.string().uuid(),
});

export const recordCollectionResponse = z.object({ id: z.string(), folio: z.string() });

/* FR-025, contract table: six outcomes, mapped from the row's
   `actionOutcome` and the action decided for its class (H2). A cash row
   is never held for review (D13). */
export const COLLECTION_OUTCOMES = [
  "reconnected",
  "registered",
  "queued",
  "not_reconnected_short",
  "observation",
  "failed",
] as const;
export const collectionOutcome = z.enum(COLLECTION_OUTCOMES);

/* GET /store/collections/:id */
export const collectionStatusResponse = z.object({
  id: z.string(),
  folio: z.string(),
  createdAt: z.number().int(),
  businessName: z.string(),
  customerName: z.string(),
  /* Applied to the debt */
  amountCents: z.number().int().positive(),
  /* The network fee paid on top */
  feeCents: z.number().int().nonnegative(),
  class: z.enum(["exact", "short"]),
  /* What remains owed after a short payment; 0 on a whole one */
  remainingCents: z.number().int().nonnegative(),
  outcome: collectionOutcome,
});

/* GET /store/collections/:id/receipt (D18, D31) — asked for only when the
   shopkeeper taps *Enviar comprobante*. The phone exists only inside
   `waLink`, read at this moment and never written. */
export const collectionReceiptResponse = z.object({
  text: z.string(),
  waLink: z.string().url(),
  hasPhone: z.boolean(),
});

/* ---- The cash book (D19, D20) ---- */

export const handoverSummary = z.object({
  cents: z.number().int().positive(),
  status: z.enum(["confirmed", "disputed"]),
  at: z.number().int(),
  /* The business's note on a dispute (FR-035, confirm-cash-drop D7) */
  note: z.string().nullable(),
});

export const pendingHandover = z.object({
  id: z.string(),
  cents: z.number().int().positive(),
  declaredAt: z.number().int(),
});

/* GET /store/cashbox */
export const cashboxResponse = z.object({
  businesses: z.array(
    z.object({
      businessId: z.string(),
      businessName: z.string(),
      heldCents: z.number().int(),
      feesSinceHandoverCents: z.number().int().nonnegative(),
      lastHandover: handoverSummary.nullable(),
      pendingHandover: pendingHandover.nullable(),
    }),
  ),
});

/* GET /store/ledger?cursor=&businessId=&kind= — newest first, 20 a page.
   `businessId` and `kind` are what *Mi caja*'s numbers open into (FR-037):
   the amount held opens every movement for that business, the fees open
   its collections. */
export const STORE_LEDGER_PAGE = 20;
export const storeLedgerQuery = z.object({
  cursor: z.string().optional(),
  businessId: z.string().optional(),
  kind: z.enum(["collection", "handover", "correction"]).optional(),
});

export const storeLedgerRow = z.object({
  id: z.string(),
  kind: z.enum(["collection", "handover", "correction"]),
  cents: z.number().int(),
  at: z.number().int(),
  businessId: z.string(),
  businessName: z.string(),
  /* The payment a collection or a correction refers to */
  folio: z.string().nullable(),
  customerName: z.string().nullable(),
  /* The network fee of a collection — the store's own money, shown beside
     the movement and never a movement itself (D19) */
  feeCents: z.number().int().nullable(),
  /* A correction's reason */
  reason: z.string().nullable(),
});

export const storeLedgerResponse = z.object({
  rows: z.array(storeLedgerRow),
  nextCursor: z.string().nullable(),
});

/* POST /store/handovers (D20) */
export const declareHandoverRequest = z.object({
  businessId: z.string().min(1),
  cents: z.number().int().positive(),
});
export const declareHandoverResponse = z.object({ id: z.string(), status: z.literal("pending") });

/* ---- The invitation, session-less (D4, D5) ---- */

/* GET /store/invitations/:token — every bad token reads the same */
export const invitationPreviewResponse = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("open"),
    storeName: z.string(),
    /* The last four digits, so the shopkeeper recognises their number */
    phoneTail: z.string().regex(/^\d{4}$/),
  }),
  z.object({ state: z.literal("invalid") }),
]);

/* POST /store/invitations/:token/accept */
export const acceptStoreInvitationRequest = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});
export const acceptStoreInvitationResponse = z.object({ email: z.string() });

/* Every code the store's routes answer, so the app's copy has one list */
export const STORE_ERROR_CODES = [
  "AUTHENTICATION_ERROR",
  "WRONG_ACTOR",
  "STORE_SUSPENDED",
  "CHANNEL_OFF",
  "NOT_CAPABLE",
  "QUERY_TOO_SHORT",
  "AMOUNT_CHANGED",
  "NOTHING_DUE",
  "AMOUNT_ABOVE_DEBT",
  "INTEGRATION_UNAVAILABLE",
  "NOT_FOUND",
  "HANDOVER_PENDING",
  "AMOUNT_EXCEEDS_HELD",
  "INVALID_INVITATION",
  "EMAIL_TAKEN",
  "VALIDATION_ERROR",
] as const;
export type StoreErrorCode = (typeof STORE_ERROR_CODES)[number];

export type StoreMeResponse = z.infer<typeof storeMeResponse>;
export type StoreCustomerRow = z.infer<typeof storeCustomerRow>;
export type StoreSearchResponse = z.infer<typeof storeSearchResponse>;
export type StoreQuoteResponse = z.infer<typeof storeQuoteResponse>;
export type RecordCollectionRequest = z.infer<typeof recordCollectionRequest>;
export type RecordCollectionResponse = z.infer<typeof recordCollectionResponse>;
export type CollectionOutcome = z.infer<typeof collectionOutcome>;
export type CollectionStatusResponse = z.infer<typeof collectionStatusResponse>;
export type CollectionReceiptResponse = z.infer<typeof collectionReceiptResponse>;
export type CashboxResponse = z.infer<typeof cashboxResponse>;
export type StoreLedgerQuery = z.infer<typeof storeLedgerQuery>;
export type StoreLedgerRow = z.infer<typeof storeLedgerRow>;
export type StoreLedgerResponse = z.infer<typeof storeLedgerResponse>;
export type DeclareHandoverRequest = z.infer<typeof declareHandoverRequest>;
export type DeclareHandoverResponse = z.infer<typeof declareHandoverResponse>;
export type InvitationPreviewResponse = z.infer<typeof invitationPreviewResponse>;
export type AcceptStoreInvitationRequest = z.infer<typeof acceptStoreInvitationRequest>;

import { z } from "zod";

/* Shareable contract (ARCHITECTURE.md): the admin derives types from
   these schemas and MSW handlers validate against them. Store-channel
   shapes retired to devolada-red. */

/* payments-and-classes D4: every lifecycle status is a filter — the feed
   is where a payment shows itself, whatever became of it. */
export const PAYMENT_STATUSES = [
  "validating",
  "confirmed",
  "partial",
  "invalid",
  "expired",
  "unapplied",
  "superseded",
  "queued_for_credit",
] as const;

export const RECONCILIATION_CLASSES = ["exact", "short", "over"] as const;

export const feedQuery = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  /* Lifecycle filter (D4). Without it the feed answers money that
     arrived: confirmed, partial and unapplied. */
  status: z.enum(PAYMENT_STATUSES).optional(),
  /* The action outcome keeps its own filter (payments-and-classes D5;
     vocabulary and name per integrations-hub D7): the failed strip and
     the queue chips ask about the action, not about the money. */
  action: z.enum(["queued", "done", "withheld", "failed", "observation"]).optional(),
  /* D1's vocabulary as a filter — the "Pago parcial" chip is `short` */
  class: z.enum(RECONCILIATION_CLASSES).optional(),
  /* Customer search: usuario or name, contains-match (D4) */
  q: z.string().trim().min(1).max(120).optional(),
  /* Calendar dates in the BUSINESS's timezone (D4, settings D5) —
     inclusive on both ends; the server owns the midnight boundary. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const feedCharge = z.object({
  id: z.string(),
  folio: z.string(),
  /* 'spei' = direct payment (direct-payment D6); one channel today */
  channel: z.enum(["spei"]),
  /* The payment lifecycle status (D4). The feed's default answers money
     that arrived; the filter reaches everything else. */
  status: z.enum(PAYMENT_STATUSES),
  /* Null when no action was ever decided (unapplied, or not yet
     confirmed). Generic vocabulary since integrations-hub D7: `done` is
     the mapped action completed — the es-MX label stays action-specific
     ("Reconectado" under register_and_reconnect). */
  actionOutcome: z.enum(["queued", "done", "withheld", "failed", "observation"]).nullable(),
  /* D3: computed once at the verdict against the fresh ask; null until
     then and forever on invalid/expired (no money, no class). */
  reconciliationClass: z.enum(RECONCILIATION_CLASSES).nullable(),
  /* What arrived (partial-payment D9) — named for what it is since the
     phase-4 rename (payments-and-classes D6) */
  receivedCents: z.number().int(),
  invoiceCents: z.number().int(),
  carriedBalanceCents: z.number().int(),
  serviceFeeCents: z.number().int(),
  /* The ask as the row remembers it (invoice + carried + fee). The
     verdict-time debt lives only in the class — the row keeps no second
     copy (schema: no column change). */
  askedCents: z.number().int(),
  missingCents: z.number().int(),
  /* For `unapplied` the whole payment is surplus: the debt was zero */
  surplusCents: z.number().int(),
  /* integrations-hub D5: the gated verdict's hypothesis — what the
     mapping would have executed ("register_and_reconnect:reconnect" /
     ":withhold" / "register_only"); null on rows that really
     dispatched. */
  observedAction: z.string().nullable(),
  /* The last dispatch decision's action, from the ledger (D6/D7): what
     `done` should be called. Null when nothing ever dispatched. */
  dispatchedAction: z.enum(["register_and_reconnect", "register_only"]).nullable(),
  customerName: z.string(),
  /* null for channel = 'spei': no store handled this money */
  storeName: z.string().nullable(),
  createdAt: z.number().int(),
  actionDoneAt: z.number().int().nullable(),
  actionAttempts: z.number().int(),
  /* Why the last attempt did not work, for the ISP's detail view
     (reconnection-queue spec UI contract) */
  actionError: z.string().nullable(),
});

export const feedResponse = z.object({
  /* The rename in one PR (payments-and-classes D6): the `charges` key
     retired the moment the Cobros section existed */
  payments: z.array(feedCharge),
  nextCursor: z.number().int().nullable(),
  /* D2: what a surplus means for THIS business today — its policy, or
     `credit` when the integration absorbs surplus on its own. The
     expansion's "queda a favor" / "devolver al cliente" hangs on it;
     `unapplied` rows ignore it (always "resolver con el cliente"). */
  effectiveOverTreatment: z.enum(["flag", "credit"]),
  /* The day starts in the ISP's timezone, so it is always present.
     `startedAtMs` is that boundary — the server says which day it counted
     (settings D5), instead of leaving the client to assume. */
  today: z.object({
    count: z.number().int(),
    totalCents: z.number().int(),
    startedAtMs: z.number().int(),
  }),
});

/* payments-and-classes D4: the proof is the whole truth — what Banxico
   said and what the payer sent — readable by every role. */
export const proofResponse = z.object({
  folio: z.string().nullable(),
  proofMode: z.enum(["transfer", "receipt"]),
  /* Null while nothing validated yet. The CEP carries no account — the
     masked-CLABE rule (business-and-memberships D3) never meets this
     door. */
  cep: z
    .object({
      trackingKey: z.string().nullable(),
      amountCents: z.number().int(),
      date: z.string().nullable(),
      senderBank: z.string().nullable(),
      senderName: z.string().nullable(),
      beneficiaryName: z.string().nullable(),
    })
    .nullable(),
  /* Short-lived signed URL (direct-payment D12's own mechanism), null
     when the payer never uploaded a capture */
  imageUrl: z.string().nullable(),
});

/* payments-and-classes D5 (retry) and integrations-hub D5 (execute):
   both answer the row's new outcome */
export const retryResponse = z.object({
  actionOutcome: z.enum(["queued", "done", "withheld", "failed", "observation"]),
  nextAttemptAt: z.number().int().nullable(),
});

export type FeedCharge = z.infer<typeof feedCharge>;
export type FeedResponse = z.infer<typeof feedResponse>;
export type ProofResponse = z.infer<typeof proofResponse>;
export type RetryResponse = z.infer<typeof retryResponse>;

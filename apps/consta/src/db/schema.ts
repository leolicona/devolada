import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/* All money in integer cents. Timestamps in ms. */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

/* Manual keys (validation spec D5): only the SHA-256 of the key is stored;
   the plaintext exists once, in the issuance response. */
export const apiKeys = sqliteTable("api_keys", {
  id: id(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdAt: createdAt(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

/* Append-only log (validation spec D6, amended by D15): one row per
   request that reached the provider and got any response back, non-2xx
   included — apiCEP bills a credit for a request it rejects with 400
   (measured 2026-08-19), so a log of successes was not a billing record.
   Never UPDATE/DELETE — billing is a SUM over this table. */
export const validations = sqliteTable(
  "validations",
  {
    id: id(),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id),
    mode: text("mode", { enum: ["transfer", "receipt"] }).notNull(),
    /* NULL = the call failed before any verdict existed (D15). Rows that
       carry a verdict stay selectable with `status IS NOT NULL`. */
    status: text("status", { enum: ["valid", "pending", "invalid"] }),
    /* D11: which kind of `invalid`. NULL for every other verdict — and the
       column that will finally say how often `not_found` is a real payment
       we could not see rather than a claim we should refuse. */
    reason: text("reason", { enum: ["contradicted", "not_found"] }),
    alreadyValidated: integer("already_validated", { mode: "boolean" }).notNull().default(false),
    /* What was claimed/extracted, for audit and support */
    trackingKey: text("tracking_key"),
    /* proof-extraction D13: kept so the pair (bank, clave) accumulates on
       the transfer door too. Per-bank clave shape is derived only from
       rows Banxico confirmed (`status = 'valid'`), never from claims. */
    senderBank: text("sender_bank"),
    referenceNumber: text("reference_number"),
    amountCents: integer("amount_cents"),
    transferDate: text("transfer_date"),
    /* learned-retry D2: the receiving side of the transfer, from the
       caller's own `beneficiary.bank`. The request always carried it and
       this table dropped it (measured 2026-08-27) — it is what the
       receiver and pair cells of the latency ladder group over. NULL on
       receipt-door calls matched against a candidate list, and on every
       row written before the column existed. */
    beneficiaryBank: text("beneficiary_bank"),
    /* Provider breadcrumbs: their id and raw CEP status ("EN PROCESO"…) */
    providerValidationId: text("provider_validation_id"),
    cepStatus: text("cep_status"),
    /* D14 — what the call cost and how long it took. From response
       headers, which ride 200s only, so NULL is normal on failures.
       `provider_ms` is the instrument that will say whether a faceless
       `invalid` ever reached Banxico (1–2 s early fail vs 6–7 s lookup);
       `quota_remaining` makes the 800-per-period plan visible before the
       429 does. */
    providerHttpStatus: integer("provider_http_status"),
    providerMs: integer("provider_ms"),
    quotaRemaining: integer("quota_remaining"),
    /* trust-layer D1/D7 — opaque history refs the caller chooses. Sending
       `customer_ref` is the opt-in for history collection; `payment_ref`
       chains the attempts of one payment. Never interpreted, never joined
       against anything but themselves, and stored on failed rows too: the
       log stays faithful. Every trust number is a SUM over these at
       request time — no aggregate tables, ever. */
    customerRef: text("customer_ref"),
    paymentRef: text("payment_ref"),
    createdAt: createdAt(),
  },
  (t) => [
    index("validations_key_idx").on(t.apiKeyId, t.createdAt),
    index("validations_customer_idx").on(t.apiKeyId, t.customerRef),
  ],
);

/* D8 — Consta stores the reading, never the image.

   The SHA-256 ties this record to whatever the integrator still holds,
   without Consta accumulating other people's customers' bank receipts:
   names, partial CLABEs and amounts are the integrator's data under the
   integrator's retention policy, not ours.

   D9 — a refusal at the edge lands here too, with `validationId` null and
   no provider call behind it. Nothing this feature refuses is refused
   silently, because the refusal rate is the number the feature exists to
   drive down. (validation.spec.md D15 will fold billed-but-failed
   provider calls into `validations`; these never reached a provider, so
   they are a different fact and live in a different table.) */
export const extractions = sqliteTable(
  "extractions",
  {
    id: id(),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id),
    /* Which reader saw the file — the routing decision of D2, recorded so
       a caller (and we) can tell the two paths apart after the fact */
    source: text("source", { enum: ["reader", "provider-ocr"] }).notNull(),
    outcome: text("outcome", {
      enum: ["passed", "gated", "not_a_receipt", "unreadable", "refused", "routed"],
    }).notNull(),
    model: text("model"),
    /* Never the bytes themselves (D8) */
    proofSha256: text("proof_sha256"),
    mediaType: text("media_type"),
    byteSize: integer("byte_size"),
    /* What was read. Reported, never authoritative — D3 */
    trackingKey: text("tracking_key"),
    senderBank: text("sender_bank"),
    amountCents: integer("amount_cents"),
    transferDate: text("transfer_date"),
    receiptStatus: text("receipt_status"),
    gateTrackingKey: text("gate_tracking_key"),
    gateSenderBank: text("gate_sender_bank"),
    rawOutput: text("raw_output"),
    /* Set only when the reading went on to buy a provider call */
    validationId: text("validation_id").references(() => validations.id),
    createdAt: createdAt(),
  },
  (t) => [index("extractions_key_idx").on(t.apiKeyId, t.createdAt)],
);

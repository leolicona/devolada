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

/* Append-only log (validation spec D6): one row per validation that reached
   the provider. Never UPDATE/DELETE — billing is a SUM over this table. */
export const validations = sqliteTable(
  "validations",
  {
    id: id(),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id),
    mode: text("mode", { enum: ["transfer", "receipt"] }).notNull(),
    status: text("status", { enum: ["valid", "pending", "invalid"] }).notNull(),
    /* D11: which kind of `invalid`. NULL for every other verdict — and the
       column that will finally say how often `not_found` is a real payment
       we could not see rather than a claim we should refuse. */
    reason: text("reason", { enum: ["contradicted", "not_found"] }),
    alreadyValidated: integer("already_validated", { mode: "boolean" }).notNull().default(false),
    /* What was claimed/extracted, for audit and support */
    trackingKey: text("tracking_key"),
    referenceNumber: text("reference_number"),
    amountCents: integer("amount_cents"),
    transferDate: text("transfer_date"),
    /* Provider breadcrumbs: their id and raw CEP status ("EN PROCESO"…) */
    providerValidationId: text("provider_validation_id"),
    cepStatus: text("cep_status"),
    createdAt: createdAt(),
  },
  (t) => [index("validations_key_idx").on(t.apiKeyId, t.createdAt)],
);

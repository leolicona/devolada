import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organization, user } from "./auth-schema";

/* Better Auth's tables live in auth-schema.ts; re-exported here so
   drizzle-kit sees a single schema. */
export * from "./auth-schema";

/* All money in integer cents. Timestamps in ms.
   `businessId` on every business table: the tenant (pivot glossary:
   Negocio), which the phase-2 rename made real. */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const businesses = sqliteTable("businesses", {
  id: id(),
  /* The auth twin (business-and-memberships D2): one Better Auth
     organization per business. Ownership and roles live in the
     organization's memberships, never here. */
  orgId: text("org_id")
    .notNull()
    .unique()
    .references(() => organization.id),
  name: text("name").notNull(),
  /* Display/business copy of the contact email; auth never reads it */
  email: text("email").notNull().unique(),
  wisphubApiKey: text("wisphub_api_key"),
  /* Fee the end customer pays; the SPEI fee falls back to it (direct-payment D3) */
  serviceFeeCents: integer("service_fee_cents").notNull().default(1500),
  /* Display settings (settings spec D5, D6). Mexico spans three zones, so
     the ISP — not the browser — decides where its business day starts. */
  timezone: text("timezone").notNull().default("America/Mexico_City"),
  timeFormat: text("time_format", { enum: ["12h", "24h"] })
    .notNull()
    .default("12h"),
  status: text("status", { enum: ["active", "suspended"] })
    .notNull()
    .default("active"),
  /* Direct SPEI channel (direct-payment spec D3, D4): the ISP's own
     account — the money never touches Devolada. All nullable: unset
     means the channel is "unavailable" and the page says so. The bank
     name rides along because Consta's transfer door requires the
     receiving institution by name, and deriving it from the CLABE
     would mean maintaining a bank catalog. */
  speiClabe: text("spei_clabe"),
  speiBank: text("spei_bank"),
  speiBeneficiaryName: text("spei_beneficiary_name"),
  /* null → falls back to serviceFeeCents (D3) */
  speiServiceFeeCents: integer("spei_service_fee_cents"),
  /* Partial payments (partial-payment spec D2, D4). One control, not two:
     100 means only a full payment reconnects — the default and the
     owner's policy — and 0 means any payment does. A threshold and a
     separate "action" switch could contradict each other; the extremes
     already say "never" and "always".
     The floor rides along because a percentage alone lets a token
     payment reconnect a large arrears balance (D4). Both must hold. */
  reconnectionThresholdPercent: integer("reconnection_threshold_percent")
    .notNull()
    .default(100),
  reconnectionFloorCents: integer("reconnection_floor_cents").notNull().default(0),
  /* provisional-release D10 (US-D15): one switch, no dials. On, a payment
     with per-transaction evidence buys a WispHub payment promise while
     Banxico confirms — reconnecting the suspended, protecting the current
     from the cut. The rule behind it is fixed and lives in the spec;
     the threshold and floor above apply to it unchanged. */
  provisionalReleaseEnabled: integer("provisional_release_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  /* prepaid-credit D4: a negotiated fee, written only from the operator
     panel; null → the global `validation_fee_cents` current at each debit */
  feeOverrideCents: integer("fee_override_cents"),
  createdAt: createdAt(),
});

export const paymentLinks = sqliteTable(
  "payment_links",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    token: text("token").notNull().unique(),
    /* Numeric WispHub id (as string) for the auto-activate PATCH;
       the usuario is what every lookup needs — same split as charges.
       The usuario is the link's identity (admin-links-view D5): the
       numeric id is a cache WispHub may recycle to a different person,
       so it is refreshed on sight and never keys anything. */
    wisphubCustomerId: text("wisphub_customer_id").notNull(),
    customerUsuario: text("customer_usuario").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payment_links_business_usuario_idx").on(t.businessId, t.customerUsuario),
  ],
);

/* One submitted SPEI proof and its validation lifecycle
   (direct-payment spec). The row is also the re-validation queue (D7):
   `nextValidationAt` is when the sweep may touch it again. */
export const payments = sqliteTable(
  "payments",
  {
    id: id(),
    paymentLinkId: text("payment_link_id")
      .notNull()
      .references(() => paymentLinks.id),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    amountCents: integer("amount_cents").notNull(),
    /* Same meaning as on `charges` (debt-truth D8/D13) */
    invoiceCents: integer("invoice_cents").notNull(),
    carriedBalanceCents: integer("carried_balance_cents").notNull().default(0),
    /* What the CEP says actually arrived (partial-payment D6). It equals
       `amountCents` on an ordinary payment and is smaller on a short one;
       the page's "faltan $X" is the difference. */
    receivedCents: integer("received_cents"),
    /* What the receipt said was transferred, as the reader saw it
       (partial-payment D5). This is the amount that has to travel to
       Banxico: `sender.amount` is a search criterion, so asking with the
       amount we *expected* finds nothing when the payer fell short — a
       faceless `not_found` and six hours of silence for a real payment.
       Null on the manual door, where nobody read anything. */
    claimedAmountCents: integer("claimed_amount_cents"),
    /* reading-check D1–D5: what the minute-two cross said. 'agreed' —
       the provider's OCR read the same clave and amount (evidence, the
       clock escalation retires); 'disputed' — at least one machine is
       wrong, the human is asked now; 'blind' — the provider could not
       read the image, no evidence either way. NULL = no cross ran. */
    readingCheck: text("reading_check", { enum: ["agreed", "disputed", "blind"] }),
    /* JSON array, set only on 'disputed' (D4): which fields to empty */
    disputedFields: text("disputed_fields"),
    serviceFeeCents: integer("service_fee_cents").notNull(),
    /* unapplied (D14): the CEP was real but the debt was settled
       elsewhere meanwhile — visible, never silent */
    /* `superseded` (D18): a silent attempt whose reading the payer then
       corrected. Deliberately not `invalid` — that word means "your
       transfer does not exist", and this is the opposite: we were the
       ones who were wrong. */
    /* `partial` (partial-payment D6): the transfer is real and the money
       moved, but it did not cover the debt. Not `confirmed` — the payer
       would see a green tick and no internet. Not `invalid` — that word
       means "your transfer does not exist". Not `unapplied` — D14 keeps
       that for a valid transfer with nothing left to pay, the opposite
       situation. */
    status: text("status", {
      enum: [
        "validating",
        "confirmed",
        "partial",
        "invalid",
        "expired",
        "unapplied",
        "superseded",
        /* prepaid-credit D8: submitted while the business is paused — no
           provider call until a top-up lifts the balance above the cap */
        "queued_for_credit",
      ],
    })
      .notNull()
      .default("validating"),
    proofMode: text("proof_mode", { enum: ["receipt", "transfer"] }).notNull(),
    /* From customer input (transfer door) or from the CEP (receipt door) */
    trackingKey: text("tracking_key"),
    senderBank: text("sender_bank"),
    transferDate: text("transfer_date"),
    /* Private R2 object key, never a public URL (D12) */
    proofKey: text("proof_key"),
    /* D18: the receipt's own `Estatus`, as the reader saw it. The one
       discriminator we have between "the bank has not released this yet"
       and the other four causes of a faceless `not_found` — so it decides
       whether the payer is shown a form or told to wait. */
    receiptStatus: text("receipt_status"),
    /* D18: who Banxico says sent the money. Recorded, never acted on —
       people pay for relatives, so a mismatch is a signal for the ISP and
       never a rule. Nothing displays it yet. */
    cepSenderName: text("cep_sender_name"),
    /* D18: the row this one corrects. Keeps the pair (what was read,
       what the payer confirmed), which is the measurement that says
       whether the reader earns its keep. */
    supersedesId: text("supersedes_id"),
    constaValidationId: text("consta_validation_id"),
    constaStatus: text("consta_status", { enum: ["valid", "pending", "invalid"] }),
    validationAttempts: integer("validation_attempts").notNull().default(0),
    nextValidationAt: integer("next_validation_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    /* provisional-release D1/D11 (US-D15): the moment the vote of
       confidence bought a WispHub payment promise, and which evidence
       bought it — point-in-time facts, recorded because they cannot be
       derived later. Null = never released. */
    provisionalReleaseAt: integer("provisional_release_at", { mode: "timestamp_ms" }),
    /* `history` is D12's graduation privilege — the payer's own record
       vouching where the machines could not read. Unreachable until the
       shadow table writes K; TS-level only, no SQL change. */
    releaseEvidence: text("release_evidence", { enum: ["pending", "agreed", "human", "history"] }),
    /* D2's two faces, recorded at the moment of truth: `reconnect` — the
       customer was suspended and the promise gave the service back;
       `protect` — the customer was current and the promise shields them
       from the scheduled cut. The page's copy hangs on this (D9): "tu
       internet ya volvió" must never be said to someone whose internet
       never left. */
    releaseKind: text("release_kind", { enum: ["reconnect", "protect"] }),
    /* D12 — the shadow: the payer's measured history (Consta's US-V15
       `trust` block) exactly as received at the release evaluation,
       verbatim JSON; null when the block was absent. Frozen here because
       the block decays with time and Devolada holds no log to recompute
       it: each release becomes a labeled row — history at decision →
       decision → outcome. Read by nobody in v1; it exists to choose K. */
    trustSnapshot: text("trust_snapshot"),
    /* ---- Absorbed from the retired `charges` twin (business-and-memberships
       D6): one row is the whole payment, from proof to router. Set at
       confirmation; null while the payment is still validating. ---- */
    /* DV- folio, assigned when the money is confirmed (receipt spec heritage) */
    folio: text("folio").unique(),
    /* 'spei' today; future channels ride the same row */
    channel: text("channel", { enum: ["spei"] }).notNull().default("spei"),
    /* Denormalized at confirmation, same reason as receipt D4: the feed
       and the queue must not depend on WispHub being up */
    wisphubCustomerId: text("wisphub_customer_id"),
    customerUsuario: text("customer_usuario"),
    customerName: text("customer_name"),
    customerZone: text("customer_zone"),
    customerPhone: text("customer_phone"),
    /* What is registered against the WispHub debt (partial-payment D5/D9:
       what arrived, applied) — the number every retry registers again */
    registeredCents: integer("registered_cents"),
    /* The reconnection queue rides the payment row (reconnection-queue
       spec D2). `withheld` = deliberately not restored (partial D13). */
    reconnectionStatus: text("reconnection_status", {
      enum: ["queued", "reconnected", "failed", "withheld"],
    }),
    reconnectionAttempts: integer("reconnection_attempts").notNull().default(0),
    reconnectedAt: integer("reconnected_at", { mode: "timestamp_ms" }),
    wisphubInvoiceId: integer("wisphub_invoice_id"),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }),
    paymentRegisteredAt: integer("payment_registered_at", { mode: "timestamp_ms" }),
    /* D6's split: `lastError` above is the validation error; this one is
       the reconnection's. One name for two failures was only tolerable
       across two tables. */
    reconnectionError: text("reconnection_error"),
    /* Born nullable with no semantics (D6): phase 4's child spec defines
       exacto / corto / excedente; reserved now so the busiest table
       migrates once. */
    reconciliationClass: text("reconciliation_class", { enum: ["exact", "short", "over"] }),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_link_idx").on(t.paymentLinkId),
    index("payments_due_idx").on(t.status, t.nextValidationAt),
    index("payments_reconnection_due_idx").on(t.reconnectionStatus, t.nextAttemptAt),
    index("payments_business_created_idx").on(t.businessId, t.createdAt),
    /* D8: one transfer pays once — the database, not the provider,
       refuses the second submission, racing ones included */
    uniqueIndex("payments_business_tracking_idx")
      .on(t.businessId, t.trackingKey)
      .where(
        /* `superseded` joins the exclusions (D18): a corrected reading
           must release its claim, or a clave the machine misread would
           block the customer it really belongs to for six hours. */
        sql`tracking_key IS NOT NULL AND status NOT IN ('invalid', 'expired', 'superseded')`,
      ),
  ],
);

/* provisional-release D6 (US-D15): the edge rejection gets a memory. A
   reused clave dies today at the unique index above with a 409 and left
   no row anywhere — but a revocation signal needs one, and knowing WHICH
   payment owned the clave is what turns own-vs-other into a query
   instead of a guess. Append-only; a row is an attempt, never a verdict. */
export const proofRejections = sqliteTable(
  "proof_rejections",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    /* Who tried */
    paymentLinkId: text("payment_link_id")
      .notNull()
      .references(() => paymentLinks.id),
    /* Whose clave it was */
    ownerPaymentId: text("owner_payment_id").references(() => payments.id),
    trackingKey: text("tracking_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("proof_rejections_link_idx").on(t.paymentLinkId, t.createdAt)],
);

/* ---- Phase 3: the platform's book (prepaid-credit spec, operator-panel spec) ---- */

/* operator-panel D1: append-only rows, one key per row, the current
   value is the latest row. Types and birth values live in
   src/platform/settings.ts, never here. */
export const platformSettings = sqliteTable(
  "platform_settings",
  {
    id: id(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("platform_settings_key_created_idx").on(t.key, t.createdAt)],
);

/* prepaid-credit D6: a top-up is the platform's own transaction —
   the business pays, the platform receives — with the payment lifecycle's
   proof columns and none of its debt columns. */
export const topUps = sqliteTable(
  "top_ups",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    submittedByUserId: text("submitted_by_user_id")
      .notNull()
      .references(() => user.id),
    claimedCents: integer("claimed_cents").notNull(),
    /* The CEP's amount, set when valid (claimed-amount D1's principle) */
    creditedCents: integer("credited_cents"),
    status: text("status", {
      enum: ["validating", "credited", "invalid", "expired", "superseded"],
    })
      .notNull()
      .default("validating"),
    proofMode: text("proof_mode", { enum: ["receipt", "transfer"] }).notNull(),
    trackingKey: text("tracking_key"),
    senderBank: text("sender_bank"),
    transferDate: text("transfer_date"),
    proofKey: text("proof_key"),
    readingCheck: text("reading_check", { enum: ["agreed", "disputed", "blind"] }),
    constaValidationId: text("consta_validation_id"),
    constaStatus: text("consta_status", { enum: ["valid", "pending", "invalid"] }),
    validationAttempts: integer("validation_attempts").notNull().default(0),
    nextValidationAt: integer("next_validation_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("top_ups_business_created_idx").on(t.businessId, t.createdAt),
    index("top_ups_due_idx").on(t.status, t.nextValidationAt),
    /* One transfer credits once (direct-payment D8's rule) */
    uniqueIndex("top_ups_tracking_idx")
      .on(t.trackingKey)
      .where(sql`tracking_key IS NOT NULL AND status NOT IN ('invalid', 'expired', 'superseded')`),
  ],
);

/* prepaid-credit D3: the house's append-only money table. Balance =
   SUM(cents) per business, never stored. Corrections are new rows. */
export const creditEntries = sqliteTable(
  "credit_entries",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    kind: text("kind", { enum: ["welcome_bonus", "top_up", "validation_fee", "adjustment"] }).notNull(),
    /* Signed: credits positive, the fee negative */
    cents: integer("cents").notNull(),
    /* validation_fee: the payment that earned it — unique, so a retried
       sweep can never charge twice (D2) */
    paymentId: text("payment_id").references(() => payments.id),
    topUpId: text("top_up_id").references(() => topUps.id),
    /* welcome_bonus: the user it was granted to — once per user (D5) */
    grantedToUserId: text("granted_to_user_id").references(() => user.id),
    /* adjustment (operator-panel D5): why, and who */
    reason: text("reason"),
    authorUserId: text("author_user_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("credit_entries_business_created_idx").on(t.businessId, t.createdAt),
    uniqueIndex("credit_entries_fee_payment_idx")
      .on(t.paymentId)
      .where(sql`kind = 'validation_fee'`),
    uniqueIndex("credit_entries_bonus_user_idx")
      .on(t.grantedToUserId)
      .where(sql`kind = 'welcome_bonus'`),
  ],
);

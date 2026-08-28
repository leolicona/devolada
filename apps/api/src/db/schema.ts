import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

/* Better Auth's tables live in auth-schema.ts; re-exported here so
   drizzle-kit sees a single schema. */
export * from "./auth-schema";

/* All money in integer cents. Timestamps in ms.
   Designed for a single pilot ISP, with ispId on every business table to
   enable multi-tenancy later without structural migration. */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const isps = sqliteTable("isps", {
  id: id(),
  /* Auth lives in the Better Auth user row (better-auth.spec.md D3):
     `userId` links there. `email` here is the business/display copy,
     synced at signup and never read by auth flows. Credentials and
     verification state have no columns here at all. */
  userId: text("user_id")
    .unique()
    .references(() => user.id),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  wisphubApiKey: text("wisphub_api_key"),
  /* Fee the end customer pays, and the store's share of it.
     The platform's share is the difference. */
  serviceFeeCents: integer("service_fee_cents").notNull().default(1500),
  storeCommissionCents: integer("store_commission_cents").notNull().default(900),
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
  createdAt: createdAt(),
});

export const stores = sqliteTable(
  "stores",
  {
    id: id(),
    ispId: text("isp_id")
      .notNull()
      .references(() => isps.id),
    name: text("name").notNull(),
    contactName: text("contact_name").notNull(),
    phone: text("phone").notNull().unique(),
    zone: text("zone"),
    /* null until the invitation is accepted; the Better Auth user holds
       the shopkeeper's credentials and recovery email (spec D3) */
    userId: text("user_id")
      .unique()
      .references(() => user.id),
    /* null → inherits storeCommissionCents from the ISP */
    commissionCents: integer("commission_cents"),
    balanceCapCents: integer("balance_cap_cents").notNull().default(500000),
    status: text("status", { enum: ["invited", "active", "suspended"] })
      .notNull()
      .default("invited"),
    createdAt: createdAt(),
  },
  (t) => [index("stores_isp_idx").on(t.ispId)],
);

export const charges = sqliteTable(
  "charges",
  {
    id: id(),
    ispId: text("isp_id")
      .notNull()
      .references(() => isps.id),
    /* null for channel = 'spei' (direct-payment spec D6): a direct
       payment involves no store, no commission, no ledger entries */
    storeId: text("store_id").references(() => stores.id),
    /* 'store' = cash at a corner store · 'spei' = direct payment (D6) */
    channel: text("channel", { enum: ["store", "spei"] })
      .notNull()
      .default("store"),
    directPaymentId: text("direct_payment_id").references(
      (): AnySQLiteColumn => directPayments.id,
    ),
    folio: text("folio").notNull().unique(),
    wisphubCustomerId: text("wisphub_customer_id").notNull(),
    customerName: text("customer_name").notNull(),
    customerZone: text("customer_zone"),
    /* Copied at record time (receipt spec D4): reading it back from
       WispHub would make the receipt fail exactly when WispHub is down */
    customerPhone: text("customer_phone"),
    /* What the ISP was owed for the period this charge settles — the
       pending invoice's own total, not the plan's list price
       (debt-truth D8/D13). Prorations, discounts and any reconnection
       charge are already inside it. */
    invoiceCents: integer("invoice_cents").notNull(),
    /* Debt the customer was already carrying in WispHub's running
       account (`saldo`, debt-truth D7). Zero for the ordinary case; a
       credit never lands here, it is netted into `invoiceCents` (D12). */
    carriedBalanceCents: integer("carried_balance_cents").notNull().default(0),
    serviceFeeCents: integer("service_fee_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    /* `withheld` (partial-payment D9): the payment was recorded and the
       service deliberately not restored — a short payment under the
       ISP's threshold. Terminal, like reconnected and failed. */
    reconnectionStatus: text("reconnection_status", {
      enum: ["queued", "reconnected", "failed", "withheld"],
    })
      .notNull()
      .default("queued"),
    reconnectionAttempts: integer("reconnection_attempts").notNull().default(0),
    reconnectedAt: integer("reconnected_at", { mode: "timestamp_ms" }),
    /* Reconnection queue (reconnection-queue spec). The charge row is the
       queue: `nextAttemptAt` is when it may be touched again (null once
       terminal), and the invoice id makes a retry pay the same invoice
       instead of creating a second one (D1, pays TD-009). */
    wisphubInvoiceId: integer("wisphub_invoice_id"),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    /* The WispHub usuario, which every retry lookup needs (D8 revision):
       wisphubCustomerId above is the numeric id and only serves the
       auto-activate PATCH. Nullable: rows before 0006 predate it. */
    customerUsuario: text("customer_usuario"),
    /* Set once registrar-pago landed (D8): later attempts verify only —
       WispHub refuses paying an already-paid invoice (422, measured). */
    paymentRegisteredAt: integer("payment_registered_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("charges_store_idx").on(t.storeId),
    index("charges_isp_created_idx").on(t.ispId, t.createdAt),
    index("charges_due_idx").on(t.reconnectionStatus, t.nextAttemptAt),
  ],
);

export const cashDrops = sqliteTable(
  "cash_drops",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    cents: integer("cents").notNull(),
    status: text("status", { enum: ["pending", "confirmed", "disputed"] })
      .notNull()
      .default("pending"),
    note: text("note"),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("cash_drops_store_idx").on(t.storeId)],
);

/* Append-only ledger: never UPDATE or DELETE on this table.
   Corrections = counter-entries. A store's balance = SUM(cents).
   charge: +total · commission: −store share · cash_drop: −amount handed over */
export const ledgerEntries = sqliteTable(
  "ledger_entries",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    type: text("type", { enum: ["charge", "commission", "cash_drop"] }).notNull(),
    cents: integer("cents").notNull(),
    chargeId: text("charge_id").references(() => charges.id),
    cashDropId: text("cash_drop_id").references(() => cashDrops.id),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_entries_store_created_idx").on(t.storeId, t.createdAt)],
);

/* The phone the shopkeeper captured for a customer WispHub has none for
   (customer-phone spec D1, D3). WispHub's own `telefono` is read-only
   through its API — probed 2026-08-17, see integrations/wisphub.md — so
   this table is the only place such a number can live. It exists to
   deliver receipts and feeds nothing else (D5). */
export const customerContacts = sqliteTable(
  "customer_contacts",
  {
    id: id(),
    ispId: text("isp_id")
      .notNull()
      .references(() => isps.id),
    /* Numeric WispHub id (as string), same split as charges and links */
    wisphubCustomerId: text("wisphub_customer_id").notNull(),
    /* 10 national digits, normalized on the way in */
    phone: text("phone").notNull(),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("customer_contacts_isp_customer_idx").on(t.ispId, t.wisphubCustomerId)],
);

/* One permanent link per customer per ISP (direct-payment spec D1, D5):
   the token is opaque and never expires — the page asks WispHub for the
   live debt on every open, so the link itself carries no state. */
export const paymentLinks = sqliteTable(
  "payment_links",
  {
    id: id(),
    ispId: text("isp_id")
      .notNull()
      .references(() => isps.id),
    token: text("token").notNull().unique(),
    /* Numeric WispHub id (as string) for the auto-activate PATCH;
       the usuario is what every lookup needs — same split as charges */
    wisphubCustomerId: text("wisphub_customer_id").notNull(),
    customerUsuario: text("customer_usuario").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payment_links_isp_customer_idx").on(t.ispId, t.wisphubCustomerId),
  ],
);

/* One submitted SPEI proof and its validation lifecycle
   (direct-payment spec). The row is also the re-validation queue (D7):
   `nextValidationAt` is when the sweep may touch it again. */
export const directPayments = sqliteTable(
  "direct_payments",
  {
    id: id(),
    paymentLinkId: text("payment_link_id")
      .notNull()
      .references(() => paymentLinks.id),
    ispId: text("isp_id")
      .notNull()
      .references(() => isps.id),
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
    chargeId: text("charge_id").references(() => charges.id),
    validationAttempts: integer("validation_attempts").notNull().default(0),
    nextValidationAt: integer("next_validation_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    /* provisional-release D1/D11 (US-D15): the moment the vote of
       confidence bought a WispHub payment promise, and which evidence
       bought it — point-in-time facts, recorded because they cannot be
       derived later. Null = never released. */
    provisionalReleaseAt: integer("provisional_release_at", { mode: "timestamp_ms" }),
    releaseEvidence: text("release_evidence", { enum: ["pending", "agreed", "human"] }),
    /* D2's two faces, recorded at the moment of truth: `reconnect` — the
       customer was suspended and the promise gave the service back;
       `protect` — the customer was current and the promise shields them
       from the scheduled cut. The page's copy hangs on this (D9): "tu
       internet ya volvió" must never be said to someone whose internet
       never left. */
    releaseKind: text("release_kind", { enum: ["reconnect", "protect"] }),
    /* provisional-release D12 — the graduation shadow: Consta's trust
       block as received at the release evaluation, JSON, frozen once a
       release happens. History at the moment of decision cannot be
       rebuilt later; joined with the outcome, each release becomes the
       labeled row that will one day produce K. The rule reads none of
       it while K is null. */
    trustSnapshot: text("trust_snapshot"),
    createdAt: createdAt(),
  },
  (t) => [
    index("direct_payments_link_idx").on(t.paymentLinkId),
    index("direct_payments_due_idx").on(t.status, t.nextValidationAt),
    /* D8: one transfer pays once — the database, not the provider,
       refuses the second submission, racing ones included */
    uniqueIndex("direct_payments_isp_tracking_idx")
      .on(t.ispId, t.trackingKey)
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
    ispId: text("isp_id")
      .notNull()
      .references(() => isps.id),
    /* Who tried */
    paymentLinkId: text("payment_link_id")
      .notNull()
      .references(() => paymentLinks.id),
    /* Whose clave it was */
    ownerPaymentId: text("owner_payment_id").references(() => directPayments.id),
    trackingKey: text("tracking_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("proof_rejections_link_idx").on(t.paymentLinkId, t.createdAt)],
);

export const invitations = sqliteTable(
  "invitations",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    /* Our own random token (better-auth.spec.md D8): single-use, valid
       7 days from createdAt — checked at redemption, no extra column */
    token: text("token").notNull().unique(),
    status: text("status", { enum: ["sent", "accepted"] })
      .notNull()
      .default("sent"),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_store_idx").on(t.storeId)],
);

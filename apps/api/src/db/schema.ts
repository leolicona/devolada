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
  /* Birth default of the service fee; the SPEI fee falls back to it until
     one is saved (direct-payment D3). Not editable since settings D9. */
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
  /* The WispHub key, the reconnection threshold+floor and the
     provisional switch moved to `integrations` (integrations-hub D2):
     they are integration config, not business identity. */
  /* prepaid-credit D4: a negotiated fee, written only from the operator
     panel; null → the global `validation_fee_cents` current at each debit */
  feeOverrideCents: integer("fee_override_cents"),
  /* Reconciliation policy (payments-and-classes D1). Tolerance in cents
     around the ask that still reads `exact` — birth default 0, because
     SPEI is exact to the cent and a $1 difference is a real short
     payment. `over_treatment` says what a surplus means to this
     business; an integration that absorbs surplus overrides it to
     `credit` at read time (D2), never in this column. */
  toleranceCents: integer("tolerance_cents").notNull().default(0),
  overTreatment: text("over_treatment", { enum: ["flag", "credit"] })
    .notNull()
    .default("flag"),
  /* Retired in place (consta-api-merge D11). It held the business's own
     Consta key (payments-and-classes D7) while the validation engine was
     a separate service; the engine is a module of this API now and
     attributes every row by `business_id`, so this column is never read
     and never written. It stays declared, not dropped, because the
     per-PR preview applies migrations to the live dev database while the
     deployed Worker keeps serving — a DROP COLUMN here would break that
     Worker's SELECT for the life of the PR (research R10). The drop is
     registered as debt `retired-consta-key-column`. */
  constaApiKey: text("consta_api_key"),
  createdAt: createdAt(),
});

/* One table for both collection channels (automated-collections-api D2,
   D3): a link the panel made for a WispHub customer, and a link the
   business's own software made through /v1. Widened rather than twinned —
   the payer's page resolves a link by token and `payments` references
   `payment_links.id`, so a second table would fork the token space, the
   payer path and every reader. Existing rows are panel links and stay
   exactly as they were.

   Invariants, enforced at the write path (the panel's `ensureLinks`, the
   API's create handler) and narrowed by `direct-payments/links.ts`:
     source = 'api'    ⟹ customer_ref and ask_cents are present
     source = 'panel'  ⟹ customer_usuario and wisphub_customer_id are present
     mode = 'one_time' ⟹ expires_at is present
     mode = 'reusable' ⟹ expires_at is null and closed_at stays null
     ask_cents > 0 whenever it is present (FR-010)
   Link state is derived, never stored (data-model.md): `open` while
   closed_at is null and expires_at is null or ahead; `paid` once
   closed_at is set; `expired` when closed_at is null and expires_at has
   passed. A reusable link is always open. */
export const paymentLinks = sqliteTable(
  "payment_links",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    token: text("token").notNull().unique(),
    /* automated-collections-api D3/D5: who created the link (FR-011),
       and therefore where the ask comes from — a panel link reads its
       debt live from WispHub, an API link carries `ask_cents`. */
    source: text("source", { enum: ["panel", "api"] })
      .notNull()
      .default("panel"),
    /* automated-collections-api D3 (FR-027): stored rather than inferred
       from `expires_at IS NULL` — two kinds the spec names in words are
       named in the data, so a reader never has to know that a null
       deadline means reusable. */
    mode: text("mode", { enum: ["reusable", "one_time"] })
      .notNull()
      .default("reusable"),
    /* The caller's own customer identifier — stored and echoed, never
       interpreted, never joined against anything (data-model: no
       api_customers table on purpose). API links only. */
    customerRef: text("customer_ref"),
    /* The amount to collect, in cents. Null on a panel link, whose ask
       is read live from WispHub; a re-price overwrites it — what was
       asked at the time of a payment lives on `payments.asked_cents`. */
    askCents: integer("ask_cents"),
    /* Display name the payer sees; falls back to the business name */
    label: text("label"),
    /* The payer-facing description the caller may supply (FR-006) */
    concept: text("concept"),
    /* One-time links only: the deadline, in ms */
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    /* When the link stopped accepting payments — a one-time link that
       was paid or closed by the caller. Null on every reusable link. */
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    /* automated-collections-api D12: born from a test credential. Its
       payments are test payments — excluded from the fee, the panel and
       the sweeps by one shared predicate, never by a remembered filter. */
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
    /* Numeric WispHub id (as string) for the auto-activate PATCH;
       the usuario is what every lookup needs — same split as charges.
       The usuario is the link's identity (admin-links-view D5): the
       numeric id is a cache WispHub may recycle to a different person,
       so it is refreshed on sight and never keys anything.
       automated-collections-api D3: both nullable now — an API link has
       no WispHub customer, and `customer_usuario` is surfaced to the
       payer as `reference`, so a sentinel here would reach a customer's
       screen. */
    wisphubCustomerId: text("wisphub_customer_id"),
    customerUsuario: text("customer_usuario"),
    createdAt: createdAt(),
  },
  (t) => [
    /* automated-collections-api D4: two partial unique indexes replace
       the one `(business_id, customer_usuario)` index. One index over both
       namespaces would let an ISP's WispHub usuario collide with its own
       API customer reference — two different people, one row. One-time
       links are excluded from the second because a customer can
       legitimately hold many (FR-033 is about reusable links). */
    uniqueIndex("payment_links_panel_usuario_idx")
      .on(t.businessId, t.customerUsuario)
      .where(sql`source = 'panel'`),
    uniqueIndex("payment_links_api_ref_idx")
      .on(t.businessId, t.customerRef)
      .where(sql`source = 'api' AND mode = 'reusable'`),
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
    /* reading-check D1–D5: what the comparison of the two readings said.
       'agreed' — the provider's OCR read the same clave and amount
       (evidence, the clock escalation retires); 'disputed' — at least one
       machine is wrong, the human is asked now; 'blind' — one side read
       nothing, no evidence either way. NULL = no comparison ran.
       *When* it is taken changed with two-eyes-receipt: at the first call
       for rows born after the cut-over (D5 — the file goes to the
       provider's image door on the first credit, so both readings exist at
       minute zero), at minute two for legacy rows (D16). */
    readingCheck: text("reading_check", { enum: ["agreed", "disputed", "blind"] }),
    /* JSON array (D4): which fields to empty in the payer's form. Set on
       'disputed' when nothing could break the tie, and — whatever the
       reading check says — carrying "date" when the accepted data has no
       date on either side (two-eyes-receipt D20): the transfer door is
       never called with a date nobody read, so the payer is asked for that
       one field while the agreement stands. */
    disputedFields: text("disputed_fields"),
    /* two-eyes-receipt D5/FR-018: the attempt number the classification
       was taken at — 1 on a provider-first call, higher when the inline
       attempt never ran (provider down, worker evicted) and a sweep
       classified instead. Which *flow* a row followed is the D16 shape,
       never this number: a new-flow row whose first attempt died classifies
       at 2 like a legacy cross does. */
    readingCheckAttempt: integer("reading_check_attempt"),
    /* two-eyes-receipt D5: which side read nothing. Set only when
       `readingCheck = 'blind'`; 'both' is a hole on our side and no clave
       on theirs, which is the one blind case that still asks the payer. */
    blindSide: text("blind_side", { enum: ["provider", "reader", "both"] }),
    /* two-eyes-receipt D7/D17: who supplied the clave, bank, amount and
       date that the transfer-door retries carry. 'agreed' — both readings
       said the same; 'reader' / 'provider' — the shape rules broke the tie
       for that side; 'human' — a typed correction superseded the row, so
       "the payer was asked and answered" is a count, not a guess. */
    acceptedFrom: text("accepted_from", {
      enum: ["agreed", "reader", "provider", "human"],
    }),
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
    /* What the payer submitted — a file or a form (two-eyes-receipt D17).
       It does *not* decide the door of the next attempt any more: that is
       read from the accepted fields below. The admin feed and the `human`
       evidence rule keep reading it with its original meaning. */
    proofMode: text("proof_mode", { enum: ["receipt", "transfer"] }).notNull(),
    /* From customer input (transfer door), from the CEP (receipt door),
       or — since two-eyes-receipt D17 — from what the two readings agreed
       on. All four present (with `claimedAmountCents`) is what makes the
       next attempt a transfer call. */
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
    /* automated-collections-api D3/D7: the caller's own customer
       reference, denormalised at submission for the same reason as the
       WispHub customer fields above — the history and the webhook must
       not depend on the link row. Null on a panel payment. */
    customerRef: text("customer_ref"),
    /* automated-collections-api D7: what was asked at submission. The
       classification compares against this number, and a retry days
       later compares against the same one — never against a link that
       was re-priced meanwhile. Null on a panel payment, whose ask is
       read fresh from WispHub at the verdict (direct-payment D14). */
    askedCents: integer("asked_cents"),
    /* automated-collections-api D12: a payment on a test link. Readable
       through the API so a developer can test their own polling, and
       excluded from the fee, the panel feed and every real total. */
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
    /* What is registered against the WispHub debt (partial-payment D5/D9:
       what arrived, applied) — the number every retry registers again */
    registeredCents: integer("registered_cents"),
    /* The action queue rides the payment row (reconnection-queue spec
       D2; vocabulary generalized by integrations-hub D7). `done` = the
       mapped action completed (WispHub v1: reconnected, or registered
       under `register_only`); `withheld` = deliberately not restored
       (partial D13); `observation` = the gate held the action back and
       the business executes by hand (integrations-hub D4/D5).
       automated-collections-api D8/FR-026: an API payment's mapped
       action is its VERDICT's webhook — `queued` while it is retried,
       `done` when the endpoint accepted it, `failed` when the schedule
       is spent; null when no address is registered. Deliveries of
       earlier states never write this column. */
    actionOutcome: text("action_outcome", {
      enum: ["queued", "done", "withheld", "failed", "observation"],
    }),
    actionAttempts: integer("action_attempts").notNull().default(0),
    actionDoneAt: integer("action_done_at", { mode: "timestamp_ms" }),
    wisphubInvoiceId: integer("wisphub_invoice_id"),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }),
    paymentRegisteredAt: integer("payment_registered_at", { mode: "timestamp_ms" }),
    /* D6's split: `lastError` above is the validation error; this one is
       the action's. One name for two failures was only tolerable across
       two tables. */
    actionError: text("action_error"),
    /* integrations-hub D5: what the mapping WOULD have executed, written
       at a verdict the observation gate held back — the action plus the
       threshold's answer ("register_and_reconnect:reconnect" /
       "register_and_reconnect:withhold" / "register_only"). Null on
       every row that really dispatched. */
    observedAction: text("observed_action"),
    /* Born nullable with no semantics (D6): phase 4's child spec defines
       exacto / corto / excedente; reserved now so the busiest table
       migrates once. */
    reconciliationClass: text("reconciliation_class", { enum: ["exact", "short", "over"] }),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_link_idx").on(t.paymentLinkId),
    index("payments_due_idx").on(t.status, t.nextValidationAt),
    index("payments_action_due_idx").on(t.actionOutcome, t.nextAttemptAt),
    index("payments_business_created_idx").on(t.businessId, t.createdAt),
    /* presence-freshness D5/D6: `MAX(payment_registered_at)` per tenant
       is the pulse and the display cache's key, read every 30 s per open
       Cobros tab and on every payer-page render. Covering index, so the
       read is one seek — measured against the `(business_id, created_at)`
       index it walked every payment of the tenant. */
    index("payments_business_registered_idx").on(t.businessId, t.paymentRegisteredAt),
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

/* The integration: one per business (pivot D10), the single house of
   everything that lets the oracle act (integrations-hub D2). No row —
   or a row with no key — is "not connected", exactly the old empty
   `wisphub_api_key`. The key is stored like the business's other tenant
   credentials (payments-and-classes D7 settled the posture). */
export const integrations = sqliteTable(
  "integrations",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    provider: text("provider", { enum: ["wisphub"] })
      .notNull()
      .default("wisphub"),
    /* Nullable: a row can be born from a dials-only save; the channel
       stays "unavailable" until the key lands (D2). */
    apiKey: text("api_key"),
    /* Which WispHub installation this business's key belongs to
       (provider-address-per-isp D1/D5/D6). A catalogue KEY, never a URL:
       the address is resolved from `wisphub/installations.ts`, so no row
       can name an origin the platform does not compile in (D1).

       Nullable with no default and no backfill (D6), and null is a
       meaning, not a gap: "not chosen", which resolves to the platform
       default. That is every row that existed before this feature, and
       it is how they carry over untouched (FR-002) — `wisphubFor` reads
       null and falls through to `WISPHUB_BASE_URL`, then to wisphub.net,
       exactly the behaviour those rows had yesterday (D5). */
    installation: text("installation"),
    /* integrations-hub D3: two actions, no "nothing" — money that
       arrived and goes unregistered makes the ISP's books lie. */
    exactAction: text("exact_action", { enum: ["register_and_reconnect", "register_only"] })
      .notNull()
      .default("register_and_reconnect"),
    shortAction: text("short_action", { enum: ["register_and_reconnect", "register_only"] })
      .notNull()
      .default("register_and_reconnect"),
    overAction: text("over_action", { enum: ["register_and_reconnect", "register_only"] })
      .notNull()
      .default("register_and_reconnect"),
    /* partial-payment D2/D4, moved house: both must hold, and they only
       mean anything under `register_and_reconnect` on the short row. */
    thresholdPercent: integer("threshold_percent").notNull().default(100),
    floorCents: integer("floor_cents").notNull().default(0),
    /* provisional-release D10 as amended (integrations-hub D8): the
       pre-verdict switch lives here now. */
    provisionalReleaseEnabled: integer("provisional_release_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    /* integrations-hub D4: the master switch. False = observation —
       zero writes to WispHub. New rows are born observing; the phase-5
       migration backfilled existing businesses with true. */
    actionsEnabled: integer("actions_enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("integrations_business_idx").on(t.businessId)],
);

/* The dispatch ledger (integrations-hub D6): one row per action really
   dispatched, carrying the reconciliation class (pivot Open item 5 —
   never just "validated"). The retry schedule stays on the payment row;
   this table is the ledger the queue writes through, and D17's webhooks
   arrive later as its second reader. A gated verdict writes NO row —
   the payment's `observation` outcome is that record. */
export const integrationEvents = sqliteTable(
  "integration_events",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    integrationId: text("integration_id")
      .notNull()
      .references(() => integrations.id),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    class: text("class", { enum: ["exact", "short", "over"] }).notNull(),
    action: text("action", { enum: ["register_and_reconnect", "register_only"] }).notNull(),
    status: text("status", { enum: ["dispatched", "acked", "failed"] })
      .notNull()
      .default("dispatched"),
    error: text("error"),
    createdAt: createdAt(),
    ackedAt: integer("acked_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("integration_events_business_idx").on(t.businessId, t.createdAt),
    index("integration_events_payment_idx").on(t.paymentId),
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
    /* `fee_reversal` (D2 amendment): the system giving a contradicted
       row's fee back when the same link's fresh submission confirms —
       keyed on the reversed row's payment_id, idempotent like the fee */
    kind: text("kind", {
      enum: ["welcome_bonus", "top_up", "validation_fee", "fee_reversal", "adjustment"],
    }).notNull(),
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
    uniqueIndex("credit_entries_topup_idx")
      .on(t.topUpId)
      .where(sql`kind = 'top_up'`),
    uniqueIndex("credit_entries_reversal_payment_idx")
      .on(t.paymentId)
      .where(sql`kind = 'fee_reversal'`),
    uniqueIndex("credit_entries_bonus_user_idx")
      .on(t.grantedToUserId)
      .where(sql`kind = 'welcome_bonus'`),
  ],
);

/* The SPEI validation engine's record (consta-api-merge D1, D3): the two
   tables Consta kept in its own database while it was a separate service,
   now beside the payment they describe. `business_id` replaces the
   engine's `api_key_id` — the business is the tenant identity; there is
   no per-business credential for the engine any more. */

/* Append-only log (validation spec D6, amended by D15): one row per
   request that reached the provider and got any response back, non-2xx
   included — apiCEP bills a credit for a request it rejects with 400
   (measured 2026-08-19), so a log of successes was not a billing record.
   Never UPDATE/DELETE — billing is a SUM over this table. */
export const validations = sqliteTable(
  "validations",
  {
    id: id(),
    /* consta-api-merge D3: who the call was made for. NULL is the
       platform's own top-up (prepaid-credit D6) — the one caller that
       never had a business key and still needs none. Every per-business
       read filters on it; the trust block can never fuse a platform row
       into a tenant's chains. */
    businessId: text("business_id").references(() => businesses.id),
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
    /* trust-layer D1/D7 — history refs. Sending `customer_ref` is the
       opt-in for history collection; `payment_ref` chains the attempts of
       one payment. Never interpreted, never joined against anything but
       themselves, and stored on failed rows too: the log stays faithful.
       Every trust number is a SUM over these at request time — no
       aggregate tables, ever.
       consta-api-merge D5: `customer_ref` is the link's own customer
       identity, undisguised — the usuario for a panel link, the caller's
       reference for an API link — because the row now sits in the same
       database as the link, three tables away; the HMAC that hid it on
       the wire retired with the wire (research R4). NULL on top-ups. */
    customerRef: text("customer_ref"),
    paymentRef: text("payment_ref"),
    createdAt: createdAt(),
  },
  (t) => [
    index("validations_business_idx").on(t.businessId, t.createdAt),
    index("validations_customer_idx").on(t.businessId, t.customerRef),
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
    /* consta-api-merge D3: as on `validations` — NULL is the platform's
       own top-up (prepaid-credit D6) */
    businessId: text("business_id").references(() => businesses.id),
    /* Which reader saw the file — the routing decision of D2, recorded so
       a caller (and we) can tell the two paths apart after the fact */
    source: text("source", { enum: ["reader", "provider-ocr"] }).notNull(),
    /* `illegible` (two-eyes-receipt D2): the model said it could read no
       field at all, so the file was refused before a credit was spent —
       the sibling of `not_a_receipt`, and countable apart from it.
       `gated` no longer means "refused": since D3 a gated reading goes to
       the provider with its hole, and the word is kept for the row. */
    outcome: text("outcome", {
      enum: [
        "passed",
        "gated",
        "not_a_receipt",
        "unreadable",
        "refused",
        "routed",
        "illegible",
      ],
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
    /* D15/D16: the soft signals, recorded so their false-alarm rate is a
       query and not a guess — `shape` is a verdict on the reading, and
       `suggested_bank` is what the payer was offered to confirm */
    shape: text("shape", { enum: ["ok", "mismatch", "unknown"] }),
    suggestedBank: text("suggested_bank"),
    /* two-eyes-receipt D2 (R7): what the model said about the picture it
       saw — 'none' is the one legibility that refuses before spending.
       Null on a text reading (a PDF has no photograph to judge, D15) and
       when the model omitted the field, which is read as 'full'. */
    legibility: text("legibility", { enum: ["full", "partial", "none"] }),
    /* two-eyes-receipt D19: the comparison, recorded beside the two
       readings it compared, for every owner — a business payment and a
       platform top-up alike. This row, not `payments`, is where the
       measurement of FR-018 is counted, because a top-up has no payment
       row. Same words as on `payments`. */
    readingCheck: text("reading_check", { enum: ["agreed", "disputed", "blind"] }),
    /* JSON array, as on `payments` (D8, D20) */
    disputedFields: text("disputed_fields"),
    /* As on `payments` (D5): which side read nothing */
    blindSide: text("blind_side", { enum: ["provider", "reader", "both"] }),
    /* As on `payments` (D7), minus 'human': a typed correction reads
       nothing, so it never writes an extraction row */
    acceptedFrom: text("accepted_from", { enum: ["agreed", "reader", "provider"] }),
    /* two-eyes-receipt D19: what the *provider* read, verbatim, on the
       same row as what we read — so "who was right" is a row-by-row
       comparison and not a reconstruction. Cents here, as everywhere
       (constitution II); converted by `amountToCents` in `apicep.ts`. */
    providerTrackingKey: text("provider_tracking_key"),
    providerAmountCents: integer("provider_amount_cents"),
    rawOutput: text("raw_output"),
    /* Set only when the reading went on to buy a provider call. NULL on
       every refusal, which is what makes "refused, and no credit spent" a
       single query (two-eyes-receipt D10). */
    validationId: text("validation_id").references(() => validations.id),
    createdAt: createdAt(),
  },
  (t) => [index("extractions_business_idx").on(t.businessId, t.createdAt)],
);

/* ---- The public collections API (automated-collections-api): the
   business's own software as a second actor, and the webhook that closes
   the loop without a human. Every table carries `business_id` and every
   query filters by the credential's business (constitution V). ---- */

/* automated-collections-api D11: the API credential — a second kind of
   actor, a credential and not a membership (plan, Complexity Tracking).
   It resolves to exactly one business and carries no role; it never
   passes through `requireArea`. Mirrors the engine's former key table
   (`apps/consta/src/db/schema.ts`, deleted by consta-api-merge): only
   the SHA-256 of `dk_<32 hex>` is stored, the plaintext exists once in
   the issuing response (constitution V: a credential the product only
   compares is hashed). The WispHub key on `integrations` is stored as it
   is because Devolada must *send* it — the asymmetry is deliberate. */
export const apiCredentials = sqliteTable(
  "api_credentials",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    /* What the business called it, so the panel can tell two apart */
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    /* The last 4 characters, so the panel can name which credential it is
       without ever showing the key again (FR-003) */
    keyTail: text("key_tail").notNull(),
    /* automated-collections-api D12: a credential is real or test, never
       both. A test credential creates test links; their payments are test
       payments. */
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
    /* Touched on every authenticated request, so a business can retire a
       credential it no longer recognises */
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    /* Revocation is a timestamp, never a delete (FR-004): the row stays
       so the panel can still name it, and the hash can never match again */
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("api_credentials_business_idx").on(t.businessId, t.createdAt)],
);

/* automated-collections-api D10 (FR-012): where a business's outcomes
   go — one address per business (spec assumption). No secret on this
   row, on purpose: deliveries are signed with Devolada's own private key,
   one set for the whole platform, held in the Worker secret
   `WEBHOOK_SIGNING_KEYS` and never in a business table. The business has
   nothing to store, nothing that can leak and nothing to rotate; the row
   is an address and its health. */
export const apiWebhooks = sqliteTable(
  "api_webhooks",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .unique()
      .references(() => businesses.id),
    /* Must protect the message in transit (FR-038): the handler refuses
       anything that is not https with INSECURE_URL */
    url: text("url").notNull(),
    /* What the panel's health line reads (FR-018): reset to 0 by a 2xx,
       incremented by every attempt that was not */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastFailureAt: integer("last_failure_at", { mode: "timestamp_ms" }),
    lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
);

/* automated-collections-api D8: the queue is the row, exactly as the
   reconnection queue is the payment row (reconnection-queue D2). A first
   attempt runs inline at the verdict under `waitUntil`; retries are
   claimed by a lease in a sweep that rides the every-minute cron — no
   new trigger (constitution). Backoff [1, 5, 15, 60, 240] minutes, the
   same five waits the reconnection queue uses, so the product has one
   retry rhythm to explain; each attempt waits 10 s for a 2xx (FR-016).
   Transitions: pending → delivered on a 2xx; pending → pending with a
   later `next_attempt_at` on anything else while waits remain; pending →
   failed when the schedule is spent; failed → pending, same event id,
   same payload, when the business asks for a re-send (FR-041). */
export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    /* Null is possible for a future event that is not about one payment */
    paymentId: text("payment_id").references(() => payments.id),
    /* What the caller uses to recognise a repeat (FR-014): at least once,
       never exactly once, so the same id travels on every attempt and on
       a re-send */
    eventId: text("event_id").notNull().unique(),
    /* automated-collections-api D17: `payment.<status>` for every status
       the payment row enters — the row's own word, never a synonym */
    eventType: text("event_type").notNull(),
    /* automated-collections-api D9: the body, rendered once at enqueue
       and never re-rendered. A retry four hours later must deliver what
       the verdict said, not what the row looks like now — and a re-send
       is byte-identical, so its event id still holds. */
    payload: text("payload").notNull(),
    /* automated-collections-api D10: the `kid` that signed the latest
       attempt, for settling arguments (FR-026). A re-send may carry a
       newer one than the first attempt did. */
    keyId: text("key_id"),
    status: text("status", { enum: ["pending", "delivered", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /* When the sweep may touch the row again. Null = terminal, or a
       lease held by a running sweep (the reconnection queue's shape). */
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }),
    /* What the endpoint answered, for the panel and for settling
       arguments (FR-026). Null when it never answered. */
    responseStatus: integer("response_status"),
    /* The last attempt's failure, or SIGNING_KEY_MISSING when the
       platform's signing key is unset (D10, constitution VIII) */
    lastError: text("last_error"),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [
    /* The sweep's claim */
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    /* The panel's delivery list, and GET /v1/webhook/deliveries */
    index("webhook_deliveries_business_created_idx").on(t.businessId, t.createdAt),
    index("webhook_deliveries_payment_idx").on(t.paymentId),
  ],
);

/* automated-collections-api D14 (FR-008): the first response to a POST
   carrying `Idempotency-Key`, replayed verbatim on a repeat. Its own
   table rather than a column on `payment_links`, because FR-008 must
   return *the first response*, not merely avoid a second write — and
   because a key whose request failed validation is remembered too, which
   is the case that otherwise creates duplicates on a retried network
   failure. Swept after 24 hours by the cron that also expires
   `rate_counters` buckets. */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    /* The caller's own key, opaque; unique per business, never across */
    key: text("key").notNull(),
    /* The first response body, as sent */
    response: text("response").notNull(),
    statusCode: integer("status_code").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("idempotency_keys_business_key_idx").on(t.businessId, t.key),
    index("idempotency_keys_created_idx").on(t.createdAt),
  ],
);

/* automated-collections-api D13 (FR-024): the per-business rate limit
   as D1 counters — the house pattern (`HOURLY_ATTEMPT_BUDGET`,
   `UPLOAD_HOURLY_BUDGET` count rows in D1 over a window), and the one
   that can be asserted deterministically on real D1 in the test layer.
   `bucket` is the minute as epoch minutes; the request that takes a
   business's count past 120 is refused with RATE_LIMITED and a
   Retry-After of the seconds left in that minute. A test credential
   shares its business's bucket: the limit protects the platform from one
   business's traffic, and test traffic is that business's traffic. Old
   buckets are deleted by the same sweep that expires idempotency keys. */
export const rateCounters = sqliteTable(
  "rate_counters",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    bucket: integer("bucket").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("rate_counters_business_bucket_idx").on(t.businessId, t.bucket)],
);

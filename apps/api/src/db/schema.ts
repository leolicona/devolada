import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    folio: text("folio").notNull().unique(),
    wisphubCustomerId: text("wisphub_customer_id").notNull(),
    customerName: text("customer_name").notNull(),
    customerZone: text("customer_zone"),
    /* Copied at record time (receipt spec D4): reading it back from
       WispHub would make the receipt fail exactly when WispHub is down */
    customerPhone: text("customer_phone"),
    monthlyFeeCents: integer("monthly_fee_cents").notNull(),
    serviceFeeCents: integer("service_fee_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    reconnectionStatus: text("reconnection_status", {
      enum: ["queued", "reconnected", "failed"],
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

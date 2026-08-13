import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  passwordHash: text("password_hash"),
  passwordSalt: text("password_salt"),
  wisphubApiKey: text("wisphub_api_key"),
  /* Fee the end customer pays, and the store's share of it.
     The platform's share is the difference. */
  serviceFeeCents: integer("service_fee_cents").notNull().default(1500),
  storeCommissionCents: integer("store_commission_cents").notNull().default(900),
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
    /* null until the invitation is accepted */
    passwordHash: text("password_hash"),
    passwordSalt: text("password_salt"),
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
    createdAt: createdAt(),
  },
  (t) => [
    index("charges_store_idx").on(t.storeId),
    index("charges_isp_created_idx").on(t.ispId, t.createdAt),
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
    /* token issued by Agnostic Auth /auth/initiate */
    token: text("token").notNull().unique(),
    status: text("status", { enum: ["sent", "accepted"] })
      .notNull()
      .default("sent"),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_store_idx").on(t.storeId)],
);

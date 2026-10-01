import type { Context } from "hono";
import { and, desc, eq, inArray, like, ne, or, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import {
  businesses,
  integrations,
  member,
  payments,
  providerQuota,
  session as sessionTable,
  storeInvitations,
  storeLedger,
  stores,
  user as userTable,
} from "../../db/schema";
import { capabilityNames } from "../../integrations/registry";
import { nationalPhone } from "../../phone";
import { toWhatsAppPhone, whatsAppLink } from "../../receipt";
import { isUniqueViolation } from "../../direct-payments/validation";
import {
  decodeLedgerCursor,
  encodeLedgerCursor,
  heldByPair,
  heldCents,
  ledgerRowsOf,
  movementsOf,
  recordCorrection,
} from "../../store-ledger";
import {
  adjustCredit,
  balanceCents,
  effectiveFeeCents,
  listEntries,
  stepFor,
} from "../../credit";
import {
  getNumberSetting,
  isSettingKey,
  listSettings,
  setSetting,
  validateSetting,
} from "../../platform/settings";
import {
  STORE_CHANNEL_CAPABILITIES,
  type CorrectionRequest,
  type CorrectionResponse,
  type CreateStoreRequest,
  type CreateStoreResponse,
  type PatchBusinessRequest,
  type PatchStoreRequest,
  type PlatformBusinessRow,
  type PlatformLedgerResponse,
  type ProviderQuotaResponse,
  type StoreInvitation,
  type StoreRow,
} from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

export async function getPlatformSettings(c: Ctx) {
  const db = drizzle(c.env.DB);
  return c.json({ success: true, data: { settings: await listSettings(db) } });
}

/* payment-without-receipt D19 (FR-038): the provider's remaining calls as
   its latest answer said — a platform row, naming no business. Null until
   an answer carried the header. */
export async function getProviderQuota(c: Ctx) {
  const [row] = await drizzle(c.env.DB).select().from(providerQuota).where(eq(providerQuota.provider, "apicep"));
  const data: ProviderQuotaResponse = row
    ? { provider: "apicep", remaining: row.remaining, observedAt: row.observedAt.getTime() }
    : null;
  return c.json({ success: true, data });
}

/* operator-panel D4: one key per write, validated per D1, appended with its author */
export async function postPlatformSetting(c: Ctx, key: string, value: unknown) {
  if (!isSettingKey(key)) {
    return c.json({ success: false, error: { code: "INVALID_SETTING" } }, 400);
  }
  const checked = validateSetting(key, value);
  if (!checked.ok) return c.json({ success: false, error: { code: "INVALID_SETTING" } }, 400);
  const db = drizzle(c.env.DB);
  const row = await setSetting(db, key, checked.value, c.get("actor").userId);
  return c.json({ success: true, data: { key, value: row.value, createdAt: row.createdAt.getTime() } }, 201);
}

async function toRow(db: ReturnType<typeof drizzle>, b: typeof businesses.$inferSelect, capCents: number): Promise<PlatformBusinessRow> {
  const [balance, feeCents, [integration], [held]] = await Promise.all([
    balanceCents(db, b.id),
    effectiveFeeCents(db, b),
    db.select().from(integrations).where(eq(integrations.businessId, b.id)),
    db.select({ total: sum(storeLedger.cents) }).from(storeLedger).where(eq(storeLedger.businessId, b.id)),
  ]);
  return {
    id: b.id,
    name: b.name,
    email: b.email,
    status: b.status,
    balanceCents: balance,
    step: stepFor(balance, feeCents, capCents),
    feeCents,
    feeOverrideCents: b.feeOverrideCents,
    createdAt: b.createdAt.getTime(),
    /* cash-at-stores D7 */
    storeChannel: { on: b.storeChannelOn, since: b.storeChannelSince?.getTime() ?? null },
    /* FR-007: read with no network call, from the adapter's own list */
    capabilities: capabilityNames(integration ?? null),
    /* D19: every store's SUM for this business */
    storeHeldCents: Number(held?.total ?? 0),
  };
}

/* operator-panel D7: the map, searchable by name or email */
export async function listPlatformBusinesses(c: Ctx, q: string | undefined) {
  const db = drizzle(c.env.DB);
  const needle = q?.trim() ? `%${q.trim()}%` : null;
  /* "By owner email" means the owners of record — the memberships — not
     the signup copy on the business row, which stops being the owner
     after a transfer (business-and-memberships D11). */
  let ownedIds: string[] = [];
  if (needle) {
    const owned = await db
      .select({ orgId: member.organizationId })
      .from(member)
      .innerJoin(userTable, eq(userTable.id, member.userId))
      .where(and(eq(member.role, "owner"), like(userTable.email, needle)));
    const orgIds = owned.map((o) => o.orgId);
    if (orgIds.length) {
      const byOrg = await db.select({ id: businesses.id }).from(businesses).where(inArray(businesses.orgId, orgIds));
      ownedIds = byOrg.map((b) => b.id);
    }
  }
  const rows = await db
    .select()
    .from(businesses)
    .where(
      needle
        ? or(like(businesses.name, needle), ...(ownedIds.length ? [inArray(businesses.id, ownedIds)] : []))
        : undefined,
    )
    .orderBy(desc(businesses.createdAt))
    .limit(100);
  const capCents = await getNumberSetting(db, "negative_cap_cents");
  const data = [];
  for (const b of rows) data.push(await toRow(db, b, capCents));
  return c.json({ success: true, data: { businesses: data } });
}

export async function getPlatformBusiness(c: Ctx, id: string) {
  const db = drizzle(c.env.DB);
  const [b] = await db.select().from(businesses).where(eq(businesses.id, id));
  if (!b) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  const capCents = await getNumberSetting(db, "negative_cap_cents");
  const [row, entries] = await Promise.all([toRow(db, b, capCents), listEntries(db, b.id)]);
  return c.json({ success: true, data: { ...row, ...entries } });
}

/* operator-panel D6, and cash-at-stores D7: the fee override and the
   store channel's switch. The switch refuses an integration without the
   three capabilities (FR-007) and a second business (FR-006: the deferred
   decision of which stores serve which business lives in this guard, not
   in a setting — lifting it is a spec). `since` is set the first time and
   never cleared (FR-034). */
export async function patchPlatformBusiness(c: Ctx, id: string, body: PatchBusinessRequest) {
  const db = drizzle(c.env.DB);
  const [b] = await db.select().from(businesses).where(eq(businesses.id, id));
  if (!b) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  const patch: Partial<typeof businesses.$inferInsert> = {};
  if (body.feeOverrideCents !== undefined) patch.feeOverrideCents = body.feeOverrideCents;
  if (body.storeChannel === true && !b.storeChannelOn) {
    const [integration] = await db.select().from(integrations).where(eq(integrations.businessId, id));
    const names = capabilityNames(integration ?? null);
    if (!STORE_CHANNEL_CAPABILITIES.every((n) => names.includes(n))) {
      return c.json({ success: false, error: { code: "NOT_CAPABLE" } }, 409);
    }
    const [other] = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.storeChannelOn, true), ne(businesses.id, id)))
      .limit(1);
    if (other) return c.json({ success: false, error: { code: "ONE_BUSINESS_AT_A_TIME" } }, 409);
    patch.storeChannelOn = true;
    patch.storeChannelSince = b.storeChannelSince ?? new Date();
  }
  if (body.storeChannel === false) patch.storeChannelOn = false;
  const [updated] = Object.keys(patch).length
    ? await db.update(businesses).set(patch).where(eq(businesses.id, id)).returning()
    : [b];
  const capCents = await getNumberSetting(db, "negative_cap_cents");
  return c.json({ success: true, data: await toRow(db, updated, capCents) });
}

/* operator-panel D5 */
export async function postAdjustment(c: Ctx, id: string, cents: number, reason: string) {
  const db = drizzle(c.env.DB);
  const [b] = await db.select().from(businesses).where(eq(businesses.id, id));
  if (!b) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  const row = await adjustCredit(c.env, db, b, cents, reason, c.get("actor").userId);
  return c.json(
    { success: true, data: { id: row.id, cents: row.cents, reason: row.reason, createdAt: row.createdAt.getTime() } },
    201,
  );
}

/* ---- cash-at-stores: the operator's stores (contracts/platform-stores-api.md) ---- */

/* D4: seven days, as FR-002 says */
const INVITATION_DAYS = 7;

const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/* 32 random bytes, base64url: the link's whole secret */
function invitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/* D4: the store invitation's address. RED_BASE_URL unset is a developer's
   machine (constitution VIII): the link points at the local dev server,
   and the panel says so when it shows a localhost link. */
function redBase(env: Bindings): string {
  if (!env.RED_BASE_URL) console.warn("RED_BASE_URL is not set: store invitations point at http://localhost:5177");
  return (env.RED_BASE_URL ?? "http://localhost:5177").replace(/\/$/, "");
}

/* D4: a new token, the open invitation replaced in the same batch (FR-004).
   The plaintext leaves only in this answer; the row keeps its hash. */
async function issueInvitation(
  c: Ctx,
  db: ReturnType<typeof drizzle>,
  store: typeof stores.$inferSelect,
  now: Date,
): Promise<StoreInvitation> {
  const token = invitationToken();
  const expiresAt = new Date(now.getTime() + INVITATION_DAYS * 24 * 3600 * 1000);
  await db.batch([
    db
      .update(storeInvitations)
      .set({ status: "replaced" })
      .where(and(eq(storeInvitations.storeId, store.id), eq(storeInvitations.status, "sent"))),
    db.insert(storeInvitations).values({
      storeId: store.id,
      tokenHash: await sha256Hex(token),
      expiresAt,
      createdByUserId: c.get("actor").userId,
      createdAt: now,
    }),
  ]);
  const url = `${redBase(c.env)}/invitacion/${token}`;
  const text = `Hola, ${store.shopkeeperName}. Te invitamos a cobrar con Devolada en ${store.name}. Activa tu cuenta aquí: ${url}`;
  return { url, expiresAt: expiresAt.getTime(), waLink: whatsAppLink(text, toWhatsAppPhone(store.phone)) };
}

/* FR-001: every store, with the businesses it collects for — the one with
   the channel on (for an active store, FR-006) and every business whose
   cash it still holds */
async function storeRowsOf(db: ReturnType<typeof drizzle>, rows: (typeof stores.$inferSelect)[]): Promise<StoreRow[]> {
  const [held, [channel]] = await Promise.all([
    heldByPair(db, { storeIds: rows.map((r) => r.id) }),
    db.select({ id: businesses.id, name: businesses.name }).from(businesses).where(eq(businesses.storeChannelOn, true)).limit(1),
  ]);
  const businessIds = [...new Set(held.filter((h) => h.heldCents !== 0).map((h) => h.businessId))];
  const names = new Map<string, string>(channel ? [[channel.id, channel.name]] : []);
  if (businessIds.length) {
    for (const b of await db.select({ id: businesses.id, name: businesses.name }).from(businesses).where(inArray(businesses.id, businessIds))) {
      names.set(b.id, b.name);
    }
  }
  return rows.map((r) => {
    const mine = held.filter((h) => h.storeId === r.id);
    const ids = new Set(mine.filter((h) => h.heldCents !== 0).map((h) => h.businessId));
    if (channel && r.status === "active") ids.add(channel.id);
    return {
      id: r.id,
      name: r.name,
      address: r.address,
      shopkeeperName: r.shopkeeperName,
      phone: r.phone,
      status: r.status,
      createdAt: r.createdAt.getTime(),
      collectsFor: [...ids].map((businessId) => ({
        businessId,
        businessName: names.get(businessId) ?? "",
        heldCents: mine.find((h) => h.businessId === businessId)?.heldCents ?? 0,
      })),
    };
  });
}

export async function listStores(c: Ctx) {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(stores).orderBy(desc(stores.createdAt));
  return c.json({ success: true, data: { stores: await storeRowsOf(db, rows) } });
}

/* FR-002: a store, born `invited`, with its first invitation */
export async function createStore(c: Ctx, body: CreateStoreRequest) {
  const db = drizzle(c.env.DB);
  const now = new Date();
  /* D3, L5: the phone as the core reads it — the schema refused anything else */
  const phone = nationalPhone(body.phone)!;
  let store: typeof stores.$inferSelect;
  try {
    [store] = await db
      .insert(stores)
      .values({
        name: body.name,
        address: body.address,
        shopkeeperName: body.shopkeeperName,
        phone,
        createdByUserId: c.get("actor").userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ success: false, error: { code: "PHONE_TAKEN" } }, 409);
    throw e;
  }
  const invitation = await issueInvitation(c, db, store, now);
  const [row] = await storeRowsOf(db, [store]);
  const data: CreateStoreResponse = { store: row, invitation };
  return c.json({ success: true, data }, 201);
}

/* FR-003, FR-005, FR-014: edit, suspend, reactivate. A new phone moves the
   shopkeeper's sign-in name in the same batch; a suspension deletes the
   shopkeeper's sessions; reactivating a store nobody accepted returns it
   to `invited`, where its open invitation works again within its seven
   days (data-model, /speckit-analyze M6). Nothing is ever deleted but
   sessions. */
export async function patchStore(c: Ctx, id: string, body: PatchStoreRequest) {
  const db = drizzle(c.env.DB);
  const [store] = await db.select().from(stores).where(eq(stores.id, id));
  if (!store) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  const now = new Date();
  const phone = body.phone !== undefined ? nationalPhone(body.phone)! : undefined;
  const patch: Partial<typeof stores.$inferInsert> = { updatedAt: now };
  if (body.name !== undefined) patch.name = body.name;
  if (body.address !== undefined) patch.address = body.address;
  if (body.shopkeeperName !== undefined) patch.shopkeeperName = body.shopkeeperName;
  if (phone !== undefined) patch.phone = phone;
  if (body.status === "suspended") patch.status = "suspended";
  if (body.status === "active") patch.status = store.userId ? "active" : "invited";

  const statements = [db.update(stores).set(patch).where(eq(stores.id, id)).returning()] as const;
  const extra = [
    ...(phone !== undefined && store.userId
      ? [db.update(userTable).set({ username: phone, displayUsername: phone }).where(eq(userTable.id, store.userId))]
      : []),
    ...(body.status === "suspended" && store.userId ? [db.delete(sessionTable).where(eq(sessionTable.userId, store.userId))] : []),
  ];
  let updated: typeof stores.$inferSelect;
  try {
    const [rows] = await db.batch([statements[0], ...extra]);
    [updated] = rows as (typeof stores.$inferSelect)[];
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ success: false, error: { code: "PHONE_TAKEN" } }, 409);
    throw e;
  }
  const [row] = await storeRowsOf(db, [updated]);
  return c.json({ success: true, data: row });
}

/* FR-004: re-send — a new token; the open one stops working */
export async function resendStoreInvitation(c: Ctx, id: string) {
  const db = drizzle(c.env.DB);
  const [store] = await db.select().from(stores).where(eq(stores.id, id));
  if (!store) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  if (store.userId) return c.json({ success: false, error: { code: "ALREADY_ACCEPTED" } }, 409);
  const invitation = await issueInvitation(c, db, store, new Date());
  return c.json({ success: true, data: { invitation } }, 201);
}

const LEDGER_PAGE = 20;

/* D21: one store's cash book for one business, for the operator */
export async function getStoreLedger(c: Ctx, storeId: string, businessId: string, rawCursor: string | undefined) {
  const db = drizzle(c.env.DB);
  const [store] = await db.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId));
  if (!store) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  const cursor = decodeLedgerCursor(rawCursor);
  if (cursor === "bad") return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  const [page, held] = await Promise.all([
    movementsOf(db, { storeId, businessIds: [businessId] }, cursor, LEDGER_PAGE),
    heldCents(db, storeId, businessId),
  ]);
  const data: PlatformLedgerResponse = {
    heldCents: held,
    rows: await ledgerRowsOf(db, page.rows),
    nextCursor: page.next ? encodeLedgerCursor(page.next) : null,
  };
  return c.json({ success: true, data });
}

/* D21 (FR-030): a correction, linked to a cash payment of this store and
   this business — anything else is 404 */
export async function postStoreCorrection(c: Ctx, storeId: string, businessId: string, body: CorrectionRequest) {
  const db = drizzle(c.env.DB);
  const [payment] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.id, body.paymentId),
        eq(payments.storeId, storeId),
        eq(payments.businessId, businessId),
        eq(payments.channel, "store"),
      ),
    );
  if (!payment) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  const row = await recordCorrection(db, {
    storeId,
    businessId,
    paymentId: payment.id,
    cents: body.cents,
    reason: body.reason,
    authorUserId: c.get("actor").userId,
  });
  const data: CorrectionResponse = { id: row.id, cents: row.cents, reason: row.reason ?? "", createdAt: row.createdAt.getTime() };
  return c.json({ success: true, data }, 201);
}

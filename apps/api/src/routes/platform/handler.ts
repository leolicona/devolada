import type { Context } from "hono";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { businesses, member, providerQuota, user as userTable } from "../../db/schema";
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
import type { PlatformBusinessRow, ProviderQuotaResponse } from "./schema";

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
  const [balance, feeCents] = await Promise.all([balanceCents(db, b.id), effectiveFeeCents(db, b)]);
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

/* operator-panel D6 */
export async function patchPlatformBusiness(c: Ctx, id: string, feeOverrideCents: number | null) {
  const db = drizzle(c.env.DB);
  const [b] = await db.select().from(businesses).where(eq(businesses.id, id));
  if (!b) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  await db.update(businesses).set({ feeOverrideCents }).where(eq(businesses.id, id));
  const capCents = await getNumberSetting(db, "negative_cap_cents");
  return c.json({ success: true, data: await toRow(db, { ...b, feeOverrideCents }, capCents) });
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

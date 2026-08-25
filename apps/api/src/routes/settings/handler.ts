import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { isps } from "../../db/schema";
import { WispHub, WispHubError } from "../../wisphub/client";
import type { SettingsPatchRequest, SettingsResponse, WispHubTestResponse } from "./schema";
import { speiBankIsKnown } from "../../direct-payments/validation";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

function ispGuard(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "isp") {
    return { error: c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403) };
  }
  return { actor, db: drizzle(c.env.DB) };
}

/* D1: the key never travels back — only enough of it to be recognised. */
function toSettings(isp: typeof isps.$inferSelect): SettingsResponse {
  return {
    serviceFeeCents: isp.serviceFeeCents,
    storeCommissionCents: isp.storeCommissionCents,
    /* D4: derived, so it cannot drift from the two numbers it comes from */
    platformShareCents: isp.serviceFeeCents - isp.storeCommissionCents,
    timezone: isp.timezone as SettingsResponse["timezone"],
    timeFormat: isp.timeFormat,
    wisphub: {
      configured: Boolean(isp.wisphubApiKey),
      keyTail: isp.wisphubApiKey ? isp.wisphubApiKey.slice(-4) : null,
    },
    /* Direct SPEI channel (direct-payment D3, D4). "configured" is what
       flips the payment pages from "unavailable" to instructions. */
    spei: {
      clabe: isp.speiClabe,
      bank: isp.speiBank,
      beneficiaryName: isp.speiBeneficiaryName,
      serviceFeeCents: isp.speiServiceFeeCents,
      effectiveServiceFeeCents: isp.speiServiceFeeCents ?? isp.serviceFeeCents,
      /* BUG-008: a bank stored before D16 can be set and still unusable, so
         `configured` alone would report a channel that silently refuses every
         payment. `bankUnknown` is what the settings screen shows the ISP. */
      bankUnknown: Boolean(isp.speiBank) && !speiBankIsKnown(isp),
      configured:
        Boolean(isp.speiClabe && isp.speiBeneficiaryName) && speiBankIsKnown(isp),
    },
    /* partial-payment D2/D4: the short-payment dial, defaults 100 / $0 */
    reconnection: {
      thresholdPercent: isp.reconnectionThresholdPercent,
      floorCents: isp.reconnectionFloorCents,
    },
  };
}

/* D2/D3: WispHub's own answer is the test. The two failures stay apart —
   a bad key is the ISP's problem, an outage is nobody's. */
async function testKey(apiKey: string, baseUrl?: string): Promise<WispHubTestResponse> {
  try {
    /* provider-latency D7: the configured base, like every other path */
    const customers = await new WispHub(apiKey, baseUrl).searchCustomers("a");
    return { ok: true, code: null, sampleCustomerCount: customers.length };
  } catch (e) {
    const code = e instanceof WispHubError ? e.code : "WISPHUB_UNAVAILABLE";
    return { ok: false, code, sampleCustomerCount: null };
  }
}

export async function getSettings(c: Ctx) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;
  const [isp] = await ctx.db.select().from(isps).where(eq(isps.id, ctx.actor.id));
  return c.json({ success: true, data: toSettings(isp) });
}

export async function patchSettings(c: Ctx, body: SettingsPatchRequest) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;
  const [isp] = await ctx.db.select().from(isps).where(eq(isps.id, ctx.actor.id));

  /* D4: the store's share cannot be larger than what the customer pays */
  const fee = body.serviceFeeCents ?? isp.serviceFeeCents;
  const commission = body.storeCommissionCents ?? isp.storeCommissionCents;
  if (commission > fee) {
    return c.json({ success: false, error: { code: "COMMISSION_EXCEEDS_FEE" } }, 400);
  }

  /* D3: a new key is always re-tested, and the result is reported, not enforced */
  const test = body.wisphubApiKey
    ? await testKey(body.wisphubApiKey, c.env.WISPHUB_BASE_URL)
    : null;

  await ctx.db
    .update(isps)
    .set({
      ...(body.serviceFeeCents !== undefined ? { serviceFeeCents: body.serviceFeeCents } : {}),
      ...(body.storeCommissionCents !== undefined
        ? { storeCommissionCents: body.storeCommissionCents }
        : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.timeFormat !== undefined ? { timeFormat: body.timeFormat } : {}),
      ...(body.wisphubApiKey !== undefined ? { wisphubApiKey: body.wisphubApiKey } : {}),
      ...(body.speiClabe !== undefined ? { speiClabe: body.speiClabe } : {}),
      ...(body.speiBank !== undefined ? { speiBank: body.speiBank } : {}),
      ...(body.speiBeneficiaryName !== undefined
        ? { speiBeneficiaryName: body.speiBeneficiaryName }
        : {}),
      ...(body.speiServiceFeeCents !== undefined
        ? { speiServiceFeeCents: body.speiServiceFeeCents }
        : {}),
      ...(body.reconnectionThresholdPercent !== undefined
        ? { reconnectionThresholdPercent: body.reconnectionThresholdPercent }
        : {}),
      ...(body.reconnectionFloorCents !== undefined
        ? { reconnectionFloorCents: body.reconnectionFloorCents }
        : {}),
    })
    .where(eq(isps.id, isp.id));

  const [updated] = await ctx.db.select().from(isps).where(eq(isps.id, isp.id));
  return c.json({
    success: true,
    data: {
      ...toSettings(updated),
      ...(test ? { wisphubTest: { ok: test.ok, code: test.code } } : {}),
    },
  });
}

export async function testWispHubKey(c: Ctx, apiKey?: string) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;

  let key = apiKey;
  if (!key) {
    const [isp] = await ctx.db.select().from(isps).where(eq(isps.id, ctx.actor.id));
    key = isp.wisphubApiKey ?? undefined;
  }
  if (!key) {
    return c.json({
      success: true,
      data: { ok: false, code: "WISPHUB_NOT_CONFIGURED", sampleCustomerCount: null },
    });
  }
  /* 200 either way: the test succeeded in telling us the answer (D2) */
  return c.json({ success: true, data: await testKey(key, c.env.WISPHUB_BASE_URL) });
}

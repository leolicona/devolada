import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { businesses } from "../../db/schema";
import { WispHub, WispHubError } from "../../wisphub/client";
import type { SettingsPatchRequest, SettingsResponse, WispHubTestResponse } from "./schema";
import { speiBankIsKnown } from "../../direct-payments/validation";
import { effectiveOverTreatment } from "../../direct-payments/classes";
import { integrationOf, upsertIntegration, type Integration } from "../../integrations/store";
import { roleCan } from "../../auth/roles";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

function ispGuard(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return { error: c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403) };
  }
  return { actor, db: drizzle(c.env.DB) };
}

/* D1: the key never travels back — only enough of it to be recognised.
   Since integrations-hub D2 the WispHub key and the reconnection dials
   live on the integration row; this response is a FAÇADE over both rows
   so Configuración keeps working until the phase-5 UI PR moves its
   cards to the integration detail (D9). */
function toSettings(
  business: typeof businesses.$inferSelect,
  integration: Integration | null,
): SettingsResponse {
  return {
    /* With the store network retired, this fee survives as the fallback
       the SPEI fee inherits when unset (direct-payment D3). */
    serviceFeeCents: business.serviceFeeCents,
    timezone: business.timezone as SettingsResponse["timezone"],
    timeFormat: business.timeFormat,
    wisphub: {
      configured: Boolean(integration?.apiKey),
      keyTail: integration?.apiKey ? integration.apiKey.slice(-4) : null,
    },
    /* Direct SPEI channel (direct-payment D3, D4). "configured" is what
       flips the payment pages from "unavailable" to instructions. */
    spei: {
      clabe: business.speiClabe,
      bank: business.speiBank,
      beneficiaryName: business.speiBeneficiaryName,
      serviceFeeCents: business.speiServiceFeeCents,
      effectiveServiceFeeCents: business.speiServiceFeeCents ?? business.serviceFeeCents,
      /* BUG-008: a bank stored before D16 can be set and still unusable, so
         `configured` alone would report a channel that silently refuses every
         payment. `bankUnknown` is what the settings screen shows the ISP. */
      bankUnknown: Boolean(business.speiBank) && !speiBankIsKnown(business),
      /* claimed-amount D5: the beneficiary name is recommended, not part
         of "configured" — apiCEP never required it. */
      configured: Boolean(business.speiClabe) && speiBankIsKnown(business),
    },
    /* partial-payment D2/D4: the short-payment dial, defaults 100 / $0.
       provisional-release D10: one switch next to them, no dials — the
       fixed rule lives in the spec, the same threshold and floor apply. */
    reconnection: {
      thresholdPercent: integration?.thresholdPercent ?? 100,
      floorCents: integration?.floorCents ?? 0,
      provisionalReleaseEnabled: integration?.provisionalReleaseEnabled ?? false,
    },
    /* payments-and-classes D1/D2: the policy and what it effectively
       means today — `credit` when the integration absorbs surplus. */
    reconciliationPolicy: {
      toleranceCents: business.toleranceCents,
      overTreatment: business.overTreatment,
      effectiveOverTreatment: effectiveOverTreatment(business, integration),
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
  const [business] = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.actor.id));
  const integration = await integrationOf(ctx.db, ctx.actor.id);
  const data = toSettings(business, integration);
  /* D3: a role that cannot update settings never sees the full CLABE or
     the key tail — masked to the last 4, like the key already is */
  if (!roleCan(ctx.actor.role, "settings", "update")) {
    data.wisphub = { ...data.wisphub, keyTail: null };
    data.spei = { ...data.spei, clabe: data.spei.clabe ? `••••${data.spei.clabe.slice(-4)}` : null };
  }
  return c.json({ success: true, data });
}

export async function patchSettings(c: Ctx, body: SettingsPatchRequest) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;
  /* D3: changing the CLABE is the owner's area, whatever else rides along */
  if (body.speiClabe !== undefined && !roleCan(ctx.actor.role, "clabe", "update")) {
    return c.json({ success: false, error: { code: "FORBIDDEN_FOR_ROLE" } }, 403);
  }
  const [business] = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.actor.id));

  /* D3: a new key is always re-tested, and the result is reported, not enforced */
  const test = body.wisphubApiKey
    ? await testKey(body.wisphubApiKey, c.env.WISPHUB_BASE_URL)
    : null;

  const businessPatch = {
      ...(body.serviceFeeCents !== undefined ? { serviceFeeCents: body.serviceFeeCents } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.timeFormat !== undefined ? { timeFormat: body.timeFormat } : {}),
      ...(body.speiClabe !== undefined ? { speiClabe: body.speiClabe } : {}),
      ...(body.speiBank !== undefined ? { speiBank: body.speiBank } : {}),
      ...(body.speiBeneficiaryName !== undefined
        ? { speiBeneficiaryName: body.speiBeneficiaryName }
        : {}),
      ...(body.speiServiceFeeCents !== undefined
        ? { speiServiceFeeCents: body.speiServiceFeeCents }
        : {}),
      ...(body.toleranceCents !== undefined ? { toleranceCents: body.toleranceCents } : {}),
      ...(body.overTreatment !== undefined ? { overTreatment: body.overTreatment } : {}),
  };
  /* Since the D2 move a patch can be integration-only — drizzle refuses
     an empty set, and there is nothing to write anyway. */
  if (Object.keys(businessPatch).length) {
    await ctx.db.update(businesses).set(businessPatch).where(eq(businesses.id, business.id));
  }

  /* integrations-hub D2: the key and the dials write to the integration
     row (created on first touch; a new row is born observing, D4). */
  const integrationPatch = {
    ...(body.wisphubApiKey !== undefined ? { apiKey: body.wisphubApiKey } : {}),
    ...(body.reconnectionThresholdPercent !== undefined
      ? { thresholdPercent: body.reconnectionThresholdPercent }
      : {}),
    ...(body.reconnectionFloorCents !== undefined ? { floorCents: body.reconnectionFloorCents } : {}),
    ...(body.provisionalReleaseEnabled !== undefined
      ? { provisionalReleaseEnabled: body.provisionalReleaseEnabled }
      : {}),
  };
  const integration = Object.keys(integrationPatch).length
    ? await upsertIntegration(ctx.db, business.id, integrationPatch)
    : await integrationOf(ctx.db, business.id);

  const [updated] = await ctx.db.select().from(businesses).where(eq(businesses.id, business.id));
  return c.json({
    success: true,
    data: {
      ...toSettings(updated, integration),
      ...(test ? { wisphubTest: { ok: test.ok, code: test.code } } : {}),
    },
  });
}

export async function testWispHubKey(c: Ctx, apiKey?: string) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;

  let key = apiKey;
  if (!key) {
    key = (await integrationOf(ctx.db, ctx.actor.id))?.apiKey ?? undefined;
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

import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { businesses } from "../../db/schema";
import type { SettingsPatchRequest, SettingsResponse } from "./schema";
import { speiBankIsKnown } from "../../direct-payments/validation";
import { effectiveOverTreatment } from "../../direct-payments/classes";
import { integrationOf, type Integration } from "../../integrations/store";
import { roleCan } from "../../auth/roles";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

function ispGuard(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return { error: c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403) };
  }
  return { actor, db: drizzle(c.env.DB) };
}

/* integrations-hub D9: the WispHub key and the reconnection dials left
   for the hub; Configuración keeps what belongs to the business itself.
   The integration row is still read — the effective surplus treatment
   depends on being connected (D2). */
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
    /* payments-and-classes D1/D2: the policy and what it effectively
       means today — `credit` when the integration absorbs surplus. */
    reconciliationPolicy: {
      toleranceCents: business.toleranceCents,
      overTreatment: business.overTreatment,
      effectiveOverTreatment: effectiveOverTreatment(business, integration),
    },
  };
}

export async function getSettings(c: Ctx) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;
  const [business] = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.actor.id));
  const integration = await integrationOf(ctx.db, ctx.actor.id);
  const data = toSettings(business, integration);
  /* D3: a role that cannot update settings never sees the full CLABE —
     masked to the last 4, like the key already was */
  if (!roleCan(ctx.actor.role, "settings", "update")) {
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

  const integration = await integrationOf(ctx.db, business.id);

  const [updated] = await ctx.db.select().from(businesses).where(eq(businesses.id, business.id));
  return c.json({
    success: true,
    data: {
      ...toSettings(updated, integration),
    },
  });
}


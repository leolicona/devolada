import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { businesses } from "../../db/schema";
import type { SettingsPatchRequest, SettingsResponse } from "./schema";
import { businessConfigured, speiBankIsKnown } from "../../direct-payments/validation";
import {
  collectHalves,
  collectKind,
  currentAccounts,
  parseAccounts,
  type StoredAccount,
} from "../../direct-payments/accounts";
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
    /* The birth default the SPEI fee inherits until one is saved
       (direct-payment D3); read-only since D9 — the page edits the
       SPEI fee alone. */
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
         payment. `bankUnknown` is what the settings screen shows the ISP.
         receipt-triage D32: the cuenta de cobro's bank is the one that
         matters. */
      bankUnknown: Boolean(collectHalves(business).bank) && !speiBankIsKnown(business),
      /* claimed-amount D5: the beneficiary name is recommended, not part
         of "configured" — apiCEP never required it.
         receipt-triage D32: nor is a CLABE any more — the cuenta de cobro,
         whatever its kind, registered with a bank the provider knows. */
      configured: businessConfigured(business),
      card: business.speiCard,
      cardBank: business.speiCardBank,
      phone: business.speiPhone,
      phoneBank: business.speiPhoneBank,
      /* receipt-triage D29: NULL reads `clabe` */
      collectKind: collectKind(business),
    },
    /* payments-and-classes D1/D2: the policy and what it effectively
       means today — `credit` when the integration absorbs surplus. */
    reconciliationPolicy: {
      toleranceCents: business.toleranceCents,
      overTreatment: business.overTreatment,
      effectiveOverTreatment: effectiveOverTreatment(business, integration),
    },
    /* payment-without-receipt D20 */
    payByReference: business.payByReference,
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
    const mask = (v: string | null) => (v ? `••••${v.slice(-4)}` : null);
    /* receipt-triage FR-016: the card and the phone read like the CLABE */
    data.spei = {
      ...data.spei,
      clabe: mask(data.spei.clabe),
      card: mask(data.spei.card),
      phone: mask(data.spei.phone),
    };
  }
  return c.json({ success: true, data });
}

export async function patchSettings(c: Ctx, body: SettingsPatchRequest) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;
  /* D3: changing the CLABE is the owner's area, whatever else rides along.
     receipt-triage D26/D29: so are the card, the phone and the choice of
     the cuenta de cobro — the same money, the same area. */
  const touchesAccounts =
    body.speiClabe !== undefined ||
    body.speiCard !== undefined ||
    body.speiCardBank !== undefined ||
    body.speiPhone !== undefined ||
    body.speiPhoneBank !== undefined ||
    body.speiCollectKind !== undefined;
  if (touchesAccounts && !roleCan(ctx.actor.role, "clabe", "update")) {
    return c.json({ success: false, error: { code: "FORBIDDEN_FOR_ROLE" } }, 403);
  }
  const [business] = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.actor.id));

  /* receipt-triage D29/D30 — the accounts, judged on the merged row: a
     patch may send one half of a pair and rely on the stored other. */
  let accountsPatch: Partial<typeof businesses.$inferInsert> = {};
  if (touchesAccounts) {
    const merged = {
      ...business,
      ...(body.speiClabe !== undefined ? { speiClabe: body.speiClabe } : {}),
      ...(body.speiBank !== undefined ? { speiBank: body.speiBank } : {}),
      ...(body.speiCard !== undefined ? { speiCard: body.speiCard } : {}),
      ...(body.speiCardBank !== undefined ? { speiCardBank: body.speiCardBank } : {}),
      ...(body.speiPhone !== undefined ? { speiPhone: body.speiPhone } : {}),
      ...(body.speiPhoneBank !== undefined ? { speiPhoneBank: body.speiPhoneBank } : {}),
      ...(body.speiCollectKind !== undefined ? { speiCollectKind: body.speiCollectKind } : {}),
    };
    const invalid = (field: string, reason: string) =>
      c.json({ success: false, error: { code: "VALIDATION_ERROR", field, reason } }, 400);
    /* A card or a phone is only an account with its bank, and a bank with
       no number is nobody's account: set together, cleared together. */
    if (Boolean(merged.speiCard) !== Boolean(merged.speiCardBank)) {
      return invalid(merged.speiCard ? "speiCardBank" : "speiCard", "PAIR_INCOMPLETE");
    }
    if (Boolean(merged.speiPhone) !== Boolean(merged.speiPhoneBank)) {
      return invalid(merged.speiPhone ? "speiPhoneBank" : "speiPhone", "PAIR_INCOMPLETE");
    }
    const after = currentAccounts(merged);
    const kind = collectKind(merged);
    if (!after.some((a) => a.kind === kind)) {
      /* D29: the cuenta de cobro must be a registered account. Choosing a
         kind that is not set is refused; so is clearing the cuenta de
         cobro while another account could take its place — the owner
         chooses that one first. Clearing the last account is allowed: it
         is what "SPEI not configured" has always been. */
      if (body.speiCollectKind !== undefined) return invalid("speiCollectKind", "NOT_REGISTERED");
      if (after.length > 0) return invalid("speiCollectKind", "COLLECT_ACCOUNT_CLEARED");
    }
    /* D30: every number that was set and is changed or cleared joins the
       retired list, in this same write; a number set again leaves it. A
       receipt paid to a removed account is then recognised and held for
       the owner instead of being refused as somebody else's (FR-020a). */
    const before = currentAccounts(business);
    const now = Date.now();
    let retired: StoredAccount[] = parseAccounts(business.speiRetiredAccounts);
    for (const old of before) {
      if (!after.some((a) => a.kind === old.kind && a.value === old.value)) {
        retired = [
          ...retired.filter((r) => !(r.kind === old.kind && r.value === old.value)),
          { kind: old.kind, value: old.value, bank: old.bank, removedAt: now },
        ];
      }
    }
    retired = retired.filter((r) => !after.some((a) => a.kind === r.kind && a.value === r.value));
    accountsPatch = {
      ...(body.speiCard !== undefined ? { speiCard: body.speiCard } : {}),
      ...(body.speiCardBank !== undefined ? { speiCardBank: body.speiCardBank } : {}),
      ...(body.speiPhone !== undefined ? { speiPhone: body.speiPhone } : {}),
      ...(body.speiPhoneBank !== undefined ? { speiPhoneBank: body.speiPhoneBank } : {}),
      ...(body.speiCollectKind !== undefined ? { speiCollectKind: body.speiCollectKind } : {}),
      speiRetiredAccounts: retired.length ? JSON.stringify(retired) : null,
    };
  }

  const businessPatch = {
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
      ...(body.payByReference !== undefined ? { payByReference: body.payByReference } : {}),
      ...accountsPatch,
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


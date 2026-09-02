import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { WispHub, WispHubError } from "../../wisphub/client";
import { integrationOf, upsertIntegration, type Integration } from "../../integrations/store";
import type { IntegrationsResponse, WisphubPatchRequest, WispHubTestResponse } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

function businessGuard(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return { error: c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403) };
  }
  return { actor, db: drizzle(c.env.DB) };
}

/* The card's state. No row — or a row with no key — is "not connected";
   a missing row answers the birth values, actions OFF (born observing,
   integrations-hub D4). */
function toWisphub(integration: Integration | null): IntegrationsResponse["wisphub"] {
  return {
    provider: "wisphub",
    configured: Boolean(integration?.apiKey),
    keyTail: integration?.apiKey ? integration.apiKey.slice(-4) : null,
    actionsEnabled: integration?.actionsEnabled ?? false,
    mapping: {
      exact: integration?.exactAction ?? "register_and_reconnect",
      short: integration?.shortAction ?? "register_and_reconnect",
      over: integration?.overAction ?? "register_and_reconnect",
    },
    thresholdPercent: integration?.thresholdPercent ?? 100,
    floorCents: integration?.floorCents ?? 0,
    provisionalReleaseEnabled: integration?.provisionalReleaseEnabled ?? false,
  };
}

/* settings D2/D3, moved verbatim: WispHub's own answer is the test, and
   the two failures stay apart. */
async function testKey(apiKey: string, baseUrl?: string): Promise<WispHubTestResponse> {
  try {
    const customers = await new WispHub(apiKey, baseUrl).searchCustomers("a");
    return { ok: true, code: null, sampleCustomerCount: customers.length };
  } catch (e) {
    const code = e instanceof WispHubError ? e.code : "WISPHUB_UNAVAILABLE";
    return { ok: false, code, sampleCustomerCount: null };
  }
}

export async function getIntegrations(c: Ctx) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const integration = await integrationOf(ctx.db, ctx.actor.id);
  return c.json({ success: true, data: { wisphub: toWisphub(integration) } });
}

export async function patchWisphub(c: Ctx, body: WisphubPatchRequest) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;

  /* D3 (settings, moved): a new key is always re-tested, and the result
     is reported, never enforced */
  const test = body.wisphubApiKey
    ? await testKey(body.wisphubApiKey, c.env.WISPHUB_BASE_URL)
    : null;

  const patch = {
    ...(body.wisphubApiKey !== undefined ? { apiKey: body.wisphubApiKey } : {}),
    ...(body.exactAction !== undefined ? { exactAction: body.exactAction } : {}),
    ...(body.shortAction !== undefined ? { shortAction: body.shortAction } : {}),
    ...(body.overAction !== undefined ? { overAction: body.overAction } : {}),
    ...(body.thresholdPercent !== undefined ? { thresholdPercent: body.thresholdPercent } : {}),
    ...(body.floorCents !== undefined ? { floorCents: body.floorCents } : {}),
    ...(body.provisionalReleaseEnabled !== undefined
      ? { provisionalReleaseEnabled: body.provisionalReleaseEnabled }
      : {}),
    ...(body.actionsEnabled !== undefined ? { actionsEnabled: body.actionsEnabled } : {}),
  };
  const integration = Object.keys(patch).length
    ? await upsertIntegration(ctx.db, ctx.actor.id, patch)
    : await integrationOf(ctx.db, ctx.actor.id);

  return c.json({
    success: true,
    data: {
      wisphub: toWisphub(integration),
      ...(test ? { wisphubTest: { ok: test.ok, code: test.code } } : {}),
    },
  });
}

export async function testWisphubKey(c: Ctx, apiKey?: string) {
  const ctx = businessGuard(c);
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

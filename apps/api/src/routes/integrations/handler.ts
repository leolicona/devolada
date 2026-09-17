import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { WispHub, WispHubError } from "../../wisphub/client";
import { integrationOf, upsertIntegration, type Integration } from "../../integrations/store";
import {
  issueCredential,
  listCredentials,
  revokeCredential,
  type CredentialSummary,
} from "../../api-clients/store";
import { validationAvailable } from "../../direct-payments/validation";
import type {
  ApiCredential,
  IntegrationsResponse,
  IssueCredentialRequest,
  WisphubPatchRequest,
  WispHubTestResponse,
} from "./schema";

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

/* The panel's view of a credential (FR-003): tail, never hash */
function toCredential(row: CredentialSummary): ApiCredential {
  return {
    id: row.id,
    name: row.name,
    keyTail: row.keyTail,
    isTest: row.isTest,
    lastUsedAt: row.lastUsedAt?.getTime() ?? null,
    revokedAt: row.revokedAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
  };
}

export async function getIntegrations(c: Ctx) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const integration = await integrationOf(ctx.db, ctx.actor.id);
  const credentials = await listCredentials(ctx.db, ctx.actor.id);
  const data: IntegrationsResponse = {
    wisphub: toWisphub(integration),
    api: { activeCredentials: credentials.filter((row) => row.revokedAt === null).length },
  };
  return c.json({ success: true, data });
}

/* GET /integrations/api (automated-collections-api US1, FR-001/FR-003):
   the credentials by tail, and the platform's own validation state as a
   notice the screen words as Devolada's, never as the business's. */
export async function getApiIntegration(c: Ctx) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const credentials = await listCredentials(ctx.db, ctx.actor.id);
  return c.json({
    success: true,
    data: { credentials: credentials.map(toCredential), validationAvailable: validationAvailable(c.env) },
  });
}

/* POST /integrations/api/credentials: the plaintext exists in this one
   answer and nowhere else (research D11, constitution V). Issuing is
   self-service — no help from Devolada (FR-001). */
export async function issueApiCredential(c: Ctx, body: IssueCredentialRequest) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const { credential, plaintext } = await issueCredential(ctx.db, ctx.actor.id, {
    name: body.name,
    isTest: body.isTest ?? false,
  });
  return c.json({ success: true, data: { credential: toCredential(credential), key: plaintext } }, 201);
}

/* POST /integrations/api/credentials/:id/revoke (FR-004): immediate —
   the middleware reads `revoked_at` on every request, so the next call
   with this key is refused. A credential of another business, or one
   already revoked, answers NOT_FOUND; nothing about it is revealed. */
export async function revokeApiCredential(c: Ctx, id: string) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const revoked = await revokeCredential(ctx.db, ctx.actor.id, id, new Date());
  if (!revoked) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  const row = (await listCredentials(ctx.db, ctx.actor.id)).find((credential) => credential.id === id);
  if (!row) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  return c.json({ success: true, data: { credential: toCredential(row) } });
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

  /* The panel replaces its cached GET with this answer, so it carries
     the same shape — the API card's count included */
  const credentials = await listCredentials(ctx.db, ctx.actor.id);
  const data: IntegrationsResponse = {
    wisphub: toWisphub(integration),
    api: { activeCredentials: credentials.filter((row) => row.revokedAt === null).length },
    ...(test ? { wisphubTest: { ok: test.ok, code: test.code } } : {}),
  };
  return c.json({ success: true, data });
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

import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { WispHubError } from "../../wisphub/client";
/* provider-address-per-isp D4: the eleventh call site, and the only one
   that cannot read `integration.installation` — it tests a key and an
   installation that are not yet saved, so it resolves the catalogue
   directly (`wisphubAt`) rather than from a stored row. */
import { effectiveInstallation, wisphubAt } from "../../wisphub/factory";
import { isInstallationKey } from "../../wisphub/installations";
import { integrationOf, upsertIntegration, type Integration } from "../../integrations/store";
import {
  issueCredential,
  listCredentials,
  revokeCredential,
  type CredentialSummary,
} from "../../api-clients/store";
import { validationAvailable } from "../../direct-payments/validation";
import { realOnly } from "../../direct-payments/links";
import { and, desc, eq } from "drizzle-orm";
import { apiWebhooks, payments, webhookDeliveries } from "../../db/schema";
import { activeSigningKey, parseSigningKeys } from "../../webhooks/sign";
import type {
  ApiCredential,
  InstallationKeyValue,
  IntegrationsResponse,
  IssueCredentialRequest,
  WisphubPatchRequest,
  WispHubTestResponse,
  WispHubVerifiableRead,
  WebhookIntegrationResponse,
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
   integrations-hub D4).

   provider-address-per-isp FR-004: the address is answered twice on
   purpose. `installation` is what the business chose — null when nobody
   did. `effectiveInstallation` is what is actually being called, which
   exists either way, because "which WispHub am I on" is a question the
   screen must be able to answer for a business that never touched the
   picker. `assumed` is the difference between the two, and the screen
   words it as one. */
function toWisphub(
  integration: Integration | null,
  env: Bindings,
): IntegrationsResponse["wisphub"] {
  const effective = effectiveInstallation(integration?.installation ?? null, env);
  return {
    provider: "wisphub",
    configured: Boolean(integration?.apiKey),
    keyTail: integration?.apiKey ? integration.apiKey.slice(-4) : null,
    /* Only a catalogue key ever travels back. A row holding a key the
       catalogue has since dropped reads as "not chosen" — which is what
       it now behaves as (D1, `wisphubFor`), so the screen and the
       adapter cannot disagree. */
    installation: isInstallationKey(integration?.installation ?? "")
      ? (integration!.installation as InstallationKeyValue)
      : null,
    effectiveInstallation: {
      key: effective.installation.key,
      label: effective.installation.label,
      kind: effective.installation.kind,
      assumed: effective.assumed,
    },
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

/* The connection test (provider-address-per-isp US2, D7). It replaces
   the single "WispHub rechazó esta llave" that was shown for three
   different problems — most damagingly for a valid key pointed at the
   wrong installation, which is the case this whole feature exists for.

   It probes the three reads Devolada actually needs, in the order that
   makes the answers separable:

     1. customers       — if this is refused, the key is refused
     2. invoices        — refused after 1 passed = a missing permission
     3. payment methods — same

   The order is the diagnosis. WispHub sends the same generic 403 for
   "bad key" and "no permission" (spike finding, client.ts), so nothing
   in a single response tells the two apart; what tells them apart is
   that a bad key is refused by *everything*, and a missing permission
   by one endpoint after another has already answered.

   It never attempts a WRITE (D7). All four writes Devolada will later
   make — create the invoice, register the payment, set the
   reactivation flag, create the payment promise — have side effects in
   a real ISP's live billing, and writing test data into an ISP's books
   to check a permission is worse than the problem it detects. They are
   reported as unverified, by name, and first exercised by a real
   payment where the action queue already shows the outcome. FR-011 was
   amended to say exactly this rather than let the screen keep claiming
   more than it proved.

   FR-013: nothing here puts the key in a message or a log line. The
   adapter's own errors carry a status and a reason, never the
   credential, and nothing below adds it. */

const WRITES = ["create_invoice", "register_payment", "auto_activate", "payment_promise"] as const;

async function testKey(
  apiKey: string,
  installation: string | null,
  env: Bindings,
): Promise<WispHubTestResponse> {
  const tried = effectiveInstallation(installation, env).installation;
  const answer = (
    outcome: WispHubTestResponse["outcome"],
    rest: Partial<WispHubTestResponse> = {},
  ): WispHubTestResponse => ({
    ok: outcome === "OK",
    outcome,
    triedInstallation: { key: tried.key, label: tried.label },
    verified: [],
    /* Always all four: a write is never proven here, whatever the reads
       said (D7). A healthy connection that listed nothing as unverified
       would be the old silent claim in a new shape. */
    unverified: [...WRITES],
    missingPermission: null,
    sampleCustomerCount: null,
    ...rest,
  });

  const wisphub = wisphubAt(apiKey, installation, env);
  const verified: WispHubVerifiableRead[] = [];
  let sampleCustomerCount: number | null = null;

  const probes: { name: WispHubVerifiableRead; run: () => Promise<void> }[] = [
    {
      name: "customers",
      run: async () => {
        sampleCustomerCount = (await wisphub.searchCustomers("a")).length;
      },
    },
    { name: "invoices", run: () => wisphub.probeInvoices() },
    { name: "payment_methods", run: () => wisphub.probePaymentMethods() },
  ];

  for (const probe of probes) {
    try {
      await probe.run();
      verified.push(probe.name);
    } catch (e) {
      const rejected = e instanceof WispHubError && e.code === "WISPHUB_AUTH_FAILED";
      if (!rejected) {
        /* Everything else is the installation failing to answer usefully
           — no reply, a timeout, or a 5xx. All three mean the same thing
           to the ISP ("we could not get an answer from there") and take
           the same advice, and none of them is evidence about the key,
           which is the mistake this outcome exists to stop making. */
        return answer("INSTALLATION_UNREACHABLE", { verified, sampleCustomerCount });
      }
      /* Refused on the FIRST probe: the key is refused, and the likeliest
         reason by far is that it belongs to another installation — which
         is why the screen raises the address before the credential. */
      if (verified.length === 0) return answer("KEY_REJECTED");
      /* Refused after something already answered: the key is good and a
         permission is not there. `missingPermission` names the endpoint
         we watched be denied, never a guess at the provider's own name
         for the right. */
      return answer("PERMISSION_MISSING", {
        verified,
        sampleCustomerCount,
        missingPermission: probe.name,
      });
    }
  }

  return answer("OK", { verified, sampleCustomerCount });
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
    wisphub: toWisphub(integration, c.env),
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

/* GET /integrations/webhook (automated-collections-api US2, FR-018): the
   address, its health and the recent deliveries with their reasons — an
   endpoint the business broke is the business's to fix, and this is
   where it sees that. Real payments only (research D12, T065); the
   counters on the endpoint row count every attempt. The address is
   registered by the business's software through PUT /v1/webhook: it
   belongs to the system that will answer it, not to a person in the
   panel. */
const RECENT_DELIVERIES = 20;

export async function getWebhookIntegration(c: Ctx) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const { db, actor } = ctx;
  const [endpoint] = await db.select().from(apiWebhooks).where(eq(apiWebhooks.businessId, actor.id));
  const recent = await db
    .select({ delivery: webhookDeliveries })
    .from(webhookDeliveries)
    .innerJoin(payments, eq(payments.id, webhookDeliveries.paymentId))
    /* automated-collections-api D12 (FR-035): real payments only, by the one shared rule */
    .where(and(eq(webhookDeliveries.businessId, actor.id), realOnly(payments)))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(RECENT_DELIVERIES);
  const data: WebhookIntegrationResponse = {
    endpoint: endpoint
      ? {
          url: endpoint.url,
          createdAt: endpoint.createdAt.getTime(),
          consecutiveFailures: endpoint.consecutiveFailures,
          lastFailureAt: endpoint.lastFailureAt?.getTime() ?? null,
          lastSuccessAt: endpoint.lastSuccessAt?.getTime() ?? null,
        }
      : null,
    signingConfigured: activeSigningKey(parseSigningKeys(c.env)) !== null,
    jwksUrl: `${c.env.API_BASE_URL ?? ""}/.well-known/jwks.json`,
    deliveries: recent.map(({ delivery }) => ({
      id: delivery.id,
      eventId: delivery.eventId,
      type: delivery.eventType,
      paymentId: delivery.paymentId,
      status: delivery.status,
      attempts: delivery.attempts,
      nextAttemptAt: delivery.nextAttemptAt?.getTime() ?? null,
      responseStatus: delivery.responseStatus,
      lastError: delivery.lastError,
      deliveredAt: delivery.deliveredAt?.getTime() ?? null,
      createdAt: delivery.createdAt.getTime(),
    })),
  };
  return c.json({ success: true, data });
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
     is reported, never enforced.

     provider-address-per-isp FR-009 widens both halves of that. A
     connection is a key AND an address, so changing EITHER re-tests —
     an ISP who saved a good key against the wrong installation fixes
     the installation alone, and must see that it now works. And the
     test runs against the installation **being saved**: the one in this
     patch when it carries one, the stored one otherwise. Testing the
     old address after choosing a new one would report on a pairing
     that no longer exists.

     Saving is never blocked by the result (settings D3). That matters
     more now, not less: an ISP whose key is rejected by the wrong
     installation must be able to save the right installation without
     first clearing the key. */
  const stored =
    body.wisphubApiKey === undefined || body.installation === undefined
      ? await integrationOf(ctx.db, ctx.actor.id)
      : null;
  const testKeyValue = body.wisphubApiKey ?? stored?.apiKey ?? null;
  const testInstallation = body.installation ?? stored?.installation ?? null;
  const test =
    (body.wisphubApiKey !== undefined || body.installation !== undefined) && testKeyValue
      ? await testKey(testKeyValue, testInstallation, c.env)
      : null;

  const patch = {
    ...(body.wisphubApiKey !== undefined ? { apiKey: body.wisphubApiKey } : {}),
    /* FR-001/FR-005: the closed choice, already narrowed to a catalogue
       key by `wisphubPatchRequest` — anything else never reaches here
       (400 at the validator). The column stays text, so `installations`
       and that enum are asserted to agree in
       `test/installations.test.ts`. */
    ...(body.installation !== undefined ? { installation: body.installation } : {}),
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
    wisphub: toWisphub(integration, c.env),
    api: { activeCredentials: credentials.filter((row) => row.revokedAt === null).length },
    /* T029: the whole result, not a two-field projection of it.
       Save-then-test is the path an ISP actually uses, so the three
       failures have to be tellable apart right here — and carrying the
       object itself means this can never fall behind the contract
       again. */
    ...(test ? { wisphubTest: test } : {}),
  };
  return c.json({ success: true, data });
}

export async function testWisphubKey(c: Ctx, apiKey?: string) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  /* Loaded once: the stored key when none was typed, and — always — the
     stored installation, because a typed candidate is still being tested
     against the address this business actually uses
     (provider-address-per-isp FR-009). */
  const stored = await integrationOf(ctx.db, ctx.actor.id);
  const key = apiKey ?? stored?.apiKey ?? undefined;
  if (!key) {
    /* Not one of the four outcomes, because no test ran: there is
       nothing to report about a connection that was never attempted.
       The same `WISPHUB_NOT_CONFIGURED` the rest of the API answers for
       "no key yet" (constitution III, `routes/direct-payments`), so the
       panel words it the way it already words that. */
    return c.json({ success: false, error: { code: "WISPHUB_NOT_CONFIGURED" } }, 409);
  }
  /* 200 either way: the test succeeded in telling us the answer (D2) */
  return c.json({ success: true, data: await testKey(key, stored?.installation ?? null, c.env) });
}

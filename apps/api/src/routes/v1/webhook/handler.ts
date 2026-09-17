import type { Context } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../../env";
import { apiWebhooks, payments, webhookDeliveries } from "../../../db/schema";
import { attemptDelivery, requeueDelivery, type Delivery } from "../../../webhooks/queue";
import { deferOf } from "../../defer";
import { fail, ok } from "../envelope";
import type { ListDeliveriesQuery, RegisterWebhookRequest, WebhookDelivery, WebhookEndpoint, WebhookEventType } from "./schema";

/* PUT/GET/DELETE /v1/webhook and its deliveries (automated-collections-api
   US2, FR-012, FR-026, FR-038, FR-041). One address per business; every
   query filters by the credential's business (constitution V). */

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;
type Endpoint = typeof apiWebhooks.$inferSelect;

function toPublic(row: Endpoint): WebhookEndpoint {
  return {
    url: row.url,
    createdAt: row.createdAt.getTime(),
    consecutiveFailures: row.consecutiveFailures,
    lastFailureAt: row.lastFailureAt?.getTime() ?? null,
    lastSuccessAt: row.lastSuccessAt?.getTime() ?? null,
  };
}

function toPublicDelivery(row: Delivery): WebhookDelivery {
  return {
    id: row.id,
    eventId: row.eventId,
    type: row.eventType as WebhookEventType,
    paymentId: row.paymentId,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt?.getTime() ?? null,
    responseStatus: row.responseStatus,
    lastError: row.lastError,
    keyId: row.keyId,
    deliveredAt: row.deliveredAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
  };
}

/* FR-038: what "can protect the message in transit" means here — an
   absolute https URL. Anything else is INSECURE_URL, named so the
   developer fixes the scheme rather than guessing. */
function insecure(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  return parsed.protocol !== "https:" || parsed.hostname.length === 0;
}

/* PUT /v1/webhook: register or replace. Replacing the address resets its
   health — the counters describe the endpoint that answered, and this
   one has not answered yet. Pending deliveries go to the new address
   on their next attempt: the row holds an address, not a promise. */
export async function registerWebhook(c: Ctx, body: RegisterWebhookRequest) {
  const { businessId } = c.get("apiClient");
  if (insecure(body.url)) return fail(c, "INSECURE_URL", "url must be an absolute https URL");
  const db = drizzle(c.env.DB);
  const [row] = await db
    .insert(apiWebhooks)
    .values({ businessId, url: body.url })
    .onConflictDoUpdate({
      target: apiWebhooks.businessId,
      set: { url: body.url, consecutiveFailures: 0, lastFailureAt: null, lastSuccessAt: null },
    })
    .returning();
  return ok(c, toPublic(row));
}

export async function getWebhook(c: Ctx) {
  const { businessId } = c.get("apiClient");
  const [row] = await drizzle(c.env.DB).select().from(apiWebhooks).where(eq(apiWebhooks.businessId, businessId));
  if (!row) return fail(c, "NOT_FOUND");
  return ok(c, toPublic(row));
}

/* DELETE /v1/webhook (FR-012): idempotent. Deliveries already pending
   end as ENDPOINT_REMOVED on their next attempt rather than vanishing
   — the record stays readable (FR-026). */
export async function deleteWebhook(c: Ctx) {
  const { businessId } = c.get("apiClient");
  const removed = await drizzle(c.env.DB)
    .delete(apiWebhooks)
    .where(eq(apiWebhooks.businessId, businessId))
    .returning({ id: apiWebhooks.id });
  return ok(c, { removed: removed.length > 0 });
}

/* GET /v1/webhook/deliveries (FR-026): newest first. A test credential
   reads the deliveries of test payments and a real one those of real
   payments (research D12) — the payment row says which. */
export async function listDeliveries(c: Ctx, query: ListDeliveriesQuery) {
  const { businessId, isTest } = c.get("apiClient");
  const rows = await drizzle(c.env.DB)
    .select({ delivery: webhookDeliveries })
    .from(webhookDeliveries)
    .innerJoin(payments, eq(payments.id, webhookDeliveries.paymentId))
    .where(
      and(
        eq(webhookDeliveries.businessId, businessId),
        eq(payments.isTest, isTest),
        ...(query.status ? [eq(webhookDeliveries.status, query.status)] : []),
      ),
    )
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(query.limit);
  return ok(c, { deliveries: rows.map((r) => toPublicDelivery(r.delivery)) });
}

/* POST /v1/webhook/deliveries/:id/retry (FR-041): a failed delivery is
   sent again — same event id, same body (D9), signed with the key
   active now (D10). Answered as `pending` at once; the attempt runs
   past the answer under `waitUntil`, or on the sweep this minute. */
export async function retryDelivery(c: Ctx, id: string) {
  const { businessId, isTest } = c.get("apiClient");
  const db = drizzle(c.env.DB);
  const now = new Date();
  const [found] = await db
    .select({ delivery: webhookDeliveries })
    .from(webhookDeliveries)
    .innerJoin(payments, eq(payments.id, webhookDeliveries.paymentId))
    .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.businessId, businessId), eq(payments.isTest, isTest)));
  if (!found) return fail(c, "NOT_FOUND");
  const { delivery } = found;
  if (delivery.status === "delivered") return fail(c, "VALIDATION_ERROR", "delivery was already accepted by your endpoint");
  if (delivery.status === "pending") return fail(c, "VALIDATION_ERROR", "delivery is already scheduled");
  const [endpoint] = await db.select({ id: apiWebhooks.id }).from(apiWebhooks).where(eq(apiWebhooks.businessId, businessId));
  if (!endpoint) return fail(c, "VALIDATION_ERROR", "register a webhook url before asking for a re-send");

  const requeued = await requeueDelivery(db, delivery, now);
  const defer = deferOf(c);
  if (defer) {
    defer(
      attemptDelivery(c.env, db, requeued, now).catch((e) => {
        console.error(`webhook re-send ${requeued.id} failed:`, e);
      }),
    );
  }
  return ok(c, toPublicDelivery(requeued), 202);
}

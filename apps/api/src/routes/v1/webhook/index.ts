import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../../env";
import { fail } from "../envelope";
import { idempotent, rateLimit, requireApiCredential } from "../middleware";
import { listDeliveriesQuery, registerWebhookRequest } from "./schema";
import { deleteWebhook, getWebhook, listDeliveries, registerWebhook, retryDelivery } from "./handler";

/* Pure router (constitution III): credential, rate limit, idempotency,
   validation, wiring — no logic. Mounted at /v1/webhook. */
export const webhookRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

webhookRoute.use("*", requireApiCredential, rateLimit());

const named = (issues: { path: (string | number)[]; message: string }[]) => {
  const first = issues[0];
  return first ? `${first.path.join(".") || "body"}: ${first.message}` : undefined;
};

webhookRoute.put(
  "/",
  zValidator("json", registerWebhookRequest, (result, c) => {
    if (!result.success) return fail(c, "VALIDATION_ERROR", named(result.error.issues));
  }),
  (c) => registerWebhook(c, c.req.valid("json")),
);

webhookRoute.get("/", (c) => getWebhook(c));

webhookRoute.delete("/", (c) => deleteWebhook(c));

webhookRoute.get(
  "/deliveries",
  zValidator("query", listDeliveriesQuery, (result, c) => {
    if (!result.success) return fail(c, "VALIDATION_ERROR", named(result.error.issues));
  }),
  (c) => listDeliveries(c, c.req.valid("query")),
);

webhookRoute.post("/deliveries/:id/retry", idempotent, (c) => retryDelivery(c, c.req.param("id")));

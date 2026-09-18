import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../../env";
import { fail } from "../envelope";
import { idempotent, rateLimit, requireApiCredential } from "../middleware";
import { createPaymentLinkRequest, listPaymentLinksQuery, patchPaymentLinkRequest } from "./schema";
import { createPaymentLink, getPaymentLink, listPaymentLinks, patchPaymentLink } from "./handler";

/* Pure router (constitution III): credential, rate limit, idempotency,
   validation, wiring — no logic. Mounted at /v1/payment-links. */
export const paymentLinksRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

paymentLinksRoute.use("*", requireApiCredential, rateLimit());

/* Zod's refusal wears the /v1 envelope, with the first issue's path so
   the developer knows which field (FR-025). */
const named = (issues: { path: (string | number)[]; message: string }[]) => {
  const first = issues[0];
  return first ? `${first.path.join(".") || "body"}: ${first.message}` : undefined;
};

paymentLinksRoute.post(
  "/",
  idempotent,
  zValidator("json", createPaymentLinkRequest, (result, c) => {
    if (!result.success) return fail(c, "VALIDATION_ERROR", named(result.error.issues));
  }),
  (c) => createPaymentLink(c, c.req.valid("json")),
);

paymentLinksRoute.get(
  "/",
  zValidator("query", listPaymentLinksQuery, (result, c) => {
    if (!result.success) return fail(c, "VALIDATION_ERROR", named(result.error.issues));
  }),
  (c) => listPaymentLinks(c, c.req.valid("query").customerRef),
);

paymentLinksRoute.get("/:id", (c) => getPaymentLink(c, c.req.param("id")));

paymentLinksRoute.patch(
  "/:id",
  idempotent,
  zValidator("json", patchPaymentLinkRequest, (result, c) => {
    if (!result.success) return fail(c, "VALIDATION_ERROR", named(result.error.issues));
  }),
  (c) => patchPaymentLink(c, c.req.param("id"), c.req.valid("json")),
);

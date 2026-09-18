import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../../env";
import { fail } from "../envelope";
import { rateLimit, requireApiCredential } from "../middleware";
import { listPaymentsQuery } from "./schema";
import { getPayment, listPayments } from "./handler";

/* Pure router (constitution III): credential, rate limit, validation,
   wiring — no logic. Mounted at /v1/payments. Reads only, so nothing
   here is idempotent by header: a GET already is. */
export const paymentsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

paymentsRoute.use("*", requireApiCredential, rateLimit());

const named = (issues: { path: (string | number)[]; message: string }[]) => {
  const first = issues[0];
  return first ? `${first.path.join(".") || "query"}: ${first.message}` : undefined;
};

paymentsRoute.get(
  "/",
  zValidator("query", listPaymentsQuery, (result, c) => {
    if (!result.success) return fail(c, "VALIDATION_ERROR", named(result.error.issues));
  }),
  (c) => listPayments(c, c.req.valid("query").customerRef),
);

paymentsRoute.get("/:id", (c) => getPayment(c, c.req.param("id")));

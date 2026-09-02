import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireArea, requireSession } from "../../auth/middleware";
import { feedQuery } from "./schema";
import { getPaymentProof, listPaymentFeed, retryAction } from "./handler";

/* Pure router: validation + wiring only (code organization law). The
   feed reads `payments` (business-and-memberships D6); the proof is
   readable by every role and the retry is the operator's
   (payments-and-classes D4/D5). */
export const paymentsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

paymentsRoute.get("/feed", requireSession, requireArea("payments", "read"), zValidator("query", feedQuery), (c) => {
  return listPaymentFeed(c, c.req.valid("query"));
});

paymentsRoute.get("/:id/proof", requireSession, requireArea("payments", "read"), (c) => {
  return getPaymentProof(c, c.req.param("id"));
});

paymentsRoute.post("/:id/retry-action", requireSession, requireArea("payments", "operate"), (c) => {
  return retryAction(c, c.req.param("id"));
});

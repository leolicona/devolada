import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireArea, requireSession } from "../../auth/middleware";
import { feedQuery } from "./schema";
import { listPaymentFeed } from "./handler";

/* Pure router: validation + wiring only (code organization law). The
   feed reads `payments` (business-and-memberships D6). */
export const paymentsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

paymentsRoute.get("/feed", requireSession, requireArea("payments", "read"), zValidator("query", feedQuery), (c) => {
  return listPaymentFeed(c, c.req.valid("query"));
});

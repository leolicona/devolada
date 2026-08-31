import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { feedQuery } from "./schema";
import { listChargeFeed } from "./handler";

/* Pure router: validation + wiring only (code organization law).
   The store-channel endpoints (customer search, quote, record, receipt)
   retired to devolada-red; the ISP feed is what remains. */
export const charges = new Hono<{ Bindings: Bindings; Variables: Variables }>();

charges.get("/feed", requireSession, zValidator("query", feedQuery), (c) => {
  return listChargeFeed(c, c.req.valid("query"));
});

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { customerSearchQuery } from "./schema";
import { getCustomerQuote, searchCustomers } from "./handler";

/* Pure router: validation + wiring only (code organization law). */
export const charges = new Hono<{ Bindings: Bindings; Variables: Variables }>();

charges.get("/customers", requireSession, zValidator("query", customerSearchQuery), (c) => {
  return searchCustomers(c, c.req.valid("query").q);
});

charges.get("/customers/:usuario", requireSession, (c) => {
  return getCustomerQuote(c, c.req.param("usuario"));
});

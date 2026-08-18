import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { chargeRecordRequest, customerSearchQuery, feedQuery } from "./schema";
import {
  getCharge,
  getCustomerQuote,
  getReceipt,
  listChargeFeed,
  recordCharge,
  searchCustomers,
} from "./handler";

/* Pure router: validation + wiring only (code organization law). */
export const charges = new Hono<{ Bindings: Bindings; Variables: Variables }>();

charges.get("/customers", requireSession, zValidator("query", customerSearchQuery), (c) => {
  return searchCustomers(c, c.req.valid("query").q);
});

charges.get("/customers/:usuario", requireSession, (c) => {
  return getCustomerQuote(c, c.req.param("usuario"));
});

charges.get("/feed", requireSession, zValidator("query", feedQuery), (c) => {
  return listChargeFeed(c, c.req.valid("query"));
});

charges.post("/", requireSession, zValidator("json", chargeRecordRequest), (c) => {
  const body = c.req.valid("json");
  return recordCharge(c, body.usuario, body.customerPhone);
});

/* Param routes last: static /customers and /feed win over /:chargeId */
charges.get("/:chargeId/receipt", requireSession, (c) => {
  return getReceipt(c, c.req.param("chargeId"));
});

charges.get("/:chargeId", requireSession, (c) => {
  return getCharge(c, c.req.param("chargeId"));
});

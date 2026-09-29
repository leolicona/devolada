import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { receivablesQuery } from "./schema";
import { listPaymentRequests } from "./handler";

/* Pure router (constitution III). No requireArea: every role reads the
   Por cobrar view (cobros-live D4) — the handler still refuses
   non-business actors. */
export const paymentRequestsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

paymentRequestsRoute.get(
  "/",
  requireSession,
  /* cobros-in-links D1: the block contract's query. A rejected one
     answers in the project envelope, never zod's own 400 shape. */
  zValidator("query", receivablesQuery, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
    }
  }),
  (c) => listPaymentRequests(c, c.req.valid("query")),
);

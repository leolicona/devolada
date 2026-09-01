import { Hono } from "hono";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { listPaymentRequests } from "./handler";

/* Pure router (code organization law). No requireArea: every role reads
   Cobros (cobros-live D4) — the handler still refuses non-business actors. */
export const paymentRequestsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

paymentRequestsRoute.get("/", requireSession, (c) => listPaymentRequests(c));

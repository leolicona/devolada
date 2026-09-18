import { Hono } from "hono";
import type { Bindings, Variables } from "../../env";
import { paymentLinksRoute } from "./payment-links";

/* Pure router for the public collections API (constitution III, research D1):
   a second front door onto the same D1, versioned because outside callers
   now depend on its shape. Server-to-server only — excluded from the CORS
   allow-list in ../../index.ts. Each area (payment-links, payments, webhook,
   test-mode, well-known) mounts here behind requireApiCredential and the
   rate limit in ./middleware as it lands. */
export const v1Route = new Hono<{ Bindings: Bindings; Variables: Variables }>();

v1Route.route("/payment-links", paymentLinksRoute);

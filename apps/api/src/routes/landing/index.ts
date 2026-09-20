import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { rateLimitRoute } from "../../auth/rate-limit";
import {
  accessRequestBody,
  accessRequestListQuery,
  landingCountsQuery,
  landingEventBody,
  type AccessRequestBody,
} from "./schema";
import {
  getLandingCounts,
  listAccessRequests,
  postAccessRequest,
  postLandingEvent,
  refuseAccessRequest,
} from "./handler";

type Env = { Bindings: Bindings; Variables: Variables };

/* Pure routers (constitution III; landing-page D5). The public one is
   mounted at /landing by src/index.ts — inside CORS, unlike /v1, because
   the page's script calls it from the landing's origin. The operator one
   is mounted at /platform/landing by routes/platform, behind that file's
   `requireSession, requirePlatformOperator`. */

/* landing-page D6: the request door takes JSON from the page's script and
   application/x-www-form-urlencoded from the HTML form when no script
   runs. Hono's validators each accept one content type, so this picks the
   one that matches; the refusal is shaped by the handler, which knows
   which answer this caller can read. */
const isJson = (type: string | undefined) => (type ?? "").toLowerCase().includes("application/json");
const invalidBody = (result: { success: boolean }, c: Parameters<typeof refuseAccessRequest>[0]) => {
  if (!result.success) return refuseAccessRequest(c, "VALIDATION_ERROR");
};
const jsonBody = zValidator("json", accessRequestBody, invalidBody);
const formBody = zValidator("form", accessRequestBody, invalidBody);
type BodyInput = { in: { json: AccessRequestBody; form: AccessRequestBody }; out: { json: AccessRequestBody; form: AccessRequestBody } };
const requestBody: MiddlewareHandler<Env, string, BodyInput> = (c, next) =>
  isJson(c.req.header("content-type")) ? jsonBody(c, next) : formBody(c, next);

export const landingPublicRoute = new Hono<Env>();

/* landing-page D9: five an hour per address (FR-019); a sixth from a plain
   form lands on the outcome page like every other refusal (D6). */
landingPublicRoute.post(
  "/requests",
  rateLimitRoute("landing-request", {
    window: 3600,
    max: 5,
    refuse: (c) => refuseAccessRequest(c, "TOO_MANY_REQUESTS", 429),
  }),
  requestBody,
  (c) => postAccessRequest(c, isJson(c.req.header("content-type")) ? c.req.valid("json") : c.req.valid("form")),
);

/* landing-page D8: the beacon — form-urlencoded, sent with keepalive and
   no-cors, so no preflight. Sixty an hour per address (D9). */
landingPublicRoute.post(
  "/events",
  rateLimitRoute("landing-event", { window: 3600, max: 60 }),
  zValidator("form", landingEventBody, (result, c) => {
    if (!result.success) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }),
  (c) => postLandingEvent(c, c.req.valid("form")),
);

export const landingOperatorRoute = new Hono<Env>();

landingOperatorRoute.get("/requests", zValidator("query", accessRequestListQuery), (c) =>
  listAccessRequests(c, c.req.valid("query")),
);
landingOperatorRoute.get("/counts", zValidator("query", landingCountsQuery), (c) =>
  getLandingCounts(c, c.req.valid("query")),
);

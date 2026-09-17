import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings, Variables } from "./env";
import { auth } from "./routes/auth";
import { settingsRoute } from "./routes/settings";
import { businessesRoute } from "./routes/businesses";
import { creditRoute } from "./routes/credit";
import { platformRoute } from "./routes/platform";
import { sweepReconnections } from "./reconnection/queue";
import { sweepDirectPayments } from "./direct-payments/validation";
import { releaseQueuedForCredit, sweepTopUps } from "./credit/topups";
import { paymentsRoute } from "./routes/payments";
import { paymentRequestsRoute } from "./routes/payment-requests";
import { integrationsRoute } from "./routes/integrations";
import { directPaymentsRoute } from "./routes/direct-payments";
import { dev } from "./routes/dev";
import { supportRoute } from "./routes/support";
import { v1Route } from "./routes/v1";
import { wellKnownRoute } from "./routes/v1/well-known";
import { sweepWebhookDeliveries } from "./webhooks/queue";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* CORS allow-list (TD-007): only the listed frontend origins may call
   with credentials. An entry starting with "*" is a suffix pattern —
   it admits the per-PR preview URLs.
   Requests without an Origin header (curl) pass by.
   /v1 is excluded (automated-collections-api D1): it is server-to-server,
   a browser calling it with a secret key is a mistake, not a use case. */
app.use("*", (c, next) => {
  if (c.req.path === "/v1" || c.req.path.startsWith("/v1/")) return next();
  const allowed = (c.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  const isAllowed = (origin: string) =>
    allowed.some((entry) =>
      entry.startsWith("*")
        ? origin.startsWith("https://") && origin.endsWith(entry.slice(1))
        : origin === entry,
    );
  return cors({
    origin: (origin) => (isAllowed(origin) ? origin : null),
    credentials: true,
  })(c, next);
});

app.get("/health", (c) => c.json({ success: true, status: "healthy" }));

app.route("/auth", auth);
app.route("/payments", paymentsRoute);
app.route("/payment-requests", paymentRequestsRoute);
app.route("/integrations", integrationsRoute);
app.route("/settings", settingsRoute);
app.route("/businesses", businessesRoute);
app.route("/credit", creditRoute);
app.route("/platform", platformRoute);
app.route("/direct-payments", directPaymentsRoute);
app.route("/support", supportRoute);

/* The public collections API (automated-collections-api D1): server-to-server,
   no CORS, versioned because outside callers now depend on its shape. */
app.route("/v1", v1Route);
/* automated-collections-api D10: the webhook signing keys, public and
   cacheable, on the path RFC 8615 gives them — outside /v1 and its
   credential, and through CORS like any public read. */
app.route("/.well-known", wellKnownRoute);

/* Seed routes exist in development only */
app.use("/dev/*", async (c, next) => {
  if (c.env.ENVIRONMENT !== "dev") return c.notFound();
  await next();
});
app.route("/dev", dev);

app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, error: { code: "INTERNAL_SERVER_ERROR" } }, 500);
});

/* The Hono app itself, for tests and for the worker below */
export { app };

/* The worker is the API plus the every-minute sweeps, all on one
   trigger (direct-payment spec D7 — no new Worker trigger): the
   reconnection queue (reconnection-queue spec D2), the queued-for-credit
   release followed by the direct-payment re-validations, and the top-up
   sweep. `waitUntil` keeps them alive past the handler's return.
   consta-api-merge FR-014: the Consta key backfill that rode here
   (payments-and-classes D7) left with the keys — the engine is a module
   of this Worker and attributes by `business_id` (D3); the payer refs it
   collects need no secret either (D5). */
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      sweepReconnections(env).then((report) => {
        if (report.claimed) console.log("reconnection sweep:", JSON.stringify(report));
      }),
    );
    /* prepaid-credit D8: the release runs before the direct sweep, so a
       business that just topped up sees its queue move this same minute */
    ctx.waitUntil(
      releaseQueuedForCredit(env)
        .then((released) => {
          if (released) console.log("queued-for-credit release:", released);
        })
        .then(() => sweepDirectPayments(env))
        .then((report) => {
          if (report.claimed) console.log("direct-payment sweep:", JSON.stringify(report));
        })
        /* automated-collections-api D8: the webhook retries ride the
           same trigger, chained after the verdicts that produce them so
           a verdict reached by the sweep is delivered this same minute
           (SC-002). Speaks only when it did something. */
        .then(() => sweepWebhookDeliveries(env))
        .then((report) => {
          if (report.claimed) console.log("webhook sweep:", JSON.stringify(report));
        }),
    );
    ctx.waitUntil(
      sweepTopUps(env).then((report) => {
        if (report.claimed) console.log("top-up sweep:", JSON.stringify(report));
      }),
    );
  },
};

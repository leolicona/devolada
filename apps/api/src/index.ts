import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings, Variables } from "./env";
import { auth } from "./routes/auth";
import { settingsRoute } from "./routes/settings";
import { businessesRoute } from "./routes/businesses";
import { creditRoute } from "./routes/credit";
import { platformRoute } from "./routes/platform";
import { sweepReconnections } from "./reconnection/queue";
import { sweepUnsettledCollections } from "./store-collections";
import { sweepDirectPayments } from "./direct-payments/validation";
import { backfillPayerReferences } from "./direct-payments/payer-reference";
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
import { sweepWispHubLists } from "./wisphub/snapshot";
import { sweepApiCounters } from "./routes/v1/middleware";
import { prunePanelLinks } from "./links/prune";
import { internalError } from "./routes/v1/envelope";
import { landingPublicRoute } from "./routes/landing";
import { storeRoute } from "./routes/store";
import { cashPointsRoute } from "./routes/cash-points";
import { eraseLegacyCredentials } from "./auth/credentials-sweep";

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
/* cash-at-stores: the shopkeeper's area (D2) — its own actor, its own
   guard, inside CORS like every browser door */
app.route("/store", storeRoute);
/* cash-at-stores D23: *Puntos de pago*, the business's side of the cash */
app.route("/cash-points", cashPointsRoute);
/* landing-page D5/D6: the landing page's two public doors — the request
   and the beacon. Inside CORS, unlike /v1: the page's script calls the
   request door from the landing's origin (ALLOWED_ORIGINS, D14). */
app.route("/landing", landingPublicRoute);

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
  return internalError(c);
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
      /* cash-at-stores T072: a cash payment a dead request left unsettled,
         or settled without its cash-book movement, is finished first, so
         its action joins the queue this same minute. Speaks only when it
         did something. */
      sweepUnsettledCollections(env)
        .then((report) => {
          if (report.settled || report.movements || report.failed) console.log("store collection sweep:", JSON.stringify(report));
        })
        .then(() => sweepReconnections(env))
        .then((report) => {
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
        /* payment-without-receipt D5: the references of the links that
           existed when a business turned the feature on, twenty links per
           business per minute, oldest first. Speaks only when it assigned
           something. */
        .then(() => backfillPayerReferences(env))
        .then((report) => {
          if (report.assigned) console.log("payer reference backfill:", JSON.stringify(report));
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
    /* bug: pending-invoice-cap, bug: links-roster-cap: the background
       read of a tenant's WispHub lists — pending invoices and customers —
       for the tenants a request cannot read whole. Its own lane — the
       verdicts above read the list it keeps, and a slow page must not
       hold a verdict this minute. */
    ctx.waitUntil(
      sweepWispHubLists(env).then((report) => {
        if (report.pages || report.failed) console.log("wisphub list sweep:", JSON.stringify(report));
      }),
    );
    /* links-on-demand-search D13 (FR-023): the one-time cleanup of the
       panel links the retired roster created and nobody ever used. It
       joins this trigger rather than adding one (constitution: one
       trigger), runs once per business — the row it writes is what
       stops it — and speaks only when it did something. */
    ctx.waitUntil(
      prunePanelLinks(env).then((report) => {
        if (report.businesses) console.log("link prune:", JSON.stringify(report));
      }),
    );
    /* passwordless-access D5 (FR-029): the passwords that exist, and the
       legacy accounts whose email was never proven, are erased here — a
       sweep, not a migration, so a restored export or a forgotten door
       cannot bring one back for more than a minute. Its own lane: nothing
       else waits on it. Speaks only when it deleted something. */
    ctx.waitUntil(
      eraseLegacyCredentials(env).then((report) => {
        if (report.credentials || report.users) console.log("credential erase:", JSON.stringify(report));
      }),
    );
    /* automated-collections-api D13/D14: the public API's housekeeping —
       idempotency keys past 24 h and rate buckets past their minute —
       rides the same trigger */
    ctx.waitUntil(
      sweepApiCounters(env).then((report) => {
        if (report.keys || report.buckets) console.log("api housekeeping:", JSON.stringify(report));
      }),
    );
  },
};

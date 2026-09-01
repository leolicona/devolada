import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings, Variables } from "./env";
import { auth } from "./routes/auth";
import { settingsRoute } from "./routes/settings";
import { businessesRoute } from "./routes/businesses";
import { sweepReconnections } from "./reconnection/queue";
import { sweepDirectPayments } from "./direct-payments/validation";
import { charges } from "./routes/charges";
import { directPaymentsRoute } from "./routes/direct-payments";
import { dev } from "./routes/dev";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* CORS allow-list (TD-007): only the listed frontend origins may call
   with credentials. An entry starting with "*" is a suffix pattern —
   it admits the per-PR preview URLs.
   Requests without an Origin header (curl) pass by. */
app.use("*", (c, next) => {
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
app.route("/charges", charges);
app.route("/settings", settingsRoute);
app.route("/businesses", businessesRoute);
app.route("/direct-payments", directPaymentsRoute);

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

/* The worker is the API plus the every-minute sweeps: the reconnection
   queue (reconnection-queue spec D2) and the direct-payment
   re-validations, which ride the same trigger (direct-payment spec D7 —
   no new Worker trigger). `waitUntil` keeps them alive past the
   handler's return. */
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      sweepReconnections(env).then((report) => {
        if (report.claimed) console.log("reconnection sweep:", JSON.stringify(report));
      }),
    );
    ctx.waitUntil(
      sweepDirectPayments(env).then((report) => {
        if (report.claimed) console.log("direct-payment sweep:", JSON.stringify(report));
      }),
    );
  },
};

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings, Variables } from "./env";
import { auth } from "./routes/auth";
import { cashbox } from "./routes/cashbox";
import { cashDropsRoute } from "./routes/cash-drops";
import { ledgerRoute } from "./routes/ledger";
import { storesRoute } from "./routes/stores";
import { settingsRoute } from "./routes/settings";
import { charges } from "./routes/charges";
import { dev } from "./routes/dev";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* CORS allow-list (TD-007): only the listed frontend origins may call
   with credentials. An entry starting with "*" is a suffix pattern —
   it admits the per-PR preview URLs (<hash>-devolada-tienda-dev...).
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
app.route("/cashbox", cashbox);
app.route("/cash-drops", cashDropsRoute);
app.route("/ledger", ledgerRoute);
app.route("/stores", storesRoute);
app.route("/settings", settingsRoute);

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

export default app;

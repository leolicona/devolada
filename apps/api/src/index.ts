import { Hono } from "hono";
import type { Bindings, Variables } from "./env";
import { auth } from "./routes/auth";
import { charges } from "./routes/charges";
import { dev } from "./routes/dev";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get("/health", (c) => c.json({ success: true, status: "healthy" }));

app.route("/auth", auth);
app.route("/charges", charges);

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

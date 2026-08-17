import { Hono } from "hono";
import type { Bindings, Variables } from "./env";
import { validateRoute } from "./routes/validate";
import { adminKeysRoute } from "./routes/admin/keys";

/* Consta: SPEI transfer validation behind one endpoint (docs/consta/
   validation.spec.md). Server-to-server in v1 — no CORS on purpose (D8). */
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get("/health", (c) => c.json({ success: true, status: "healthy" }));

app.route("/validate", validateRoute);
app.route("/admin/keys", adminKeysRoute);

app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, error: { code: "INTERNAL_SERVER_ERROR" } }, 500);
});

export { app };
export default app;

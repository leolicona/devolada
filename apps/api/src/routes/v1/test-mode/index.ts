import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../../env";
import { fail } from "../envelope";
import { idempotent, rateLimit, requireApiCredential, requireTestCredential } from "../middleware";
import { advanceTestPaymentRequest } from "./schema";
import { advanceTestPayment } from "./handler";

/* Pure router (constitution III): credential, rate limit, the test-mode
   gate, idempotency, validation, wiring — no logic. Mounted at /v1/test.
   research D12: a real credential is told NOT_FOUND before any path
   here is matched — for it, this router does not exist. Test traffic
   shares its business's rate budget (D13). */
export const testModeRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

testModeRoute.use("*", requireApiCredential, rateLimit(), requireTestCredential);

const named = (issues: { path: (string | number)[]; message: string }[]) => {
  const first = issues[0];
  return first ? `${first.path.join(".") || "body"}: ${first.message}` : undefined;
};

testModeRoute.post(
  "/payments/:id/advance",
  idempotent,
  zValidator("json", advanceTestPaymentRequest, (result, c) => {
    if (!result.success) return fail(c, "VALIDATION_ERROR", named(result.error.issues));
  }),
  (c) => advanceTestPayment(c, c.req.param("id"), c.req.valid("json")),
);

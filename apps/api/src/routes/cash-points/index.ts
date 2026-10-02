import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireArea, requireSession } from "../../auth/middleware";
import { disputeRequest, historyQuery } from "./schema";
import { confirmHandover, disputeHandover, handoverHistory, listCashPoints } from "./handler";

/* cash-at-stores D20, D23 — *Puntos de pago*. Pure router. Every member
   reads it (a viewer too, FR-035); confirming and disputing are
   `payments: operate`. */
export const cashPointsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

cashPointsRoute.get("/", requireSession, requireArea("payments", "read"), (c) => listCashPoints(c));

cashPointsRoute.post("/handovers/:id/confirm", requireSession, requireArea("payments", "operate"), (c) =>
  confirmHandover(c, c.req.param("id")),
);

cashPointsRoute.post(
  "/handovers/:id/dispute",
  requireSession,
  requireArea("payments", "operate"),
  zValidator("json", disputeRequest, (result, c) => {
    if (!result.success) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }),
  (c) => disputeHandover(c, c.req.param("id"), c.req.valid("json")),
);

cashPointsRoute.get(
  "/stores/:storeId/history",
  requireSession,
  requireArea("payments", "read"),
  zValidator("query", historyQuery, (result, c) => {
    if (!result.success) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }),
  (c) => handoverHistory(c, c.req.param("storeId"), c.req.valid("query").cursor),
);

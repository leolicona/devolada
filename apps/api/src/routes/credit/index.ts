import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { Bindings, Variables } from "../../env";
import { requireArea, requireSession } from "../../auth/middleware";
import { zValidator } from "@hono/zod-validator";
import { topUpRequest } from "./schema";
import { getTopUp, listTopUps, submitTopUp, uploadTopUpProof } from "./handler";
import { businesses } from "../../db/schema";
import { creditSummary, listEntries } from "../../credit";
import { getSetting } from "../../platform/settings";
import type { CreditResponse } from "./schema";

/* prepaid-credit spec contract. Any member reads the balance (a paused
   business is everyone's problem to know); only the owner tops up
   (D3 matrix, `credit: manage` — the top-up routes land with D6). */
export const creditRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

creditRoute.get("/", requireSession, async (c) => {
  const db = drizzle(c.env.DB);
  const actor = c.get("actor");
  const [business] = await db.select().from(businesses).where(eq(businesses.id, actor.id));
  const summary = await creditSummary(db, business);
  const [clabe, bank, beneficiary] = await Promise.all([
    getSetting(db, "topup_clabe"),
    getSetting(db, "topup_bank"),
    getSetting(db, "topup_beneficiary"),
  ]);
  const data: CreditResponse = {
    ...summary,
    topUp: clabe && bank ? { clabe, bank, beneficiary } : null,
  };
  return c.json({ success: true, data });
});

creditRoute.get("/entries", requireSession, async (c) => {
  const db = drizzle(c.env.DB);
  const cursor = c.req.query("cursor");
  const data = await listEntries(db, c.get("actor").id, cursor ? Number(cursor) : undefined);
  return c.json({ success: true, data });
});

/* prepaid-credit D6 (US-B05): the owner's area (D3 matrix, `credit: manage`) */
creditRoute.post("/top-ups/proof", requireSession, requireArea("credit", "manage"), (c) => uploadTopUpProof(c));
creditRoute.post(
  "/top-ups",
  requireSession,
  requireArea("credit", "manage"),
  zValidator("json", topUpRequest, (result, c) => {
    if (!result.success) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }),
  (c) => submitTopUp(c, c.req.valid("json")),
);
creditRoute.get("/top-ups", requireSession, (c) => listTopUps(c));
creditRoute.get("/top-ups/:id", requireSession, (c) => getTopUp(c, c.req.param("id")));

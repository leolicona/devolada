import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { cashDropRequest, disputeRequest } from "./schema";
import { confirmCashDrop, disputeCashDrop, listCashDrops, recordCashDrop } from "./handler";

export const cashDropsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* Store side: records the handover (cashbox spec) */
cashDropsRoute.post("/", requireSession, zValidator("json", cashDropRequest), (c) => {
  return recordCashDrop(c, c.req.valid("json").cents);
});

/* Admin side: sees, confirms and disputes (cash-drops spec) */
cashDropsRoute.get("/", requireSession, (c) => {
  const scope = c.req.query("scope") === "resolved" ? "resolved" : "pending";
  const cursor = c.req.query("cursor");
  return listCashDrops(c, scope, cursor ? Number(cursor) : undefined);
});

cashDropsRoute.post("/:id/confirm", requireSession, (c) => confirmCashDrop(c, c.req.param("id")));

cashDropsRoute.post("/:id/dispute", requireSession, zValidator("json", disputeRequest), (c) =>
  disputeCashDrop(c, c.req.param("id"), c.req.valid("json").note),
);

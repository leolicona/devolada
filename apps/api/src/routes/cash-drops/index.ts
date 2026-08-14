import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { cashDropRequest } from "./schema";
import { recordCashDrop } from "./handler";

export const cashDropsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

cashDropsRoute.post("/", requireSession, zValidator("json", cashDropRequest), (c) => {
  return recordCashDrop(c, c.req.valid("json").cents);
});

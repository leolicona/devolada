import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { ledgerQuery } from "./schema";
import { listLedger } from "./handler";

export const ledgerRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

ledgerRoute.get("/", requireSession, zValidator("query", ledgerQuery), (c) => {
  return listLedger(c, c.req.valid("query").cursor);
});

import { Hono } from "hono";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { getSettlement } from "./handler";

/* Pure router: wiring only (code organization law). */
export const settlementRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

settlementRoute.get("/", requireSession, (c) => getSettlement(c));

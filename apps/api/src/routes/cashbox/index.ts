import { Hono } from "hono";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { getCashbox } from "./handler";

/* Pure router: wiring only (code organization law). */
export const cashbox = new Hono<{ Bindings: Bindings; Variables: Variables }>();

cashbox.get("/", requireSession, (c) => getCashbox(c));

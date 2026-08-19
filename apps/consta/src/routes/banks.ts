import { Hono } from "hono";
import { requireApiKey } from "../auth/api-key";
import { BANKS } from "../provider/banks";
import type { Bindings, Variables } from "../env";

/* D12: the vocabulary as a contract, so an integrator's bank picker is
   generated from one source instead of transcribed a third time. Behind the
   API key like everything else — the list is not secret, but Consta has no
   anonymous surface (D8). */
export const banksRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

banksRoute.get("/", requireApiKey, (c) => c.json({ success: true, data: { banks: BANKS } }));

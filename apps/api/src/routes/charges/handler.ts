import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { isps } from "../../db/schema";
import { WispHub, WispHubError } from "../../wisphub/client";
import type { CustomerSearchResponse } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

export async function searchCustomers(c: Ctx, q: string) {
  const actor = c.get("actor");
  /* D4: store sessions only */
  if (actor.type !== "store") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }

  const db = drizzle(c.env.DB);
  const [isp] = await db.select().from(isps).where(eq(isps.id, actor.ispId));
  if (!isp?.wisphubApiKey) {
    /* D3: a setup problem, not an outage */
    return c.json({ success: false, error: { code: "WISPHUB_NOT_CONFIGURED" } }, 503);
  }

  try {
    const customers = await new WispHub(isp.wisphubApiKey).searchCustomers(q);
    const data: CustomerSearchResponse = { customers };
    return c.json({ success: true, data });
  } catch (e) {
    if (e instanceof WispHubError) {
      /* D3: a rejected key surfaces as a setup problem, like a missing key */
      const code = e.code === "WISPHUB_AUTH_FAILED" ? "WISPHUB_NOT_CONFIGURED" : e.code;
      return c.json({ success: false, error: { code } }, 503);
    }
    throw e;
  }
}

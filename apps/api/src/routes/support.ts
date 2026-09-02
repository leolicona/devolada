import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../env";
import { getSetting } from "../platform/settings";

/* The platform's support channel, readable without a session: the
   suspended screen has no actor to ask with (sessions rule 2 revokes
   it), and the channel is public by nature (operator-panel D1,
   identity round). */
export const supportRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

supportRoute.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const [whatsapp, email] = await Promise.all([
    getSetting(db, "support_whatsapp"),
    getSetting(db, "support_email"),
  ]);
  return c.json({ success: true, data: { whatsapp, email } });
});

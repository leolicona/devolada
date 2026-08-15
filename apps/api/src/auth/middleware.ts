import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Actor, Bindings, Variables } from "../env";
import { isps, session as sessionTable, stores } from "../db/schema";
import { makeAuth } from "./better";

/* Resolves the Better Auth user to our actor. The user's id links via
   `userId` (better-auth.spec.md D3); emailVerified rides in from the
   Better Auth user, which owns it now. */
export async function findActor(
  env: Bindings,
  user: { id: string; email: string; emailVerified: boolean },
): Promise<Actor | null> {
  const db = drizzle(env.DB);
  const [store] = await db.select().from(stores).where(eq(stores.userId, user.id));
  if (store) {
    return {
      type: "store",
      id: store.id,
      ispId: store.ispId,
      name: store.name,
      phone: store.phone,
      status: store.status,
    };
  }
  const [isp] = await db.select().from(isps).where(eq(isps.userId, user.id));
  if (isp) {
    return {
      type: "isp",
      id: isp.id,
      name: isp.name,
      email: isp.email,
      emailVerified: user.emailVerified,
      status: isp.status,
      timezone: isp.timezone,
      timeFormat: isp.timeFormat,
      wisphubConfigured: Boolean(isp.wisphubApiKey),
    };
  }
  return null;
}

/* Session required (better-auth.spec.md D5): Better Auth resolves the
   session cookie; the actor's status is checked in the DB on every
   request, so a suspension revokes access immediately (US-S03). */
export const requireSession = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const auth = makeAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401);
    }

    const actor = await findActor(c.env, session.user);
    if (!actor) {
      return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401);
    }
    if (actor.status === "suspended") {
      /* Revoke server-side: the cookie the client still holds now points
         at nothing (spec D5 "clears the session"). */
      const db = drizzle(c.env.DB);
      await db.delete(sessionTable).where(eq(sessionTable.id, session.session.id));
      return c.json({ success: false, error: { code: "ACCOUNT_SUSPENDED" } }, 403);
    }

    c.set("actor", actor);
    await next();
  },
);

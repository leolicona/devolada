import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Actor, Bindings, Variables } from "../env";
import { isps, stores } from "../db/schema";
import { AgnosticAuth } from "./agnostic";
import { readPayload } from "./jwt";
import { COOKIE_ACCESS, COOKIE_REFRESH, clearSessionCookies, setSessionCookies } from "./cookies";

export async function findActor(env: Bindings, identity: string): Promise<Actor | null> {
  const db = drizzle(env.DB);
  const [store] = await db.select().from(stores).where(eq(stores.phone, identity));
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
  const [isp] = await db.select().from(isps).where(eq(isps.email, identity));
  if (isp) {
    return {
      type: "isp",
      id: isp.id,
      name: isp.name,
      email: isp.email,
      emailVerified: isp.emailVerified,
      status: isp.status,
    };
  }
  return null;
}

/* Session required: validates gm_access; if it expired and gm_refresh is
   valid, renews in the background, updates cookies and lets the original
   request continue. Checks status in the DB on every request:
   a suspension revokes access immediately. */
export const requireSession = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const access = getCookie(c, COOKIE_ACCESS);
    const refresh = getCookie(c, COOKIE_REFRESH);

    let payload = access ? await readPayload(access, c.env) : null;

    if (!payload && refresh) {
      try {
        const tokens = await new AgnosticAuth(c.env).refresh(refresh);
        payload = await readPayload(tokens.jwt, c.env);
        if (payload) setSessionCookies(c, tokens);
      } catch {
        /* invalid or revoked refresh: falls through to the 401 below */
      }
    }

    const identity = payload?.identity ?? payload?.sub;
    if (!identity) {
      clearSessionCookies(c);
      return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401);
    }

    const actor = await findActor(c.env, identity);
    if (!actor) {
      clearSessionCookies(c);
      return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401);
    }
    if (actor.status === "suspended") {
      clearSessionCookies(c);
      return c.json({ success: false, error: { code: "ACCOUNT_SUSPENDED" } }, 403);
    }

    c.set("actor", actor);
    await next();
  },
);

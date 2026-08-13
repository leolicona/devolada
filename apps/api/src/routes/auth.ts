import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../env";
import { isps, stores } from "../db/schema";
import { AgnosticAuth, AuthError } from "../auth/agnostic";
import { COOKIE_REFRESH, clearSessionCookies, setSessionCookies } from "../auth/cookies";
import { requireSession } from "../auth/middleware";

export const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const storeCredentials = z.object({
  phone: z.string().min(10).max(15),
  password: z.string().min(8),
});

const adminCredentials = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

/* Identical 401 whether the account exists or not: don't leak which
   phones/emails are registered */
const unauthorized = { success: false, error: { code: "AUTHENTICATION_ERROR" } } as const;

auth.post("/store/login", zValidator("json", storeCredentials), async (c) => {
  const { phone, password } = c.req.valid("json");
  const db = drizzle(c.env.DB);

  const [store] = await db.select().from(stores).where(eq(stores.phone, phone));
  if (!store?.passwordHash || !store.passwordSalt) return c.json(unauthorized, 401);
  if (store.status === "suspended") {
    return c.json({ success: false, error: { code: "ACCOUNT_SUSPENDED" } }, 403);
  }

  try {
    const tokens = await new AgnosticAuth(c.env).verifyPassword(
      phone,
      password,
      store.passwordHash,
      store.passwordSalt,
    );
    setSessionCookies(c, tokens);
    return c.json({
      success: true,
      data: { type: "store", id: store.id, name: store.name },
    });
  } catch (e) {
    /* Only invalid credentials map to 401; configuration errors
       (unregistered app, validation) must stay visible, not a fake 401 */
    if (e instanceof AuthError && e.status === 401) return c.json(unauthorized, 401);
    throw e;
  }
});

auth.post("/admin/login", zValidator("json", adminCredentials), async (c) => {
  const { email, password } = c.req.valid("json");
  const db = drizzle(c.env.DB);

  const [isp] = await db.select().from(isps).where(eq(isps.email, email));
  if (!isp?.passwordHash || !isp.passwordSalt) return c.json(unauthorized, 401);
  if (isp.status === "suspended") {
    return c.json({ success: false, error: { code: "ACCOUNT_SUSPENDED" } }, 403);
  }

  try {
    const tokens = await new AgnosticAuth(c.env).verifyPassword(
      email,
      password,
      isp.passwordHash,
      isp.passwordSalt,
    );
    setSessionCookies(c, tokens);
    return c.json({ success: true, data: { type: "isp", id: isp.id, name: isp.name } });
  } catch (e) {
    if (e instanceof AuthError && e.status === 401) return c.json(unauthorized, 401);
    throw e;
  }
});

auth.post("/logout", async (c) => {
  const refresh = getCookie(c, COOKIE_REFRESH);
  if (refresh) {
    try {
      await new AgnosticAuth(c.env).revoke(refresh);
    } catch {
      /* revocation is best-effort; cookies get cleared regardless */
    }
  }
  clearSessionCookies(c);
  return c.json({ success: true, data: {} });
});

auth.get("/me", requireSession, (c) => {
  return c.json({ success: true, data: c.get("actor") });
});

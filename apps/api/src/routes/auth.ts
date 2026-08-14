import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../env";
import { invitations, isps, stores } from "../db/schema";
import { AgnosticAuth, AuthError } from "../auth/agnostic";
import { COOKIE_REFRESH, clearSessionCookies, setSessionCookies } from "../auth/cookies";
import { requireSession } from "../auth/middleware";
import { readPayload } from "../auth/jwt";
import { sendAuthLink } from "../email/sender";

export const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* Magic links are built with our admin URL, not the IdP's magicLink,
   which points at the registered store domain (spec D1). */
async function sendLink(
  env: Bindings,
  kind: "verify" | "recover",
  email: string,
): Promise<void> {
  const { token } = await new AgnosticAuth(env).initiate(email);
  const path = kind === "verify" ? "verify" : "reset";
  await sendAuthLink(env, kind, email, `${env.ADMIN_BASE_URL}/${path}?token=${token}`);
}

/* Redeems a magic token and resolves which ISP it belongs to.
   Returns null when the token is invalid, used, or maps to no account. */
async function redeemIspToken(env: Bindings, token: string) {
  try {
    const tokens = await new AgnosticAuth(env).verify(token);
    const payload = await readPayload(tokens.jwt, env);
    const identity = payload?.identity ?? payload?.sub;
    if (!identity) return null;
    const db = drizzle(env.DB);
    const [isp] = await db.select().from(isps).where(eq(isps.email, identity));
    if (!isp) return null;
    return { isp, tokens };
  } catch (e) {
    if (e instanceof AuthError && e.status < 500) return null;
    throw e;
  }
}

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

const signupInput = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

auth.post("/signup", zValidator("json", signupInput), async (c) => {
  const { name, email, password } = c.req.valid("json");
  const db = drizzle(c.env.DB);

  const [existing] = await db.select().from(isps).where(eq(isps.email, email));
  /* Signup necessarily reveals existence (spec D4) */
  if (existing) return c.json({ success: false, error: { code: "EMAIL_TAKEN" } }, 409);

  const idp = new AgnosticAuth(c.env);
  const { hash, salt } = await idp.hash(password);
  const [isp] = await db
    .insert(isps)
    .values({ name, email, passwordHash: hash, passwordSalt: salt })
    .returning();

  const tokens = await idp.verifyPassword(email, password, hash, salt);
  setSessionCookies(c, tokens);

  /* Best-effort: the account never depends on the email provider (spec D2) */
  try {
    await sendLink(c.env, "verify", email);
  } catch (e) {
    console.error("verification email failed", e);
  }

  return c.json(
    { success: true, data: { type: "isp", id: isp.id, name: isp.name, emailVerified: false } },
    201,
  );
});

auth.post(
  "/verify-email",
  zValidator("json", z.object({ token: z.string().min(1) })),
  async (c) => {
    const redeemed = await redeemIspToken(c.env, c.req.valid("json").token);
    if (!redeemed) return c.json({ success: false, error: { code: "INVALID_TOKEN" } }, 400);

    const db = drizzle(c.env.DB);
    await db.update(isps).set({ emailVerified: true }).where(eq(isps.id, redeemed.isp.id));
    setSessionCookies(c, redeemed.tokens);
    return c.json({
      success: true,
      data: { type: "isp", id: redeemed.isp.id, name: redeemed.isp.name, emailVerified: true },
    });
  },
);

auth.post("/resend-verification", requireSession, async (c) => {
  const actor = c.get("actor");
  if (actor.type !== "isp") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const [isp] = await db.select().from(isps).where(eq(isps.id, actor.id));
  if (isp?.emailVerified) {
    return c.json({ success: false, error: { code: "ALREADY_VERIFIED" } }, 409);
  }
  try {
    await sendLink(c.env, "verify", actor.email);
  } catch (e) {
    console.error("verification email failed", e);
  }
  return c.json({ success: true, data: {} });
});

auth.post(
  "/recover",
  zValidator("json", z.object({ email: z.string().email() })),
  async (c) => {
    const { email } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const [isp] = await db.select().from(isps).where(eq(isps.email, email));
    /* Identical 200 whether the account exists or not (no existence leak) */
    if (isp) {
      try {
        await sendLink(c.env, "recover", email);
      } catch (e) {
        console.error("recovery email failed", e);
      }
    }
    return c.json({ success: true, data: {} });
  },
);

auth.post(
  "/reset-password",
  zValidator("json", z.object({ token: z.string().min(1), password: z.string().min(8) })),
  async (c) => {
    const { token, password } = c.req.valid("json");
    const redeemed = await redeemIspToken(c.env, token);
    if (!redeemed) return c.json({ success: false, error: { code: "INVALID_TOKEN" } }, 400);

    const { hash, salt } = await new AgnosticAuth(c.env).hash(password);
    const db = drizzle(c.env.DB);
    /* Completing a reset proves email ownership (spec D5) */
    await db
      .update(isps)
      .set({ passwordHash: hash, passwordSalt: salt, emailVerified: true })
      .where(eq(isps.id, redeemed.isp.id));
    setSessionCookies(c, redeemed.tokens);
    return c.json({
      success: true,
      data: { type: "isp", id: redeemed.isp.id, name: redeemed.isp.name, emailVerified: true },
    });
  },
);

/* Store invitation redemption (store-invitation spec). One call:
   verify the token, set the password, activate, sign in. */
auth.post(
  "/store/accept-invitation",
  zValidator("json", z.object({ token: z.string().min(1), password: z.string().min(8) })),
  async (c) => {
    const { token, password } = c.req.valid("json");
    const invalid = () =>
      c.json({ success: false, error: { code: "INVALID_TOKEN" } }, 400);

    const idp = new AgnosticAuth(c.env);
    let tokens;
    try {
      tokens = await idp.verify(token);
    } catch (e) {
      /* D3: every failure shape answers the same */
      if (e instanceof AuthError && e.status < 500) return invalid();
      throw e;
    }

    const db = drizzle(c.env.DB);
    const [invitation] = await db.select().from(invitations).where(eq(invitations.token, token));
    if (!invitation || invitation.status !== "sent") return invalid();

    const [store] = await db.select().from(stores).where(eq(stores.id, invitation.storeId));
    if (!store) return invalid();

    const { hash, salt } = await idp.hash(password);
    /* D2: accepting also activates */
    await db
      .update(stores)
      .set({ passwordHash: hash, passwordSalt: salt, status: "active" })
      .where(eq(stores.id, store.id));
    await db
      .update(invitations)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(invitations.id, invitation.id));

    setSessionCookies(c, tokens);
    return c.json({ success: true, data: { type: "store", id: store.id, name: store.name } });
  },
);

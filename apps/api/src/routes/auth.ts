import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { APIError } from "better-auth";
import type { Bindings, Variables } from "../env";
import {
  account as accountTable,
  isps,
  session as sessionTable,
  user as userTable,
} from "../db/schema";
import { makeAuth } from "../auth/better";
import { requireSession } from "../auth/middleware";

/* Auth routes (better-auth.spec.md D6): our thin envelope routes first,
   then everything else under /auth/* falls through to the Better Auth
   handler, whose endpoints are exempt from the envelope by rule. */

export const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* Deletes a Better Auth user and its dependents — the cleanup path when
   linking the actor row fails after the user was created. */
async function removeUser(db: ReturnType<typeof drizzle>, userId: string) {
  await db.delete(sessionTable).where(eq(sessionTable.userId, userId));
  await db.delete(accountTable).where(eq(accountTable.userId, userId));
  await db.delete(userTable).where(eq(userTable.id, userId));
}

/* Better Auth sets its session cookie on its own response; our envelope
   responses have to carry it over. */
function forwardCookies(from: Headers, c: Context) {
  /* getSetCookie exists in workerd; the lib types lag behind */
  const cookies = (from as Headers & { getSetCookie(): string[] }).getSetCookie();
  for (const cookie of cookies) {
    c.header("set-cookie", cookie, { append: true });
  }
}

const signupInput = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

auth.post("/isp/signup", zValidator("json", signupInput), async (c) => {
  const { name, email, password } = c.req.valid("json");
  const db = drizzle(c.env.DB);

  /* Signup necessarily reveals existence (rule inherited from the old
     spec's D4). BOTH tables: a user row, or an isps row — including
     pre-migration rows with no user linked. Checking only `user` once
     created an orphan (user inserted, isps UNIQUE(email) blew up), and
     an orphan signs in but /auth/me finds no actor. */
  const [existing] = await db.select().from(userTable).where(eq(userTable.email, email));
  if (existing) return c.json({ success: false, error: { code: "EMAIL_TAKEN" } }, 409);
  const [taken] = await db.select().from(isps).where(eq(isps.email, email));
  if (taken) return c.json({ success: false, error: { code: "EMAIL_TAKEN" } }, 409);

  const ba = makeAuth(c.env);
  const { headers, response } = await ba.api.signUpEmail({
    body: { name, email, password },
    returnHeaders: true,
  });

  /* isps.email is the business/display copy (schema note); auth reads
     the Better Auth user only. The verification code went out through
     the OTP hook, best-effort by construction. */
  let isp;
  try {
    [isp] = await db
      .insert(isps)
      .values({ name, email, userId: response.user.id })
      .returning();
  } catch (e) {
    /* Never leave an orphan behind: a user that signs in but resolves
       to no actor is worse than a failed signup */
    await removeUser(db, response.user.id);
    throw e;
  }

  forwardCookies(headers, c);
  return c.json(
    { success: true, data: { type: "isp", id: isp.id, name: isp.name, emailVerified: false } },
    201,
  );
});

auth.get("/me", requireSession, (c) => {
  return c.json({ success: true, data: c.get("actor") });
});

/* Everything else — sign-in/email, email-otp/*,
   passkey/*, sign-out, get-session — is Better Auth's, exempt from the
   envelope (spec D6). Registered last so our routes above win. */
auth.on(["GET", "POST"], "/*", (c) => makeAuth(c.env).handler(c.req.raw));

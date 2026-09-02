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
  businesses,
  session as sessionTable,
  user as userTable,
} from "../db/schema";
import { makeAuth } from "../auth/better";
import { requireSession } from "../auth/middleware";
import { rateLimitRoute } from "../auth/rate-limit";
import { creditSummary } from "../credit";

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

/* The cookies Better Auth just set, as a request header — for calling
   its own API on behalf of the user it just created. */
function cookieHeadersFrom(from: Headers): Headers {
  const cookies = (from as Headers & { getSetCookie(): string[] }).getSetCookie();
  return new Headers({ Cookie: cookies.map((c) => c.split(";")[0]).join("; ") });
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

/* D15: our own door, our own tope — Better Auth's limiter never sees a
   Hono route. Five accounts a minute per address is plenty for a person
   and nothing for a script. */
auth.post("/business/signup", rateLimitRoute("business-signup", { window: 60, max: 5 }), zValidator("json", signupInput), async (c) => {
  const { name, email, password } = c.req.valid("json");
  const db = drizzle(c.env.DB);

  /* Signup necessarily reveals existence (rule inherited from the old
     spec's D4). The user table is the only identity now. */
  const [existing] = await db.select().from(userTable).where(eq(userTable.email, email));
  if (existing) return c.json({ success: false, error: { code: "EMAIL_TAKEN" } }, 409);

  /* business-and-memberships D5: signup births the USER only. The
     business is persisted at wizard completion (`POST /businesses`),
     never here — an abandoned wizard creates nothing. The verification
     code goes out through the OTP hook, best-effort by construction. */
  const ba = makeAuth(c.env);
  const { headers, response } = await ba.api.signUpEmail({
    body: { name, email, password },
    returnHeaders: true,
  });

  /* The código goes out from here, not from the sign-up hook (D13/D14):
     best-effort by construction — the OTP hook never throws, and neither
     may this. */
  try {
    await ba.api.sendVerificationOTP({ body: { email, type: "email-verification" } });
  } catch (e) {
    console.error("signup verification code failed", e);
  }

  forwardCookies(headers, c);
  return c.json(
    { success: true, data: { type: "user", id: response.user.id, name, emailVerified: false } },
    201,
  );
});

/* prepaid-credit D7: the chip reads its step from the session query —
   computed here, once per /auth/me, never in the middleware (a SUM and
   three settings reads on every request was the wrong price). */
auth.get("/me", requireSession, async (c) => {
  const actor = c.get("actor");
  const db = drizzle(c.env.DB);
  const [business] = await db.select().from(businesses).where(eq(businesses.id, actor.id));
  const credit = await creditSummary(db, business);
  return c.json({
    success: true,
    data: { ...actor, credit: { balanceCents: credit.balanceCents, step: credit.step } },
  });
});

/* Everything else — sign-in/email, email-otp/*,
   passkey/*, sign-out, get-session — is Better Auth's, exempt from the
   envelope (spec D6). Registered last so our routes above win. */
auth.on(["GET", "POST"], "/*", (c) => makeAuth(c.env).handler(c.req.raw));

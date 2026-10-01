import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../env";
import {
  account as accountTable,
  businesses,
  session as sessionTable,
  user as userTable,
  verification,
} from "../db/schema";
import { makeAuth } from "../auth/better";
import { requireAnyActor } from "../auth/middleware";
import { channelBusiness } from "../store-channel";
import { rateLimitRoute } from "../auth/rate-limit";
import { creditSummary } from "../credit";

/* Auth routes (better-auth.spec.md D6): our thin envelope routes first,
   then everything else under /auth/* falls through to the Better Auth
   handler, whose endpoints are exempt from the envelope by rule. */

export const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* Deletes a Better Auth user and its dependents — once the cleanup path
   when linking the actor row failed; now D16's replacement of an
   unverified account by a fresh signup. */
async function removeUser(db: ReturnType<typeof drizzle>, userId: string) {
  await db.delete(sessionTable).where(eq(sessionTable.userId, userId));
  await db.delete(accountTable).where(eq(accountTable.userId, userId));
  await db.delete(userTable).where(eq(userTable.id, userId));
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
     spec's D4). The user table is the only identity now. D16: an
     unverified account is a half-typed address, not a taken one — the
     new signup replaces it (password included), so a mistyped email can
     never lock its owner out. A verified account is taken for good. */
  const [existing] = await db.select().from(userTable).where(eq(userTable.email, email));
  if (existing) {
    if (existing.emailVerified) return c.json({ success: false, error: { code: "EMAIL_TAKEN" } }, 409);
    await removeUser(db, existing.id);
    /* The old código dies with the old account: the plugin reads the
       first live row for an identifier, so a second one would make the
       fresh código fail. Identifier shape pinned against 1.6.29's dist. */
    await db.delete(verification).where(eq(verification.identifier, `email-verification-otp-${email.toLowerCase()}`));
  }

  /* business-and-memberships D5: signup births the USER only. The
     business is persisted at wizard completion (`POST /businesses`),
     never here — an abandoned wizard creates nothing. D16: no session
     either — `email-otp/verify-email` opens it once the código is typed. */
  const ba = makeAuth(c.env);
  const { response } = await ba.api.signUpEmail({
    body: { name, email, password },
    returnHeaders: true,
  });

  /* The código goes out from here, not from the sign-up hook (D14/D16):
     best-effort by construction — the OTP hook never throws, and neither
     may this. If it fails, the verify screen's "Reenviar" is the retry. */
  try {
    await ba.api.sendVerificationOTP({ body: { email, type: "email-verification" } });
  } catch (e) {
    console.error("signup verification code failed", e);
  }

  return c.json(
    { success: true, data: { type: "user", id: response.user.id, name, emailVerified: false } },
    201,
  );
});

/* prepaid-credit D7: the chip reads its step from the session query —
   computed here, once per /auth/me, never in the middleware (a SUM and
   three settings reads on every request was the wrong price). */
auth.get("/me", requireAnyActor, async (c) => {
  const db = drizzle(c.env.DB);
  /* cash-at-stores D2: a shopkeeper's session answers the store branch —
     the store, and the one business its counter serves (null while no
     business has the channel on, FR-015) */
  const store = c.get("store");
  if (store) {
    const business = await channelBusiness(db);
    return c.json({
      success: true,
      data: { type: "store" as const, storeId: store.storeId, name: store.name, businessName: business?.name ?? null },
    });
  }
  const actor = c.get("actor");
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

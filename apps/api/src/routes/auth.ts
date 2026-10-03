import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../env";
import { businesses } from "../db/schema";
import { makeAuth } from "../auth/better";
import { foldCodeRefusal } from "../auth/otp-refusal";
import { requireAnyActor } from "../auth/middleware";
import { channelBusiness } from "../store-channel";
import { creditSummary } from "../credit";
import type { StoreMeResponse } from "./store/schema";

/* Auth routes (better-auth.spec.md D6): our thin envelope routes first,
   then everything else under /auth/* falls through to the Better Auth
   handler, whose endpoints are exempt from the envelope by rule. */

export const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* passwordless-access D1: `POST /auth/business/signup` (better-auth D15,
   D16) retired. Registration is the email-OTP plugin's sign-in door —
   `send-verification-otp`, then `sign-in/email-otp` with the name — which
   births the account verified, at the código, and never says whether the
   address was taken (FR-005). */

/* prepaid-credit D7: the chip reads its step from the session query —
   computed here, once per /auth/me, never in the middleware (a SUM and
   three settings reads on every request was the wrong price). */
auth.get("/me", requireAnyActor, async (c) => {
  const db = drizzle(c.env.DB);
  /* cash-at-stores D2: a shopkeeper's session answers the store branch —
     the store, and the one business its counter serves (null while no
     business has the channel on, FR-015). passwordless-access D8: and the
     store account's own email, where Caja's step-up sends its código —
     shown only to the store's own session, so it reveals nothing. */
  const store = c.get("store");
  if (store) {
    const business = await channelBusiness(db);
    const data: StoreMeResponse = {
      type: "store",
      storeId: store.storeId,
      name: store.name,
      businessName: business?.name ?? null,
      email: store.email,
    };
    return c.json({ success: true, data });
  }
  const actor = c.get("actor");
  const [business] = await db.select().from(businesses).where(eq(businesses.id, actor.id));
  const credit = await creditSummary(db, business);
  return c.json({
    success: true,
    data: { ...actor, credit: { balanceCents: credit.balanceCents, step: credit.step } },
  });
});

/* passwordless-access FR-033, SC-006 (adversarial review, 2026-10-03):
   Better Auth's one HTTP door that checks a código — its
   `check-verification-otp` and `verify-email` are in `disabledPaths`
   (auth/better.ts). Our own doors check through `auth.api` and never pass
   here: `POST /store/sign-in` folds in its handler; the store acceptance
   and accept-new keep the plugin's three words (D9, D10). Better Auth
   routes on the URL's own pathname and answers 404 to a trailing slash or
   a doubled one (better-call 1.4.0's router.mjs, as better-auth 1.6.29
   pins it; `skipTrailingSlashes` unset), so this exact path is every
   request that reaches it. */
const CODE_DOOR = "/auth/sign-in/email-otp";

/* Everything else — email-otp/*, sign-in/email-otp,
   passkey/*, sign-out, get-session — is Better Auth's, exempt from the
   envelope (spec D6). Registered last so our routes above win. Its código
   door folds OTP_EXPIRED and TOO_MANY_ATTEMPTS into INVALID_OTP
   (`foldCodeRefusal`): those two exist only for an address holding a
   live código, which is what a store's phone writes. */
auth.on(["GET", "POST"], "/*", async (c) => {
  const betterAuth = makeAuth(c.env);
  const res = await betterAuth.handler(c.req.raw);
  if (c.req.method !== "POST" || new URL(c.req.url).pathname !== CODE_DOOR) return res;
  return foldCodeRefusal(res, betterAuth.$ERROR_CODES.INVALID_OTP);
});

import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { APIError } from "better-auth";
import type { Bindings, Variables } from "../env";
import { invitations, isps, stores, user as userTable } from "../db/schema";
import { makeAuth } from "../auth/better";
import { requireSession } from "../auth/middleware";

/* Auth routes (better-auth.spec.md D6): our thin envelope routes first,
   then everything else under /auth/* falls through to the Better Auth
   handler, whose endpoints are exempt from the envelope by rule. */

export const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
     spec's D4) */
  const [existing] = await db.select().from(userTable).where(eq(userTable.email, email));
  if (existing) return c.json({ success: false, error: { code: "EMAIL_TAKEN" } }, 409);

  const ba = makeAuth(c.env);
  const { headers, response } = await ba.api.signUpEmail({
    body: { name, email, password },
    returnHeaders: true,
  });

  /* isps.email is the business/display copy (schema note); auth reads
     the Better Auth user only. The verification code went out through
     the OTP hook, best-effort by construction. */
  const [isp] = await db
    .insert(isps)
    .values({ name, email, userId: response.user.id })
    .returning();

  forwardCookies(headers, c);
  return c.json(
    { success: true, data: { type: "isp", id: isp.id, name: isp.name, emailVerified: false } },
    201,
  );
});

/* Store invitation redemption (spec D8): our own single-use token, valid
   7 days. Collects the shopkeeper's recovery email; activation never
   waits for the code email. */
auth.post(
  "/store/accept-invitation",
  zValidator(
    "json",
    z.object({ token: z.string().min(1), email: z.string().email(), password: z.string().min(8) }),
  ),
  async (c) => {
    const { token, email, password } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    /* One generic failure to the client; the distinct cause in the log
       (TD-012's lesson). */
    const invalid = (cause: string) => {
      console.log(`accept-invitation rejected: ${cause}`);
      return c.json({ success: false, error: { code: "INVALID_TOKEN" } }, 400);
    };

    const [invitation] = await db.select().from(invitations).where(eq(invitations.token, token));
    if (!invitation) return invalid("unknown token");
    if (invitation.status !== "sent") return invalid("already accepted");
    if (Date.now() - invitation.createdAt.getTime() > SEVEN_DAYS_MS) {
      return invalid("expired (7-day window, spec D8)");
    }

    const [store] = await db.select().from(stores).where(eq(stores.id, invitation.storeId));
    if (!store) return invalid("invitation without store");

    const [taken] = await db.select().from(userTable).where(eq(userTable.email, email));
    if (taken) return c.json({ success: false, error: { code: "EMAIL_TAKEN" } }, 409);

    const ba = makeAuth(c.env);
    let result;
    try {
      result = await ba.api.signUpEmail({
        /* The store's phone is its login username (spec D3) */
        body: { name: store.contactName, email, password, username: store.phone },
        returnHeaders: true,
      });
    } catch (e) {
      if (e instanceof APIError) {
        console.log(`accept-invitation sign-up failed: ${e.message}`);
        return c.json({ success: false, error: { code: "EMAIL_TAKEN" } }, 409);
      }
      throw e;
    }

    /* Accepting also activates (rule inherited from the old spec) */
    await db
      .update(stores)
      .set({ userId: result.response.user.id, status: "active" })
      .where(eq(stores.id, store.id));
    await db
      .update(invitations)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(invitations.id, invitation.id));

    forwardCookies(result.headers, c);
    return c.json({ success: true, data: { type: "store", id: store.id, name: store.name } });
  },
);

auth.get("/me", requireSession, (c) => {
  return c.json({ success: true, data: c.get("actor") });
});

/* Everything else — sign-in/email, sign-in/username, email-otp/*,
   passkey/*, sign-out, get-session — is Better Auth's, exempt from the
   envelope (spec D6). Registered last so our routes above win. */
auth.on(["GET", "POST"], "/*", (c) => makeAuth(c.env).handler(c.req.raw));

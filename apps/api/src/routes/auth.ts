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

auth.post("/business/signup", zValidator("json", signupInput), async (c) => {
  const { name, email, password } = c.req.valid("json");
  const db = drizzle(c.env.DB);

  /* Signup necessarily reveals existence (rule inherited from the old
     spec's D4). BOTH tables: a user row, or an businesses row — including
     pre-migration rows with no user linked. Checking only `user` once
     created an orphan (user inserted, businesses UNIQUE(email) blew up), and
     an orphan signs in but /auth/me finds no actor. */
  const [existing] = await db.select().from(userTable).where(eq(userTable.email, email));
  if (existing) return c.json({ success: false, error: { code: "EMAIL_TAKEN" } }, 409);
  const [taken] = await db.select().from(businesses).where(eq(businesses.email, email));
  if (taken) return c.json({ success: false, error: { code: "EMAIL_TAKEN" } }, 409);

  const ba = makeAuth(c.env);
  const { headers, response } = await ba.api.signUpEmail({
    body: { name, email, password },
    returnHeaders: true,
  });

  /* Interim shape until the wizard lands (business-and-memberships D5,
     phase-2 frontend PR): signup still births the business, now with its
     auth twin — the organization the plugin creates, the creator as owner
     (spike 1) — and the business row pointing at it. Any failure after
     the user exists removes everything: a user that signs in but resolves
     to no actor is worse than a failed signup. */
  const sessionHeaders = cookieHeadersFrom(headers);
  let business;
  let orgId: string | null = null;
  try {
    const org = await ba.api.createOrganization({
      headers: sessionHeaders,
      body: { name, slug: `negocio-${crypto.randomUUID().slice(0, 8)}` },
    });
    if (!org) throw new Error("organization not created");
    orgId = org.id;
    [business] = await db.insert(businesses).values({ name, email, orgId }).returning();
    await ba.api.setActiveOrganization({ headers: sessionHeaders, body: { organizationId: orgId } });
  } catch (e) {
    if (orgId) {
      await ba.api
        .deleteOrganization({ headers: sessionHeaders, body: { organizationId: orgId } })
        .catch(() => undefined);
    }
    await removeUser(db, response.user.id);
    throw e;
  }

  forwardCookies(headers, c);
  return c.json(
    { success: true, data: { type: "business", id: business.id, name: business.name, emailVerified: false } },
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

import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  businesses,
  member,
  organization,
  session as sessionTable,
  user as userTable,
  verification,
} from "../src/db/schema";
import type { Role } from "../src/auth/roles";
import { makeAuth } from "../src/auth/better";
import type { Bindings } from "../src/env";

/* Better Auth world (better-auth.spec.md): no IdP to mock. Users are
   created through the real server API; sessions are rows in our own D1.
   `sessionCookieHeader` stays stateless (any test may build it, even at
   module top level): it signs a deterministic token, and the seed
   functions insert the matching session row. */

export const PASSWORD = "devolada123";

/* The Hono app, not the worker default export (which also carries
   the cron `scheduled` handler). */
export const app = async () => (await import("../src/index")).app;

const auth = () => makeAuth(env as unknown as Bindings);

/* Sign with whatever secret makeAuth will verify with: the binding when
   `.dev.vars` provides one (vitest-pool-workers loads it), the fallback
   otherwise. Hardcoding the fallback broke every forged cookie on any
   machine whose .dev.vars had the real secret. */
const TEST_SECRET =
  (env as unknown as Bindings).BETTER_AUTH_SECRET ?? "devolada-dev-only-insecure-secret";

const tokenFor = (identity: string) => `test-session-${identity}`;

/* Mirrors better-call's signCookieValue (crypto.mjs): HMAC-SHA256,
   plain base64, URI-encoded "token.signature". */
async function signedSessionCookie(token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TEST_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `better-auth.session_token=${encodeURIComponent(`${token}.${b64}`)}`;
}

export function sessionCookieHeader(identity: string): Promise<string> {
  return signedSessionCookie(tokenFor(identity));
}

export async function seedSession(userId: string, identity: string, activeOrganizationId?: string) {
  await drizzle(env.DB)
    .insert(sessionTable)
    .values({
      id: crypto.randomUUID(),
      token: tokenFor(identity),
      userId,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
      activeOrganizationId: activeOrganizationId ?? null,
    });
}

async function seedAuthUser(
  name: string,
  email: string,
  opts: { emailVerified?: boolean } = {},
) {
  const { response } = await auth().api.signUpEmail({
    body: { name, email, password: PASSWORD },
    returnHeaders: true,
  });
  if (opts.emailVerified !== false) {
    await drizzle(env.DB)
      .update(userTable)
      .set({ emailVerified: true })
      .where(eq(userTable.id, response.user.id));
  }
  return response.user.id;
}

/* A business with its auth twin and one owner (business-and-memberships
   D1/D2): organization + member rows through the server-side door, the
   same shape the D7 backfill and the dev seed write. The session row is
   seeded pointing at the organization, like the sign-in hook would. */
export async function seedBusiness(
  overrides: Partial<typeof businesses.$inferInsert> & { emailVerified?: boolean } = {},
) {
  const { emailVerified, ...businessOverrides } = overrides;
  const email = businessOverrides.email ?? "demo@devolada.app";
  const userId = await seedAuthUser("ISP Demo", email, { emailVerified });
  const db = drizzle(env.DB);
  const orgId = `org_${crypto.randomUUID()}`;
  const now = new Date();
  await db.insert(organization).values({ id: orgId, name: "ISP Demo", slug: `negocio-${orgId.slice(4, 12)}`, createdAt: now });
  await db.insert(member).values({ id: crypto.randomUUID(), organizationId: orgId, userId, role: "owner", createdAt: now });
  await seedSession(userId, email, orgId);
  const [business] = await db
    .insert(businesses)
    .values({ name: "ISP Demo", email, orgId, ...businessOverrides })
    .returning();
  return business;
}

/* A second person inside an existing business, with the given role and a
   session of their own (`sessionCookieHeader(email)`). */
export async function seedMember(business: { orgId: string }, email: string, role: Role) {
  const userId = await seedAuthUser(email.split("@")[0], email);
  const db = drizzle(env.DB);
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: business.orgId,
    userId,
    role,
    createdAt: new Date(),
  });
  await seedSession(userId, email, business.orgId);
  return userId;
}

export function cookiesOf(res: Response): string[] {
  return (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
}

/* The session cookie from a response, ready for a Cookie header */
export function sessionOf(res: Response): string {
  const cookie = cookiesOf(res).find((c) => c.includes("session_token"));
  if (!cookie) throw new Error(`no session cookie in: ${cookiesOf(res).join(" | ")}`);
  return cookie.split(";")[0];
}

/* The last code "emailed" to an address (spec D4): Better Auth keeps it
   in the verification table until redeemed. */
export async function lastCodeFor(email: string): Promise<string> {
  const rows = await drizzle(env.DB).select().from(verification);
  const row = rows.filter((r) => r.identifier.includes(email)).at(-1);
  if (!row) throw new Error(`no code stored for ${email}`);
  const match = /\d{6}/.exec(row.value);
  if (!match) throw new Error(`no 6-digit code in: ${row.value}`);
  return match[0];
}

/* A browser always sends Origin on POST; Better Auth's CSRF check
   requires it on cookie-bearing requests. */
export const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "http://localhost:5174" },
  body: JSON.stringify(body),
});

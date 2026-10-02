import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import {
  businesses, integrations,
  member,
  organization,
  paymentLinks,
  payments,
  session as sessionTable,
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

/* In-memory R2 for the proof bucket: real R2 writes trip
   vitest-pool-workers' isolated storage (its snapshotter rejects the
   bucket's sqlite WAL files). D1 stays real — the "no database mocks"
   rule is about D1; the blob store is an implementation detail behind
   four calls. Shared by the payment suites and the engine's own
   (consta-api-merge D12): the engine reads proofs from this bucket now
   (D7), so a test that uploads one and validates it goes through the
   same double end to end. */
export function fakeProofs(): R2Bucket {
  const store = new Map<string, { data: unknown; contentType?: string; uploaded: Date }>();
  return {
    async put(key: string, value: unknown, opts?: R2PutOptions) {
      const meta = (opts?.httpMetadata as { contentType?: string } | undefined)?.contentType;
      store.set(key, { data: value, contentType: meta, uploaded: new Date() });
      return {} as R2Object;
    },
    async head(key: string) {
      return store.has(key) ? ({} as R2Object) : null;
    },
    /* receipt-reader-tuning US3: a bench file the 15-day rule removed */
    async delete(key: string) {
      store.delete(key);
    },
    /* Enough of the real shape for the upload budget: prefix filter and
       an `uploaded` date per object (direct-payment D13) */
    async list(opts?: R2ListOptions) {
      const prefix = opts?.prefix ?? "";
      return {
        objects: [...store.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, o]) => ({ key, uploaded: o.uploaded }) as R2Object),
        truncated: false,
      } as unknown as R2Objects;
    },
    async get(key: string) {
      const object = store.get(key);
      if (!object) return null;
      return {
        body: new Blob([object.data as BlobPart]).stream(),
        httpMetadata: { contentType: object.contentType },
      } as unknown as R2ObjectBody;
    },
  } as unknown as R2Bucket;
}

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

export async function seedSession(
  userId: string,
  identity: string,
  activeOrganizationId?: string,
  /* A row born `ageDays` ago, as the sign-in of that day would have
     written it (BUG-015: the refresh only fires after a day of use) */
  opts: { ageDays?: number } = {},
) {
  const born = Date.now() - (opts.ageDays ?? 0) * 24 * 3600 * 1000;
  await drizzle(env.DB)
    .insert(sessionTable)
    .values({
      id: crypto.randomUUID(),
      token: tokenFor(identity),
      userId,
      expiresAt: new Date(born + 30 * 24 * 3600 * 1000),
      createdAt: new Date(born),
      updatedAt: new Date(born),
      activeOrganizationId: activeOrganizationId ?? null,
    });
}

/* passwordless-access D14: a panel person is born without a password —
   a `user` row and no `account` row, written through Better Auth's own
   adapter, as every door of the product now births one. `emailVerified:
   false` stays possible for the legacy rows the sweep and the session gate
   are proven against (D5, better-auth D16). */
async function seedAuthUser(
  name: string,
  email: string,
  opts: { emailVerified?: boolean } = {},
) {
  const user = await (await auth().$context).internalAdapter.createUser({
    name,
    email,
    emailVerified: opts.emailVerified !== false,
  });
  return user.id;
}

/* passwordless-access D14 (PR 2): a user as the retired password doors
   left one — a `user` row and a `credential` account holding a password
   hash — for the cases the sweep and the código are proven against (D5,
   analysis G1). `signUpEmail` cannot write one any more: `emailAndPassword`
   is off (D4). Unverified by default, as the old sign-up left a person
   before their first código. */
export async function seedLegacyUser(
  name: string,
  email: string,
  opts: { emailVerified?: boolean } = {},
) {
  const ctx = await auth().$context;
  const user = await ctx.internalAdapter.createUser({ name, email, emailVerified: opts.emailVerified === true });
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    /* Never checked by anything now: no door reads a password */
    password: "legacy-salt:legacy-hash",
  });
  return user.id;
}

/* A business with its auth twin and one owner (business-and-memberships
   D1/D2): organization + member rows through the server-side door, the
   same shape the D7 backfill and the dev seed write. The session row is
   seeded pointing at the organization, like the sign-in hook would. */
export async function seedBusiness(
  overrides: Partial<typeof businesses.$inferInsert> & {
    emailVerified?: boolean;
    /* Integration config rides the same call (integrations-hub D2): the
       helper writes these to the integration row, so the suites keep
       their one-line seeds. Actions enabled by default — tests describe
       the backfilled pilot unless they say otherwise. */
    wisphubApiKey?: string | null;
    /* provider-address-per-isp: which installation this business's key
       belongs to. Omitted means the column stays null — "not chosen",
       which is every row that predates the feature (FR-002), so the
       existing suites keep describing exactly the world they did. */
    installation?: string | null;
    reconnectionThresholdPercent?: number;
    reconnectionFloorCents?: number;
    provisionalReleaseEnabled?: boolean;
    actionsEnabled?: boolean;
  } = {},
) {
  const {
    emailVerified,
    wisphubApiKey,
    installation,
    reconnectionThresholdPercent,
    reconnectionFloorCents,
    provisionalReleaseEnabled,
    actionsEnabled,
    ...businessOverrides
  } = overrides;
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
  if (
    wisphubApiKey !== undefined ||
    installation !== undefined ||
    reconnectionThresholdPercent !== undefined ||
    reconnectionFloorCents !== undefined ||
    provisionalReleaseEnabled !== undefined ||
    actionsEnabled !== undefined
  ) {
    await db.insert(integrations).values({
      businessId: business.id,
      apiKey: wisphubApiKey ?? null,
      installation: installation ?? null,
      thresholdPercent: reconnectionThresholdPercent ?? 100,
      floorCents: reconnectionFloorCents ?? 0,
      provisionalReleaseEnabled: provisionalReleaseEnabled ?? false,
      actionsEnabled: actionsEnabled ?? true,
    });
  }
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

/* A confirmed payment as one row (business-and-memberships D6): the link
   it came through plus the payment with its folio, customer and
   reconnection state. `over` shapes the queue/feed scenario. */
export async function seedConfirmedPayment(
  business: { id: string },
  over: Partial<typeof payments.$inferInsert> = {},
) {
  const db = drizzle(env.DB);
  const usuario = over.customerUsuario ?? "greyes@wifiplus";
  /* One permanent link per customer (direct-payment D1): reuse it */
  let [link] = await db
    .select()
    .from(paymentLinks)
    .where(and(eq(paymentLinks.businessId, business.id), eq(paymentLinks.customerUsuario, usuario)));
  if (!link) {
    [link] = await db
      .insert(paymentLinks)
      .values({
        businessId: business.id,
        token: `tok${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        wisphubCustomerId: over.wisphubCustomerId ?? "6",
        customerUsuario: usuario,
      })
      .returning();
  }
  const [payment] = await db
    .insert(payments)
    .values({
      paymentLinkId: link.id,
      businessId: business.id,
      amountCents: 51400,
      invoiceCents: 49900,
      serviceFeeCents: 1500,
      proofMode: "transfer",
      status: "confirmed",
      receivedCents: 51400,
      registeredCents: 49900,
      confirmedAt: new Date(),
      folio: `DV-Q${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      wisphubCustomerId: "6",
      customerUsuario: "greyes@wifiplus",
      customerName: "Janely",
      actionOutcome: "done",
      ...over,
    })
    .returning();
  return payment;
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

/* passwordless-access D14: the last código the sender logged for an
   address (setup.ts keeps them). Flow tests use it — the registration, the
   sign-in — because they must prove the código reached the address. */
export function sentCode(email: string): string {
  const codes = (globalThis as { [k: symbol]: Map<string, string> | undefined })[Symbol.for("devolada.test.sentCodes")];
  const code = codes?.get(email.toLowerCase());
  if (!code) throw new Error(`sentCode: no código was logged for ${email} in this test`);
  return code;
}

/* passwordless-access D14: a fresh código for an address, through the
   plugin's own server-only door (the one D9 uses). The address's live
   sign-in código goes first, as T005's hook does for a request, so the
   minted código is the only one. For tests whose subject is not the email. */
export async function mintCode(email: string): Promise<string> {
  await drizzle(env.DB).delete(verification).where(eq(verification.identifier, `sign-in-otp-${email.toLowerCase()}`));
  return auth().api.createVerificationOTP({ body: { email, type: "sign-in" } });
}

/* A browser always sends Origin on POST; Better Auth's CSRF check
   requires it on cookie-bearing requests. */
export const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "http://localhost:5174" },
  body: JSON.stringify(body),
});

import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import type { Actor, Bindings, StoreActor, Variables } from "../env";
import { businesses, member, session as sessionTable, integrations, stores } from "../db/schema";
import { makeAuth } from "./better";
import { isRole, roleCan, type Action, type Area, type Role } from "./roles";
import { isPlatformOperator } from "../platform/settings";
import { businessConfigured } from "../direct-payments/validation";
import { capabilityNames } from "../integrations/registry";

/* Resolves the Better Auth user to our actor (business-and-memberships
   D4): the memberships name the businesses, the session's active
   organization picks one, the membership's role rides on the actor. */
export async function findActor(
  env: Bindings,
  user: { id: string; name: string; email: string; emailVerified: boolean },
  activeOrganizationId: string | null | undefined,
): Promise<Actor | { error: "NO_BUSINESS" | "NO_ACTIVE_BUSINESS" | "MEMBERSHIP_REVOKED" }> {
  const db = drizzle(env.DB);
  const memberships = await db
    .select({
      orgId: member.organizationId,
      role: member.role,
      businessId: businesses.id,
      businessName: businesses.name,
    })
    .from(member)
    .innerJoin(businesses, eq(businesses.orgId, member.organizationId))
    .where(eq(member.userId, user.id));

  /* A session pointing at an organization the user no longer belongs to
     is a revoked membership, not a missing choice — checked first, so the
     last membership going away is named for what it is. */
  let active = memberships.find((m) => m.orgId === activeOrganizationId);
  if (!active && activeOrganizationId) return { error: "MEMBERSHIP_REVOKED" };
  if (memberships.length === 0) return { error: "NO_BUSINESS" };
  /* The active organization, or the only one (the sign-in hook sets it
     for new sessions; older sessions get the same courtesy here). */
  if (!active) {
    if (memberships.length === 1) active = memberships[0];
    else return { error: "NO_ACTIVE_BUSINESS" };
  }
  const role: Role = isRole(active.role) ? active.role : "viewer";

  const [joined] = await db
    .select({ business: businesses, integration: integrations })
    .from(businesses)
    .leftJoin(integrations, eq(integrations.businessId, businesses.id))
    .where(eq(businesses.id, active.businessId));
  const business = joined.business;
  return {
    type: "business",
    id: business.id,
    orgId: business.orgId,
    name: business.name,
    userId: user.id,
    userName: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    status: business.status,
    role,
    timezone: business.timezone,
    timeFormat: business.timeFormat,
    /* integrations-hub D2: "configured" means the integration row holds
       a key. D10: the shell reads it as "has an integration", never as
       "has WispHub" — an ISP is one kind of business. */
    integrationConfigured: Boolean(joined.integration?.apiKey),
    /* cobros-in-links D13: the chip and the search's debt are offered by
       capability, read with no network call */
    integrationCapabilities: capabilityNames(joined.integration),
    /* receipt-triage D32: the cuenta de cobro, whatever its kind */
    speiConfigured: businessConfigured(business),
    observing: Boolean(joined.integration?.apiKey) && !joined.integration?.actionsEnabled,
    businesses: memberships.map((m) => ({
      id: m.businessId,
      orgId: m.orgId,
      name: m.businessName,
      role: isRole(m.role) ? m.role : "viewer",
    })),
    platformOperator: isPlatformOperator(env, user.email),
    storeChannel: { on: business.storeChannelOn, since: business.storeChannelSince?.getTime() ?? null },
  };
}

/* operator-panel D2/D3: the platform's hands. Composes after requireSession. */
export const requirePlatformOperator = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    if (!c.get("actor").platformOperator) {
      return c.json({ success: false, error: { code: "NOT_PLATFORM_OPERATOR" } }, 403);
    }
    await next();
  },
);

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;
type Refusal = { refusal: Response };

/* The Better Auth session behind the request, shared by both kinds of
   actor (cash-at-stores D2: one session system, the actor type keeps
   them apart). Answers the refusal every door shares: no session, or an
   unverified user. */
async function sessionOf(c: Ctx) {
  const auth = makeAuth(c.env);
  /* BUG-015: the 30-day window slides in the DB row AND in the browser.
     Better Auth re-issues the cookie when it refreshes the row (once a
     day of use), on the headers of its own response — which this
     server-side call used to drop, so the cookie kept login day's
     Max-Age and every session died 30 days after login. */
  const { headers: refreshed, response: session } = await auth.api.getSession({
    headers: c.req.raw.headers,
    returnHeaders: true,
  });
  if (!session) {
    return { refusal: c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401) };
  }
  for (const cookie of (refreshed as Headers & { getSetCookie(): string[] }).getSetCookie()) {
    c.header("set-cookie", cookie, { append: true });
  }

  /* better-auth D16: an unverified user has no session, whatever the
     cookie says — a row from before the gate, or one seeded by hand,
     is revoked here and the person goes back through the código. */
  if (!session.user.emailVerified) {
    const db = drizzle(c.env.DB);
    await db.delete(sessionTable).where(eq(sessionTable.id, session.session.id));
    return { refusal: c.json({ success: false, error: { code: "EMAIL_NOT_VERIFIED" } }, 403) };
  }
  return { session };
}

type Session = Exclude<Awaited<ReturnType<typeof sessionOf>>["session"], undefined>;

/* cash-at-stores D2: the store row a user's session names, if any. One
   indexed read (`stores.user_id` is unique). */
async function storeRowOf(c: Ctx, userId: string) {
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(stores).where(eq(stores.userId, userId));
  return row ?? null;
}

/* The business actor (business-and-memberships D4), or the refusal. */
async function businessActorOf(c: Ctx, session: Session): Promise<{ actor: Actor } | Refusal> {
  const active = (session.session as { activeOrganizationId?: string | null })
    .activeOrganizationId;
  const actor = await findActor(c.env, session.user, active);
  if ("error" in actor) {
    return { refusal: c.json({ success: false, error: { code: actor.error } }, 403) };
  }
  if (actor.status === "suspended") {
    /* Revoke server-side: the cookie the client still holds now points
       at nothing (spec D5 "clears the session"). */
    const db = drizzle(c.env.DB);
    await db.delete(sessionTable).where(eq(sessionTable.id, session.session.id));
    return { refusal: c.json({ success: false, error: { code: "ACCOUNT_SUSPENDED" } }, 403) };
  }
  return { actor };
}

/* cash-at-stores D2 (FR-014): the store actor from its row, checked on
   every request so a suspension takes effect on the next action. A
   suspended store's session is deleted, as a suspended business's is;
   an invited store has no actor yet (its user exists only between the
   acceptance's two writes). */
async function storeActorOf(
  c: Ctx,
  session: Session,
  row: typeof stores.$inferSelect,
): Promise<{ store: StoreActor } | Refusal> {
  if (row.status === "suspended") {
    const db = drizzle(c.env.DB);
    await db.delete(sessionTable).where(eq(sessionTable.id, session.session.id));
    return { refusal: c.json({ success: false, error: { code: "STORE_SUSPENDED" } }, 403) };
  }
  if (row.status !== "active") {
    return { refusal: c.json({ success: false, error: { code: "WRONG_ACTOR" } }, 403) };
  }
  return {
    store: {
      type: "store",
      storeId: row.id,
      userId: session.user.id,
      name: row.name,
      email: session.user.email,
      status: "active",
    },
  };
}

/* Session required (better-auth.spec.md D5): Better Auth resolves the
   session cookie; the business's status is checked in the DB on every
   request, so a suspension revokes access immediately (sessions spec
   rule 2). */
export const requireSession = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const resolved = await sessionOf(c);
    if ("refusal" in resolved) return resolved.refusal;
    /* cash-at-stores D2 (FR-013): a shopkeeper is refused before
       `findActor`, which would read "no membership" as NO_BUSINESS — and
       the panel turns that into the business wizard */
    if (await storeRowOf(c, resolved.session.user.id)) {
      return c.json({ success: false, error: { code: "WRONG_ACTOR" } }, 403);
    }
    const business = await businessActorOf(c, resolved.session);
    if ("refusal" in business) return business.refusal;
    c.set("actor", business.actor);
    await next();
  },
);

/* cash-at-stores D2: the store app's guard. A business member, or any
   user with no store row, is the wrong actor (FR-013). */
export const requireStore = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const resolved = await sessionOf(c);
    if ("refusal" in resolved) return resolved.refusal;
    const row = await storeRowOf(c, resolved.session.user.id);
    if (!row) return c.json({ success: false, error: { code: "WRONG_ACTOR" } }, 403);
    const store = await storeActorOf(c, resolved.session, row);
    if ("refusal" in store) return store.refusal;
    c.set("store", store.store);
    await next();
  },
);

/* cash-at-stores D2: `/auth/me` answers both kinds — whichever the
   session's user is. Sets `actor` or `store`, never both. */
export const requireAnyActor = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const resolved = await sessionOf(c);
    if ("refusal" in resolved) return resolved.refusal;
    const row = await storeRowOf(c, resolved.session.user.id);
    if (row) {
      const store = await storeActorOf(c, resolved.session, row);
      if ("refusal" in store) return store.refusal;
      c.set("store", store.store);
    } else {
      const business = await businessActorOf(c, resolved.session);
      if ("refusal" in business) return business.refusal;
      c.set("actor", business.actor);
    }
    await next();
  },
);

/* Area guard (spec D3): one permission map, consulted per area — never
   per button. Composes after requireSession. */
export function requireArea<A extends Area>(area: A, action: Action<A>) {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    const actor = c.get("actor");
    if (!roleCan(actor.role, area, action)) {
      return c.json({ success: false, error: { code: "FORBIDDEN_FOR_ROLE" } }, 403);
    }
    await next();
  });
}

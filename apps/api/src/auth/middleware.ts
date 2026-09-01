import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Actor, Bindings, Variables } from "../env";
import { businesses, member, session as sessionTable } from "../db/schema";
import { makeAuth } from "./better";
import { isRole, roleCan, type Action, type Area, type Role } from "./roles";
import { isPlatformOperator } from "../platform/settings";
import { creditSummary } from "../credit";

/* Resolves the Better Auth user to our actor (business-and-memberships
   D4): the memberships name the businesses, the session's active
   organization picks one, the membership's role rides on the actor. */
export async function findActor(
  env: Bindings,
  user: { id: string; email: string; emailVerified: boolean },
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

  const [business] = await db.select().from(businesses).where(eq(businesses.id, active.businessId));
  const credit = await creditSummary(db, business);
  return {
    type: "business",
    id: business.id,
    orgId: business.orgId,
    name: business.name,
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    status: business.status,
    role,
    timezone: business.timezone,
    timeFormat: business.timeFormat,
    wisphubConfigured: Boolean(business.wisphubApiKey),
    businesses: memberships.map((m) => ({
      id: m.businessId,
      orgId: m.orgId,
      name: m.businessName,
      role: isRole(m.role) ? m.role : "viewer",
    })),
    platformOperator: isPlatformOperator(env, user.email),
    credit: { balanceCents: credit.balanceCents, step: credit.step },
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

/* Session required (better-auth.spec.md D5): Better Auth resolves the
   session cookie; the business's status is checked in the DB on every
   request, so a suspension revokes access immediately (sessions spec
   rule 2). */
export const requireSession = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const auth = makeAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401);
    }

    const active = (session.session as { activeOrganizationId?: string | null })
      .activeOrganizationId;
    const actor = await findActor(c.env, session.user, active);
    if ("error" in actor) {
      return c.json({ success: false, error: { code: actor.error } }, 403);
    }
    if (actor.status === "suspended") {
      /* Revoke server-side: the cookie the client still holds now points
         at nothing (spec D5 "clears the session"). */
      const db = drizzle(c.env.DB);
      await db.delete(sessionTable).where(eq(sessionTable.id, session.session.id));
      return c.json({ success: false, error: { code: "ACCOUNT_SUSPENDED" } }, 403);
    }

    c.set("actor", actor);
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

import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { businesses, member, user as userTable } from "../../db/schema";
import { makeAuth } from "../../auth/better";
import { findActor } from "../../auth/middleware";
import { grantableRoles, isRole, ROLE_RANK } from "../../auth/roles";
import { grantWelcomeBonus } from "../../credit";
import type { CreateBusinessRequest, InviteMemberRequest, MembersResponse } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* One organization per business (spec D1/D2): the auth twin is created
   through the plugin (creator becomes owner, spike 1), the domain row
   points at it, and the new business becomes the active one. Any failure
   after the organization exists removes it — no twin without a business. */
export async function createBusiness(c: Ctx, body: CreateBusinessRequest) {
  const auth = makeAuth(c.env);
  const headers = c.req.raw.headers;
  const session = await auth.api.getSession({ headers });
  if (!session) {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401);
  }

  const org = await auth.api.createOrganization({
    headers,
    body: { name: body.name, slug: `negocio-${crypto.randomUUID().slice(0, 8)}` },
  });
  if (!org) throw new Error("organization not created");

  const db = drizzle(c.env.DB);
  const [sameEmail] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.email, session.user.email));
  const emailTaken = Boolean(sameEmail);
  let business;
  try {
    [business] = await db
      .insert(businesses)
      .values({
        orgId: org.id,
        name: body.name,
        /* businesses.email is UNIQUE and a display copy: the user's own
           email for their first business, org-prefixed for the next ones */
        email: emailTaken ? `${org.id}+${session.user.email}` : session.user.email,
        speiClabe: body.speiClabe,
        speiBank: body.speiBank,
        speiBeneficiaryName: body.speiBeneficiaryName ?? null,
      })
      .returning();
  } catch (e) {
    await auth.api.deleteOrganization({ headers, body: { organizationId: org.id } });
    throw e;
  }

  /* prepaid-credit D5: once per user, their first business */
  await grantWelcomeBonus(db, business, session.user.id);
  await auth.api.setActiveOrganization({ headers, body: { organizationId: org.id } });
  const actor = await findActor(c.env, session.user, org.id);
  return c.json({ success: true, data: actor }, 201);
}

export async function listMembers(c: Ctx) {
  const actor = c.get("actor");
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      id: member.id,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
      name: userTable.name,
      email: userTable.email,
    })
    .from(member)
    .innerJoin(userTable, eq(userTable.id, member.userId))
    .where(eq(member.organizationId, actor.orgId));
  const data: MembersResponse = {
    members: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: r.name,
      email: r.email,
      role: isRole(r.role) ? r.role : "viewer",
      createdAt: r.createdAt.getTime(),
    })),
    grantable: grantableRoles(actor.role),
  };
  return c.json({ success: true, data });
}

/* D3's footnote, enforced here and not by the plugin (spike 5): a granter
   hands out only roles below their own. */
export async function inviteMember(c: Ctx, body: InviteMemberRequest) {
  const actor = c.get("actor");
  if (!grantableRoles(actor.role).includes(body.role)) {
    return c.json({ success: false, error: { code: "FORBIDDEN_FOR_ROLE" } }, 403);
  }
  const auth = makeAuth(c.env);
  const invitation = await auth.api.createInvitation({
    headers: c.req.raw.headers,
    body: { email: body.email, role: body.role, organizationId: actor.orgId },
  });
  return c.json(
    { success: true, data: { id: invitation.id, email: invitation.email, role: body.role } },
    201,
  );
}

export async function removeMember(c: Ctx, memberId: string) {
  const actor = c.get("actor");
  const db = drizzle(c.env.DB);
  const [target] = await db.select().from(member).where(eq(member.id, memberId));
  if (!target || target.organizationId !== actor.orgId) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  /* Same rank rule: nobody removes a peer or a superior; the owner is
     removed by nobody (ownership transfer is its own story) */
  const targetRole = isRole(target.role) ? target.role : "viewer";
  if (targetRole === "owner" || ROLE_RANK[targetRole] >= ROLE_RANK[actor.role]) {
    return c.json({ success: false, error: { code: "FORBIDDEN_FOR_ROLE" } }, 403);
  }
  const auth = makeAuth(c.env);
  await auth.api.removeMember({
    headers: c.req.raw.headers,
    body: { memberIdOrEmail: memberId, organizationId: actor.orgId },
  });
  return c.json({ success: true, data: {} });
}

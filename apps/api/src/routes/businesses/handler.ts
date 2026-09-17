import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { businesses, invitation, member, organization, user as userTable } from "../../db/schema";
import { makeAuth } from "../../auth/better";
import { findActor } from "../../auth/middleware";
import { grantableRoles, isRole, roleCan, ROLE_RANK, type Role } from "../../auth/roles";
import { grantWelcomeBonus } from "../../credit";
import { getNumberSetting, getSetting } from "../../platform/settings";
import type {
  AcceptInvitationNewRequest,
  CreateBusinessRequest,
  InvitationPreviewResponse,
  InviteMemberRequest,
  MembersResponse,
  UpdateMemberRoleRequest,
} from "./schema";

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
  /* payments-and-classes D1: the newborn's reconciliation policy comes
     from the platform defaults of the moment, then belongs to the
     business (Configuración edits its own copy, never the default). */
  const [defaultTolerance, defaultOver] = await Promise.all([
    getNumberSetting(db, "default_tolerance_cents"),
    getSetting(db, "default_over_treatment"),
  ]);
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
        /* D5 (2026-09-02): born without a CLABE unless the caller brings
           one — Configuración is where it lands */
        speiClabe: body.speiClabe ?? null,
        speiBank: body.speiBank ?? null,
        speiBeneficiaryName: body.speiBeneficiaryName ?? null,
        toleranceCents: defaultTolerance,
        overTreatment: defaultOver === "credit" ? ("credit" as const) : ("flag" as const),
      })
      .returning();
  } catch (e) {
    await auth.api.deleteOrganization({ headers, body: { organizationId: org.id } });
    throw e;
  }

  /* consta-api-merge D3: a business is born without an engine key
     because it needs none — the validation engine is a module of this
     API and attributes every row by `business_id`, so the trust shadow's
     evidence lands in the right chain from day one (payments-and-classes
     D8) with nothing to mint. */

  /* prepaid-credit D5: once per user, their first business */
  await grantWelcomeBonus(db, business, session.user.id);
  await auth.api.setActiveOrganization({ headers, body: { organizationId: org.id } });
  const actor = await findActor(c.env, session.user, org.id);
  return c.json({ success: true, data: actor }, 201);
}

const roleOf = (value: string | null): Role => (isRole(value) ? value : "viewer");

/* D11: every member reads the team — names and roles. The email is the
   inviter's tool (resend, recognise), so it rides only for roles that
   may invite. The pending invitations (D8) follow the same rule. */
export async function listMembers(c: Ctx) {
  const actor = c.get("actor");
  const db = drizzle(c.env.DB);
  const mayInvite = roleCan(actor.role, "members", "invite_below_admin");
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
  const pendingRows = mayInvite
    ? await db
        .select()
        .from(invitation)
        .where(and(eq(invitation.organizationId, actor.orgId), eq(invitation.status, "pending")))
    : [];
  const now = Date.now();
  const data: MembersResponse = {
    members: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: r.name,
      email: mayInvite ? r.email : null,
      role: roleOf(r.role),
      createdAt: r.createdAt.getTime(),
    })),
    grantable: grantableRoles(actor.role),
    pending: pendingRows
      .map((i) => ({
        id: i.id,
        email: i.email,
        role: roleOf(i.role),
        expiresAt: i.expiresAt.getTime(),
        expired: i.expiresAt.getTime() < now,
      }))
      .sort((a, b) => b.expiresAt - a.expiresAt),
  };
  return c.json({ success: true, data });
}

/* D3's footnote, enforced here and not by the plugin (spike 5): a granter
   hands out only roles below their own. The inviter's email is verified
   by construction — nobody unverified holds a session (better-auth D16). */
export async function inviteMember(c: Ctx, body: InviteMemberRequest) {
  const actor = c.get("actor");
  if (!grantableRoles(actor.role).includes(body.role)) {
    return c.json({ success: false, error: { code: "FORBIDDEN_FOR_ROLE" } }, 403);
  }
  const auth = makeAuth(c.env);
  const created = await auth.api.createInvitation({
    headers: c.req.raw.headers,
    /* resend: a second invitation to the same address refreshes the
       pending one instead of failing on "already invited" */
    body: { email: body.email, role: body.role, organizationId: actor.orgId, resend: true },
  });
  return c.json(
    { success: true, data: { id: created.id, email: created.email, role: body.role } },
    201,
  );
}

/* The invitation's own rank rule: the inviter may touch only invitations
   for roles they could grant themselves — an admin never resends or
   cancels an owner's invitation of an admin. */
async function ownedInvitation(c: Ctx, invitationId: string) {
  const actor = c.get("actor");
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(invitation).where(eq(invitation.id, invitationId));
  if (!row || row.organizationId !== actor.orgId || row.status !== "pending") return { error: 404 as const };
  if (!grantableRoles(actor.role).includes(roleOf(row.role))) return { error: 403 as const };
  return { row };
}

/* D8: resend = a fresh 48 hours and a fresh email, same id */
export async function resendInvitation(c: Ctx, invitationId: string) {
  const actor = c.get("actor");
  const found = await ownedInvitation(c, invitationId);
  if ("error" in found) {
    return c.json(
      { success: false, error: { code: found.error === 404 ? "NOT_FOUND" : "FORBIDDEN_FOR_ROLE" } },
      found.error,
    );
  }
  const auth = makeAuth(c.env);
  const refreshed = await auth.api.createInvitation({
    headers: c.req.raw.headers,
    body: { email: found.row.email, role: roleOf(found.row.role), organizationId: actor.orgId, resend: true },
  });
  /* An expired row is invisible to the plugin's "already invited" check,
     so its resend births a new id; the old row is retired so the list
     never shows the same address twice. */
  if (refreshed.id !== found.row.id) {
    await drizzle(c.env.DB)
      .update(invitation)
      .set({ status: "canceled" })
      .where(eq(invitation.id, found.row.id));
  }
  return c.json({
    success: true,
    data: { id: refreshed.id, email: refreshed.email, expiresAt: new Date(refreshed.expiresAt).getTime() },
  });
}

export async function cancelInvitation(c: Ctx, invitationId: string) {
  const found = await ownedInvitation(c, invitationId);
  if ("error" in found) {
    return c.json(
      { success: false, error: { code: found.error === 404 ? "NOT_FOUND" : "FORBIDDEN_FOR_ROLE" } },
      found.error,
    );
  }
  const auth = makeAuth(c.env);
  await auth.api.cancelInvitation({ headers: c.req.raw.headers, body: { invitationId } });
  return c.json({ success: true, data: {} });
}

/* D12: role change under the same rank rule as invite and remove — the
   target sits below me today, the new role is one I may grant, the owner
   is nobody's to change, and neither am I. */
export async function updateMemberRole(c: Ctx, memberId: string, body: UpdateMemberRoleRequest) {
  const actor = c.get("actor");
  const db = drizzle(c.env.DB);
  const [target] = await db.select().from(member).where(eq(member.id, memberId));
  if (!target || target.organizationId !== actor.orgId) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  const targetRole = roleOf(target.role);
  if (
    target.userId === actor.userId ||
    targetRole === "owner" ||
    ROLE_RANK[targetRole] >= ROLE_RANK[actor.role] ||
    !grantableRoles(actor.role).includes(body.role)
  ) {
    return c.json({ success: false, error: { code: "FORBIDDEN_FOR_ROLE" } }, 403);
  }
  const auth = makeAuth(c.env);
  await auth.api.updateMemberRole({
    headers: c.req.raw.headers,
    body: { memberId, role: body.role, organizationId: actor.orgId },
  });
  return c.json({ success: true, data: { id: memberId, role: body.role } });
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
  const targetRole = roleOf(target.role);
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

/* D14: what the invitation page needs to decide for the invitee. The id
   is the key (random, emailed); the answer is what the email already
   said plus one fact the person cannot know — whether that address has
   an account here. */
export async function previewInvitation(c: Ctx, invitationId: string) {
  const db = drizzle(c.env.DB);
  const [row] = await db
    .select({ inv: invitation, orgName: organization.name })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(eq(invitation.id, invitationId));
  const gone: InvitationPreviewResponse = {
    status: "gone",
    businessName: null,
    role: null,
    email: null,
    hasAccount: false,
  };
  if (!row || row.inv.status !== "pending") return c.json({ success: true, data: gone });
  const [account] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, row.inv.email));
  const data: InvitationPreviewResponse = {
    status: row.inv.expiresAt.getTime() < Date.now() ? "expired" : "pending",
    businessName: row.orgName,
    role: roleOf(row.inv.role),
    email: row.inv.email,
    hasAccount: Boolean(account),
  };
  return c.json({ success: true, data });
}

/* The cookies Better Auth just set, as a request header — for calling
   its own API on behalf of the user it just created. */
function cookieHeadersFrom(from: Headers): Headers {
  const cookies = (from as Headers & { getSetCookie(): string[] }).getSetCookie();
  return new Headers({ Cookie: cookies.map((c) => c.split(";")[0]).join("; ") });
}

/* D14: the invitee without an account creates it here — name and
   password, the email is the invitation's — and lands inside the
   business. The invitation proves the address (it arrived in that
   inbox), so the user is born verified and no código goes out. */
export async function acceptInvitationAsNewUser(c: Ctx, invitationId: string, body: AcceptInvitationNewRequest) {
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(invitation).where(eq(invitation.id, invitationId));
  if (!row || row.status !== "pending" || row.expiresAt.getTime() < Date.now()) {
    return c.json({ success: false, error: { code: "INVITATION_NOT_FOUND" } }, 404);
  }
  const [existing] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, row.email));
  if (existing) return c.json({ success: false, error: { code: "EMAIL_TAKEN" } }, 409);

  const auth = makeAuth(c.env);
  const { user } = await auth.api.signUpEmail({
    body: { name: body.name, email: row.email, password: body.password },
  });
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, user.id));

  /* better-auth D16: signUpEmail births no session any more; the sign-in
     right after the flag is what opens one — the invitee is verified by
     the invitation, so the gate lets them through. */
  const { headers } = await auth.api.signInEmail({
    body: { email: row.email, password: body.password },
    returnHeaders: true,
  });
  const asNewUser = cookieHeadersFrom(headers);
  await auth.api.acceptInvitation({ headers: asNewUser, body: { invitationId } });
  await auth.api.setActiveOrganization({ headers: asNewUser, body: { organizationId: row.organizationId } });

  const cookies = (headers as Headers & { getSetCookie(): string[] }).getSetCookie();
  for (const cookie of cookies) c.header("set-cookie", cookie, { append: true });
  const actor = await findActor(c.env, { ...user, emailVerified: true }, row.organizationId);
  return c.json({ success: true, data: actor }, 201);
}

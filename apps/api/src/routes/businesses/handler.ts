import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { businesses, invitation, member, organization, user as userTable } from "../../db/schema";
import { isStoreUser, makeAuth } from "../../auth/better";
import { codeOf, otpRefusal } from "../../auth/otp-refusal";
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
  MyInvitationsResponse,
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
  /* cash-at-stores D2 (FR-013): a shopkeeper never creates a business —
     refused here, before the organization plugin's own refusal would
     surface as an error this route does not speak */
  if (await isStoreUser(drizzle(c.env.DB), session.user.id)) {
    return c.json({ success: false, error: { code: "WRONG_ACTOR" } }, 403);
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

/* bug: invitee-lands-own-business — the invitations sent to the person
   behind the session. The email was the only door to one: an invitee who
   already had a business and signed in any other way (the login page, a
   password recovery, an email that had not arrived) landed in their own
   business, and nothing ever named the invitation again (measured
   2026-10-01 on production: one such invitation expired unaccepted).
   The address is proven — nobody unverified holds a session (better-auth
   D16) — so this answers what that inbox already holds, the id included.
   No membership required: the business wizard asks before any exists,
   which is why the route resolves the session itself, as `createBusiness`
   does. A business the person already belongs to is not offered again. */
export async function myInvitations(c: Ctx) {
  const auth = makeAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401);
  }
  if (!session.user.emailVerified) {
    return c.json({ success: false, error: { code: "EMAIL_NOT_VERIFIED" } }, 403);
  }
  const db = drizzle(c.env.DB);
  /* cash-at-stores D2 (FR-013): a shopkeeper is not a business member */
  if (await isStoreUser(db, session.user.id)) {
    return c.json({ success: false, error: { code: "WRONG_ACTOR" } }, 403);
  }
  const [rows, memberships] = await Promise.all([
    db
      .select({ inv: invitation, businessName: organization.name })
      .from(invitation)
      .innerJoin(organization, eq(organization.id, invitation.organizationId))
      .where(and(eq(invitation.email, session.user.email.toLowerCase()), eq(invitation.status, "pending"))),
    db.select({ orgId: member.organizationId }).from(member).where(eq(member.userId, session.user.id)),
  ]);
  const joined = new Set(memberships.map((m) => m.orgId));
  const now = Date.now();
  const data: MyInvitationsResponse = {
    invitations: rows
      /* D8: the plugin keeps an expired row `pending`; it cannot be accepted */
      .filter((r) => r.inv.expiresAt.getTime() > now && !joined.has(r.inv.organizationId))
      .map((r) => ({
        id: r.inv.id,
        businessName: r.businessName,
        role: roleOf(r.inv.role),
        expiresAt: r.inv.expiresAt.getTime(),
      }))
      .sort((a, b) => a.expiresAt - b.expiresAt),
  };
  return c.json({ success: true, data });
}

/* The cookies Better Auth just set, as a request header — for calling
   its own API on behalf of the user it just signed in. */
function cookieHeadersFrom(from: Headers): Headers {
  const cookies = (from as Headers & { getSetCookie(): string[] }).getSetCookie();
  return new Headers({ Cookie: cookies.map((c) => c.split(";")[0]).join("; ") });
}

/* D14: the invitee without an account creates it here — the email is the
   invitation's, never typed — and lands inside the business.

   passwordless-access D9, as amended 2026-10-03 (spec Clarifications Q5,
   FR-004, FR-019): the invitation does NOT prove the inbox. Its id is this
   route's key, and the panel hands it to the inviter (`inviteMember`'s
   answer) and to every owner and admin (`listMembers`' pending list). Born
   from the id alone, the account was anyone's who could send an
   invitation: open it, add a key, keep it after the real person arrived,
   with no password reset left to shut them out (adversarial review,
   2026-10-02). The proof is the código sent to the invited address, which
   the page asks for through `send-verification-otp` (the address shown as
   text, never typed). In this order:
     1. the invitation, pending and alive — else INVITATION_NOT_FOUND;
     2. an address with an account is EMAIL_TAKEN, before any código is
        checked: the page's `hasAccount` branch (the key, or a código and
        the plugin's acceptance) is its door, and the preview already says
        so to the link's holder;
     3. `signInEmailOTP` with the invited address, the código and the name:
        the user is born verified, named, with a session. A refusal of the
        código is the plugin's own word, and nothing is born;
     4. the acceptance and the active business, on the new session;
     5. the cookies, forwarded.
   No race guard as the store's (D10) and no undo: whoever typed the
   código holds the inbox, so the account is theirs whatever follows. An
   account the address gained between steps 2 and 3 is opened instead (the
   plugin signs into it); one the plugin left without a session when its
   insert failed meets step 2 at the retry, whose door is the account
   branch; and when the invitation dies between steps 1 and 4, the account
   stays with its session, as a registration's would, and the answer is
   INVITATION_NOT_FOUND. No separate refusal of an operator's address
   either (D9's amendment): the código proves its holder, and an operator
   may be a business's member. */
export async function acceptInvitationAsNewUser(c: Ctx, invitationId: string, body: AcceptInvitationNewRequest) {
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(invitation).where(eq(invitation.id, invitationId));
  if (!row || row.status !== "pending" || row.expiresAt.getTime() < Date.now()) {
    return c.json({ success: false, error: { code: "INVITATION_NOT_FOUND" } }, 404);
  }
  const email = row.email.toLowerCase();
  const [existing] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email));
  if (existing) return c.json({ success: false, error: { code: "EMAIL_TAKEN" } }, 409);

  const auth = makeAuth(c.env);
  let signedIn: { headers: Headers; response: { user: { id: string; name: string; email: string } } };
  try {
    signedIn = await auth.api.signInEmailOTP({
      body: { email, otp: body.otp, name: body.name },
      returnHeaders: true,
    });
  } catch (e) {
    const refused = otpRefusal(c, e);
    if (refused) return refused;
    throw e;
  }
  const { headers, response } = signedIn;
  /* Step 5 first: from here on, every answer carries the session the
     código proved */
  for (const cookie of (headers as Headers & { getSetCookie(): string[] }).getSetCookie()) {
    c.header("set-cookie", cookie, { append: true });
  }

  const asNewUser = cookieHeadersFrom(headers);
  try {
    await auth.api.acceptInvitation({ headers: asNewUser, body: { invitationId } });
  } catch (e) {
    /* The invitation died after step 1 — cancelled, accepted, or past its
       48 hours: the plugin's own check, at its own moment */
    if (codeOf(e) === "INVITATION_NOT_FOUND") {
      return c.json({ success: false, error: { code: "INVITATION_NOT_FOUND" } }, 404);
    }
    throw e;
  }
  await auth.api.setActiveOrganization({ headers: asNewUser, body: { organizationId: row.organizationId } });

  const actor = await findActor(c.env, { ...response.user, emailVerified: true }, row.organizationId);
  return c.json({ success: true, data: actor }, 201);
}

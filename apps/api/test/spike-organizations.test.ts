import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import * as authSchema from "../src/db/auth-schema";

/* business-and-memberships.spec.md DoD 1 — the organizations spike
   (US-B02, US-B03). Throwaway by design: it builds its own Better Auth
   instance with the plugin and its own tables, so nothing here touches
   the app. Answers, on workerd + real D1: table names (the D7 collision),
   custom roles through access control, what `activeOrganizationId` does
   on sign-in with one membership, the switch, and the invitation flow. */

/* Hand-written twin of the plugin's default schema (organization.mjs,
   better-auth@1.6.29). Keys must equal the plugin's model names. */
const organizationTable = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  metadata: text("metadata"),
});
const memberTable = sqliteTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("member"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
const invitationTable = sqliteTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  inviterId: text("inviter_id").notNull(),
});
/* The plugin extends the session model with one field */
const sessionTable = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull(),
  activeOrganizationId: text("active_organization_id"),
});

const spikeSchema = {
  ...authSchema,
  session: sessionTable,
  organization: organizationTable,
  member: memberTable,
  invitation: invitationTable,
};

/* Our matrix (spec D3), as access-control statements: one resource per
   area, so a permission check names the area, never a button. FINDING
   (first run): the statements MUST extend the plugin's defaults — its own
   endpoints (createInvitation, removeMember, updateOrganization...) check
   `invitation`/`member`/`organization` permissions against the role, so a
   custom `ac` without them refuses even the owner ("You are not allowed
   to invite users to this organization"). */
const statements = {
  ...defaultStatements,
  payments: ["read", "operate"],
  settings: ["update"],
  clabe: ["update"],
  credit: ["manage"],
  integrations: ["manage"],
  members: ["invite_below_admin", "invite_any"],
  business: ["delete"],
} as const;
const ac = createAccessControl(statements);
const roles = {
  owner: ac.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    payments: ["read", "operate"],
    settings: ["update"],
    clabe: ["update"],
    credit: ["manage"],
    integrations: ["manage"],
    members: ["invite_below_admin", "invite_any"],
    business: ["delete"],
  }),
  admin: ac.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    payments: ["read", "operate"],
    settings: ["update"],
    integrations: ["manage"],
    members: ["invite_below_admin"],
  }),
  operator: ac.newRole({ payments: ["read", "operate"] }),
  viewer: ac.newRole({ payments: ["read"] }),
};

const sentInvitations: { email: string; role: string; org: string }[] = [];

function makeSpikeAuth(opts: { autoActivate: boolean }) {
  const db = drizzle(env.DB);
  return betterAuth({
    baseURL: "http://localhost:8787",
    basePath: "/auth",
    secret: "spike-secret",
    database: drizzleAdapter(db, { provider: "sqlite", schema: spikeSchema }),
    emailAndPassword: { enabled: true },
    session: { cookieCache: { enabled: false } },
    /* The question D4 asks: does one membership activate itself? The
       plugin does not do it; this hook is the documented way. */
    databaseHooks: opts.autoActivate
      ? {
          session: {
            create: {
              before: async (session) => {
                const rows = await db
                  .select()
                  .from(memberTable)
                  .where(eq(memberTable.userId, session.userId));
                return rows.length === 1
                  ? { data: { ...session, activeOrganizationId: rows[0].organizationId } }
                  : { data: session };
              },
            },
          },
        }
      : undefined,
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        async sendInvitationEmail(data) {
          sentInvitations.push({
            email: data.email,
            role: data.role,
            org: data.organization.name,
          });
        },
      }),
    ],
  });
}

async function createSpikeTables() {
  const stmts = [
    `ALTER TABLE session ADD COLUMN active_organization_id text`,
    `CREATE TABLE organization (id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, logo text, created_at integer NOT NULL, metadata text)`,
    `CREATE TABLE member (id text PRIMARY KEY, organization_id text NOT NULL, user_id text NOT NULL, role text NOT NULL DEFAULT 'member', created_at integer NOT NULL)`,
    `CREATE TABLE invitation (id text PRIMARY KEY, organization_id text NOT NULL, email text NOT NULL, role text, status text NOT NULL DEFAULT 'pending', expires_at integer NOT NULL, created_at integer NOT NULL, inviter_id text NOT NULL)`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
}

type Auth = ReturnType<typeof makeSpikeAuth>;

async function signUp(auth: Auth, email: string) {
  const { headers } = await auth.api.signUpEmail({
    body: { name: email.split("@")[0], email, password: "devolada123" },
    returnHeaders: true,
  });
  return cookieHeader(headers);
}
async function signIn(auth: Auth, email: string) {
  const { headers } = await auth.api.signInEmail({
    body: { email, password: "devolada123" },
    returnHeaders: true,
  });
  return cookieHeader(headers);
}
function cookieHeader(headers: Headers) {
  const setCookie = (headers as Headers & { getSetCookie(): string[] }).getSetCookie();
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  return new Headers({ Cookie: cookie });
}
async function userIdOf(auth: Auth, headers: Headers) {
  const s = await auth.api.getSession({ headers });
  return s!.user.id;
}

describe("spike: organizations plugin contract (spec DoD 1)", () => {
  it("1. table names: organization / member / invitation (singular); creator becomes owner", async () => {
    await createSpikeTables();
    const auth = makeSpikeAuth({ autoActivate: false });
    const owner = await signUp(auth, "owner@spike.test");

    const org = await auth.api.createOrganization({
      headers: owner,
      body: { name: "WifiPlus", slug: "wifiplus" },
    });
    expect(org?.id).toBeTruthy();

    const db = drizzle(env.DB);
    const [member] = await db.select().from(memberTable);
    expect(member.organizationId).toBe(org!.id);
    expect(member.role).toBe("owner");

    /* The D7 collision question: the plugin's own model is `invitation`;
       our retired domain table was `invitations`. Both can coexist. */
    const names = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('invitation','invitations') ORDER BY name`,
    ).all<{ name: string }>();
    expect(names.results.map((r) => r.name)).toEqual(["invitation", "invitations"]);
  });

  it("2. custom roles: hasPermission answers per role from our access-control statements", async () => {
    await createSpikeTables();
    const auth = makeSpikeAuth({ autoActivate: false });
    const owner = await signUp(auth, "owner@spike.test");
    const org = await auth.api.createOrganization({
      headers: owner,
      body: { name: "WifiPlus", slug: "wifiplus" },
    });

    const operatorHeaders = await signUp(auth, "operator@spike.test");
    const operatorId = await userIdOf(auth, operatorHeaders);
    /* addMember is the server-side door (no invitation email) */
    await auth.api.addMember({
      body: { organizationId: org!.id, userId: operatorId, role: "operator" },
    });
    await auth.api.setActiveOrganization({
      headers: operatorHeaders,
      body: { organizationId: org!.id },
    });

    const can = (headers: Headers, permissions: Record<string, string[]>) =>
      auth.api.hasPermission({ headers, body: { permissions } });

    expect((await can(operatorHeaders, { payments: ["operate"] })).success).toBe(true);
    expect((await can(operatorHeaders, { clabe: ["update"] })).success).toBe(false);
    expect((await can(operatorHeaders, { settings: ["update"] })).success).toBe(false);

    await auth.api.setActiveOrganization({ headers: owner, body: { organizationId: org!.id } });
    expect((await can(owner, { clabe: ["update"] })).success).toBe(true);
    expect((await can(owner, { business: ["delete"] })).success).toBe(true);
  });

  it("3. sign-in with one membership: NOT active by itself; the session hook makes it so", async () => {
    await createSpikeTables();
    const plain = makeSpikeAuth({ autoActivate: false });
    const owner = await signUp(plain, "owner@spike.test");
    await plain.api.createOrganization({ headers: owner, body: { name: "WifiPlus", slug: "wifiplus" } });

    /* A fresh sign-in on the plain instance: no active organization */
    const again = await signIn(plain, "owner@spike.test");
    const s1 = await plain.api.getSession({ headers: again });
    expect((s1!.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null).toBeNull();

    /* Same DB, instance with the hook: the single membership activates */
    const hooked = makeSpikeAuth({ autoActivate: true });
    const third = await signIn(hooked, "owner@spike.test");
    const s2 = await hooked.api.getSession({ headers: third });
    expect((s2!.session as { activeOrganizationId?: string | null }).activeOrganizationId).toBeTruthy();
  });

  it("4. the switch: set-active moves the session; a non-member cannot activate a foreign org", async () => {
    await createSpikeTables();
    const auth = makeSpikeAuth({ autoActivate: false });
    const owner = await signUp(auth, "owner@spike.test");
    const a = await auth.api.createOrganization({ headers: owner, body: { name: "A", slug: "a" } });
    const b = await auth.api.createOrganization({ headers: owner, body: { name: "B", slug: "b" } });

    await auth.api.setActiveOrganization({ headers: owner, body: { organizationId: a!.id } });
    let s = await auth.api.getSession({ headers: owner });
    expect((s!.session as { activeOrganizationId?: string }).activeOrganizationId).toBe(a!.id);

    await auth.api.setActiveOrganization({ headers: owner, body: { organizationId: b!.id } });
    s = await auth.api.getSession({ headers: owner });
    expect((s!.session as { activeOrganizationId?: string }).activeOrganizationId).toBe(b!.id);

    const list = await auth.api.listOrganizations({ headers: owner });
    expect(list.map((o) => o.slug).sort()).toEqual(["a", "b"]);

    const stranger = await signUp(auth, "stranger@spike.test");
    await expect(
      auth.api.setActiveOrganization({ headers: stranger, body: { organizationId: a!.id } }),
    ).rejects.toMatchObject({ status: expect.anything() });
  });

  it("5. invitations: create → email hook → accept by the invited email; admin cannot invite an admin without the permission", async () => {
    await createSpikeTables();
    sentInvitations.length = 0;
    const auth = makeSpikeAuth({ autoActivate: false });
    const owner = await signUp(auth, "owner@spike.test");
    const org = await auth.api.createOrganization({ headers: owner, body: { name: "WifiPlus", slug: "wifiplus" } });
    await auth.api.setActiveOrganization({ headers: owner, body: { organizationId: org!.id } });

    const invitation = await auth.api.createInvitation({
      headers: owner,
      body: { email: "contador@spike.test", role: "viewer", organizationId: org!.id },
    });
    expect(sentInvitations).toEqual([{ email: "contador@spike.test", role: "viewer", org: "WifiPlus" }]);

    /* The invitee already has an account (US-B02): accepting just adds
       the membership — no second signup */
    const invitee = await signUp(auth, "contador@spike.test");
    await auth.api.acceptInvitation({ headers: invitee, body: { invitationId: invitation!.id } });
    const db = drizzle(env.DB);
    const members = await db.select().from(memberTable).where(eq(memberTable.organizationId, org!.id));
    expect(members.map((m) => m.role).sort()).toEqual(["owner", "viewer"]);

    /* D3's granting rule lives in OUR check, not the plugin's: the plugin
       only asks whether the inviter's role may create invitations at all.
       Measured here so the spec says where the rule must be enforced. */
    const adminHeaders = await signUp(auth, "admin@spike.test");
    await auth.api.addMember({
      body: { organizationId: org!.id, userId: await userIdOf(auth, adminHeaders), role: "admin" },
    });
    await auth.api.setActiveOrganization({ headers: adminHeaders, body: { organizationId: org!.id } });
    const adminInvitesAdmin = auth.api.createInvitation({
      headers: adminHeaders,
      body: { email: "otro@spike.test", role: "admin", organizationId: org!.id },
    });
    const outcome = await adminInvitesAdmin.then(() => "allowed", () => "refused");
    /* Recorded, not asserted either way: the finding goes to the spec */
    console.log(`spike finding: admin inviting admin → ${outcome}`);
    expect(["allowed", "refused"]).toContain(outcome);
  });
});

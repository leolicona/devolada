import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { invitation, member, platformSettings, user as userTable, verification } from "../src/db/schema";
import { validateSetting } from "../src/platform/settings";
import { app, json, seedBusiness, seedMember, sessionCookieHeader, PASSWORD } from "./helpers";

/* The identity round's spec PR (2026-09-02): business-and-memberships
   D5 (born without a CLABE), D8 (48 h, pending list, resend, cancel),
   D11 (every member reads the team), D12 (role change); better-auth
   D14 (the invitation page decides), D15 (our routes' limiter), D16
   (verification gates the session). US-B01, US-B03, US-S04. */

const asUser = async (email: string) => ({ headers: { Cookie: await sessionCookieHeader(email) } });
const call = async (email: string | null, method: string, path: string, body?: unknown, bindings: unknown = env) => {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: "http://localhost:5174" };
  if (email) Object.assign(headers, (await asUser(email)).headers);
  return (await app()).request(path, { method, headers, body: body ? JSON.stringify(body) : undefined }, bindings);
};
const data = async (res: Response) => (await res.json()).data;

const armed = () => {
  const { AUTH_RATE_LIMIT: _off, ...rest } = env as unknown as Record<string, unknown>;
  return rest;
};

describe("US-B03 / D11: every member reads the team; the email rides only for inviters", () => {
  it("a viewer lists names and roles with null emails and no pending list; the owner sees both", async () => {
    const business = await seedBusiness();
    await seedMember(business, "lector@wifiplus.mx", "viewer");
    await call("demo@devolada.app", "POST", "/businesses/members", { email: "nuevo@wifiplus.mx", role: "operator" });

    const asViewer = await data(await call("lector@wifiplus.mx", "GET", "/businesses/members"));
    expect(asViewer.members.map((m: { email: string | null }) => m.email)).toEqual([null, null]);
    expect(asViewer.members.map((m: { role: string }) => m.role).sort()).toEqual(["owner", "viewer"]);
    expect(asViewer.pending).toEqual([]);
    expect(asViewer.grantable).toEqual([]);

    const asOwner = await data(await call("demo@devolada.app", "GET", "/businesses/members"));
    expect(asOwner.members.map((m: { email: string | null }) => m.email).sort()).toEqual([
      "demo@devolada.app",
      "lector@wifiplus.mx",
    ]);
    expect(asOwner.pending).toHaveLength(1);
  });
});

describe("US-B03 / D8: invitations live 48 hours, listed, resent and cancelled by the inviter", () => {
  it("a fresh invitation expires in 48 h; resend refreshes it; cancel removes it", async () => {
    await seedBusiness();
    const before = Date.now();
    const created = await data(
      await call("demo@devolada.app", "POST", "/businesses/members", { email: "ana@wifiplus.mx", role: "operator" }),
    );
    const listed = await data(await call("demo@devolada.app", "GET", "/businesses/members"));
    const pending = listed.pending[0];
    expect(pending).toMatchObject({ id: created.id, email: "ana@wifiplus.mx", role: "operator", expired: false });
    const ttl = pending.expiresAt - before;
    expect(ttl).toBeGreaterThan(47.9 * 3600 * 1000);
    expect(ttl).toBeLessThan(48.1 * 3600 * 1000);

    /* Age the row, then resend: the same id gets a fresh 48 h */
    await drizzle(env.DB)
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitation.id, created.id));
    const stale = await data(await call("demo@devolada.app", "GET", "/businesses/members"));
    expect(stale.pending[0].expired).toBe(true);

    const resent = await call("demo@devolada.app", "POST", `/businesses/invitations/${created.id}/resend`);
    expect(resent.status).toBe(200);
    const fresh = await data(resent);
    expect(fresh.expiresAt).toBeGreaterThan(Date.now() + 47 * 3600 * 1000);
    /* One address, one row on the list — whatever id the plugin chose */
    const relisted = await data(await call("demo@devolada.app", "GET", "/businesses/members"));
    expect(relisted.pending.map((p: { email: string; expired: boolean }) => [p.email, p.expired])).toEqual([["ana@wifiplus.mx", false]]);

    const cancelled = await call("demo@devolada.app", "DELETE", `/businesses/invitations/${fresh.id}`);
    expect(cancelled.status).toBe(200);
    const after = await data(await call("demo@devolada.app", "GET", "/businesses/members"));
    expect(after.pending).toEqual([]);
  });

  it("an admin may not resend or cancel an invitation for a role they could not grant", async () => {
    const business = await seedBusiness();
    await seedMember(business, "admin@wifiplus.mx", "admin");
    const created = await data(
      await call("demo@devolada.app", "POST", "/businesses/members", { email: "otro@wifiplus.mx", role: "admin" }),
    );
    expect((await call("admin@wifiplus.mx", "POST", `/businesses/invitations/${created.id}/resend`)).status).toBe(403);
    expect((await call("admin@wifiplus.mx", "DELETE", `/businesses/invitations/${created.id}`)).status).toBe(403);
  });
});

describe("US-S04 / D16: verification gates the session, so every door is the same door", () => {
  it("an unverified owner's cookie opens nothing — 403 EMAIL_NOT_VERIFIED, then the row is gone", async () => {
    await seedBusiness({ emailVerified: false });
    const res = await call("demo@devolada.app", "GET", "/businesses/members");
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("EMAIL_NOT_VERIFIED");
    expect((await call("demo@devolada.app", "GET", "/settings")).status).toBe(401);
  });
});

describe("US-B03 / D12: role change under the rank rule", () => {
  it("the owner promotes an operator to admin; an admin may not; nobody touches the owner or themselves", async () => {
    const business = await seedBusiness();
    await seedMember(business, "admin@wifiplus.mx", "admin");
    await seedMember(business, "op@wifiplus.mx", "operator");
    const members = (await data(await call("demo@devolada.app", "GET", "/businesses/members"))).members;
    const idOf = (email: string) => members.find((m: { email: string }) => m.email === email).id;

    expect((await call("admin@wifiplus.mx", "PATCH", `/businesses/members/${idOf("op@wifiplus.mx")}`, { role: "admin" })).status).toBe(403);
    expect((await call("admin@wifiplus.mx", "PATCH", `/businesses/members/${idOf("op@wifiplus.mx")}`, { role: "viewer" })).status).toBe(200);
    expect((await call("demo@devolada.app", "PATCH", `/businesses/members/${idOf("demo@devolada.app")}`, { role: "admin" })).status).toBe(403);
    expect((await call("admin@wifiplus.mx", "PATCH", `/businesses/members/${idOf("demo@devolada.app")}`, { role: "viewer" })).status).toBe(403);

    const promoted = await call("demo@devolada.app", "PATCH", `/businesses/members/${idOf("op@wifiplus.mx")}`, { role: "admin" });
    expect(promoted.status).toBe(200);
    const [row] = await drizzle(env.DB).select().from(member).where(eq(member.id, idOf("op@wifiplus.mx")));
    expect(row.role).toBe("admin");
  });
});

describe("US-B03 / D14: the invitation page decides for the invitee", () => {
  it("preview names business, role and email; a new user is born verified, without a código, and lands inside", async () => {
    await seedBusiness();
    const created = await data(
      await call("demo@devolada.app", "POST", "/businesses/members", { email: "ana@wifiplus.mx", role: "operator" }),
    );

    const preview = await data(await call(null, "GET", `/businesses/invitations/${created.id}/preview`));
    expect(preview).toEqual({
      status: "pending",
      businessName: "ISP Demo",
      role: "operator",
      email: "ana@wifiplus.mx",
      hasAccount: false,
    });

    const born = await call(null, "POST", `/businesses/invitations/${created.id}/accept-new`, { name: "Ana", password: PASSWORD });
    expect(born.status).toBe(201);
    expect(await data(born)).toMatchObject({ type: "business", role: "operator", name: "ISP Demo", emailVerified: true });
    const cookie = born.headers.get("set-cookie");
    expect(cookie).toContain("better-auth.session_token");

    const [ana] = await drizzle(env.DB).select().from(userTable).where(eq(userTable.email, "ana@wifiplus.mx"));
    expect(ana.emailVerified).toBe(true);
    const codes = (await drizzle(env.DB).select().from(verification)).filter((v) => v.identifier.includes("ana@wifiplus.mx"));
    expect(codes).toEqual([]);

    /* The session works, and the invitation is spent */
    const me = await (await app()).request("/auth/me", { headers: { Cookie: cookie!.split(";")[0] } }, env);
    expect(me.status).toBe(200);
    expect((await data(await call(null, "GET", `/businesses/invitations/${created.id}/preview`))).status).toBe("gone");
  });

  it("an invited address that already has an account is told so; an expired invitation answers expired and refuses", async () => {
    await seedBusiness();
    await seedBusiness({ email: "contador@wifiplus.mx" });
    const created = await data(
      await call("demo@devolada.app", "POST", "/businesses/members", { email: "contador@wifiplus.mx", role: "viewer" }),
    );
    expect((await data(await call(null, "GET", `/businesses/invitations/${created.id}/preview`))).hasAccount).toBe(true);
    expect((await call(null, "POST", `/businesses/invitations/${created.id}/accept-new`, { name: "Xavier", password: PASSWORD })).status).toBe(409);

    await drizzle(env.DB).update(invitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitation.id, created.id));
    expect((await data(await call(null, "GET", `/businesses/invitations/${created.id}/preview`))).status).toBe("expired");
    expect((await call(null, "POST", `/businesses/invitations/${created.id}/accept-new`, { name: "Xavier", password: PASSWORD })).status).toBe(404);
    expect((await data(await call(null, "GET", "/businesses/invitations/nope/preview"))).status).toBe("gone");
  });
});

describe("US-S04 / D15: our own doors have a tope too", () => {
  it("the sixth signup from one address in a minute answers 429", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await (await app()).request(
        "/auth/business/signup",
        json({ name: "Cuenta", email: `c${i}@wifiplus.mx`, password: PASSWORD }),
        armed(),
      );
      expect(res.status).toBe(201);
    }
    const sixth = await (await app()).request(
      "/auth/business/signup",
      json({ name: "Cuenta", email: "c6@wifiplus.mx", password: PASSWORD }),
      armed(),
    );
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("x-retry-after")).toBeTruthy();
  });

  it("the signup still sends its código (D16: the route sends it, not the hook)", async () => {
    const res = await (await app()).request(
      "/auth/business/signup",
      json({ name: "Cuenta", email: "nuevo@wifiplus.mx", password: PASSWORD }),
      env,
    );
    expect(res.status).toBe(201);
    const codes = (await drizzle(env.DB).select().from(verification)).filter((v) => v.identifier.includes("nuevo@wifiplus.mx"));
    expect(codes).toHaveLength(1);
  });
});

describe("operator-panel D1 / sessions rule 2: the support channel is public and validated", () => {
  it("GET /support answers nulls before the operator sets it, then the digits and the address", async () => {
    expect(await data(await call(null, "GET", "/support"))).toEqual({ whatsapp: null, email: null });
    expect(validateSetting("support_whatsapp", "+52 1 55 1234 5678")).toEqual({ ok: true, value: "5215512345678" });
    expect(validateSetting("support_whatsapp", "5555")).toEqual({ ok: false });

    await seedBusiness();
    const [owner] = await drizzle(env.DB).select().from(userTable);
    await drizzle(env.DB).insert(platformSettings).values([
      { key: "support_whatsapp", value: "5215512345678", authorUserId: owner.id },
      { key: "support_email", value: "hola@devoladapago.com", authorUserId: owner.id },
    ]);
    expect(await data(await call(null, "GET", "/support"))).toEqual({
      whatsapp: "5215512345678",
      email: "hola@devoladapago.com",
    });
  });
});

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { account, invitation, member, session as sessionTable, user as userTable } from "../src/db/schema";
import { app, mintCode, seedBusiness, sessionCookieHeader, sessionOf } from "./helpers";

/* passwordless-access US4 (contracts/panel-access.md § accept-new; D9): an
   invitee without an account gives a name and nothing else. The invitation
   proves the inbox, so the account is born verified — through the
   email-OTP plugin's own door, a código minted and consumed on the server —
   with a session, inside the business, holding no password. */

const db = () => drizzle(env.DB);
const call = async (who: string | null, method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: "http://localhost:5174" };
  if (who) headers.Cookie = await sessionCookieHeader(who);
  return (await app()).request(path, { method, headers, body: body ? JSON.stringify(body) : undefined }, env);
};

async function invite(email: string, role = "operator") {
  const business = await seedBusiness();
  const res = await call("demo@devolada.app", "POST", "/businesses/members", { email, role });
  const { id } = (await res.json()).data as { id: string };
  return { business, id };
}
const acceptNew = (id: string, body: unknown) => call(null, "POST", `/businesses/invitations/${id}/accept-new`, body);

describe("passwordless-access US4 — accept-new takes a name, and the invitee lands inside (D9, FR-019)", () => {
  it("born verified and named, no password, a member with the invited role, the business active, the cookie set", async () => {
    const { business, id } = await invite("ana@wifiplus.mx", "operator");

    const res = await acceptNew(id, { name: " Ana Ruiz " });
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ type: "business", id: business.id, role: "operator" });

    const [ana] = await db().select().from(userTable).where(eq(userTable.email, "ana@wifiplus.mx"));
    expect(ana).toMatchObject({ emailVerified: true, name: "Ana Ruiz" });
    expect(await db().select().from(account).where(eq(account.userId, ana.id))).toHaveLength(0);
    const [membership] = await db().select().from(member).where(eq(member.userId, ana.id));
    expect(membership).toMatchObject({ organizationId: business.orgId, role: "operator" });
    const [session] = await db().select().from(sessionTable).where(eq(sessionTable.userId, ana.id));
    expect(session.activeOrganizationId).toBe(business.orgId);

    const me = await (await app()).request("/auth/me", { headers: { Cookie: sessionOf(res) } }, env);
    expect((await me.json()).data).toMatchObject({ type: "business", id: business.id, role: "operator" });
  });

  it("a stray sign-in código already live for the address does not break it (D9, step 1)", async () => {
    const { id } = await invite("ana@wifiplus.mx");
    const stray = await mintCode("ana@wifiplus.mx");
    const res = await acceptNew(id, { name: "Ana Ruiz" });
    expect(res.status).toBe(201);
    /* and the stray código died with it: one live código per address */
    const late = await (await app()).request(
      "/auth/sign-in/email-otp",
      { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5174" }, body: JSON.stringify({ email: "ana@wifiplus.mx", otp: stray }) },
      env,
    );
    expect(late.status).toBe(400);
  });

  it("a `password` a stale client still sends is ignored: no account row is written", async () => {
    const { id } = await invite("ana@wifiplus.mx");
    const res = await acceptNew(id, { name: "Ana Ruiz", password: "una-clave-123" });
    expect(res.status).toBe(201);
    const [ana] = await db().select().from(userTable).where(eq(userTable.email, "ana@wifiplus.mx"));
    expect(await db().select().from(account).where(eq(account.userId, ana.id))).toHaveLength(0);
  });

  it("a name outside 2–80 characters is VALIDATION, and nobody is born", async () => {
    const { id } = await invite("ana@wifiplus.mx");
    for (const name of ["A", "x".repeat(81)]) {
      const res = await acceptNew(id, { name });
      expect(res.status, name).toBe(400);
    }
    expect(await db().select().from(userTable).where(eq(userTable.email, "ana@wifiplus.mx"))).toHaveLength(0);
  });
});

describe("passwordless-access US4 — accept-new refuses what is not its door (D9)", () => {
  it("an address with an account is EMAIL_TAKEN: the page's key or código is its door", async () => {
    await seedBusiness({ email: "contador@wifiplus.mx" });
    const { id } = await invite("contador@wifiplus.mx");
    const res = await acceptNew(id, { name: "Xavier" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EMAIL_TAKEN");
  });

  it("an expired invitation and a gone one are INVITATION_NOT_FOUND", async () => {
    const { id } = await invite("ana@wifiplus.mx");
    await db().update(invitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitation.id, id));
    const expired = await acceptNew(id, { name: "Ana Ruiz" });
    expect(expired.status).toBe(404);
    expect((await expired.json()).error.code).toBe("INVITATION_NOT_FOUND");

    const gone = await acceptNew("no-such-invitation", { name: "Ana Ruiz" });
    expect(gone.status).toBe(404);
    expect((await gone.json()).error.code).toBe("INVITATION_NOT_FOUND");
    expect(await db().select().from(userTable).where(eq(userTable.email, "ana@wifiplus.mx"))).toHaveLength(0);
  });
});

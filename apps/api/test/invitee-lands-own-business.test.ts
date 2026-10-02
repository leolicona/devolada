import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { invitation, organization } from "../src/db/schema";
import { myInvitationsResponse } from "../src/routes/businesses/schema";
import { app, seedBusiness, sentCode, sessionCookieHeader } from "./helpers";
import { seedActiveStore } from "./store-helpers";

/* bug: invitee-lands-own-business — an invitee who already had a
   business signed in any other way than the email's link and landed in
   their own business; nothing named the invitation again. The panel now
   reads the invitations addressed to the person behind the session.

   passwordless-access US4: the person with no business yet registers by
   código (D1), and the código comes from the sender's log, not the table:
   it is stored hashed (D2). */

/* No network: the invitation email fails closed here (the sender logs
   and moves on), never reaching Resend from a test */
beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

const call = async (who: string | { cookie: string } | null, method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: "http://localhost:5174" };
  if (typeof who === "string") headers.Cookie = await sessionCookieHeader(who);
  else if (who) headers.Cookie = who.cookie;
  return (await app()).request(path, { method, headers, body: body ? JSON.stringify(body) : undefined }, env);
};
const data = async (res: Response) => (await res.json()).data;
const mine = async (who: string | { cookie: string } | null) => call(who, "GET", "/businesses/invitations/mine");

/* The inviting business, named so the answer can be told from the
   invitee's own (the seed names every organization "ISP Demo") */
async function invitingBusiness() {
  const business = await seedBusiness();
  await drizzle(env.DB).update(organization).set({ name: "WifiPlus Norte" }).where(eq(organization.id, business.orgId));
  return business;
}

describe("bug: invitee-lands-own-business — the panel reads the invitations sent to me", () => {
  it("an invitee who owns a business reads the invitation through their own session; the inviter and a stranger do not", async () => {
    await invitingBusiness();
    await seedBusiness({ email: "contador@wifiplus.mx" });
    await seedBusiness({ email: "otro@wifiplus.mx" });
    const created = await data(
      await call("demo@devolada.app", "POST", "/businesses/members", { email: "contador@wifiplus.mx", role: "operator" }),
    );

    const res = await mine("contador@wifiplus.mx");
    expect(res.status).toBe(200);
    const answer = myInvitationsResponse.parse(await data(res));
    expect(answer.invitations).toEqual([
      { id: created.id, businessName: "WifiPlus Norte", role: "operator", expiresAt: expect.any(Number) },
    ]);
    /* D8: the 48 hours the email promised */
    expect(answer.invitations[0].expiresAt - Date.now()).toBeGreaterThan(47 * 3600 * 1000);

    expect((await data(await mine("demo@devolada.app"))).invitations).toEqual([]);
    expect((await data(await mine("otro@wifiplus.mx"))).invitations).toEqual([]);
    expect((await mine(null)).status).toBe(401);
  });

  it("an expired, a cancelled or an accepted invitation is not offered", async () => {
    const business = await invitingBusiness();
    await seedBusiness({ email: "contador@wifiplus.mx" });
    const created = await data(
      await call("demo@devolada.app", "POST", "/businesses/members", { email: "contador@wifiplus.mx", role: "viewer" }),
    );
    const db = drizzle(env.DB);

    /* D8: the plugin keeps an expired row `pending` */
    await db.update(invitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitation.id, created.id));
    expect((await data(await mine("contador@wifiplus.mx"))).invitations).toEqual([]);

    await db.update(invitation).set({ expiresAt: new Date(Date.now() + 3600_000), status: "canceled" }).where(eq(invitation.id, created.id));
    expect((await data(await mine("contador@wifiplus.mx"))).invitations).toEqual([]);

    /* Accepted through the invitation page's own door: gone from the list */
    await db.update(invitation).set({ status: "pending" }).where(eq(invitation.id, created.id));
    expect((await data(await mine("contador@wifiplus.mx"))).invitations).toHaveLength(1);
    const accepted = await call("contador@wifiplus.mx", "POST", "/auth/organization/accept-invitation", { invitationId: created.id });
    expect(accepted.status).toBe(200);
    expect((await data(await mine("contador@wifiplus.mx"))).invitations).toEqual([]);
    const [row] = await db.select().from(invitation).where(eq(invitation.id, created.id));
    expect(row.organizationId).toBe(business.orgId);
    expect(row.status).toBe("accepted");
  });

  it("a person with no business yet — registered by código — reads it too (the wizard asks)", async () => {
    await invitingBusiness();
    const created = await data(
      await call("demo@devolada.app", "POST", "/businesses/members", { email: "ana@wifiplus.mx", role: "admin" }),
    );

    /* passwordless-access D1: the registration's código opens the session */
    expect((await call(null, "POST", "/auth/email-otp/send-verification-otp", { email: "ana@wifiplus.mx", type: "sign-in" })).status).toBe(200);
    const verified = await call(null, "POST", "/auth/sign-in/email-otp", {
      email: "ana@wifiplus.mx",
      otp: sentCode("ana@wifiplus.mx"),
      name: "Ana",
    });
    expect(verified.status).toBe(200);
    const cookie = verified.headers.get("set-cookie")!.split(";")[0];

    /* No membership: every business route says so — this one answers */
    expect((await call({ cookie }, "GET", "/auth/me")).status).toBe(403);
    const answer = myInvitationsResponse.parse(await data(await mine({ cookie })));
    expect(answer.invitations).toEqual([
      { id: created.id, businessName: "WifiPlus Norte", role: "admin", expiresAt: expect.any(Number) },
    ]);
  });

  it("an unverified account and a shopkeeper are refused", async () => {
    await invitingBusiness();
    await seedBusiness({ email: "contador@wifiplus.mx", emailVerified: false });
    await call("demo@devolada.app", "POST", "/businesses/members", { email: "contador@wifiplus.mx", role: "viewer" });
    const unverified = await mine("contador@wifiplus.mx");
    expect(unverified.status).toBe(403);
    expect((await unverified.json()).error.code).toBe("EMAIL_NOT_VERIFIED");

    /* cash-at-stores D2 (FR-013) */
    const shop = await seedActiveStore();
    await call("demo@devolada.app", "POST", "/businesses/members", { email: shop.email, role: "viewer" });
    const store = await mine({ cookie: shop.cookie });
    expect(store.status).toBe(403);
    expect((await store.json()).error.code).toBe("WRONG_ACTOR");
  });
});

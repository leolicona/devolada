import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, member, session as sessionTable } from "../src/db/schema";
import { app, json, seedBusiness, seedConfirmedPayment, seedMember, sessionCookieHeader } from "./helpers";

/* docs/business/business-and-memberships.spec.md scenarios 2–11
   (US-B01, US-B02, US-B03). Scenario 13's membership half is the D7
   backfill, checked on deployed dev (DoD); scenario 12 lives in
   sessions.test.ts. */

/* No network: the invitation email must fail closed here (the sender
   logs and moves on), never reach Resend from a test (TESTING.md rule 8) */
beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

const asUser = async (email: string) => ({
  headers: { Cookie: await sessionCookieHeader(email) },
});
const post = async (email: string, path: string, body: unknown) => {
  const { headers } = await asUser(email);
  return (await app()).request(
    path,
    { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
};
const patch = async (email: string, path: string, body: unknown) => {
  const { headers } = await asUser(email);
  return (await app()).request(
    path,
    { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
};
const get = async (email: string, path: string) =>
  (await app()).request(path, await asUser(email), env);

const MINIMUM = {
  name: "WifiPlus Norte",
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "WifiPlus SA de CV",
};

describe("US-B01: a business is born with the minimum, in one call", () => {
  it("scenario 2: the bank is a pick from the catalog — free text is refused at the edge", async () => {
    await seedBusiness();
    const res = await post("demo@devolada.app", "/businesses", { ...MINIMUM, speiBank: "Banco Inventado" });
    expect(res.status).toBe(400);
  });

  it("scenario 3: a forged request without a CLABE creates nothing (the minimum is the minimum)", async () => {
    await seedBusiness();
    const { speiClabe: _omit, ...withoutClabe } = MINIMUM;
    const res = await post("demo@devolada.app", "/businesses", withoutClabe);
    expect(res.status).toBe(400);
    expect(await drizzle(env.DB).select().from(businesses)).toHaveLength(1);
  });

  it("creates the business with its auth twin, the caller as owner, and makes it active", async () => {
    await seedBusiness();
    const res = await post("demo@devolada.app", "/businesses", MINIMUM);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ type: "business", name: "WifiPlus Norte", role: "owner" });
    expect(data.businesses).toHaveLength(2);

    const db = drizzle(env.DB);
    const [row] = await db.select().from(businesses).where(eq(businesses.id, data.id));
    expect(row.speiClabe).toBe(MINIMUM.speiClabe);
    expect(row.speiBank).toBe("STP");
    const [owner] = await db.select().from(member).where(eq(member.organizationId, row.orgId));
    expect(owner.role).toBe("owner");
  });
});

describe("US-B02: one login, isolated workspaces", () => {
  it("scenario 4: switching swaps the feed entirely — no row of A under B", async () => {
    const a = await seedBusiness({ wisphubApiKey: "wh-a" });
    await seedConfirmedPayment(a, { folio: "DV-AAAA01", customerName: "Cliente de A" });

    /* Creating B makes it the active one */
    const created = await post("demo@devolada.app", "/businesses", MINIMUM);
    const b = (await created.json()).data;
    let feed = await (await get("demo@devolada.app", "/payments/feed")).json();
    expect(feed.data.payments).toHaveLength(0);

    /* Back to A through the plugin's switch (envelope-exempt, better-auth D6) */
    const { headers } = await asUser("demo@devolada.app");
    const sw = await (await app()).request(
      "/auth/organization/set-active",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Origin: "http://localhost:5174" },
        body: JSON.stringify({ organizationId: a.orgId }),
      },
      env,
    );
    expect(sw.status).toBe(200);
    feed = await (await get("demo@devolada.app", "/payments/feed")).json();
    expect(feed.data.payments.map((c: { folio: string }) => c.folio)).toEqual(["DV-AAAA01"]);

    const me = await (await get("demo@devolada.app", "/auth/me")).json();
    expect(me.data.id).toBe(a.id);
    expect(me.data.businesses.map((x: { id: string }) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("scenario 5: several memberships and none active → NO_ACTIVE_BUSINESS", async () => {
    await seedBusiness();
    await post("demo@devolada.app", "/businesses", MINIMUM);
    /* Forget the choice: the client must offer the switcher */
    await drizzle(env.DB).update(sessionTable).set({ activeOrganizationId: null });
    const res = await get("demo@devolada.app", "/auth/me");
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NO_ACTIVE_BUSINESS");
  });

  it("D4: exactly one membership resolves without a choice", async () => {
    await seedBusiness();
    await drizzle(env.DB).update(sessionTable).set({ activeOrganizationId: null });
    const res = await get("demo@devolada.app", "/auth/me");
    expect(res.status).toBe(200);
    expect((await res.json()).data.role).toBe("owner");
  });
});

describe("US-B03: roles reach exactly their areas", () => {
  it("scenario 6: an admin saves the fee but cannot touch the CLABE", async () => {
    const business = await seedBusiness();
    await seedMember(business, "admin@wifiplus.mx", "admin");

    const fee = await patch("admin@wifiplus.mx", "/settings", { serviceFeeCents: 2000 });
    expect(fee.status).toBe(200);

    const clabe = await patch("admin@wifiplus.mx", "/settings", { speiClabe: "646180157000000004" });
    expect(clabe.status).toBe(403);
    expect((await clabe.json()).error.code).toBe("FORBIDDEN_FOR_ROLE");
  });

  it("scenario 7: an operator reads payments and is refused at settings", async () => {
    const business = await seedBusiness();
    await seedMember(business, "operador@wifiplus.mx", "operator");

    expect((await get("operador@wifiplus.mx", "/payments/feed")).status).toBe(200);
    const res = await patch("operador@wifiplus.mx", "/settings", { timeFormat: "24h" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_FOR_ROLE");
  });

  it("scenario 8: a viewer sees a masked CLABE, no key tail, and every mutation is refused", async () => {
    const business = await seedBusiness({
      wisphubApiKey: "01q9K2Rf.SECRETKEY1234",
      speiClabe: "646180157000000004",
      speiBank: "STP",
    });
    await seedMember(business, "contador@wifiplus.mx", "viewer");

    const res = await get("contador@wifiplus.mx", "/settings");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.spei.clabe).toBe("••••0004");
    expect(data.wisphub.keyTail).toBeNull();

    expect((await patch("contador@wifiplus.mx", "/settings", { timeFormat: "24h" })).status).toBe(403);
    expect((await post("contador@wifiplus.mx", "/businesses/members", { email: "x@y.mx", role: "viewer" })).status).toBe(403);
    expect((await get("contador@wifiplus.mx", "/payments/feed")).status).toBe(200);
  });

  it("scenario 9: an owner invites an existing account, which gains the membership without a new signup", async () => {
    const business = await seedBusiness();
    /* The invitee already has an account (and a business of their own) */
    await seedBusiness({ email: "contador@wifiplus.mx" });

    const invited = await post("demo@devolada.app", "/businesses/members", {
      email: "contador@wifiplus.mx",
      role: "viewer",
    });
    expect(invited.status).toBe(201);
    const invitation = (await invited.json()).data;

    const { headers } = await asUser("contador@wifiplus.mx");
    const accepted = await (await app()).request(
      "/auth/organization/accept-invitation",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Origin: "http://localhost:5174" },
        body: JSON.stringify({ invitationId: invitation.id }),
      },
      env,
    );
    expect(accepted.status).toBe(200);

    const rows = await drizzle(env.DB).select().from(member).where(eq(member.organizationId, business.orgId));
    expect(rows.map((r) => r.role).sort()).toEqual(["owner", "viewer"]);

    const members = await (await get("demo@devolada.app", "/businesses/members")).json();
    expect(members.data.members.map((m: { email: string }) => m.email).sort()).toEqual([
      "contador@wifiplus.mx",
      "demo@devolada.app",
    ]);
    expect(members.data.grantable).toEqual(["owner", "admin", "operator", "viewer"]);
  });

  it("scenario 10: an admin may not invite an admin (D3's granting rule, ours to enforce)", async () => {
    const business = await seedBusiness();
    await seedMember(business, "admin@wifiplus.mx", "admin");

    const res = await post("admin@wifiplus.mx", "/businesses/members", { email: "otro@wifiplus.mx", role: "admin" });
    expect(res.status).toBe(403);
    const ok = await post("admin@wifiplus.mx", "/businesses/members", { email: "otro@wifiplus.mx", role: "operator" });
    expect(ok.status).toBe(201);

    const members = await (await get("admin@wifiplus.mx", "/businesses/members")).json();
    expect(members.data.grantable).toEqual(["operator", "viewer"]);
  });

  it("scenario 11: a removed member's stale session answers MEMBERSHIP_REVOKED", async () => {
    const business = await seedBusiness();
    await seedMember(business, "operador@wifiplus.mx", "operator");
    expect((await get("operador@wifiplus.mx", "/payments/feed")).status).toBe(200);

    const members = await (await get("demo@devolada.app", "/businesses/members")).json();
    const target = members.data.members.find((m: { email: string }) => m.email === "operador@wifiplus.mx");
    const { headers } = await asUser("demo@devolada.app");
    const removed = await (await app()).request(
      `/businesses/members/${target.id}`,
      { method: "DELETE", headers },
      env,
    );
    expect(removed.status).toBe(200);

    const res = await get("operador@wifiplus.mx", "/payments/feed");
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("MEMBERSHIP_REVOKED");
  });
});

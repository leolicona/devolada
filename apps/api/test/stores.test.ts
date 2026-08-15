import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { invitations, ledgerEntries, stores, user as userTable } from "../src/db/schema";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/admin/stores.spec.md scenarios 1–3, invitation tokens now ours
   (better-auth.spec.md D8). */

const asIsp = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };
const post = (path: string, body: unknown): [string, RequestInit] => [
  path,
  {
    method: "POST",
    headers: { "Content-Type": "application/json", ...asIsp.headers },
    body: JSON.stringify(body),
  },
];

const newStore = {
  name: "Miscelánea Lupita",
  contactName: "Doña Lupita",
  phone: "5587654321",
  zone: "Col. Centro",
};

describe("US-A02: registering a store creates its invitation", () => {
  it("creates an invited store and returns the copyable link with our token", async () => {
    await seedIsp();

    const res = await (await app()).request(...post("/stores", newStore), env);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.store).toMatchObject({ status: "invited", invitationStatus: "sent" });

    /* The token is ours now (spec D8): the link carries what the DB holds */
    const db = drizzle(env.DB);
    const [invite] = await db.select().from(invitations);
    expect(data.invitationLink).toBe(`http://localhost:5173/invitation/${invite.token}`);
  });

  it("unverified ISP gets 403; a duplicate phone gets 409", async () => {
    await seedIsp({ emailVerified: false });
    const blocked = await (await app()).request(...post("/stores", newStore), env);
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe("EMAIL_NOT_VERIFIED");

    /* The flag lives on the Better Auth user now */
    const db = drizzle(env.DB);
    await db.update(userTable).set({ emailVerified: true });
    await (await app()).request(...post("/stores", newStore), env);

    const dup = await (await app()).request(...post("/stores", newStore), env);
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("PHONE_TAKEN");
  });
});

describe("US-A03: the list carries balances; tenants stay isolated", () => {
  it("returns grouped balances with cap booleans; another ISP sees nothing", async () => {
    const isp = await seedIsp();
    const store = await seedStore(isp.id, { balanceCapCents: 100000 });
    const db = drizzle(env.DB);
    await db.insert(ledgerEntries).values([
      { storeId: store.id, type: "charge", cents: 90000 },
      { storeId: store.id, type: "commission", cents: -900 },
    ]);

    const res = await (await app()).request("/stores", asIsp, env);
    const { data } = await res.json();
    expect(data.stores).toHaveLength(1);
    expect(data.stores[0]).toMatchObject({
      balanceCents: 89100,
      cap: { capCents: 100000, approaching: true, blocked: false },
    });

    await seedIsp({ email: "otro@isp.mx" });
    const other = await (await app()).request(
      "/stores",
      { headers: { Cookie: await sessionCookieHeader("otro@isp.mx") } },
      env,
    );
    expect((await other.json()).data.stores).toHaveLength(0);
  });

  it("the detail shows the recovery email once accepted (owner decision)", async () => {
    const isp = await seedIsp();
    const accepted = await seedStore(isp.id);
    const invited = await seedStore(isp.id, { status: "invited", phone: "5587654321" });

    const detail = await (await app()).request(`/stores/${accepted.id}`, asIsp, env);
    expect((await detail.json()).data.recoveryEmail).toBe("store-5512345678@test.devolada.app");

    const pending = await (await app()).request(`/stores/${invited.id}`, asIsp, env);
    expect((await pending.json()).data.recoveryEmail).toBeNull();
  });
});

describe("US-A03: manage the store", () => {
  it("patches commission/cap/status; resend rotates the token; accepted → 409", async () => {
    const isp = await seedIsp();
    const store = await seedStore(isp.id, { status: "invited" });
    const db = drizzle(env.DB);
    await db.insert(invitations).values({ storeId: store.id, token: "old-tok" });

    const patched = await (await app()).request(`/stores/${store.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...asIsp.headers },
      body: JSON.stringify({ commissionCents: 1200, balanceCapCents: 200000, status: "suspended" }),
    }, env);
    expect((await patched.json()).data).toMatchObject({
      commissionCents: 1200,
      status: "suspended",
      cap: { capCents: 200000 },
    });

    const resend = await (await app()).request(
      ...post(`/stores/${store.id}/resend-invitation`, {}),
      env,
    );
    const [invite] = await db.select().from(invitations).where(eq(invitations.storeId, store.id));
    expect(invite.token).not.toBe("old-tok");
    expect((await resend.json()).data.invitationLink).toContain(invite.token);

    await db.update(invitations).set({ status: "accepted" }).where(eq(invitations.id, invite.id));
    const after = await (await app()).request(
      ...post(`/stores/${store.id}/resend-invitation`, {}),
      env,
    );
    expect(after.status).toBe(409);
    expect((await after.json()).error.code).toBe("ALREADY_ACCEPTED");
  });
});

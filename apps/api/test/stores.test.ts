import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { invitations, ledgerEntries, stores } from "../src/db/schema";
import { app, mockIdp, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/admin/stores.spec.md scenarios 1–3. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const asIsp = { headers: { Cookie: sessionCookieHeader("demo@devolada.app") } };
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

function mockInitiate(token: string) {
  mockIdp("/auth/initiate", {
    body: { success: true, data: { token, magicLink: "https://ignored" } },
  });
}

describe("US-A02: registering a store creates its invitation", () => {
  it("creates an invited store and returns the copyable link", async () => {
    await seedIsp();
    mockInitiate("inv-tok-1");

    const res = await (await app()).request(...post("/stores", newStore), env);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.store).toMatchObject({ status: "invited", invitationStatus: "sent" });
    expect(data.invitationLink).toBe("http://localhost:5173/invitation/inv-tok-1");
  });

  it("unverified ISP gets 403; a duplicate phone gets 409", async () => {
    await seedIsp({ emailVerified: false });
    const blocked = await (await app()).request(...post("/stores", newStore), env);
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe("EMAIL_NOT_VERIFIED");

    const db = drizzle(env.DB);
    const { isps } = await import("../src/db/schema");
    await db.update(isps).set({ emailVerified: true });
    mockInitiate("inv-tok-1");
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
      { headers: { Cookie: sessionCookieHeader("otro@isp.mx") } },
      env,
    );
    expect((await other.json()).data.stores).toHaveLength(0);
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

    mockInitiate("new-tok");
    const resend = await (await app()).request(
      ...post(`/stores/${store.id}/resend-invitation`, {}),
      env,
    );
    expect((await resend.json()).data.invitationLink).toContain("new-tok");
    const [invite] = await db.select().from(invitations).where(eq(invitations.storeId, store.id));
    expect(invite.token).toBe("new-tok");

    await db.update(invitations).set({ status: "accepted" }).where(eq(invitations.id, invite.id));
    const after = await (await app()).request(
      ...post(`/stores/${store.id}/resend-invitation`, {}),
      env,
    );
    expect(after.status).toBe(409);
    expect((await after.json()).error.code).toBe("ALREADY_ACCEPTED");
  });
});

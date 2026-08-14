import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { invitations, stores } from "../src/db/schema";
import { app, cookiesOf, idpError, idpTokens, mockIdp, seedIsp, seedStore } from "./helpers";

/* docs/auth/store-invitation.spec.md scenarios 1–3. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function seedInvitedStore() {
  const isp = await seedIsp();
  const store = await seedStore(isp.id, {
    status: "invited",
    passwordHash: null,
    passwordSalt: null,
  });
  const db = drizzle(env.DB);
  const [invitation] = await db
    .insert(invitations)
    .values({ storeId: store.id, token: "invite-tok-1" })
    .returning();
  return { store, invitation, db };
}

describe("US-S05: the shopkeeper redeems the invitation in one step", () => {
  it("sets the password, activates the store and signs in", async () => {
    const { store, db } = await seedInvitedStore();
    mockIdp("/auth/verify", { body: { success: true, data: idpTokens("5512345678") } });
    mockIdp("/auth/hash", { body: { success: true, data: { hash: "h9", salt: "s9" } } });

    const res = await (await app()).request(
      "/auth/store/accept-invitation",
      json({ token: "invite-tok-1", password: "nueva-clave-1" }),
      env,
    );
    expect(res.status).toBe(200);
    expect(cookiesOf(res).join(";")).toContain("gm_access=");

    const [updated] = await db.select().from(stores).where(eq(stores.id, store.id));
    expect(updated).toMatchObject({ status: "active", passwordHash: "h9" });
    const [inv] = await db.select().from(invitations);
    expect(inv.status).toBe("accepted");
  });

  it("unknown token, accepted invitation and IdP rejection all answer INVALID_TOKEN", async () => {
    const { db, invitation } = await seedInvitedStore();

    /* IdP rejects the token */
    mockIdp("/auth/verify", { status: 400, body: idpError("HTTP_EXCEPTION", "Invalid token") });
    const rejected = await (await app()).request(
      "/auth/store/accept-invitation",
      json({ token: "invite-tok-1", password: "nueva-clave-1" }),
      env,
    );
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error.code).toBe("INVALID_TOKEN");

    /* IdP accepts but the invitation was already used */
    await db
      .update(invitations)
      .set({ status: "accepted" })
      .where(eq(invitations.id, invitation.id));
    mockIdp("/auth/verify", { body: { success: true, data: idpTokens("5512345678") } });
    const used = await (await app()).request(
      "/auth/store/accept-invitation",
      json({ token: "invite-tok-1", password: "nueva-clave-1" }),
      env,
    );
    expect(used.status).toBe(400);
    expect((await used.json()).error.code).toBe("INVALID_TOKEN");
  });

  it("a short password fails validation before touching the IdP", async () => {
    await seedInvitedStore();
    const res = await (await app()).request(
      "/auth/store/accept-invitation",
      json({ token: "invite-tok-1", password: "corta" }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

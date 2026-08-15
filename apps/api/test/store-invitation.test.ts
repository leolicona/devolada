import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { invitations, stores } from "../src/db/schema";
import { app, json, seedIsp, seedStore, sessionOf, PASSWORD } from "./helpers";

/* better-auth.spec.md scenario 3 (US-S05): our own 7-day single-use
   token; acceptance collects email + password and activates. */

const EMAIL = "chuy@gmail.com";

async function seedInvitation(overrides: { createdAt?: Date; status?: "sent" | "accepted" } = {}) {
  const isp = await seedIsp();
  const store = await seedStore(isp.id, { status: "invited" });
  const token = crypto.randomUUID();
  const db = drizzle(env.DB);
  await db.insert(invitations).values({
    storeId: store.id,
    token,
    status: overrides.status ?? "sent",
    ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
  });
  return { store, token };
}

const accept = async (token: string, email = EMAIL, password = PASSWORD) =>
  (await app()).request("/auth/store/accept-invitation", json({ token, email, password }), env);

describe("US-S05: the invitation link sets password and recovery email", () => {
  it("valid token + email + password → active, linked, signed in", async () => {
    const { store, token } = await seedInvitation();

    const res = await accept(token);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ type: "store", id: store.id });
    const cookie = sessionOf(res);

    const db = drizzle(env.DB);
    const [updated] = await db.select().from(stores).where(eq(stores.id, store.id));
    expect(updated.status).toBe("active");
    expect(updated.userId).toBeTruthy();
    const [invite] = await db.select().from(invitations).where(eq(invitations.token, token));
    expect(invite.status).toBe("accepted");

    /* The session works, and so does the daily phone login */
    const me = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(me.status).toBe(200);
    const login = await (await app()).request(
      "/auth/sign-in/username",
      json({ username: store.phone, password: PASSWORD }),
      env,
    );
    expect(login.status).toBe(200);
  });

  it("unknown and reused tokens both answer 400 INVALID_TOKEN", async () => {
    const { token } = await seedInvitation();
    await accept(token);

    for (const bad of ["no-existe", token]) {
      const res = await accept(bad, `otro-${bad.slice(0, 4)}@gmail.com`);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_TOKEN");
    }
  });

  it("a token older than 7 days is dead (spec D8)", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    const { token } = await seedInvitation({ createdAt: eightDaysAgo });

    const res = await accept(token);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_TOKEN");
  });

  it("a taken email returns 409 EMAIL_TAKEN", async () => {
    const { token } = await seedInvitation();
    const res = await accept(token, "demo@devolada.app");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EMAIL_TAKEN");
  });

  it("a short password returns 400", async () => {
    const { token } = await seedInvitation();
    const res = await accept(token, EMAIL, "corta");
    expect(res.status).toBe(400);
  });
});

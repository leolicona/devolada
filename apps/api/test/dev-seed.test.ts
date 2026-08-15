import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { isps, stores } from "../src/db/schema";
import { makeAuth } from "../src/auth/better";
import type { Bindings } from "../src/env";
import { app, cookiesOf, json, PASSWORD } from "./helpers";

/* The dev seed must repair rows born before the Better Auth migration:
   they exist with user_id NULL, so the idempotency check used to skip
   user creation and nobody could log into deployed dev again. */

describe("dev seed backfills pre-migration demo rows", () => {
  it("legacy isp and store rows get a user, and both logins work", async () => {
    const db = drizzle(env.DB);
    /* Pre-migration shape: rows exist, no Better Auth user linked */
    const [isp] = await db
      .insert(isps)
      .values({ name: "ISP Demo", email: "demo@devolada.app" })
      .returning();
    await db.insert(stores).values({
      ispId: isp.id,
      name: "Abarrotes La Esquina",
      contactName: "Don Chuy",
      phone: "5512345678",
      status: "active",
    });

    const seed = await (await app()).request("/dev/seed", { method: "POST" }, env);
    expect(seed.status).toBe(200);

    const adminLogin = await (await app()).request(
      "/auth/sign-in/email",
      json({ email: "demo@devolada.app", password: PASSWORD }),
      env,
    );
    expect(adminLogin.status).toBe(200);

    const storeLogin = await (await app()).request(
      "/auth/sign-in/username",
      json({ username: "5512345678", password: PASSWORD }),
      env,
    );
    expect(storeLogin.status).toBe(200);

    /* And running it again stays idempotent */
    const again = await (await app()).request("/dev/seed", { method: "POST" }, env);
    expect(again.status).toBe(200);
  });

  it("links a legacy isp row to its orphan user, keeping the user's password", async () => {
    /* The deployed-dev case of 2026-08-15: a pre-migration isps row plus
       an orphan Better Auth user with the same email (left by the old
       signup bug). The seed must marry them; the password the user set
       — through recovery included — keeps working. */
    const db = drizzle(env.DB);
    const [legacy] = await db
      .insert(isps)
      .values({ name: "ISP Legado", email: "leo@example.com" })
      .returning();
    const auth = makeAuth(env as unknown as Bindings);
    await auth.api.signUpEmail({
      body: { name: "Leo", email: "leo@example.com", password: "clave-recuperada-1" },
    });

    const seed = await (await app()).request("/dev/seed", { method: "POST" }, env);
    expect(seed.status).toBe(200);

    const [linked] = await db.select().from(isps).where(eq(isps.id, legacy.id));
    expect(linked.userId).toBeTruthy();

    const login = await (await app()).request(
      "/auth/sign-in/email",
      json({ email: "leo@example.com", password: "clave-recuperada-1" }),
      env,
    );
    expect(login.status).toBe(200);
    const cookie = cookiesOf(login)
      .find((c) => c.includes("session_token"))!
      .split(";")[0];
    const me = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(me.status).toBe(200);
    expect((await me.json()).data).toMatchObject({ type: "isp", email: "leo@example.com" });
  });
});

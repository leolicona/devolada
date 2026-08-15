import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { isps, stores } from "../src/db/schema";
import { app, json, PASSWORD } from "./helpers";

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
});

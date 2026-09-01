import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, member } from "../src/db/schema";
import { makeAuth } from "../src/auth/better";
import type { Bindings } from "../src/env";
import { app, cookiesOf, json, PASSWORD } from "./helpers";

/* The dev seed (CLAUDE.md): a demo business with its auth twin and an
   owner membership (business-and-memberships D1/D7 shape), idempotent. */

describe("dev seed creates the demo business with its owner", () => {
  it("US-B02: the demo owner signs in and lands in the demo business", async () => {
    const seed = await (await app()).request("/dev/seed", { method: "POST" }, env);
    expect(seed.status).toBe(200);

    const db = drizzle(env.DB);
    const [business] = await db.select().from(businesses).where(eq(businesses.email, "demo@devolada.app"));
    const [owner] = await db.select().from(member).where(eq(member.organizationId, business.orgId));
    expect(owner.role).toBe("owner");

    const login = await (await app()).request(
      "/auth/sign-in/email",
      json({ email: "demo@devolada.app", password: PASSWORD }),
      env,
    );
    expect(login.status).toBe(200);
    const cookie = cookiesOf(login)
      .find((c) => c.includes("session_token"))!
      .split(";")[0];
    const me = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(me.status).toBe(200);
    expect((await me.json()).data).toMatchObject({ type: "business", id: business.id, role: "owner" });

    /* And running it again stays idempotent */
    const again = await (await app()).request("/dev/seed", { method: "POST" }, env);
    expect(again.status).toBe(200);
    expect(await db.select().from(businesses)).toHaveLength(1);
  });

  it("marries an orphan user to the demo business, keeping the user's password", async () => {
    /* The deployed-dev case of 2026-08-15: a Better Auth user with the demo
       email and no business (left by a failed signup). The seed must give
       it the business; the password the user set keeps working. */
    const auth = makeAuth(env as unknown as Bindings);
    await auth.api.signUpEmail({
      body: { name: "Leo", email: "demo@devolada.app", password: "clave-recuperada-1" },
    });

    const seed = await (await app()).request("/dev/seed", { method: "POST" }, env);
    expect(seed.status).toBe(200);

    const login = await (await app()).request(
      "/auth/sign-in/email",
      json({ email: "demo@devolada.app", password: "clave-recuperada-1" }),
      env,
    );
    expect(login.status).toBe(200);
    const cookie = cookiesOf(login)
      .find((c) => c.includes("session_token"))!
      .split(";")[0];
    const me = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(me.status).toBe(200);
    expect((await me.json()).data).toMatchObject({ type: "business", role: "owner" });
  });
});

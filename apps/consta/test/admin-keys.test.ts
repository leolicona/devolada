import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { app, apiKeys, db } from "./helpers";

/* docs/consta/validation.spec.md scenario 6 (US-V05, D5) */

const admin = { Authorization: `Bearer ${env.CONSTA_ADMIN_TOKEN}` };

describe("POST /admin/keys", () => {
  it("US-V05: issues a key, returns the plaintext once and stores only its hash", async () => {
    const res = await app.request(
      "/admin/keys",
      {
        method: "POST",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "app-tercero" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { id: string; key: string } };
    expect(data.key).toMatch(/^ck_[0-9a-f]{32}$/);

    const [row] = await db().select().from(apiKeys).where(eq(apiKeys.id, data.id));
    expect(row.keyHash).not.toContain(data.key);
    expect(row.revokedAt).toBeNull();
  });

  it("US-V05: the wrong admin token gets 401; revoking twice gets 404", async () => {
    const bad = await app.request(
      "/admin/keys",
      {
        method: "POST",
        headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      },
      env,
    );
    expect(bad.status).toBe(401);

    const created = await app.request(
      "/admin/keys",
      {
        method: "POST",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "efimera" }),
      },
      env,
    );
    const { data } = (await created.json()) as { data: { id: string } };

    const first = await app.request(`/admin/keys/${data.id}`, { method: "DELETE", headers: admin }, env);
    expect(first.status).toBe(200);
    const second = await app.request(`/admin/keys/${data.id}`, { method: "DELETE", headers: admin }, env);
    expect(second.status).toBe(404);
  });
});
/* payments-and-classes D7: the issue-only door (validation D5 amendment). */
describe("CONSTA_ISSUER_TOKEN opens the POST and nothing else", () => {
  const issuer = { Authorization: `Bearer ${env.CONSTA_ISSUER_TOKEN}` };

  it("mints a key exactly like the admin's door", async () => {
    const res = await app.request(
      "/admin/keys",
      {
        method: "POST",
        headers: { ...issuer, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "WifiPlus · biz-1" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { key: string } };
    expect(data.key).toMatch(/^ck_[0-9a-f]{32}$/);
  });

  it("cannot revoke: a compromised issuer must never 401 another tenant", async () => {
    const created = await app.request(
      "/admin/keys",
      {
        method: "POST",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "revocable" }),
      },
      env,
    );
    const { data } = (await created.json()) as { data: { id: string } };

    const res = await app.request(
      `/admin/keys/${data.id}`,
      { method: "DELETE", headers: issuer },
      env,
    );
    expect(res.status).toBe(401);

    /* the admin still can */
    const byAdmin = await app.request(
      `/admin/keys/${data.id}`,
      { method: "DELETE", headers: admin },
      env,
    );
    expect(byAdmin.status).toBe(200);
  });

  it("with the issuer secret unset, only the admin door remains", async () => {
    const bare = { ...env, CONSTA_ISSUER_TOKEN: undefined } as typeof env;
    const res = await app.request(
      "/admin/keys",
      {
        method: "POST",
        headers: { ...issuer, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      },
      bare,
    );
    expect(res.status).toBe(401);
  });
});

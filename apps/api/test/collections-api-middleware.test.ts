import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { apiCredentials, idempotencyKeys, rateCounters } from "../src/db/schema";
import type { Bindings, Variables } from "../src/env";
import { hashApiKey, keyTail, looksLikeApiKey } from "../src/api-clients/credentials";
import { issueCredential, listCredentials, resolveCredential, revokeCredential } from "../src/api-clients/store";
import { idempotent, RATE_LIMIT_PER_MINUTE, rateLimit, requireApiCredential } from "../src/routes/v1/middleware";
import { seedBusiness } from "./helpers";

/* automated-collections-api US1 — the credential and the middleware every
   /v1 request passes through (research D11, D13, D14; FR-002, FR-004,
   FR-005, FR-008, FR-024). Mounted here on a bare router so the foundation
   is proven before any area exists; the areas' own suites drive the same
   middleware through the real routes. */

const db = () => drizzle(env.DB);

/* A router with the same composition the areas will use, and one handler
   that echoes who the middleware resolved */
function harness(opts: { now?: () => Date } = {}) {
  const r = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  r.use("*", requireApiCredential);
  r.use("*", rateLimit(opts));
  r.use("*", idempotent);
  let calls = 0;
  r.get("/whoami", (c) => c.json({ success: true, data: { businessId: c.get("apiClient").businessId, isTest: c.get("apiClient").isTest } }));
  r.post("/create", async (c) => {
    calls++;
    const body = await c.req.json<{ fail?: boolean }>();
    if (body.fail) return c.json({ success: false, error: { code: "VALIDATION_ERROR", retryable: false } }, 400);
    return c.json({ success: true, data: { id: `created-${calls}` } }, 201);
  });
  return { r, calls: () => calls };
}

const bearer = (key: string, extra: Record<string, string> = {}) => ({ headers: { Authorization: `Bearer ${key}`, ...extra } });

describe("D11: the credential — dk_, hashed, shown once, revoked by timestamp", () => {
  it("issues a dk_<32 hex> key, stores only its hash and tail, and lists without the hash", async () => {
    const business = await seedBusiness();
    const { credential, plaintext } = await issueCredential(db(), business.id, { name: "Facturación" });
    expect(plaintext).toMatch(/^dk_[0-9a-f]{32}$/);
    expect(looksLikeApiKey(plaintext)).toBe(true);
    expect(credential.keyTail).toBe(keyTail(plaintext));
    expect(credential).not.toHaveProperty("keyHash");

    const [row] = await db().select().from(apiCredentials);
    expect(row.keyHash).toBe(await hashApiKey(plaintext));
    expect(row.keyHash).not.toContain(plaintext.slice(3));
    expect(row.isTest).toBe(false);
    expect(row.revokedAt).toBeNull();

    const listed = await listCredentials(db(), business.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: "Facturación", keyTail: credential.keyTail });
    expect(listed[0]).not.toHaveProperty("keyHash");
  });

  it("resolves the plaintext to its business, and to nothing once revoked (FR-004)", async () => {
    const business = await seedBusiness();
    const { credential, plaintext } = await issueCredential(db(), business.id, { name: "k", isTest: true });
    const resolved = await resolveCredential(db(), plaintext);
    expect(resolved?.business.id).toBe(business.id);
    expect(resolved?.credential.isTest).toBe(true);

    expect(await revokeCredential(db(), business.id, credential.id, new Date())).toBe(true);
    expect(await resolveCredential(db(), plaintext)).toBeNull();
    /* the row stays, so the panel can still name it */
    expect((await listCredentials(db(), business.id))[0].revokedAt).not.toBeNull();
    /* idempotent, and never another business's to revoke */
    expect(await revokeCredential(db(), business.id, credential.id, new Date())).toBe(false);
    const other = await seedBusiness({ email: "otro@business.mx" });
    const { credential: theirs } = await issueCredential(db(), other.id, { name: "k" });
    expect(await revokeCredential(db(), business.id, theirs.id, new Date())).toBe(false);
  });
});

describe("FR-005: a missing, malformed, unknown or revoked credential gets the same empty answer", () => {
  const cases: [string, Record<string, string>][] = [
    ["no header", {}],
    ["not a bearer", { Authorization: "Basic abc" }],
    ["wrong shape", { Authorization: "Bearer ck_0123456789abcdef0123456789abcdef" }],
    ["unknown key", { Authorization: "Bearer dk_0123456789abcdef0123456789abcdef" }],
  ];
  for (const [label, headers] of cases) {
    it(label, async () => {
      await seedBusiness();
      const res = await harness().r.request("/whoami", { headers }, env);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ success: false, error: { code: "AUTHENTICATION_ERROR", retryable: false } });
    });
  }

  it("a revoked key answers exactly like an unknown one", async () => {
    const business = await seedBusiness();
    const { credential, plaintext } = await issueCredential(db(), business.id, { name: "k" });
    await revokeCredential(db(), business.id, credential.id, new Date());
    const res = await harness().r.request("/whoami", bearer(plaintext), env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: { code: "AUTHENTICATION_ERROR", retryable: false } });
  });

  it("a live key resolves to exactly its business and carries the test flag; last_used_at is touched", async () => {
    const business = await seedBusiness();
    const { credential, plaintext } = await issueCredential(db(), business.id, { name: "k", isTest: true });
    const res = await harness().r.request("/whoami", bearer(plaintext), env);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ businessId: business.id, isTest: true });
    const [row] = await db().select().from(apiCredentials);
    expect(row.id).toBe(credential.id);
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("D15: a suspended business is refused on every request, with BUSINESS_SUSPENDED", async () => {
    const business = await seedBusiness({ status: "suspended" });
    const { plaintext } = await issueCredential(db(), business.id, { name: "k" });
    const res = await harness().r.request("/whoami", bearer(plaintext), env);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code: "BUSINESS_SUSPENDED", retryable: false });
  });
});

describe("D13 / FR-024: 120 requests a minute per business, then RATE_LIMITED with Retry-After", () => {
  it(`the ${RATE_LIMIT_PER_MINUTE + 1}th request in one minute is refused, retryable, with the seconds left`, async () => {
    const business = await seedBusiness();
    const { plaintext } = await issueCredential(db(), business.id, { name: "k" });
    /* a fixed clock 20 s into a minute, so the whole test sits in one bucket */
    const { r } = harness({ now: () => new Date(Date.UTC(2026, 8, 17, 12, 0, 20)) });
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      expect((await r.request("/whoami", bearer(plaintext), env)).status).toBe(200);
    }
    const refused = await r.request("/whoami", bearer(plaintext), env);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("40");
    expect(await refused.json()).toEqual({ success: false, error: { code: "RATE_LIMITED", retryable: true } });

    const [counter] = await db().select().from(rateCounters);
    expect(counter.count).toBe(RATE_LIMIT_PER_MINUTE + 1);
  });

  it("real and test credentials of one business share the budget; another business has its own", async () => {
    const a = await seedBusiness();
    const b = await seedBusiness({ email: "otro@business.mx" });
    const real = (await issueCredential(db(), a.id, { name: "real" })).plaintext;
    const test = (await issueCredential(db(), a.id, { name: "test", isTest: true })).plaintext;
    const theirs = (await issueCredential(db(), b.id, { name: "k" })).plaintext;
    const { r } = harness({ now: () => new Date(Date.UTC(2026, 8, 17, 12, 0, 59)) });
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE / 2; i++) {
      expect((await r.request("/whoami", bearer(real), env)).status).toBe(200);
      expect((await r.request("/whoami", bearer(test), env)).status).toBe(200);
    }
    expect((await r.request("/whoami", bearer(test), env)).status).toBe(429);
    expect((await r.request("/whoami", bearer(real), env)).status).toBe(429);
    expect((await r.request("/whoami", bearer(theirs), env)).status).toBe(200);
  });

  it("the next minute is a fresh bucket", async () => {
    const business = await seedBusiness();
    const { plaintext } = await issueCredential(db(), business.id, { name: "k" });
    let minute = 0;
    const { r } = harness({ now: () => new Date(Date.UTC(2026, 8, 17, 12, minute, 0)) });
    for (let i = 0; i <= RATE_LIMIT_PER_MINUTE; i++) await r.request("/whoami", bearer(plaintext), env);
    expect((await r.request("/whoami", bearer(plaintext), env)).status).toBe(429);
    minute = 1;
    expect((await r.request("/whoami", bearer(plaintext), env)).status).toBe(200);
  });
});

describe("D14 / FR-008: Idempotency-Key replays the first response verbatim", () => {
  const post = (key: string, body: unknown, idem?: string) => ({
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) },
    body: JSON.stringify(body),
  });

  it("the second request with the same key runs no handler and returns the first body and status", async () => {
    const business = await seedBusiness();
    const { plaintext } = await issueCredential(db(), business.id, { name: "k" });
    const { r, calls } = harness();
    const first = await r.request("/create", post(plaintext, {}, "req-1"), env);
    expect(first.status).toBe(201);
    const firstBody = await first.text();

    const second = await r.request("/create", post(plaintext, {}, "req-1"), env);
    expect(second.status).toBe(201);
    expect(await second.text()).toBe(firstBody);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(calls()).toBe(1);

    /* a different key is a different request */
    const third = await r.request("/create", post(plaintext, {}, "req-2"), env);
    expect((await third.json()).data.id).toBe("created-2");
    expect(await db().select().from(idempotencyKeys)).toHaveLength(2);
  });

  it("a refusal is remembered too — the case that otherwise duplicates on a retried network failure", async () => {
    const business = await seedBusiness();
    const { plaintext } = await issueCredential(db(), business.id, { name: "k" });
    const { r, calls } = harness();
    const first = await r.request("/create", post(plaintext, { fail: true }, "bad-1"), env);
    expect(first.status).toBe(400);
    const replay = await r.request("/create", post(plaintext, { fail: true }, "bad-1"), env);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error.code).toBe("VALIDATION_ERROR");
    expect(calls()).toBe(1);
  });

  it("keys are per business: the same string from another business is a fresh request", async () => {
    const a = await seedBusiness();
    const b = await seedBusiness({ email: "otro@business.mx" });
    const ka = (await issueCredential(db(), a.id, { name: "k" })).plaintext;
    const kb = (await issueCredential(db(), b.id, { name: "k" })).plaintext;
    const { r, calls } = harness();
    await r.request("/create", post(ka, {}, "shared"), env);
    await r.request("/create", post(kb, {}, "shared"), env);
    expect(calls()).toBe(2);
  });

  it("without the header nothing is stored; an oversized key is a VALIDATION_ERROR", async () => {
    const business = await seedBusiness();
    const { plaintext } = await issueCredential(db(), business.id, { name: "k" });
    const { r, calls } = harness();
    await r.request("/create", post(plaintext, {}), env);
    await r.request("/create", post(plaintext, {}), env);
    expect(calls()).toBe(2);
    expect(await db().select().from(idempotencyKeys)).toHaveLength(0);
    const huge = await r.request("/create", post(plaintext, {}, "x".repeat(256)), env);
    expect(huge.status).toBe(400);
    expect((await huge.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

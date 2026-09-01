import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull } from "drizzle-orm";
import { apiKeys } from "../../db/schema";
import { generateApiKey, hashApiKey } from "../../auth/api-key";
import type { Bindings, Variables } from "../../env";

/* Key issuance (spec D5, amended by payments-and-classes D7). Two
   doors: CONSTA_ADMIN_TOKEN opens everything; CONSTA_ISSUER_TOKEN opens
   ONLY the POST — the SaaS can mint keys for its businesses and nothing
   else (handing it the admin token made a compromised SaaS the admin of
   every Consta tenant, external customers included). With every allowed
   secret unset a route doesn't exist, so a misconfigured deploy exposes
   nothing. */
export const adminKeysRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const guardedBy = (
  allow: (env: Bindings) => (string | undefined)[],
): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> => {
  return async (c, next) => {
    const tokens = allow(c.env).filter((t): t is string => Boolean(t));
    if (!tokens.length) return c.notFound();
    const auth = c.req.header("Authorization");
    if (!tokens.some((t) => auth === `Bearer ${t}`)) {
      return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR", retryable: false } }, 401);
    }
    await next();
  };
};

adminKeysRoute.post(
  "/",
  guardedBy((env) => [env.CONSTA_ADMIN_TOKEN, env.CONSTA_ISSUER_TOKEN]),
  zValidator("json", z.object({ name: z.string().min(1) }), (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", retryable: false } }, 400);
    }
  }),
  async (c) => {
    const { name } = c.req.valid("json");
    const key = generateApiKey();
    const db = drizzle(c.env.DB);
    const [row] = await db
      .insert(apiKeys)
      .values({ name, keyHash: await hashApiKey(key) })
      .returning({ id: apiKeys.id, name: apiKeys.name });
    /* The plaintext key exists only in this response (spec D5) */
    return c.json({ success: true, data: { id: row.id, name: row.name, key } });
  },
);

/* Revocation stays the admin's alone (D7): the issue-only door must not
   be able to 401 another tenant's traffic. */
adminKeysRoute.delete("/:id", guardedBy((env) => [env.CONSTA_ADMIN_TOKEN]), async (c) => {
  const db = drizzle(c.env.DB);
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, c.req.param("id")), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  if (!revoked.length) {
    return c.json({ success: false, error: { code: "NOT_FOUND", retryable: false } }, 404);
  }
  return c.json({ success: true, data: { id: revoked[0].id } });
});

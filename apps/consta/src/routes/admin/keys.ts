import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull } from "drizzle-orm";
import { apiKeys } from "../../db/schema";
import { generateApiKey, hashApiKey } from "../../auth/api-key";
import type { Bindings, Variables } from "../../env";

/* Manual key issuance (spec D5). Guarded by CONSTA_ADMIN_TOKEN; with the
   secret unset the routes don't exist, so a misconfigured deploy exposes
   nothing. */
export const adminKeysRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

adminKeysRoute.use("*", async (c, next) => {
  const secret = c.env.CONSTA_ADMIN_TOKEN;
  if (!secret) return c.notFound();
  if (c.req.header("Authorization") !== `Bearer ${secret}`) {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401);
  }
  await next();
});

adminKeysRoute.post(
  "/",
  zValidator("json", z.object({ name: z.string().min(1) }), (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
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

adminKeysRoute.delete("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, c.req.param("id")), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  if (!revoked.length) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  return c.json({ success: true, data: { id: revoked[0].id } });
});

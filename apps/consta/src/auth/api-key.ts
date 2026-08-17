import type { Context, Next } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull } from "drizzle-orm";
import { apiKeys } from "../db/schema";
import type { Bindings, Variables } from "../env";

/* Keys look like ck_<32 hex>. Only their SHA-256 is stored (spec D5). */

export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `ck_${hex}`;
}

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function requireApiKey(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next,
) {
  const header = c.req.header("Authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!key.startsWith("ck_")) {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401);
  }
  const keyHash = await hashApiKey(key);
  const db = drizzle(c.env.DB);
  const [row] = await db
    .select({ id: apiKeys.id, name: apiKeys.name })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)));
  if (!row) {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401);
  }
  c.set("apiKey", row);
  await next();
}

import { and, eq, gt, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";
import type { Bindings, Variables } from "../env";
import { rateLimit } from "../db/schema";

/* The limiter for OUR routes (better-auth.spec.md D15). Better Auth's
   limiter covers only its own handler; a Hono route that calls Better
   Auth server-side skips it — signup, and the invitation doors, had no
   tope at all. Same table, same window/max semantics, same off switch
   (the API test suite pins AUTH_RATE_LIMIT=off); keys carry a `hono:`
   prefix so they never collide with the plugin's. */

export function rateLimitRoute(name: string, rule: { window: number; max: number }) {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    if (c.env.AUTH_RATE_LIMIT === "off") return next();
    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "no-ip";
    const key = `${ip}|hono:${name}`;
    const now = Date.now();
    const windowStart = now - rule.window * 1000;
    const db = drizzle(c.env.DB);

    /* One atomic step: bump the row if it is inside the window and below
       the max; else start a fresh window; else refuse. */
    const bumped = await db
      .update(rateLimit)
      .set({ count: sql`${rateLimit.count} + 1`, lastRequest: now })
      .where(and(eq(rateLimit.key, key), gt(rateLimit.lastRequest, windowStart), lt(rateLimit.count, rule.max)))
      .returning({ id: rateLimit.id });
    if (bumped.length) return next();

    const reset = await db
      .update(rateLimit)
      .set({ count: 1, lastRequest: now })
      .where(and(eq(rateLimit.key, key), lt(rateLimit.lastRequest, windowStart + 1)))
      .returning({ id: rateLimit.id });
    if (reset.length) return next();

    const [existing] = await db.select().from(rateLimit).where(eq(rateLimit.key, key));
    if (!existing) {
      await db.insert(rateLimit).values({ id: crypto.randomUUID(), key, count: 1, lastRequest: now });
      return next();
    }
    const retryAfter = Math.ceil((existing.lastRequest + rule.window * 1000 - now) / 1000);
    c.header("X-Retry-After", String(Math.max(retryAfter, 1)));
    return c.json({ success: false, error: { code: "TOO_MANY_REQUESTS" } }, 429);
  });
}

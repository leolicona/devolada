import type { MiddlewareHandler } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { idempotencyKeys, rateCounters } from "../../db/schema";
import { looksLikeApiKey } from "../../api-clients/credentials";
import { resolveCredential, touchCredential } from "../../api-clients/store";
import { isUniqueViolation } from "../../direct-payments/validation";
import { fail } from "./envelope";

/* The three things every /v1 request passes through before an area's
   handler runs (research D11, D13, D14). Each is a plain Hono middleware
   the pure routers compose (constitution III); none holds logic an area
   needs to know about. */

type Env = { Bindings: Bindings; Variables: Variables };

/* automated-collections-api D11 (FR-002, FR-005): resolve `Authorization:
   Bearer dk_…` to exactly one business. A missing, malformed, unknown or
   revoked credential gets the same answer, with nothing in it — the
   caller must not learn whether the business, the reference or the
   payment exists. A suspended business is refused on every /v1 request,
   the same gate the payer's page already enforces (D15): the admissions
   policy the developer left open on 2026-09-12 needs no data here, only
   an endpoint to flip `businesses.status` later. */
export const requireApiCredential: MiddlewareHandler<Env> = async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!looksLikeApiKey(key)) return fail(c, "AUTHENTICATION_ERROR");

  const db = drizzle(c.env.DB);
  const resolved = await resolveCredential(db, key);
  if (!resolved) return fail(c, "AUTHENTICATION_ERROR");
  const { credential, business } = resolved;
  if (business.status === "suspended") return fail(c, "BUSINESS_SUSPENDED");

  await touchCredential(db, credential.id, new Date());
  c.set("apiClient", {
    type: "api",
    credentialId: credential.id,
    businessId: business.id,
    isTest: credential.isTest,
    business,
  });
  await next();
};

/* automated-collections-api D12 (FR-034): the test-mode door exists
   only for a test credential. A real one is told NOT_FOUND — not
   AUTHENTICATION_ERROR, not VALIDATION_ERROR — because for it the route
   does not exist (contracts/public-api.md), and nothing a real
   credential sends may move a real payment by pretending to be a test. */
export const requireTestCredential: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get("apiClient").isTest) return fail(c, "NOT_FOUND");
  await next();
};

/* automated-collections-api D13 (FR-024): 120 requests per minute per
   business, every /v1 endpoint counted together, real and test
   credentials sharing the one budget — the limit protects the platform
   from one business's traffic, and test traffic is that business's
   traffic. Two a second is far above what a billing run needs and far
   below what a looping integration would cost (set by the developer,
   2026-09-17). */
export const RATE_LIMIT_PER_MINUTE = 120;

const MINUTE_MS = 60_000;

/* One upsert per request on the `(business_id, bucket)` row — the house
   pattern of counting in D1, and the one a test can assert on real D1.
   The request that takes the count past the budget is the first refused;
   the counter keeps counting past it, so the refusal holds until the
   minute rolls over. `Retry-After` is the rest of the current minute in
   seconds, so a caller can tell a limit from an outage. The clock is
   injectable so a test can sit inside one bucket. */
export function rateLimit(opts: { now?: () => Date } = {}): MiddlewareHandler<Env> {
  const clock = opts.now ?? (() => new Date());
  return async (c, next) => {
    const { businessId } = c.get("apiClient");
    const now = clock().getTime();
    const bucket = Math.floor(now / MINUTE_MS);
    const db = drizzle(c.env.DB);
    const [row] = await db
      .insert(rateCounters)
      .values({ businessId, bucket, count: 1 })
      .onConflictDoUpdate({
        target: [rateCounters.businessId, rateCounters.bucket],
        set: { count: sql`${rateCounters.count} + 1` },
      })
      .returning({ count: rateCounters.count });
    if (row.count > RATE_LIMIT_PER_MINUTE) {
      const secondsLeft = Math.max(1, Math.ceil(((bucket + 1) * MINUTE_MS - now) / 1000));
      c.header("Retry-After", String(secondsLeft));
      return fail(c, "RATE_LIMITED");
    }
    await next();
  };
}

/* automated-collections-api D14 (FR-008): a POST carrying
   `Idempotency-Key` is answered once; a repeat with the same key, from the
   same business, replays the first response verbatim — status and body —
   whatever it was. A refusal is remembered too: that is the case that
   otherwise creates duplicates on a retried network failure. Keys live
   24 h and are swept by the cron. Without the header nothing here runs. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export const idempotent: MiddlewareHandler<Env> = async (c, next) => {
  const key = c.req.header(IDEMPOTENCY_KEY_HEADER);
  if (key === undefined) return next();
  if (key.length === 0 || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return fail(c, "VALIDATION_ERROR", `${IDEMPOTENCY_KEY_HEADER} must be 1–${IDEMPOTENCY_KEY_MAX_LENGTH} characters`);
  }
  const { businessId } = c.get("apiClient");
  const db = drizzle(c.env.DB);

  const [stored] = await db
    .select({ response: idempotencyKeys.response, statusCode: idempotencyKeys.statusCode })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.businessId, businessId), eq(idempotencyKeys.key, key)));
  if (stored) {
    return new Response(stored.response, {
      status: stored.statusCode,
      headers: { "Content-Type": "application/json", "Idempotency-Replayed": "true" },
    });
  }

  await next();

  /* Store what was actually sent, after the handler ran. Two identical
     requests racing past the read above both run the handler; the second
     insert loses the unique index and its own response stands — at pilot
     scale the reusable-link create is already idempotent by D4, and a
     placeholder row per key would cost every caller a write to save a
     race nobody has hit. Measured when it is. */
  const response = c.res.clone();
  const body = await response.text();
  try {
    await db
      .insert(idempotencyKeys)
      .values({ businessId, key, response: body, statusCode: response.status });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
};

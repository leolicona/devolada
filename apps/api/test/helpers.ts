import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { isps, stores } from "../src/db/schema";

export const AUTH_ORIGIN = "https://agnostic-auth.leolicona-dev.workers.dev";

/* The Hono app, not the worker default export (which also carries
   the cron `scheduled` handler). */
export const app = async () => (await import("../src/index")).app;

/* Unsigned but well-formed JWT: dev mode (no AUTH_JWT_SECRET) decodes
   without verifying the signature, exactly like the middleware documents. */
export function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

export function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 600;
}

export const idpTokens = (identity: string) => ({
  jwt: makeJwt({ identity, exp: futureExp() }),
  refreshToken: `rt-${identity}`,
});

/* Intercepts one IdP call, honoring the real contract shapes documented
   in docs/integrations/agnostic-auth.md (TESTING.md rule 5). */
export function mockIdp(
  path: string,
  reply: { status?: number; body: unknown },
  times = 1,
) {
  fetchMock
    .get(AUTH_ORIGIN)
    .intercept({ method: "POST", path })
    .reply(reply.status ?? 200, JSON.stringify(reply.body), {
      headers: { "Content-Type": "application/json" },
    })
    .times(times);
}

export const idpError = (code: string, message?: string) => ({
  success: false,
  error: code,
  ...(message ? { message } : {}),
});

export async function seedIsp(overrides: Partial<typeof isps.$inferInsert> = {}) {
  const db = drizzle(env.DB);
  const [isp] = await db
    .insert(isps)
    .values({
      name: "ISP Demo",
      email: "demo@devolada.app",
      emailVerified: true,
      passwordHash: "hash",
      passwordSalt: "salt",
      ...overrides,
    })
    .returning();
  return isp;
}

export async function seedStore(
  ispId: string,
  overrides: Partial<typeof stores.$inferInsert> = {},
) {
  const db = drizzle(env.DB);
  const [store] = await db
    .insert(stores)
    .values({
      ispId,
      name: "Abarrotes La Esquina",
      contactName: "Don Chuy",
      phone: "5512345678",
      passwordHash: "hash",
      passwordSalt: "salt",
      status: "active",
      ...overrides,
    })
    .returning();
  return store;
}

export function cookiesOf(res: Response): string[] {
  return res.headers.getSetCookie();
}

export function sessionCookieHeader(identity: string): string {
  return `gm_access=${makeJwt({ identity, exp: futureExp() })}`;
}

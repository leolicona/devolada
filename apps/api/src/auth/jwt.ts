import { decode, verify } from "hono/jwt";
import type { Bindings } from "../env";

export type Payload = { identity?: string; sub?: string; exp?: number };

/* With AUTH_JWT_SECRET verifies the HS256 signature; without it (dev only)
   decodes and checks expiry manually. */
export async function readPayload(jwt: string, env: Bindings): Promise<Payload | null> {
  try {
    if (env.AUTH_JWT_SECRET) {
      return (await verify(jwt, env.AUTH_JWT_SECRET, "HS256")) as Payload;
    }
    console.warn("AUTH_JWT_SECRET missing: JWT decoded without signature verification (dev only)");
    const { payload } = decode(jwt);
    const p = payload as Payload;
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

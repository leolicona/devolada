import type { Context } from "hono";
import type { Bindings, Variables } from "../../../env";
import { publicKeySet } from "../../../webhooks/sign";
import type { Jwks } from "../webhook/schema";

/* GET /.well-known/jwks.json (automated-collections-api D10, FR-015,
   FR-039): Devolada's public signing keys, in the JSON Web Key Set
   shape every JOSE library reads. No credential, no business data, one
   set for the platform. Cacheable for five minutes: a caller that meets
   a `kid` it does not have re-fetches once, so a rotation propagates
   within that window without anybody doing anything. Empty when the
   secret is unset (constitution VIII) — honest, not a 500. */
export const JWKS_MAX_AGE_SECONDS = 300;

export function getJwks(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const body: Jwks = publicKeySet(c.env, new Date());
  c.header("Cache-Control", `public, max-age=${JWKS_MAX_AGE_SECONDS}`);
  return c.json(body);
}

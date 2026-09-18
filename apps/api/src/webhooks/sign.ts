import type { Bindings } from "../env";

/* Webhook signatures (automated-collections-api D10, FR-015, FR-039):
   every delivery is signed with Devolada's OWN private key — ECDSA
   P-256 with SHA-256, `ES256` — over the string `"<timestamp>.<raw
   body>"`, and names the key by its `kid`. The public halves are
   published as a JSON Web Key Set at GET /.well-known/jwks.json, one set
   for the whole platform. The business holds no secret: nothing it
   stores, and nothing that could leak from it, can forge a message.

   The private keys live in the Worker secret WEBHOOK_SIGNING_KEYS — a
   JSON array of private JWKs, each with a `kid` and an optional
   `retiredAt`. The one without `retiredAt` is active; the others are
   retired and stay published for KEY_RETENTION_DAYS so a delivery signed
   before a rotation still verifies. WebCrypto does the signing — native
   in workerd, no dependency. */

export type SigningKey = {
  kid: string;
  privateJwk: JsonWebKey;
  retiredAt: Date | null;
};

/* Public JWK as every JOSE library reads it. `x`/`y` are the point; the
   private scalar `d` and WebCrypto's own `key_ops`/`ext` never travel. */
export type PublicJwk = {
  kty: "EC";
  crv: "P-256";
  alg: "ES256";
  use: "sig";
  kid: string;
  x: string;
  y: string;
};

/* D10: the retry schedule ends 5 h 21 min after the first attempt, and a
   caller that caches the set for five minutes needs the old `kid` to
   keep resolving well past that. Seven days is the safe margin — chosen,
   not measured; a caller that meets an unknown `kid` re-fetches once. */
export const KEY_RETENTION_DAYS = 7;

/* The error a delivery row carries while the platform has no key
   (constitution VIII): recorded, never attempted, retried once the
   secret lands. */
export const SIGNING_KEY_MISSING = "SIGNING_KEY_MISSING";

const RETENTION_MS = KEY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/* Parse the secret. Malformed input is a deploy mistake, not a runtime
   condition — it is logged once and treated exactly like "unset", so a
   bad paste degrades to SIGNING_KEY_MISSING rather than throwing inside
   a sweep. */
export function parseSigningKeys(env: Pick<Bindings, "WEBHOOK_SIGNING_KEYS">): SigningKey[] {
  const raw = env.WEBHOOK_SIGNING_KEYS;
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("WEBHOOK_SIGNING_KEYS is not valid JSON; signing is off");
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.error("WEBHOOK_SIGNING_KEYS must be a JSON array of private JWKs; signing is off");
    return [];
  }
  const keys: SigningKey[] = [];
  for (const entry of parsed) {
    if (!isPrivateEcJwk(entry)) {
      console.error("WEBHOOK_SIGNING_KEYS entry skipped: not a P-256 private JWK with a kid");
      continue;
    }
    const { retiredAt, ...privateJwk } = entry;
    const retired = retiredAt === undefined || retiredAt === null ? null : new Date(retiredAt);
    if (retired && Number.isNaN(retired.getTime())) {
      console.error(`WEBHOOK_SIGNING_KEYS entry ${entry.kid} skipped: retiredAt is not a date`);
      continue;
    }
    keys.push({ kid: entry.kid, privateJwk, retiredAt: retired });
  }
  return keys;
}

type PrivateEcJwkEntry = JsonWebKey & { kid: string; x: string; y: string; d: string; retiredAt?: string | number | null };

function isPrivateEcJwk(entry: unknown): entry is PrivateEcJwkEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const jwk = entry as Record<string, unknown>;
  return (
    jwk.kty === "EC" &&
    jwk.crv === "P-256" &&
    typeof jwk.kid === "string" &&
    jwk.kid.length > 0 &&
    typeof jwk.x === "string" &&
    typeof jwk.y === "string" &&
    typeof jwk.d === "string"
  );
}

/* The key that signs now: the one without `retiredAt`. Two active keys
   is a misconfiguration; the first listed wins, deterministically, so a
   caller never sees the `kid` flip between deliveries. */
export function activeSigningKey(keys: SigningKey[]): SigningKey | null {
  return keys.find((key) => key.retiredAt === null) ?? null;
}

/* The published set: the active key and every key retired less than
   KEY_RETENTION_DAYS ago (FR-039). Empty when the secret is unset. */
export function publicKeySet(env: Pick<Bindings, "WEBHOOK_SIGNING_KEYS">, now: Date): { keys: PublicJwk[] } {
  const keys = parseSigningKeys(env)
    .filter((key) => key.retiredAt === null || now.getTime() - key.retiredAt.getTime() < RETENTION_MS)
    .map(toPublicJwk);
  return { keys };
}

export function toPublicJwk(key: SigningKey): PublicJwk {
  return {
    kty: "EC",
    crv: "P-256",
    alg: "ES256",
    use: "sig",
    kid: key.kid,
    x: key.privateJwk.x as string,
    y: key.privateJwk.y as string,
  };
}

/* What travels in the delivery's headers (contracts/public-api.md): the
   signed string is `"<timestamp>.<raw body>"`, the signature is the raw
   `r || s` WebCrypto produces — the same 64 bytes JOSE's ES256 carries
   — encoded base64url without padding. */
export type DeliverySignature = { kid: string; signature: string };

export async function signDelivery(
  env: Pick<Bindings, "WEBHOOK_SIGNING_KEYS">,
  timestamp: number,
  rawBody: string,
): Promise<DeliverySignature | null> {
  const key = activeSigningKey(parseSigningKeys(env));
  if (!key) return null;
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { ...key.privateJwk, key_ops: ["sign"], ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  return { kid: key.kid, signature: base64url(new Uint8Array(signed)) };
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

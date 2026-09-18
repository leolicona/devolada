/* The API credential's shape (automated-collections-api D11): `dk_<32 hex>`,
   compared only ever by its SHA-256, shown in plaintext once at issuance,
   revoked by timestamp — the pattern of the engine's former
   `apps/consta/src/auth/api-key.ts` (`ck_`, deleted by consta-api-merge),
   now the rule of constitution Principle V for any credential the product
   only compares.

   Why ours is hashed while the provider keys are not: the WispHub key on
   `integrations` and the provider token in the environment are
   credentials Devolada must *send* to someone, so they are stored as they
   are. A `dk_` key is only ever presented *to* Devolada and compared, so
   the plaintext has no reason to exist anywhere but in the caller's
   hands — a leaked table yields hashes nobody can present. */

export const API_KEY_PREFIX = "dk_";

/* 16 random bytes → 32 hex characters: 128 bits, the same width the
   engine's keys carried */
const API_KEY_HEX_LENGTH = 32;

const API_KEY_PATTERN = new RegExp(`^${API_KEY_PREFIX}[0-9a-f]{${API_KEY_HEX_LENGTH}}$`);

export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(API_KEY_HEX_LENGTH / 2));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${API_KEY_PREFIX}${hex}`;
}

/* Cheap shape check before any hashing or query (FR-005): a header that
   is not even a key is refused with the same answer as an unknown one. */
export function looksLikeApiKey(candidate: string): boolean {
  return API_KEY_PATTERN.test(candidate);
}

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* FR-003: enough of the key to recognise which one, never enough to use
   it — the last four hex characters, 16 bits of a 128-bit key. */
export const KEY_TAIL_LENGTH = 4;

export function keyTail(key: string): string {
  return key.slice(-KEY_TAIL_LENGTH);
}

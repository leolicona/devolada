import type { Bindings } from "../env";

/* Proof storage (direct-payment spec D12). Proofs live in a private R2
   bucket; there is no public URL. What leaves the system is a
   short-lived HMAC-signed URL on this API, built only when Consta needs
   to fetch the image — the same posture as the provider's own 15-day
   download links. */

export const PROOF_MAX_BYTES = 1_000_000; /* apiCEP's own limit */
export const PROOF_URL_TTL_MINUTES = 15;

/* Keys are namespaced by link id, so a pay request can only reference
   proofs uploaded through its own link — no cross-link smuggling. */
export function makeProofKey(linkId: string): string {
  return `${linkId}/${crypto.randomUUID()}`;
}

export function proofBelongsToLink(proofKey: string, linkId: string): boolean {
  return proofKey.startsWith(`${linkId}/`);
}

/* Signing rides the auth secret: one secret to rotate, and CI already
   refuses to deploy prod without it. */
function signingSecret(env: Bindings): string {
  return env.BETTER_AUTH_SECRET ?? "devolada-dev-only-insecure-secret";
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signedProofUrl(
  env: Bindings,
  proofKey: string,
  now: Date,
): Promise<string> {
  const exp = now.getTime() + PROOF_URL_TTL_MINUTES * 60 * 1000;
  const sig = await hmacHex(signingSecret(env), `${proofKey}:${exp}`);
  const base = env.API_BASE_URL ?? "http://localhost:8787";
  return `${base}/direct-payments/proofs/${proofKey}?exp=${exp}&sig=${sig}`;
}

export async function verifyProofUrl(
  env: Bindings,
  proofKey: string,
  exp: string,
  sig: string,
  now: Date,
): Promise<boolean> {
  const expMs = Number.parseInt(exp, 10);
  if (!Number.isFinite(expMs) || expMs < now.getTime()) return false;
  const expected = await hmacHex(signingSecret(env), `${proofKey}:${expMs}`);
  /* Same length always (hex sha256); a plain compare is fine for a
     15-minute, single-purpose URL */
  return sig === expected;
}

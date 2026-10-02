import { authClient } from "@/lib/auth-client";
import { ApiError } from "@/lib/api";

/* What a WebAuthn ceremony came to, in the product's words (passwordless-
   access D7, D8) — the panel's mapping (apps/admin/src/features/auth/
   keys.ts), with the store's key name. The Better Auth client never throws:
   it answers `{ error: { code } }`, with @simplewebauthn's codes for what
   the browser said. Read in @better-auth/passkey 1.6.29's `client.mjs` on
   2026-10-02:
   - `InvalidStateError` (the plugin's `excludeCredentials` met a key this
     device already holds) arrives as ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED,
     and counts as done: "Este teléfono ya tiene tu huella o rostro.";
   - a session older than a day gets SESSION_NOT_FRESH from the options
     request (D8, measured 2026-10-02, M2), which Caja's step-up answers;
   - everything else — `NotAllowedError` (cancelled, timed out), a sensor
     that failed — is the one-line failure (FR-009).
   A thrown DOMException is read the same way, so a test double that throws
   what the browser throws lands where the real client's answer does. */
export type Activation = "done" | "alreadyEnrolled" | "notFresh" | "failed";

const outcomeOf = (code: string | undefined, name?: string): Activation => {
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" || name === "InvalidStateError") return "alreadyEnrolled";
  if (code === "SESSION_NOT_FRESH") return "notFresh";
  return "failed";
};

/* Runs the ceremony. Call it straight from the click handler: Safari refuses
   a WebAuthn call that is not inside a user gesture (D7). Keys stay named
   "Tienda" (D10, cash-at-stores D26): it is also the account name the store
   phone's picker shows. */
export async function activateKey(): Promise<Activation> {
  try {
    const result = await authClient.passkey.addPasskey({ name: "Tienda" });
    if (!result?.error) return "done";
    return outcomeOf((result.error as { code?: string }).code);
  } catch (e) {
    return outcomeOf(undefined, e instanceof Error ? e.name : undefined);
  }
}

/* The sign-in with a key: true when a session opened (FR-011). A cancel or
   a key the server no longer knows (removed in Caja, FR-036) is false, and
   the screen offers the código (FR-012). */
export async function signInWithKey(): Promise<boolean> {
  try {
    const result = await authClient.signIn.passkey();
    return !result?.error;
  } catch {
    return false;
  }
}

/* passwordless-access FR-027: the limiter's 429 is a wait, not a wrong
   código. INVALID_OTP, OTP_EXPIRED and TOO_MANY_ATTEMPTS (403, the código's
   own death after three tries) read alike: a dead código
   (contracts/store-access.md). A lost signal is said as such, never as a
   wrong código (cash-at-stores T074). */
export type AccessProblem = "tooMany" | "code" | "offline" | "other";
export function accessProblem(e: unknown): AccessProblem {
  if (!(e instanceof ApiError)) return "other";
  if (e.status === 429) return "tooMany";
  if (e.code === "NETWORK_ERROR") return "offline";
  if (/OTP|ATTEMPTS/.test(e.code)) return "code";
  return "other";
}

export const TOO_MANY = "Demasiados intentos. Espera un momento e intenta de nuevo.";
/* The store's own words for it, as the design canvas draws them */
export const CODE_REFUSED = "El código no es válido o ya venció. Pide uno nuevo.";
export const OFFLINE = "Sin conexión. Revisa tu internet e intenta de nuevo.";

/* The line a request that sends a código shows when it fails */
export function sendProblemLine(e: unknown): string {
  const problem = accessProblem(e);
  if (problem === "tooMany") return TOO_MANY;
  if (problem === "offline") return OFFLINE;
  return "No pudimos enviar el código. Intenta de nuevo.";
}

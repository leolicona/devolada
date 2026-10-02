import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { API_BASE as BASE } from "./base";

/* Better Auth client, used ONLY for the passkey ceremonies (US-S07):
   WebAuthn needs the option/attestation dance the plugin implements.
   Everything else keeps going through lib/api.ts. */

export const authClient = createAuthClient({
  baseURL: `${BASE || window.location.origin}/auth`,
  fetchOptions: { credentials: "include" },
  plugins: [passkeyClient()],
});

/* passwordless-access D7: the browser supports passkeys. It decides the
   "Entrar con huella o rostro" button — the browser can reach a phone
   nearby or a synced key even when this computer has no sensor (FR-016). */
export const passkeysSupported = () =>
  typeof window !== "undefined" && Boolean(window.PublicKeyCredential);

/* passwordless-access D7: the device can verify the person itself — Touch
   ID, Face ID, Windows Hello, an Android phone's lock. It decides the
   activation step, which `window.PublicKeyCredential` alone cannot: on a
   desktop without a built-in authenticator the browser would open a window
   asking for a phone or a security key in the middle of a registration.
   Asked once per page load; any missing piece, or a throw, is a no. */
let verifyingPlatform: Promise<boolean> | null = null;
export function canVerifyPerson(): Promise<boolean> {
  if (!verifyingPlatform) {
    verifyingPlatform = (async () => {
      try {
        const pkc = typeof window !== "undefined" ? window.PublicKeyCredential : undefined;
        if (!pkc || typeof pkc.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return false;
        return await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
      } catch {
        return false;
      }
    })();
  }
  return verifyingPlatform;
}

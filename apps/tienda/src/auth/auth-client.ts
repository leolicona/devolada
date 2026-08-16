import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { API_BASE as BASE } from "../api/base";

/* Better Auth client, used ONLY for the passkey ceremonies (US-S07):
   WebAuthn needs the option/attestation dance the plugin implements.
   Everything else keeps going through api/client.ts. */

export const authClient = createAuthClient({
  baseURL: `${BASE || window.location.origin}/auth`,
  fetchOptions: { credentials: "include" },
  plugins: [passkeyClient()],
});

export const passkeysSupported = () =>
  typeof window !== "undefined" && Boolean(window.PublicKeyCredential);

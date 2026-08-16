/* Where the API lives, for both this app's fetch wrapper and the Better
   Auth client.

   The dev server cannot proxy the API: `/cashbox`, `/ledger` and
   `/charges/:id` are SPA routes AND API paths (router.tsx), so a
   same-origin base makes Vite answer them with index.html and every
   screen fails to load. In development the base is the local worker
   instead — `ALLOWED_ORIGINS` already allow-lists this origin for CORS
   and for Better Auth's passkey origin check, and the session cookie is
   host-only on `localhost`, so it rides along across ports.

   Keyed on `development`, not on `DEV`: under vitest `DEV` is true too,
   and the component tests mock relative paths. Deployed builds get
   `VITE_API_URL` from the workflow (CICD.md). */

export const DEV_API_ORIGIN = "http://localhost:8787";

export function resolveApiBase(env: { VITE_API_URL?: string; MODE?: string }): string {
  return env.VITE_API_URL ?? (env.MODE === "development" ? DEV_API_ORIGIN : "");
}

export const API_BASE = resolveApiBase(import.meta.env);

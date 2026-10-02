/* Where the API lives, for the fetch wrapper and the Better Auth client
   (the admin's arrangement, `apps/admin/src/lib/base.ts`).

   No same-origin base in development: `/store/…` is an API path AND a
   name a SPA route could take, and Vite would answer it with
   index.html. The local worker allow-lists this origin
   (`ALLOWED_ORIGINS`, cash-at-stores D29), and the session cookie is
   host-only on `localhost`, so it rides along across ports.

   Keyed on `development`, not on `DEV`: under vitest `DEV` is true too,
   and the component tests mock relative paths. Deployed builds get
   `VITE_API_URL` from the workflow. */

export const DEV_API_ORIGIN = "http://localhost:8787";

export function resolveApiBase(env: { VITE_API_URL?: string; MODE?: string }): string {
  return env.VITE_API_URL ?? (env.MODE === "development" ? DEV_API_ORIGIN : "");
}

export const API_BASE = resolveApiBase(import.meta.env);

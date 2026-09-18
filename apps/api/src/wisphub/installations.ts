/* The installations WispHub runs, as a closed compiled-in list
   (provider-address-per-isp D1/D2/D3).

   WispHub is not one server. A tenant's key is valid only on the
   installation that issued it, so a perfectly good key is rejected
   against the wrong host — which is the whole of this feature: the
   address belongs to the business, not to the platform.

   D1: a business row stores a `key` from this list, never a URL. That is
   what makes FR-005 structural rather than a validation rule — a row
   cannot name a destination outside this file, so there is no string to
   sanitise and no allow-list to forget at one of the call sites. It also
   keeps the test suite's pinned origin meaningful (constitution IV): no
   database row can redirect a provider call somewhere the catalogue does
   not know.

   D2: hand-maintained and guarded by `test/installations.test.ts`, not
   generated. The precedent is `direct-payments/banks.ts`, and its reason
   (97 rows from an external source that changes without us) does not
   apply to three rows that change when the provider adds a deployment.

   D3: pure data and pure functions. The admin imports this to render the
   picker (`@devolada/api/installations`), so — exactly like
   `auth/role-matrix.ts`, and for the reason constitution V states — it
   must never pull `src/db`, `src/auth`, Hono or Drizzle. */

export type InstallationKey = "wisphub_net" | "wisphub_io" | "wisphub_sandbox";

export type Installation = {
  /* What a business row stores. Stable forever: renaming one is a data
     migration, so it is chosen once. */
  key: InstallationKey;
  /* es-MX, what the ISP recognises — where they sign in. Never an
     endpoint: the panel shows this and never the host. */
  label: string;
  /* The API base the adapter calls. Resolved, never stored on a row. */
  host: string;
  /* FR-007: the sandbox is marked, so a live business cannot choose it
     blind. */
  kind: "real" | "test";
  /* Exactly one entry. The answer for a business that recorded nothing
     and an environment that names nothing. */
  isDefault: boolean;
};

/* Hosts measured by DNS 2026-09-18 — each one its own machine:
   `.net` 192.241.208.217, `.io` 104.131.178.56, sandbox 174.138.57.55. */
export const INSTALLATIONS: readonly Installation[] = Object.freeze([
  {
    key: "wisphub_net",
    label: "wisphub.net",
    host: "https://api.wisphub.net/api",
    kind: "real",
    isDefault: true,
  },
  {
    /* The pilot's installation. Its host is **DNS-confirmed only**: no
       HTTP request has verified that it serves the provider's API, and
       the one probe that would (quickstart, "Before implementing") could
       not be made — the implementing session's egress refuses both
       provider hosts (research, T001/T002: `403 CONNECT`, no status
       code at all). One request with the pilot's real key retires this
       note; until then the entry is unverified, not wrong. */
    key: "wisphub_io",
    label: "wisphub.io",
    host: "https://api.wisphub.io/api",
    kind: "real",
    isDefault: false,
  },
  {
    /* WispHub's official sandbox, where a throwaway company can be
       created and keyed without touching anyone's real billing. There is
       no sandbox on the `.io` side. */
    key: "wisphub_sandbox",
    label: "Pruebas (sandbox)",
    host: "https://sandbox-api.wisphub.net/api",
    kind: "test",
    isDefault: false,
  },
]);

/* D1: an unknown key resolves to nothing rather than to a guess. The
   caller decides what absence means — `wisphubFor` reads it as "not
   chosen" and falls through to the default (constitution VIII: absent
   configuration degrades, never breaks). */
export function installationByKey(key: string): Installation | undefined {
  return INSTALLATIONS.find((installation) => installation.key === key);
}

export function defaultInstallation(): Installation {
  /* The invariant test asserts exactly one; this non-null is that
     assertion's dividend, not an assumption. */
  return INSTALLATIONS.find((installation) => installation.isDefault)!;
}

/* Whether a string may be written to `integrations.installation`
   (FR-005). The column is text and a future writer is not the panel. */
export function isInstallationKey(key: string): key is InstallationKey {
  return installationByKey(key) !== undefined;
}

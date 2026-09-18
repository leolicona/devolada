import { WispHub, type WispHubLimits } from "./client";
import {
  INSTALLATIONS,
  defaultInstallation,
  installationByKey,
  type Installation,
} from "./installations";

/* Every WispHub client in this codebase is built here
   (provider-address-per-isp D4).

   FR-003 says every provider exchange is addressed to that business's
   own installation. Eleven call sites each resolving the address
   themselves is eleven chances to miss one, and a missed one registers a
   payment on the wrong ISP's system — the failure SC-007 exists to make
   impossible. One factory turns that promise from a convention into a
   structure, and makes it a one-line audit, which is the "auditable with
   grep" constitution V asks for:

       grep -rn "new WispHub(" apps/api/src | grep -v wisphub/factory.ts

   `test/installation-isolation.test.ts` asserts that grep stays empty, so
   the twelfth call site cannot appear unnoticed. */

/* Only what the address is resolved from. Deliberately not `Integration`:
   the factory has no business reading a threshold or a switch, and a
   narrow shape lets the sweep pass the row it already loaded. */
export type WispHubAddress = { apiKey: string | null; installation: string | null };

type WispHubEnv = { WISPHUB_BASE_URL?: string };

/* D5: the resolution order, and the one rung that changed meaning.

     integration.installation  → the business's own choice
     env.WISPHUB_BASE_URL      → the platform DEFAULT for rows that chose
                                 nothing — no longer an override that
                                 every business inherits
     neither                   → wisphub.net

   D1 + constitution VIII: a stored key the catalogue does not know
   resolves to the default rather than throwing. A business cannot be
   locked out of its own panel by a key that was valid when it was
   written; the catalogue is what bounds where the call can land, and an
   unknown key names nothing, so nothing is where it points. */
export function hostFor(installation: string | null, env: WispHubEnv): string {
  const chosen = installation ? installationByKey(installation) : undefined;
  if (chosen) return chosen.host;
  /* Same value as `DEFAULT_BASE_URL` in client.ts — asserted by
     `test/installations.test.ts`, so the two cannot drift apart. */
  return env.WISPHUB_BASE_URL ?? defaultInstallation().host;
}

/* What the panel shows (FR-004): which installation is actually being
   called, and whether the business chose it or inherited it.

   The `assumed` case covers three things that are one thing to the ISP —
   no choice recorded, a choice the catalogue no longer knows, and a
   platform binding standing in. All three mean "nobody here picked
   this", which is what the screen has to say.

   A `WISPHUB_BASE_URL` pointing outside the catalogue can make this
   name the default while `hostFor` calls elsewhere. That gap is the
   stopgap binding itself (`.specify/debt/wisphub-host-is-platform-wide`),
   and it closes when the binding comes out — not by inventing a
   catalogue entry to describe it. */
export function effectiveInstallation(
  installation: string | null,
  env: WispHubEnv,
): { installation: Installation; assumed: boolean } {
  const chosen = installation ? installationByKey(installation) : undefined;
  if (chosen) return { installation: chosen, assumed: false };
  const fromEnv = env.WISPHUB_BASE_URL
    ? INSTALLATIONS.find((entry) => entry.host === env.WISPHUB_BASE_URL)
    : undefined;
  return { installation: fromEnv ?? defaultInstallation(), assumed: true };
}

/* The client for a business, addressed to that business's installation.

   `apiKey` is nullable because the row's is: every caller already guards
   on it ("no row, or a row with no key, is not connected"), and a client
   built without one degrades into the provider's own 401 rather than
   throwing somewhere the caller has no answer for (constitution VIII). */
export function wisphubFor(
  integration: WispHubAddress,
  env: WispHubEnv,
  limits?: Partial<WispHubLimits>,
): WispHub {
  return wisphubAt(integration.apiKey ?? "", integration.installation, env, limits);
}

/* The same resolution for a key and an installation that are **not yet
   saved** — the connection test, which is asked to prove a pairing
   before any row carries it (contracts/integrations.md). It is the one
   caller that cannot read `integration.installation`, which is why it
   gets a door of its own rather than a fake row. */
export function wisphubAt(
  apiKey: string,
  installation: string | null,
  env: WispHubEnv,
  limits?: Partial<WispHubLimits>,
): WispHub {
  return new WispHub(apiKey, hostFor(installation, env), limits);
}

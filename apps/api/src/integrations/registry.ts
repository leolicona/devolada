import type { Integration } from "./store";
import type { CapabilityName, IntegrationCapabilities } from "./capabilities";
import { WISPHUB_CAPABILITY_NAMES, wisphubCapabilities } from "../wisphub/receivables";

/* The core's one entry point to an adapter (constitution IX,
   cobros-in-links D18), and the only core file that imports one.

   It picks the adapter by `integration.provider` and returns what that
   adapter can do. A core route asks here, by capability, and never
   builds a provider's client itself:

       grep -rn "wisphub/" apps/api/src/routes/payment-requests

   finds nothing, and that is the audit. */

/* Only what an adapter needs to address its provider. The factory's own
   rule: it reads no threshold and no switch. Exported so a core module
   that asks for a capability types its env by this, never by a
   provider's binding (payment-without-receipt T060, constitution IX). */
export type RegistryEnv = { WISPHUB_BASE_URL?: string };

/* The integration's capabilities, ready to call. No integration, or a
   row with no credential, is "not connected" (integrations-hub D2) and
   can do nothing: `{}`. */
export function capabilitiesOf(integration: Integration | null, env: RegistryEnv): IntegrationCapabilities {
  if (!integration?.apiKey) return {};
  switch (integration.provider) {
    case "wisphub":
      return wisphubCapabilities(integration, env);
  }
  return {};
}

/* The same answer as names, with no network call and no client built,
   for the session (`/auth/me`, D13). It must agree with
   `capabilitiesOf` — both read the adapter's own list. */
export function capabilityNames(
  integration: Pick<Integration, "provider" | "apiKey"> | null,
): CapabilityName[] {
  if (!integration?.apiKey) return [];
  switch (integration.provider) {
    case "wisphub":
      return [...WISPHUB_CAPABILITY_NAMES];
  }
  return [];
}

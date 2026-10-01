import type { ActionAttempt, IntegrationCapabilities } from "../integrations/capabilities";
import { wisphubFor, type WispHubAddress } from "./factory";
import { attemptReconnection } from "./reconnection";

/* cash-at-stores D9: the WispHub adapter's side of `paymentActions` — the
   action half of the debt `core-reads-provider-directly`, paid. The two
   phases, the 422 reading, the auto-activate opt-in and the empty
   vehicle stay where they were measured (`reconnection.ts`); this file
   only speaks the core's words at the boundary. The core's three action
   call sites (the verdict, "Ejecutar ahora", the queue) and the store's
   record reach WispHub through here and nowhere else. */

type AdapterEnv = { WISPHUB_BASE_URL?: string };

/* The adapter's error vocabulary, in the core's two words (D9, and
   cobros-in-links D7's split: a refused key is setup, the rest is weather).
   NOT_ACTIVE_YET is not a failure of the provider and keeps its word. */
function coreError(error: "WISPHUB_AUTH_FAILED" | "WISPHUB_UNAVAILABLE" | "NOT_ACTIVE_YET" | null): ActionAttempt["error"] {
  if (error === "WISPHUB_AUTH_FAILED") return "INTEGRATION_AUTH_FAILED";
  if (error === "WISPHUB_UNAVAILABLE") return "INTEGRATION_UNAVAILABLE";
  return error;
}

export function paymentActions(
  integration: WispHubAddress,
  env: AdapterEnv,
): NonNullable<IntegrationCapabilities["paymentActions"]> {
  return {
    async attempt(input) {
      const result = await attemptReconnection(
        wisphubFor(integration, env),
        input.business,
        /* reconnection D8: the usuario for every lookup, the numeric id
           only for the auto-activate PATCH */
        { usuario: input.usuario, wisphubId: input.providerCustomerId },
        input.registeredCents,
        input.now,
        { invoiceId: input.invoiceId, paymentRegistered: input.paymentRegistered },
        input.reconnect,
      );
      return {
        status: result.status,
        paymentRegistered: result.paymentRegistered,
        invoiceId: result.invoiceId,
        error: coreError(result.error),
      };
    },
  };
}

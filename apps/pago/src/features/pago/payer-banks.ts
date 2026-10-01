import { BANKS } from "@devolada/api/direct-payments-schema";
import type { Bank } from "@devolada/api/direct-payments-schema";

/* confirmation-hierarchy D15 (spec FR-023): the banks a payer picks the
   bank they paid from — `BANKS` without Banxico, which holds no retail
   payer's account.

   A filter here, not an edit of the list: `banks.ts` is generated from
   the provider's own vocabulary (`scripts/gen-banks.mjs`, CI fails on
   drift) and the API validates every bank name against it, so Banxico
   stays there. The payer's page is the one place it must not be offered. */
export const payerBanks: readonly Bank[] = BANKS.filter((b) => b !== "BANXICO");

/* A draft or a status naming Banxico pre-selects nothing: the option is
   gone, and the payer picks again (spec Edge Cases) */
export function payerBank(bank: string | null | undefined): string {
  return bank && (payerBanks as readonly string[]).includes(bank) ? bank : "";
}

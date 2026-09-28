import { useQuery } from "@tanstack/react-query";
import type { CustomerDebtResponse } from "@devolada/api/direct-payments-schema";
import { api, ApiError } from "@/lib/api";

/* cobros-in-links US3 (D11): what one search result owes, asked row by
   row while the Por cobrar view is chosen.

   - One query per result row, keyed by usuario, fired only for the rows
     of the blocks that have loaded. Blocks are sized to the screen, so
     these are the rows on screen or one scroll away — which is how "N
     results, at most N debt reads" holds (SC-009).
   - Four at a time, at most. A block of up to 50 results is up to 100
     provider calls behind the door, and the cap keeps a large block from
     reaching the business's system as one burst. Its rate limits are
     unknown; four is the conservative guess.
   - An answer is reused for two minutes, the search results' own figure
     (links-on-demand-search FR-012). */

const DEBT_STALE_MS = 2 * 60_000;
export const DEBT_MAX_IN_FLIGHT = 4;

/* The gate. A finished request hands its slot straight to the next one
   waiting, so the count never passes the cap in the gap between one
   request ending and the next one starting. */
let inFlight = 0;
const waiting: (() => void)[] = [];

async function gated<T>(run: () => Promise<T>): Promise<T> {
  if (inFlight < DEBT_MAX_IN_FLIGHT) inFlight++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await run();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  }
}

/* Tests only: module state outlives a render, and a test starts from
   empty or it is not a test (constitution IV) */
export function resetDebtGateForTests(): void {
  inFlight = 0;
  waiting.length = 0;
}

export type DebtView = {
  /* `waiting` until the answer lands. An error that is not a refused key
     reads as `unconfirmed` — never as zero (FR-018). */
  state: "waiting" | "owes" | "none" | "unconfirmed";
  totalCents: number | null;
  /* The integration refused the business's key: the page switches to
     the setup message (D11, bug: links-refused-key) */
  refused: boolean;
};

export function useCustomerDebt(usuario: string | null, enabled: boolean): DebtView {
  const query = useQuery<CustomerDebtResponse, ApiError>({
    queryKey: ["customer-debt", usuario],
    queryFn: ({ signal }) =>
      gated(() => {
        /* A row that left the screen while it waited costs nothing */
        if (signal.aborted) throw new ApiError("ABORTED", 0);
        return api<CustomerDebtResponse>(
          `/direct-payments/customers/debt?usuario=${encodeURIComponent(usuario ?? "")}`,
          { signal },
        );
      }),
    enabled: enabled && usuario !== null,
    staleTime: DEBT_STALE_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (query.data) {
    return {
      state: query.data.state,
      totalCents: query.data.state === "owes" ? query.data.totalCents : null,
      refused: false,
    };
  }
  if (query.isError) {
    return {
      state: "unconfirmed",
      totalCents: null,
      refused: query.error.code === "INTEGRATION_AUTH_FAILED",
    };
  }
  return { state: "waiting", totalCents: null, refused: false };
}

import { useQuery } from "@tanstack/react-query";
import type { CashDropsResponse } from "@devolada/api/cash-drops-schema";
import { api, ApiError } from "@/lib/api";

/* D8: the sidebar badge and the screen share one query. Same key, so
   confirming a drop drops the badge at the same moment the card leaves.
   30s — a handover is not a live event like a charge (feed polls 5s). */
export const pendingDropsQuery = {
  queryKey: ["cash-drops", "pending"] as const,
  queryFn: () => api<CashDropsResponse>("/cash-drops?scope=pending"),
  refetchInterval: 30_000,
};

export function usePendingDropCount(): number {
  const { data } = useQuery<CashDropsResponse, ApiError>(pendingDropsQuery);
  return data?.drops.length ?? 0;
}

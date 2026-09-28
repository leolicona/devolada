import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { CobroRow, PaymentRequestsResponse } from "@devolada/api/payment-requests-schema";
import { api, ApiError } from "@/lib/api";
import { FOCUS_FLOOR_MS } from "@/lib/presence";
import { blockSize } from "./useCustomers";

/* cobros-in-links US1: the Por cobrar view of Links — the business's
   open invoices, read live from its integration one block at a time.

   It behaves exactly like the customer view (FR-003, FR-011): the first
   block is no larger than the screen, the next is asked for only when
   the operator scrolls toward it, the return to the tab re-reads the
   FIRST block above a 30-second floor, and nothing says how old the
   rows are. It never reads the sweep's copy — the door does not serve
   one (D3, SC-006). */

/* The same two minutes the customer view keeps an answer for
   (links-on-demand-search FR-012): switching to Todos and back inside
   them asks nothing. */
const RESULTS_STALE_MS = 2 * 60_000;

/* The view is in the key's name: this read only ever serves Por cobrar
   (D12), and the customer view's key carries its own */
const KEY = ["links-receivables"] as const;

/* One customer and the open invoices of theirs that have loaded — the
   spec's "Por cobrar row". The total and count cover what is on screen
   and grow when a later block brings more of theirs (FR-005). */
export type ReceivableGroup = {
  usuario: string;
  name: string;
  totalCents: number;
  /* Oldest issue first — the order the payer's page lists them */
  invoices: CobroRow[];
  /* The earliest due date among them, or null when none carries one */
  oldestDue: string | null;
  /* The earliest issue date, shown when no invoice has a due date */
  oldestIssued: string | null;
  /* Some due date is before today, in the business's timezone */
  overdue: boolean;
};

/* YYYY-MM-DD in the business's zone (settings D5): "overdue" must not
   flip at UTC midnight, nor at the browser's */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

/* cobros-in-links D6: grouped by customer across every loaded block, in
   the order each customer FIRST appeared — `groupCobros` without its
   sort. Sorting by due date would need the whole list, which the view
   never reads (spec Assumptions). A later block's invoice for a
   customer already on screen joins that row and moves it nowhere.

   An invoice the provider hands back twice — a list that shifted while
   the operator scrolled — is counted once, so a total never grows by a
   duplicate. */
export function groupReceivables(rows: CobroRow[], today: string): ReceivableGroup[] {
  const byCustomer = new Map<string, ReceivableGroup>();
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.externalId)) continue;
    seen.add(row.externalId);
    let group = byCustomer.get(row.customerUsuario);
    if (!group) {
      group = {
        usuario: row.customerUsuario,
        name: row.customerName ?? row.customerUsuario,
        totalCents: 0,
        invoices: [],
        oldestDue: null,
        oldestIssued: null,
        overdue: false,
      };
      byCustomer.set(row.customerUsuario, group);
    }
    group.totalCents += row.amountCents;
    group.invoices.push(row);
    if (row.customerName) group.name = row.customerName;
    if (row.dueDate && (group.oldestDue === null || row.dueDate < group.oldestDue)) group.oldestDue = row.dueDate;
    if (row.invoiceDate && (group.oldestIssued === null || row.invoiceDate < group.oldestIssued)) {
      group.oldestIssued = row.invoiceDate;
    }
    /* An invoice with no due date never reads as overdue (spec edge case) */
    if (row.dueDate && row.dueDate < today) group.overdue = true;
  }
  for (const group of byCustomer.values()) {
    group.invoices.sort(
      (a, b) => (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "") || a.externalId - b.externalId,
    );
  }
  return [...byCustomer.values()];
}

export type ReceivablesView = {
  /* Invoices as they arrived, block after block; the screen groups them */
  invoices: CobroRow[];
  /* The integration's own count of open invoices, or null (FR-007) */
  total: number | null;
  /* D7: the first block could not be read — no rows, and NOT "nobody" */
  unreadable: boolean;
  /* D7 / FR-012: rows are on screen and a later read failed — keep them
     under the quiet note */
  offline: boolean;
  /* D7: the integration answered, and nobody has an open invoice */
  nobody: boolean;
  isPending: boolean;
  error: ApiError | null;
  hasMore: boolean;
  loadingMore: boolean;
  sentinelRef: (node: HTMLElement | null) => void;
  retry: () => void;
};

export function useReceivables(enabled: boolean): ReceivablesView {
  const client = useQueryClient();
  /* D4: measured once per mount, the customer view's own rule */
  const [limit] = useState(blockSize);
  /* bug: links-refused-key, carried over: a background re-read that
     starts being REFUSED is setup and replaces the rows; a stall is
     weather and keeps them (D7) */
  const [background, setBackground] = useState<{ refused: boolean; failed: boolean }>({
    refused: false,
    failed: false,
  });

  const url = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor !== null) params.set("cursor", cursor);
      return `/payment-requests?${params.toString()}`;
    },
    [limit],
  );

  const query = useInfiniteQuery<
    PaymentRequestsResponse,
    ApiError,
    InfiniteData<PaymentRequestsResponse, string | null>,
    typeof KEY,
    string | null
  >({
    queryKey: KEY,
    queryFn: ({ pageParam }) => api<PaymentRequestsResponse>(url(pageParam)),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: RESULTS_STALE_MS,
    retry: false,
    /* FR-011: the return to the tab is handled by hand below, first
       block only — TanStack's own focus refetch would re-read every
       block the operator scrolled through */
    refetchOnWindowFocus: false,
  });

  const pages = query.data?.pages;
  const invoices = useMemo(() => pages?.flatMap((page) => page.results) ?? [], [pages]);
  const firstUnavailable = pages?.[0]?.integration === "unavailable";
  const laterUnavailable = (pages?.slice(1) ?? []).some((page) => page.integration === "unavailable");

  /* FR-011: a screen left open overnight must not show yesterday's first
     block; re-reading every block because someone came back is provider
     calls nobody asked for. The floor is the customer view's. */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      const state = client.getQueryState<InfiniteData<PaymentRequestsResponse, string | null>>(KEY);
      if (!state?.data || state.fetchStatus !== "idle") return;
      if (Date.now() - state.dataUpdatedAt < FOCUS_FLOOR_MS) return;
      try {
        const fresh = await api<PaymentRequestsResponse>(url(null));
        /* An unreadable re-read with rows already on screen keeps them:
           the rows were true when they arrived (list-states D1) */
        if (fresh.integration === "unavailable" && (state.data.pages[0]?.results.length ?? 0) > 0) {
          setBackground({ refused: false, failed: true });
          return;
        }
        client.setQueryData<InfiniteData<PaymentRequestsResponse, string | null>>(KEY, (old) =>
          old ? { ...old, pages: [fresh, ...old.pages.slice(1)] } : old,
        );
        setBackground({ refused: false, failed: false });
      } catch (e) {
        const refused = e instanceof ApiError && e.code === "INTEGRATION_AUTH_FAILED";
        setBackground({ refused, failed: true });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [client, url]);

  /* The sentinel, as the customer view hangs it (FR-003) — with no
     margin. SC-003 asks that opening the view and not scrolling reads
     exactly ONE block. The first block is the viewport plus two rows
     (D4), so it ends a row or two below the fold; the customer view's
     320px look-ahead would reach that sentinel on arrival and read a
     second block nobody scrolled toward. Measured against the rendered
     rows in tests/e2e/links.spec.ts. */
  const observer = useRef<IntersectionObserver | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      observer.current?.disconnect();
      if (!node || typeof IntersectionObserver === "undefined") return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        },
        { rootMargin: "0px" },
      );
      observer.current.observe(node);
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );
  useEffect(() => () => observer.current?.disconnect(), []);

  const hasRows = invoices.length > 0;
  return {
    invoices,
    total: pages?.[0]?.total ?? null,
    unreadable: Boolean(pages) && firstUnavailable && !hasRows,
    offline: hasRows && (laterUnavailable || firstUnavailable || (background.failed && !background.refused)),
    nobody: Boolean(pages) && !firstUnavailable && !laterUnavailable && !hasRows && !query.hasNextPage,
    isPending: enabled && query.isPending,
    error: query.error ?? (background.refused ? new ApiError("INTEGRATION_AUTH_FAILED", 503) : null),
    hasMore: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    sentinelRef,
    retry: () => void query.refetch(),
  };
}

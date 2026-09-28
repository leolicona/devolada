import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { CobroRow, PaymentRequestsResponse } from "@devolada/api/payment-requests-schema";
import { api, ApiError } from "@/lib/api";
import { FOCUS_FLOOR_MS } from "@/lib/presence";
import { useSession } from "../auth/session";
import { useFirstBlockReread, type Stop } from "./blocks";
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
   them asks nothing; past them, the view re-reads its FIRST block. */
export const RESULTS_STALE_MS = 2 * 60_000;

/* A block as the cache holds it: the door's answer, or the stop standing
   in for a later block that failed (blocks.ts) */
type Block = PaymentRequestsResponse & { stopped?: Stop };
type Blocks = InfiniteData<Block, string | null>;

/* D7, D13: a later block refused for SETUP says so the way a first block
   would — the Integraciones message for a refused key, the customer view
   for an integration that is gone — never "could not read" */
const SETUP_STATUS = { INTEGRATION_AUTH_FAILED: 503, NOT_CONFIGURED: 409 } as const;
type SetupStop = keyof typeof SETUP_STATUS;
const isSetup = (code: unknown): code is SetupStop =>
  typeof code === "string" && Object.prototype.hasOwnProperty.call(SETUP_STATUS, code);

const stop = (stopped: Stop): Block => ({ results: [], nextCursor: null, total: null, integration: "ok", stopped });

/* Where the walk stopped: a later block the integration could not read
   (D7), or one that failed on the way */
const isStop = (page: Block, i: number) => i > 0 && (page.integration === "unavailable" || page.stopped !== undefined);

/* Reintentar lifts the stop and every page after it; the page before it
   keeps the cursor the walk resumes from */
function withoutStops(data: Blocks): Blocks {
  const at = data.pages.findIndex(isStop);
  return at < 0 ? data : { pages: data.pages.slice(0, at), pageParams: data.pageParams.slice(0, at) };
}

/* The integration just answered, so no stop below still means "away" or
   "refused": the note and the setup message go. Each stays a stop all the
   same — the page never reads the next block on its own (FR-003), and a
   return to the tab is not a scroll. Reintentar lifts it. */
const answered = (page: Block, i: number): Block => (isStop(page, i) ? stop("failed") : page);

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
  /* The next block could not be read. The walk stops there — it never
     asks again on its own — and the page offers Reintentar. */
  nextFailed: boolean;
  retryNext: () => void;
  /* D7: the integration answered, and nobody has an open invoice */
  nobody: boolean;
  isPending: boolean;
  error: ApiError | null;
  hasMore: boolean;
  loadingMore: boolean;
  sentinelRef: (node: HTMLElement | null) => void;
  retry: () => void;
};

/* `enabled` is "the list is on screen": Por cobrar chosen, and no search
   showing in its place (FR-010). Hidden, it is neither read nor re-read. */
export function useReceivables(enabled: boolean): ReceivablesView {
  const client = useQueryClient();
  /* The view is in the key's name: this read only ever serves Por cobrar
     (D12). The business is in it too, like every Links memory (seen.ts). */
  const businessId = useSession().data?.id ?? "";
  const key = useMemo(() => ["links-receivables", businessId] as const, [businessId]);
  /* D4: measured once per mount, the customer view's own rule */
  const [limit] = useState(blockSize);
  /* bug: links-refused-key, carried over: a background re-read that
     starts being REFUSED is setup and replaces the rows; a stall is
     weather and keeps them (D7) */
  const [background, setBackground] = useState<{ refused: boolean; failed: boolean }>({
    refused: false,
    failed: false,
  });
  const { busy: rereading, start, isRunning, settled } = useFirstBlockReread();

  const url = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor !== null) params.set("cursor", cursor);
      return `/payment-requests?${params.toString()}`;
    },
    [limit],
  );

  const query = useInfiniteQuery<Block, ApiError, Blocks, typeof key, string | null>({
    queryKey: key,
    queryFn: async ({ pageParam }) => {
      try {
        return await api<PaymentRequestsResponse>(url(pageParam));
      } catch (e) {
        /* The first block has nothing on screen to keep: its failure is
           the screen's (D7). A later one is a stop (blocks.ts). */
        if (pageParam === null) throw e;
        return stop(e instanceof ApiError && isSetup(e.code) ? e.code : "failed");
      }
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    /* Never stale to TanStack. A stale infinite query reads again EVERY
       page it holds when it mounts or is enabled again, so coming back
       to Por cobrar after two minutes with six blocks loaded read six
       blocks nobody scrolled toward (review of 2026-09-28, FR-003).
       Freshness is by hand instead, and always first block only:
       `rereadFirst` below, on return to the tab and when the view comes
       back. A later block that fails is a stop, not an error, because an
       error would make the query stale all the same (blocks.ts). */
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const pages = query.data?.pages;
  const invoices = useMemo(() => pages?.flatMap((page) => page.results) ?? [], [pages]);
  const firstUnavailable = pages?.[0]?.integration === "unavailable";
  const laterUnavailable = (pages?.slice(1) ?? []).some((page) => page.integration === "unavailable");
  const stopped = (pages ?? []).some(isStop);
  const setupStop = pages?.find((page) => isSetup(page.stopped))?.stopped as SetupStop | undefined;

  /* FR-011: a screen left open overnight must not show yesterday's first
     block; re-reading every block because someone came back is provider
     calls nobody asked for. One re-read, of the FIRST block only, above a
     floor, for both ways of coming back — one at a time, and never while
     a next block is on its way (blocks.ts). */
  const rereadFirst = useCallback(
    (floorMs: number) => {
      if (isRunning()) return;
      const state = client.getQueryState<Blocks>(key);
      if (!state?.data || state.fetchStatus !== "idle") return;
      if (Date.now() - state.dataUpdatedAt < floorMs) return;
      const onScreen = state.data.pages[0]?.results.length ?? 0;
      start(async () => {
        try {
          const fresh = await api<PaymentRequestsResponse>(url(null));
          /* An unreadable re-read with rows already on screen keeps them:
             the rows were true when they arrived (list-states D1) */
          if (fresh.integration === "unavailable" && onScreen > 0) {
            setBackground({ refused: false, failed: true });
            return;
          }
          client.setQueryData<Blocks>(key, (old) => {
            if (!old) return old;
            const next = [fresh, ...old.pages.slice(1)];
            return { ...old, pages: fresh.integration === "ok" ? next.map(answered) : next };
          });
          setBackground({ refused: false, failed: false });
        } catch (e) {
          const refused = e instanceof ApiError && e.code === "INTEGRATION_AUTH_FAILED";
          setBackground({ refused, failed: true });
        }
      });
    },
    [client, key, url, isRunning, start],
  );

  /* The return to the tab, above the customer view's 30-second floor —
     and only while the list is on screen. With Todos chosen, or a search
     showing in its place, the list is not shown, so it is not read
     (review of 2026-09-28). */
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") rereadFirst(FOCUS_FLOOR_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled, rereadFirst]);

  /* The list coming back on screen — the chip pressed again, a search
     cleared, or Links reached again while the rows are still in memory —
     past the two minutes the customer view keeps an answer: the first
     block again, the rest as they were. The customer view reads every
     block it holds on the same return; this one does not, on purpose
     (FR-003, cobros-in-links D19). A setup stop has no age
     to wait out: coming back is how the operator asks whether the fix
     took. */
  useEffect(() => {
    if (!enabled) return;
    const held = client.getQueryData<Blocks>(key)?.pages ?? [];
    rereadFirst(held.some((page) => isSetup(page.stopped)) ? 0 : RESULTS_STALE_MS);
  }, [enabled, rereadFirst, client, key]);

  /* The sentinel, as the customer view hangs it (FR-003) — with no
     margin. SC-003 asks that opening the view and not scrolling reads
     exactly ONE block. The first block is the viewport plus two rows
     (D4), so it ends a row or two below the fold; the customer view's
     320px look-ahead would reach that sentinel on arrival and read a
     second block nobody scrolled toward. Measured against the rendered
     rows in tests/e2e/links.spec.ts.

     A stop has no cursor, so there is no sentinel below it: a failed
     block is never asked again on its own (review of 2026-09-28). */
  const observer = useRef<IntersectionObserver | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      observer.current?.disconnect();
      if (!node || typeof IntersectionObserver === "undefined") return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          if (hasNextPage && !isFetchingNextPage && !isRunning()) void fetchNextPage();
        },
        { rootMargin: "0px" },
      );
      observer.current.observe(node);
    },
    /* `rereading` rebuilds the observer when a re-read lands, so a
       sentinel reached meanwhile reports again */
    [hasNextPage, isFetchingNextPage, fetchNextPage, isRunning, rereading],
  );
  useEffect(() => () => observer.current?.disconnect(), []);

  /* Reintentar for the next block: lift the stop, then ask from the last
     good cursor — after any re-read of the first block has landed */
  const retryNext = useCallback(() => {
    void settled().then(() => {
      const state = client.getQueryState<Blocks>(key);
      if (!state?.data) return;
      const lifted = withoutStops(state.data);
      /* Lifting a stop reads nothing, so the first block keeps its age —
         the floors in `rereadFirst` measure it */
      if (lifted !== state.data) client.setQueryData<Blocks>(key, lifted, { updatedAt: state.dataUpdatedAt });
      void fetchNextPage();
    });
  }, [client, key, fetchNextPage, settled]);

  const hasRows = invoices.length > 0;
  return {
    invoices,
    total: pages?.[0]?.total ?? null,
    unreadable: Boolean(pages) && firstUnavailable && !hasRows,
    offline: hasRows && (laterUnavailable || firstUnavailable || (background.failed && !background.refused)),
    nextFailed: stopped && setupStop === undefined && !isFetchingNextPage,
    retryNext,
    nobody: Boolean(pages) && !firstUnavailable && !stopped && !hasRows && !query.hasNextPage,
    isPending: enabled && query.isPending,
    error:
      query.error ??
      (setupStop !== undefined
        ? new ApiError(setupStop, SETUP_STATUS[setupStop])
        : background.refused
          ? new ApiError("INTEGRATION_AUTH_FAILED", 503)
          : null),
    hasMore: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    sentinelRef,
    retry: () => void query.refetch(),
  };
}

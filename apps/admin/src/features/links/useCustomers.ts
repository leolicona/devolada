import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { CustomerRow, CustomersResponse } from "@devolada/api/direct-payments-schema";
import { api, ApiError } from "@/lib/api";
import { FOCUS_FLOOR_MS } from "@/lib/presence";
import { readResults, recallCustomers, rememberCustomers, rowKey, writeResults, type SearchView } from "./seen";

/* links-on-demand-search US1: the page asks for what it shows.

   One query serves browsing and searching, because the door does
   (D1) — a page with one search box should not hold two caches and
   swap between them mid-keystroke. What changes is the key.

   FR-020 is the shape of it: blocks, one provider read each, the first
   no larger than the viewport, the next asked for only when the
   operator scrolls toward it. The page never walks the list to its end
   on its own. */

/* One row is a name, a second line and two buttons: measured against
   the rendered screen at 40px controls. Approximate on purpose — the
   server clamps whatever we ask for (D3). */
const ROW_HEIGHT_PX = 76;
/* What the header, the search box and its help line cost before the
   first row */
const CHROME_PX = 240;
export const BLOCK_MIN = 10;
export const BLOCK_MAX = 50;

/* FR-002: three characters, and only after the operator pauses. The
   figure is the spec's own. */
export const SEARCH_MIN_CHARS = 3;
export const SEARCH_DEBOUNCE_MS = 300;

/* FR-012: the same text is not asked again for two minutes. The query
   cache holds it inside this tab; `seen.ts` holds it across a reload,
   which a query cache cannot survive (D11). Both use this figure. */
const RESULTS_STALE_MS = 2 * 60_000;

/* D3/FR-020: only the browser knows what fills its own viewport. The
   server clamps it to 10..50; asking for a screenful is what keeps the
   first block one provider call instead of four.

   Exported for Por cobrar (cobros-in-links D4): its blocks follow the
   same rule, reused rather than copied. */
export function blockSize(): number {
  const height = typeof window === "undefined" ? 0 : window.innerHeight;
  const rows = Math.ceil(Math.max(0, height - CHROME_PX) / ROW_HEIGHT_PX) + 2;
  return Math.min(BLOCK_MAX, Math.max(BLOCK_MIN, rows));
}

function useDebounced(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export type CustomersView = {
  rows: CustomerRow[];
  /* Browse only: how many customers the ISP has (FR-018) */
  total: number | null;
  /* Search only: a floor, never a total (D5, FR-006) */
  matched: number | null;
  wisphub: CustomersResponse["wisphub"];
  /* FR-014: the provider is away and the page says so quietly, with
     whatever it already had — never an error block */
  offline: boolean;
  /* The text the rows on screen actually answer — never the one still
     being typed (FR-013) */
  answering: string;
  /* The settled text, for the address to carry (FR-011) */
  settled: string;
  searching: boolean;
  isPending: boolean;
  isError: boolean;
  error: ApiError | null;
  hasMore: boolean;
  loadingMore: boolean;
  sentinelRef: (node: HTMLElement | null) => void;
  retry: () => void;
};

export function useCustomers(search: string, opts: { view?: SearchView } = {}): CustomersView {
  const view = opts.view ?? "customers";
  const client = useQueryClient();
  /* Measured once per mount: a key that moved with the window would
     throw away a cache on every resize */
  const [limit] = useState(blockSize);

  /* bug: links-refused-key — a background read that starts being
     REFUSED is a setup problem, and the screen must say so rather than
     keep showing rows under a note that promises a refresh which can
     never succeed. A stall is the opposite: quiet, rows kept (D9). */
  const [background, setBackground] = useState<{ refused: boolean; failed: boolean }>({
    refused: false,
    failed: false,
  });

  const settled = useDebounced(search, SEARCH_DEBOUNCE_MS);
  const trimmed = settled.trim();
  const q = trimmed.length >= SEARCH_MIN_CHARS ? trimmed : undefined;

  /* FR-013 is structural, not a race to win: an answer for "mar" lands
     under its own key, so a reply that arrives after the operator typed
     "marc" is cached — never rendered. The screen reads the entry for
     the text it is asking about, and nothing else. The limit stays OUT
     of the key: it is the same rows either way, and a resize must not
     cost the two-minute memory (FR-012). */
  /* cobros-in-links D12: the view is part of the key — the same text in
     Por cobrar asks for panel rows only (D8), so it is another answer */
  const key = useMemo(() => ["links-customers", view, q ?? ""] as const, [view, q]);
  /* cobros-in-links FR-010: in Por cobrar the customers door is asked
     only for a SEARCH. With no text the view is the open-invoice list,
     which is another read (`useReceivables`). */
  const enabled = view === "customers" || q !== undefined;

  /* FR-012 / D11: what this exact search answered last time, if it was
     within the two minutes. A TanStack cache dies on reload; this is
     what brings a reloaded or re-entered search back without a second
     visible wait (US2 scenarios 2 and 4). Only the FIRST block is
     stored — the blocks below it are a scroll the operator can repeat,
     and storing a session's whole scroll is not a two-minute memory. */
  const stored = useMemo(() => (q === undefined ? null : readResults(q, view)), [q, view]);

  const url = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (q !== undefined) params.set("q", q);
      if (cursor !== null) params.set("cursor", cursor);
      /* cobros-in-links D8: an API link has no customer and no debt in the
         business's system, so Por cobrar's search leaves them out — on
         the server, so the count stays honest */
      if (view === "receivables") params.set("channel", "panel");
      return `/direct-payments/customers?${params.toString()}`;
    },
    [limit, q, view],
  );

  const query = useInfiniteQuery<CustomersResponse, ApiError, InfiniteData<CustomersResponse, string | null>, typeof key, string | null>({
    queryKey: key,
    queryFn: ({ pageParam }) => api<CustomersResponse>(url(pageParam)),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: RESULTS_STALE_MS,
    /* Seeded from the browser's own memory, with the age it really has:
       inside the two minutes it renders at once and asks nothing, past
       them `readResults` has already returned null and this is a normal
       fetch (FR-012). */
    initialData: stored ? { pages: [stored.block], pageParams: [null] } : undefined,
    initialDataUpdatedAt: stored?.at,
    retry: false,
    /* FR-027 / D15: the return to the tab is handled by hand below, and
       only for the FIRST block. TanStack's own focus refetch would ask
       again for every block the operator scrolled through — and it would
       ask alongside ours, which is two provider calls for one return. */
    refetchOnWindowFocus: false,
  });

  const pages = query.data?.pages;
  const provider = pages?.[0]?.wisphub ?? "ok";

  const rows = useMemo(() => {
    const all = pages?.flatMap((page) => page.results) ?? [];
    /* D6: the provider offers no ordering, so a base that changes while
       the operator scrolls can hand the same customer back in two
       blocks. The server does not pretend to fix it; the page simply
       never renders one twice. A customer missed between blocks is
       still reachable by search, which is the promise the spec makes. */
    const seen = new Set<string>();
    const out: CustomerRow[] = [];
    for (const row of all) {
      const identity = rowKey(row);
      if (identity !== "" && seen.has(identity)) continue;
      seen.add(identity);
      out.push(row);
    }

    /* FR-021: a live answer ALWAYS outranks the cache, so this runs
       only when the provider did not answer.

       Two jobs, both of them "the operator can still work": a row the
       door could answer only from a link carries no name (FR-010 stores
       none), and the cache puts back the name and phone WispHub last
       gave for that usuario; and a customer the cache saw minutes ago
       who has no link yet is not in the answer at all, so searching by
       their NAME — which needs WispHub — still finds them. */
    if (provider !== "ok") {
      const remembered = new Map(recallCustomers(q ?? "").map((entry) => [entry.usuario, entry]));
      for (const [i, row] of out.entries()) {
        const entry = row.usuario === null ? undefined : remembered.get(row.usuario);
        if (!entry) continue;
        /* A copy: these rows are the query cache's own objects, and a
           screen must not write into what the cache holds */
        out[i] = { ...row, name: row.name ?? entry.name, phone: row.phone ?? entry.phone };
        remembered.delete(entry.usuario);
      }
      if (q !== undefined) {
        for (const entry of remembered.values()) {
          if (seen.has(entry.usuario)) continue;
          out.push({
            channel: "panel",
            usuario: entry.usuario,
            wisphubId: entry.wisphubId,
            customerRef: null,
            label: null,
            askCents: null,
            linkState: null,
            name: entry.name,
            phone: entry.phone,
            /* No link, and none can be born while the provider is away:
               the act reads the customer fresh by design (D8). The
               buttons still show — and say so if pressed. */
            hasLink: false,
            url: null,
            waLink: null,
          });
        }
      }
    }
    return out;
  }, [pages, provider, q]);

  /* FR-021: every live answer overwrites what it covers. Written here
     rather than in the query, because it is the RENDERED rows that the
     operator saw and may need back. */
  useEffect(() => {
    if (provider !== "ok" || rows.length === 0) return;
    rememberCustomers(rows);
  }, [provider, rows]);

  const first = pages?.[0];
  const last = pages?.[pages.length - 1];

  /* Store what the provider answered, never what we restored: writing
     the restored block back would give it a fresh timestamp and the
     two-minute memory would never expire (FR-012). */
  useEffect(() => {
    if (q === undefined || !first || first === stored?.block) return;
    writeResults(q, first, view);
  }, [q, first, stored, view]);

  /* FR-027 / D15: the page no longer reports its own age — a block is
     read when it renders, so there is nothing to print and nothing to
     refresh by hand. What survives from `presence-freshness` is this:
     the return to the tab re-reads, above a 30-second floor, and only
     the FIRST block. A screen left open overnight must not show
     yesterday's first page; re-reading five blocks because someone
     came back is five provider calls nobody asked for. */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      const state = client.getQueryState<InfiniteData<CustomersResponse, string | null>>(key);
      if (!state?.data || state.fetchStatus !== "idle") return;
      if (Date.now() - state.dataUpdatedAt < FOCUS_FLOOR_MS) return;
      try {
        const fresh = await api<CustomersResponse>(url(null));
        client.setQueryData<InfiniteData<CustomersResponse, string | null>>(key, (old) =>
          old ? { ...old, pages: [fresh, ...old.pages.slice(1)] } : old,
        );
        setBackground({ refused: false, failed: false });
      } catch (e) {
        /* A failed background read keeps what is on screen: the rows
           were true when they arrived (list-states D1). A REFUSED key
           is the exception — it is setup, and the note would promise a
           refresh that cannot happen. */
        const refused = e instanceof ApiError && e.code === "WISPHUB_AUTH_FAILED";
        setBackground({ refused, failed: true });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [client, key, url]);

  /* FR-020: the next block is asked for when the operator scrolls
     TOWARD it — a sentinel below the list, not a page walked to its
     end. `rootMargin` is what makes the block land before the operator
     reaches the bottom rather than after. */
  const observer = useRef<IntersectionObserver | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      observer.current?.disconnect();
      /* happy-dom has no IntersectionObserver: the component layer
         proves what it can, and the scroll itself is the browser
         layer's question (constitution IV, tests/e2e/links.spec.ts) */
      if (!node || typeof IntersectionObserver === "undefined") return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        },
        { rootMargin: "320px" },
      );
      observer.current.observe(node);
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );
  useEffect(() => () => observer.current?.disconnect(), []);

  return {
    rows,
    total: first?.total ?? null,
    matched: last?.matched ?? first?.matched ?? null,
    wisphub: provider,
    offline: provider === "unavailable" || (background.failed && !background.refused && rows.length > 0),
    answering: q ?? "",
    /* The text the operator has settled on, whatever its length — what
       the address carries (FR-011). `answering` is what the ROWS answer,
       which is empty until three characters. */
    settled: trimmed,
    /* The pause is part of the search: the page says it is working from
       the moment the operator stops typing, not only once the request
       is on the wire */
    searching: search.trim() !== settled.trim() || query.isFetching,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error ?? (background.refused ? new ApiError("WISPHUB_AUTH_FAILED", 503) : null),
    hasMore: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    sentinelRef,
    retry: () => void query.refetch(),
  };
}

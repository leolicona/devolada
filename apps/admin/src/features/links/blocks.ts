import { useCallback, useRef, useState } from "react";

/* cobros-in-links D19 (the review of 2026-09-28): how both Links views
   walk their blocks — the customer view (`useCustomers`) and Por cobrar
   (`useReceivables`) — when a read fails or two reads meet (FR-003,
   FR-011). */

/* 1. A later block that fails is a STOP, kept in the cache as a page of
   its own — empty, with no cursor — and never an error on the query.
   TanStack treats a query that errored as stale whatever its staleTime,
   and then reads again EVERY block it holds the next time the view is
   enabled, mounted or back online; the sentinel came back on the way and
   the failed block was asked again with nobody pressing Reintentar
   (query-core 5.101, read in the review). A page in the data survives all
   of that, so the walk waits at the stop until the operator lifts it.

   `failed` is weather, lifted by Reintentar. Por cobrar adds the two
   setup answers (`useReceivables`), which say so the way a first block
   would. */
export type Stop = "failed" | "INTEGRATION_AUTH_FAILED" | "NOT_CONFIGURED";

/* 2. The two ways a view reads never overlap. The next block, when the
   operator scrolls toward it, and the first block again, when they come
   back, used to run side by side: a next block that started during the
   re-read carried the OLD first block with it — query-core builds a next
   page on the pages it held when it started — and wrote it back over the
   fresh one when it landed, and two returns inside one slow re-read sent
   two reads. So the re-read runs one at a time, and a next block waits
   for it. */
export function useFirstBlockReread() {
  const running = useRef<Promise<void> | null>(null);
  /* For the sentinel: a new observer once the re-read lands, so a
     sentinel the operator reached meanwhile reports again */
  const [busy, setBusy] = useState(false);

  /* The caller has already checked its floor and that nothing else is
     reading; `reread` catches its own failures */
  const start = useCallback((reread: () => Promise<void>) => {
    if (running.current) return;
    setBusy(true);
    running.current = reread().finally(() => {
      running.current = null;
      setBusy(false);
    });
  }, []);

  /* Read when asked, never from a render: an observer's report can land
     before React has drawn `busy` */
  const isRunning = useCallback(() => running.current !== null, []);

  /* What a next-block read waits for first */
  const settled = useCallback(() => running.current ?? Promise.resolve(), []);

  return { busy, start, isRunning, settled };
}

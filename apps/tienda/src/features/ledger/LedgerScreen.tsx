import { useInfiniteQuery } from "@tanstack/react-query";
import { Alert, Amount, Button, Card, ListError, Skeleton, cn } from "@devolada/ui";
import type { LedgerEntryItem, LedgerResponse } from "@devolada/api/ledger-schema";
import { api, ApiError } from "../../api/client";

/* Movimientos (US-K03): the entries the Caja balance sums, grouped by
   day. Rows carry their context (spec D4). */

const typeLabel = (entry: LedgerEntryItem): string => {
  if (entry.type === "commission") return "Comisión";
  if (entry.type === "cash_drop") return "Entrega al ISP";
  return entry.reference ? `Cobro · ${entry.reference.customerName}` : "Cobro";
};

const amountClass = (entry: LedgerEntryItem): string =>
  entry.type === "charge" ? "text-success" : entry.type === "commission" ? "text-ink-soft" : "text-ink";

const dayFormat = new Intl.DateTimeFormat("es-MX", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const timeFormat = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });

export function LedgerScreen() {
  const {
    data,
    isPending,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<
    LedgerResponse,
    ApiError
  >({
    queryKey: ["ledger"],
    queryFn: ({ pageParam }) =>
      api<LedgerResponse>(pageParam ? `/ledger?cursor=${pageParam}` : "/ledger"),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  /* list-states D1: before anything else — an error must never fall
     through to the empty state and tell the shopkeeper they have no
     movements. D5: only when nothing loaded; a failed page two keeps
     its rows. */
  if (isError && !data) {
    return (
      <main className="px-6 pt-8">
        <h1 className="text-xl font-semibold">Movimientos</h1>
        <ListError
          what="tus movimientos"
          onRetry={() => void refetch()}
          retrying={isRefetching}
          className="mt-6"
        />
      </main>
    );
  }

  /* shell D7: one day group of rows, in the shape the entries will take */
  if (isPending) {
    return (
      <main className="px-6 pt-8" aria-busy="true" aria-label="Cargando tus movimientos">
        <h1 className="text-xl font-semibold">Movimientos</h1>
        <Skeleton className="mt-6 h-3 w-32" />
        <Card className="mt-2 divide-y divide-line-soft">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-baseline justify-between gap-4 p-4">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </Card>
      </main>
    );
  }

  const entries = data?.pages.flatMap((p) => p.entries) ?? [];

  /* Group by es-MX day, preserving newest-first order */
  const groups: { day: string; items: LedgerEntryItem[] }[] = [];
  for (const entry of entries) {
    const day = dayFormat.format(new Date(entry.createdAt));
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(entry);
    else groups.push({ day, items: [entry] });
  }

  return (
    <main className="px-6 pt-8">
      <h1 className="text-xl font-semibold">Movimientos</h1>

      {entries.length === 0 && (
        <Alert className="mt-6 font-normal">
          Todavía no tienes movimientos. Aparecerán aquí con tu primer cobro.
        </Alert>
      )}

      {groups.map((group) => (
        <section key={group.day} className="mt-6">
          <h2 className="text-xs font-semibold tracking-[0.06em] uppercase text-ink-faint">
            {group.day}
          </h2>
          <Card asChild>
            <ul className="mt-2 divide-y divide-line-soft">
              {group.items.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-base font-medium">{typeLabel(entry)}</p>
                    <p className="mt-0.5 text-sm text-ink-faint">
                      {timeFormat.format(new Date(entry.createdAt))}
                      {entry.reference && (
                        <span className="font-mono"> · {entry.reference.folio}</span>
                      )}
                    </p>
                  </div>
                  <Amount
                    cents={entry.cents}
                    sign
                    className={cn("shrink-0 text-base font-semibold", amountClass(entry))}
                  />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}

      {/* D5: the failed page reports under the rows it could not extend */}
      {isError && data && (
        <ListError
          what="más movimientos"
          onRetry={() => void fetchNextPage()}
          retrying={isFetchingNextPage}
          className="mt-6"
        />
      )}

      {hasNextPage && !isError && (
        <div className="mt-6 pb-4">
          <Button
            variant="secondary"
            className="w-full"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      )}
    </main>
  );
}

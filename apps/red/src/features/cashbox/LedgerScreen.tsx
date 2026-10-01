import { Link, useSearch } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button, ListError, Pending, Skeleton, formatMoney } from "@devolada/ui";
import type { StoreLedgerRow } from "@devolada/api/store-schema";
import { dayKey, dayOf, timeOf } from "@/lib/datetime";
import { getLedger } from "./api";

/* cash-at-stores FR-037, D19: *Movimientos* — the cash book, newest first,
   grouped by day, twenty at a time. Opened from *Mi caja*, it narrows to
   the movements behind the number that was tapped. */

function title(row: StoreLedgerRow): string {
  if (row.kind === "collection") return `Cobro · ${row.customerName ?? "cliente"}`;
  if (row.kind === "handover") return `Entrega a ${row.businessName}`;
  return "Corrección de Devolada";
}

function Row({ row }: { row: StoreLedgerRow }) {
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <span className="min-w-0">
        {/* design-review D1: identity wraps, it never truncates — measured
            2026-10-01 at 360px, a long name lost a third of itself */}
        <span className="block break-words text-base font-medium">{title(row)}</span>
        <span className="block text-sm text-ink-soft">
          {timeOf(row.at)}
          {row.folio ? ` · ${row.folio}` : ""}
          {row.kind === "collection" && row.feeCents ? ` · cargo tuyo ${formatMoney(row.feeCents)}` : ""}
        </span>
        {row.reason && <span className="block text-sm text-ink-soft">{row.reason}</span>}
      </span>
      <span className={`shrink-0 text-base font-semibold tabular-nums ${row.cents < 0 ? "text-ink-soft" : "text-ink"}`}>
        {row.cents < 0 ? "−" : "+"}
        {formatMoney(Math.abs(row.cents))}
      </span>
    </li>
  );
}

export function LedgerScreen() {
  const search = useSearch({ strict: false }) as { businessId?: string; kind?: "collection" | "handover" | "correction" };
  const ledger = useInfiniteQuery({
    queryKey: ["store-ledger", search.businessId ?? null, search.kind ?? null],
    queryFn: ({ pageParam }) => getLedger({ cursor: pageParam ?? undefined, businessId: search.businessId, kind: search.kind }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = ledger.data?.pages.flatMap((p) => p.rows) ?? [];
  const days = new Map<string, StoreLedgerRow[]>();
  for (const row of rows) {
    const key = dayKey(row.at);
    days.set(key, [...(days.get(key) ?? []), row]);
  }
  const narrowed = Boolean(search.businessId || search.kind);

  return (
    <section className="space-y-4" aria-labelledby="movimientos-title">
      <header className="space-y-1">
        <h1 id="movimientos-title" className="text-xl font-semibold">
          Movimientos
        </h1>
        {narrowed && (
          <p className="text-sm text-ink-soft">
            {search.kind === "collection" ? "Solo tus cobros" : "Solo un negocio"}
            {rows[0] ? ` de ${rows[0].businessName}` : ""} ·{" "}
            <Link to="/movimientos" className="font-medium text-link">
              Ver todos
            </Link>
          </p>
        )}
      </header>
      <Pending active={ledger.isPending} label="Cargando tus movimientos" shape={<Skeleton className="h-48 w-full" />}>
        {ledger.isError && rows.length === 0 ? (
          <ListError what="tus movimientos" onRetry={() => ledger.refetch()} />
        ) : rows.length === 0 && ledger.data ? (
          <p className="text-base text-ink-soft">Aún no hay movimientos.</p>
        ) : (
          [...days.entries()].map(([key, dayRows]) => (
            <div key={key} className="space-y-2">
              <h2 className="text-sm font-semibold text-ink-soft">{dayOf(dayRows[0].at)}</h2>
              <ul className="divide-y divide-line-soft rounded-md border border-line bg-card">
                {dayRows.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </ul>
            </div>
          ))
        )}
      </Pending>
      {ledger.isError && rows.length > 0 && <ListError what="más movimientos" onRetry={() => ledger.fetchNextPage()} />}
      {ledger.hasNextPage && (
        <Pending active={ledger.isFetchingNextPage} label="Cargando más movimientos">
          <Button variant="secondary" className="w-full" disabled={ledger.isFetchingNextPage} onClick={() => ledger.fetchNextPage()}>
            Cargar más
          </Button>
        </Pending>
      )}
    </section>
  );
}

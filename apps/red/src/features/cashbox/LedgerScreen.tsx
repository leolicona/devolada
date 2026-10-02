import { Link, useSearch } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button, ListError, Pending, Skeleton, formatMoney } from "@devolada/ui";
import type { StoreLedgerRow } from "@devolada/api/store-schema";
import { dayKey, dayOf, timeOf } from "@/lib/datetime";
import { useWide } from "@/lib/wide";
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
        {sign(row.cents)}
      </span>
    </li>
  );
}

const sign = (cents: number) => `${cents < 0 ? "−" : "+"}${formatMoney(Math.abs(cents))}`;
const none = <span aria-hidden className="text-ink-soft">—</span>;

/* D32: on a computer, one table per day — the same facts as the phone's
   rows, each in its own column */
function DayTable({ labelledBy, rows }: { labelledBy: string; rows: StoreLedgerRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-card">
      <table aria-labelledby={labelledBy} className="w-full border-collapse text-base">
        <thead>
          <tr className="bg-well text-sm font-medium text-ink-soft">
            <th scope="col" className="w-28 px-4 py-2 text-left font-medium">
              Hora
            </th>
            <th scope="col" className="px-4 py-2 text-left font-medium">
              Movimiento
            </th>
            <th scope="col" className="w-36 px-4 py-2 text-left font-medium">
              Folio
            </th>
            <th scope="col" className="w-32 px-4 py-2 text-right font-medium">
              Tu cargo
            </th>
            <th scope="col" className="w-36 px-4 py-2 text-right font-medium">
              Monto
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line-soft align-top">
              <td className="whitespace-nowrap px-4 py-3 text-ink-soft tabular-nums">{timeOf(row.at)}</td>
              <td className="px-4 py-3">
                <span className="block break-words font-medium">{title(row)}</span>
                {row.reason && <span className="block text-sm text-ink-soft">{row.reason}</span>}
              </td>
              <td className="px-4 py-3">{row.folio ? <span className="font-mono text-sm">{row.folio}</span> : none}</td>
              <td className="px-4 py-3 text-right text-ink-soft tabular-nums">
                {row.kind === "collection" && row.feeCents ? formatMoney(row.feeCents) : none}
              </td>
              <td className={`px-4 py-3 text-right font-semibold tabular-nums ${row.cents < 0 ? "text-ink-soft" : "text-ink"}`}>
                {sign(row.cents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LedgerScreen() {
  const search = useSearch({ strict: false }) as { businessId?: string; kind?: "collection" | "handover" | "correction"; since?: number };
  const ledger = useInfiniteQuery({
    queryKey: ["store-ledger", search.businessId ?? null, search.kind ?? null, search.since ?? null],
    queryFn: ({ pageParam }) =>
      getLedger({ cursor: pageParam ?? undefined, businessId: search.businessId, kind: search.kind, since: search.since }),
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
  const wide = useWide();

  return (
    <section className="space-y-4" aria-labelledby="movimientos-title">
      <header className="space-y-1">
        <h1 id="movimientos-title" className="text-xl font-semibold">
          Movimientos
        </h1>
        {narrowed && (
          <p className="text-sm text-ink-soft">
            {search.kind === "collection"
              ? search.since !== undefined
                ? "Tus cobros desde la última entrega"
                : "Solo tus cobros"
              : "Solo un negocio"}
            {rows[0] ? ` de ${rows[0].businessName}` : ""} ·{" "}
            <Link to="/movimientos" className="inline-flex min-h-12 items-center font-medium text-link">
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
          <div className="space-y-4">
            {[...days.entries()].map(([key, dayRows]) => (
              <div key={key} className="space-y-2">
                <h2 id={`dia-${key}`} className="text-sm font-semibold text-ink-soft">
                  {dayOf(dayRows[0].at)}
                </h2>
                {wide ? (
                  <DayTable labelledBy={`dia-${key}`} rows={dayRows} />
                ) : (
                  <ul className="divide-y divide-line-soft rounded-md border border-line bg-card">
                    {dayRows.map((row) => (
                      <Row key={row.id} row={row} />
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Pending>
      {ledger.isError && rows.length > 0 && <ListError what="más movimientos" onRetry={() => ledger.fetchNextPage()} />}
      {ledger.hasNextPage && (
        <Pending active={ledger.isFetchingNextPage} label="Cargando más movimientos">
          <Button variant="secondary" className="w-full lg:w-auto" disabled={ledger.isFetchingNextPage} onClick={() => ledger.fetchNextPage()}>
            Cargar más
          </Button>
        </Pending>
      )}
    </section>
  );
}

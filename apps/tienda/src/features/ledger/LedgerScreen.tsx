import { useInfiniteQuery } from "@tanstack/react-query";
import { Amount, Button } from "@devolada/ui";
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
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<
    LedgerResponse,
    ApiError
  >({
    queryKey: ["ledger"],
    queryFn: ({ pageParam }) =>
      api<LedgerResponse>(pageParam ? `/ledger?cursor=${pageParam}` : "/ledger"),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (isPending) {
    return (
      <main className="px-6 pt-8">
        <p className="text-sm text-ink-faint">Cargando…</p>
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
        <p className="mt-6 rounded-md border border-line bg-well px-4 py-3 text-sm text-ink-soft">
          Todavía no tienes movimientos. Aparecerán aquí con tu primer cobro.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.day} className="mt-6">
          <h2 className="text-xs font-semibold tracking-[0.06em] uppercase text-ink-faint">
            {group.day}
          </h2>
          <ul className="mt-2 divide-y divide-line-soft rounded-md border border-line bg-card">
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
                  className={`shrink-0 text-base font-semibold ${amountClass(entry)}`}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {hasNextPage && (
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

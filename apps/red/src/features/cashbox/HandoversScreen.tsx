import { Link, useSearch } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft, MessageSquareWarning } from "lucide-react";
import { Alert, Button, ListError, Pending, Skeleton, StatusBadge, formatMoney, type Status } from "@devolada/ui";
import type { StoreHandoverRow } from "@devolada/api/store-schema";
import { dateOf, timeOf } from "@/lib/datetime";
import { getHandovers } from "./api";

/* cash-at-stores T080 (US5/AC6, US5's "both sides see the same history"):
   the store's hand-overs to one business, newest first. A dispute writes
   no movement (D20), so *Movimientos* never shows it — here the store
   keeps reading the business's note after the next hand-over is settled,
   as the business does on *Puntos de pago*. */

const STATUS: Record<StoreHandoverRow["status"], Status> = {
  pending: "pending",
  confirmed: "confirmed",
  disputed: "disputed",
};

const when = (ms: number) => `${dateOf(ms)}, ${timeOf(ms)}`;

function sentence(h: StoreHandoverRow, business: string): string {
  const declared = `La entregaste el ${when(h.declaredAt)}.`;
  if (h.status === "pending" || h.resolvedAt === null) return `${declared} Esperamos a que ${business} la confirme.`;
  return `${declared} ${business} la ${h.status === "confirmed" ? "confirmó" : "disputó"} el ${when(h.resolvedAt)}.`;
}

export function HandoversScreen() {
  const { businessId } = useSearch({ strict: false }) as { businessId?: string };
  const list = useInfiniteQuery({
    queryKey: ["store-handovers", businessId ?? null],
    queryFn: ({ pageParam }) => getHandovers(businessId ?? "", pageParam ?? undefined),
    enabled: Boolean(businessId),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const business = list.data?.pages[0]?.businessName ?? "";
  const handovers = list.data?.pages.flatMap((p) => p.handovers) ?? [];

  return (
    <section className="space-y-4" aria-labelledby="entregas-title">
      <Link to="/caja" className="inline-flex min-h-12 items-center gap-2 text-base font-medium text-link">
        <ArrowLeft className="size-5" aria-hidden />
        Mi caja
      </Link>
      <header className="space-y-1">
        <h1 id="entregas-title" className="text-xl font-semibold">
          {business ? `Entregas a ${business}` : "Entregas"}
        </h1>
        <p className="text-sm text-ink-soft">
          Una entrega en disputa no cambia tu caja. Vuelve a registrarla cuando lleves el efectivo completo.
        </p>
      </header>
      <Pending active={list.isPending && Boolean(businessId)} label="Cargando tus entregas" shape={<Skeleton className="h-40 w-full" />}>
        {!businessId ? (
          <p className="text-base text-ink-soft">No encontramos ese negocio en tu caja.</p>
        ) : list.isError && handovers.length === 0 ? (
          <ListError what="tus entregas" onRetry={() => list.refetch()} />
        ) : list.data && handovers.length === 0 ? (
          <p className="text-base text-ink-soft">Todavía no has registrado entregas.</p>
        ) : (
          <ul aria-label={`Entregas a ${business}`} className="divide-y divide-line-soft rounded-md border border-line bg-card">
            {handovers.map((h) => (
              <li key={h.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <StatusBadge status={STATUS[h.status]} />
                  <span className="text-base font-semibold tabular-nums">{formatMoney(h.cents)}</span>
                </div>
                <p className="text-sm text-ink-soft">{sentence(h, business)}</p>
                {h.status === "disputed" && h.note && (
                  /* confirm-cash-drop D7: the store reads the business's note */
                  <Alert variant="warning" layout="icon">
                    <MessageSquareWarning aria-hidden />
                    {business} dice: «{h.note}»
                  </Alert>
                )}
              </li>
            ))}
          </ul>
        )}
      </Pending>
      {list.hasNextPage && (
        <Pending active={list.isFetchingNextPage} label="Cargando más entregas">
          <Button variant="secondary" className="w-full" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            Cargar más
          </Button>
        </Pending>
      )}
    </section>
  );
}

import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { Amount, AmountBreakdown, StatusBadge, formatMoney } from "@devolada/ui";
import type { FeedCharge, FeedResponse } from "@devolada/api/charges-schema";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";

/* The live charge feed (US-A01). Polling every 5s — "live" without
   sockets (spec D1). The browser owns "today" (D2). */

const POLL_MS = 5000;

const statusFilters = [
  { value: undefined, label: "Todos" },
  { value: "queued", label: "En cola" },
  { value: "failed", label: "Fallidos" },
  { value: "reconnected", label: "Reconectados" },
] as const;

function todayStartMs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

const timeFormat = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });

function feedPath(opts: { cursor?: number; status?: string; todayStart?: number }): string {
  const params = new URLSearchParams();
  if (opts.cursor) params.set("cursor", String(opts.cursor));
  if (opts.status) params.set("status", opts.status);
  if (opts.todayStart) params.set("todayStartMs", String(opts.todayStart));
  const qs = params.toString();
  return `/charges/feed${qs ? `?${qs}` : ""}`;
}

function ChargeRow({ charge }: { charge: FeedCharge }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      {/* D4: detail is an expandable row, not a route */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 p-4 text-left transition-colors duration-150 hover:bg-muted"
      >
        <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">
          {timeFormat.format(new Date(charge.createdAt))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{charge.customerName}</span>
          <span className="block truncate text-sm text-muted-foreground">{charge.storeName}</span>
        </span>
        <StatusBadge status={charge.reconnectionStatus} />
        <Amount cents={charge.totalCents} className="w-20 shrink-0 text-right text-sm font-semibold" />
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="grid gap-6 border-t border-line-soft bg-muted/50 p-4 pl-20 sm:grid-cols-2">
          <div>
            <AmountBreakdown
              lines={[
                { label: "Mensualidad", cents: charge.monthlyFeeCents },
                { label: "Cargo por servicio", cents: charge.serviceFeeCents },
              ]}
            />
            <p className="mt-3 font-mono text-sm text-muted-foreground">Folio {charge.folio}</p>
          </div>
          <div className="text-sm text-muted-foreground">
            <p>Registrado a las {timeFormat.format(new Date(charge.createdAt))}</p>
            <p className="mt-1">Intentos de reconexión: {charge.attempts}</p>
            {charge.reconnectedAt && (
              <p className="mt-1 text-success">
                Reconectado a las {timeFormat.format(new Date(charge.reconnectedAt))}
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function FeedScreen() {
  const [status, setStatus] = useState<string | undefined>(undefined);
  const todayStart = todayStartMs();

  const feed = useInfiniteQuery<FeedResponse, ApiError>({
    queryKey: ["feed", status ?? "all"],
    queryFn: ({ pageParam }) =>
      api<FeedResponse>(
        feedPath({ cursor: pageParam as number | undefined, status, todayStart }),
      ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: POLL_MS,
  });

  /* D3: failures beyond page one still surface */
  const failed = useQuery<FeedResponse, ApiError>({
    queryKey: ["feed", "failed-strip"],
    queryFn: () => api<FeedResponse>(feedPath({ status: "failed" })),
    refetchInterval: POLL_MS,
  });

  const charges = feed.data?.pages.flatMap((p) => p.charges) ?? [];
  const today = feed.data?.pages[0]?.today ?? null;
  const failedCount = failed.data?.charges.length ?? 0;

  return (
    <main className="px-4 pt-4 lg:px-8 lg:pt-8" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Cobros</h1>
        {today && (
          <p className="text-sm text-muted-foreground">
            Hoy: <span className="font-semibold text-foreground">{formatMoney(today.totalCents)}</span> ·{" "}
            {today.count} {today.count === 1 ? "cobro" : "cobros"}
          </p>
        )}
      </div>

      {failedCount > 0 && status !== "failed" && (
        <Alert variant="warning" className="mt-4 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {failedCount} {failedCount === 1 ? "cobro fallido necesita" : "cobros fallidos necesitan"} tu atención.
          </span>
          <Button variant="outline" onClick={() => setStatus("failed")}>
            Verlos
          </Button>
        </Alert>
      )}

      <div role="group" aria-label="Filtrar por estado" className="mt-4 flex flex-wrap gap-2">
        {statusFilters.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setStatus(f.value)}
            aria-pressed={status === f.value}
            className={cn(
              "h-9 rounded-full border px-4 text-sm font-medium transition-colors duration-150",
              status === f.value
                ? "border-transparent bg-accent-soft text-link"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {charges.length === 0 && !feed.isPending && (
        <p className="mt-6 max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Sin cobros por aquí todavía. Aparecerán en cuanto tus tiendas empiecen a cobrar.
        </p>
      )}

      {charges.length > 0 && (
        <Card className="mt-4">
          <ul className="divide-y divide-line-soft">
            {charges.map((charge) => (
              <ChargeRow key={charge.id} charge={charge} />
            ))}
          </ul>
        </Card>
      )}

      {feed.hasNextPage && (
        <div className="mt-4 pb-6">
          <Button variant="outline" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
            {feed.isFetchingNextPage ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      )}
    </main>
  );
}

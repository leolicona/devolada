import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { Amount, AmountBreakdown, StatusBadge, formatMoney } from "@devolada/ui";
import type { FeedCharge, FeedResponse } from "@devolada/api/charges-schema";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";

/* The live charge feed (US-A01). Polling every 5s — "live" without
   sockets (spec D1). The browser owns "today" (D2). Built on the
   shadcn catalog: Tabs, Collapsible, Skeleton (D7). */

const POLL_MS = 5000;
const ALL = "all";

const statusFilters = [
  { value: ALL, label: "Todos" },
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
  if (opts.status && opts.status !== ALL) params.set("status", opts.status);
  if (opts.todayStart) params.set("todayStartMs", String(opts.todayStart));
  const qs = params.toString();
  return `/charges/feed${qs ? `?${qs}` : ""}`;
}

/* D4 + D7: detail expands in place with a Collapsible row */
function ChargeRow({ charge }: { charge: FeedCharge }) {
  return (
    <li>
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center gap-4 p-4 text-left transition-colors duration-150 hover:bg-muted">
          <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">
            {timeFormat.format(new Date(charge.createdAt))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{charge.customerName}</span>
            <span className="block truncate text-sm text-muted-foreground">{charge.storeName}</span>
          </span>
          <StatusBadge status={charge.reconnectionStatus} />
          <Amount cents={charge.totalCents} className="w-20 shrink-0 text-right text-sm font-semibold" />
          <ChevronDown
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
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
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function FeedSkeleton() {
  return (
    <Card className="mt-4 p-4">
      {[0, 1, 2].map((k) => (
        <div key={k} className="flex items-center gap-4 py-3">
          <Skeleton className="h-4 w-12" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </Card>
  );
}

export function FeedScreen() {
  const [status, setStatus] = useState<string>(ALL);
  const todayStart = todayStartMs();

  const feed = useInfiniteQuery<FeedResponse, ApiError>({
    queryKey: ["feed", status],
    queryFn: ({ pageParam }) =>
      api<FeedResponse>(feedPath({ cursor: pageParam as number | undefined, status, todayStart })),
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

      {/* D7: status filters are shadcn Tabs */}
      <Tabs value={status} onValueChange={setStatus} className="mt-4">
        <TabsList aria-label="Filtrar por estado">
          {statusFilters.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {feed.isPending && <FeedSkeleton />}

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

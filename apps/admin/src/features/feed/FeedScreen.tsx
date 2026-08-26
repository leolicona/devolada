import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, TriangleAlert } from "lucide-react";
import {
  Alert,
  Amount,
  AmountBreakdown,
  Card,
  ListError,
  Skeleton,
  StatusBadge,
  formatMoney,
} from "@devolada/ui";
import type { FeedCharge, FeedResponse } from "@devolada/api/charges-schema";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { formatTime } from "@/lib/datetime";
import { useDisplaySettings } from "../auth/session";

/* The live charge feed (US-A01). Polling every 5s — "live" without
   sockets (spec D1). The ISP's timezone owns "today" (settings D5).
   Built on the shadcn catalog: Tabs, Collapsible, Skeleton (D7). */

const POLL_MS = 5000;
const ALL = "all";

const statusFilters = [
  { value: ALL, label: "Todos" },
  { value: "queued", label: "En cola" },
  { value: "failed", label: "Fallidos" },
  /* partial-payment D15: money that arrived without buying a
     reconnection is what an ISP audits — it gets its own chip. */
  { value: "withheld", label: "Sin reactivar" },
  { value: "reconnected", label: "Reconectados" },
] as const;

function feedPath(opts: { cursor?: number; status?: string }): string {
  const params = new URLSearchParams();
  if (opts.cursor) params.set("cursor", String(opts.cursor));
  if (opts.status && opts.status !== ALL) params.set("status", opts.status);
  const qs = params.toString();
  return `/charges/feed${qs ? `?${qs}` : ""}`;
}

/* The queue writes a code; the ISP reads a sentence
   (reconnection-queue spec UI contract). */
const reasons: Record<string, string> = {
  WISPHUB_AUTH_FAILED: "WispHub rechazó la llave. Revísala en Configuración.",
  WISPHUB_NOT_CONFIGURED: "Falta la llave de WispHub en Configuración.",
  WISPHUB_UNAVAILABLE: "WispHub no respondió. Lo seguimos intentando.",
  NOT_ACTIVE_YET: "El pago quedó registrado; el servicio aún no se activa.",
};
const reasonFor = (code: string) => reasons[code] ?? "WispHub no respondió. Lo seguimos intentando.";

/* D4 + D7: detail expands in place with a Collapsible row */
function ChargeRow({ charge }: { charge: FeedCharge }) {
  const { timeFormat, timezone } = useDisplaySettings();
  const at = (ms: number) => formatTime(ms, timeFormat, timezone);
  /* partial-payment D15: `totalCents` is what arrived (D9); the other
     three fields are what was asked. A short payment is the difference,
     derived here — no wire field carries it. `missingCents` matches the
     payer's page exactly: below the debt no fee is covered (D3), so the
     ISP and the payer quote the same figure. */
  const askCents = charge.invoiceCents + charge.carriedBalanceCents + charge.serviceFeeCents;
  const shortCents = askCents - charge.totalCents;
  const missingCents = Math.max(
    0,
    charge.invoiceCents + charge.carriedBalanceCents - charge.totalCents,
  );
  return (
    <li>
      <Collapsible>
        {/* US-P03: on a phone the row becomes a card. Squeezed into one
            line at 360px, the flex-1 name collapsed to nothing and the
            feed showed the amount without saying who paid it. */}
        <CollapsibleTrigger className="group grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 p-4 text-left transition-colors duration-150 hover:bg-muted sm:flex sm:gap-4">
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground sm:w-12">
            {at(charge.createdAt)}
          </span>
          <span className="col-start-2 min-w-0 sm:flex-1">
            {/* design-review D1: identity wraps, it never truncates */}
            <span className="block text-sm font-medium">{charge.customerName}</span>
            {/* US-D06: a direct payment has no store — the channel is
                named instead, so both kinds stay distinguishable */}
            {/* D15: the label, not only the badge — a partial that
                reconnected under a lenient threshold wears a green
                "Reconectado" and would otherwise pass for a full payment */}
            <span className="block text-sm text-muted-foreground">
              {charge.channel === "spei" ? "Pago directo · SPEI" : charge.storeName}
              {missingCents > 0 && " · Pago parcial"}
            </span>
          </span>
          <Amount
            cents={charge.totalCents}
            className="shrink-0 text-right text-sm font-semibold sm:order-last sm:w-20"
          />
          <span className="col-span-2 sm:contents">
            <StatusBadge status={charge.reconnectionStatus} />
          </span>
          <ChevronDown
            className="size-4 shrink-0 justify-self-end text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-6 border-t border-line-soft bg-muted/50 p-4 pl-20 sm:grid-cols-2">
            <div>
              <AmountBreakdown
                /* D15: with "Recibido" below, the derived sum needs its
                   honest name — it is the ask, not what arrived */
                totalLabel={shortCents > 0 ? "Total a cobrar" : "Total"}
                lines={[
                  /* debt-truth D16: the invoice total, not the plan's price */
                  { label: "Cargo del periodo", cents: charge.invoiceCents },
                  /* debt-truth D11: its own line, so the ISP can see why
                     a charge was larger than the customer's plan */
                  ...(charge.carriedBalanceCents
                    ? [{ label: "Adeudo anterior", cents: charge.carriedBalanceCents }]
                    : []),
                  { label: "Cargo por servicio", cents: charge.serviceFeeCents },
                ]}
              />
              {shortCents > 0 && (
                <dl className="mt-2 space-y-2 text-base">
                  <div className="flex justify-between gap-4 font-semibold">
                    <dt>Recibido</dt>
                    <dd>
                      <Amount cents={charge.totalCents} />
                    </dd>
                  </div>
                  {missingCents > 0 && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Faltan</dt>
                      <dd>
                        <Amount cents={missingCents} />
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              <p className="mt-3 font-mono text-sm text-muted-foreground">Folio {charge.folio}</p>
            </div>
            <div className="text-sm text-muted-foreground">
              <p>Registrado a las {at(charge.createdAt)}</p>
              <p className="mt-1">Intentos de reconexión: {charge.attempts}</p>
              {charge.lastError && (
                <p className="mt-1 text-error">{reasonFor(charge.lastError)}</p>
              )}
              {charge.reconnectedAt && (
                <p className="mt-1 text-success">
                  Reconectado a las {at(charge.reconnectedAt)}
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

  const feed = useInfiniteQuery<FeedResponse, ApiError>({
    queryKey: ["feed", status],
    queryFn: ({ pageParam }) =>
      api<FeedResponse>(feedPath({ cursor: pageParam as number | undefined, status })),
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
  /* D1/D5: a failed first load is an error, a failed page keeps its rows */
  const failedFirstLoad = feed.isError && !feed.data;
  const today = feed.data?.pages[0]?.today ?? null;
  const failedCount = failed.data?.charges.length ?? 0;

  return (
    <main className="px-4 pt-4 lg:px-8 lg:pt-8">
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

      {/* D7: status filters are shadcn Tabs. D8 (US-P04): the list lives
          inside TabsContent — a tab that advertises aria-controls without
          a panel points a screen reader at nothing. */}
      <Tabs value={status} onValueChange={setStatus} className="mt-4">
        <TabsList aria-label="Filtrar por estado">
          {statusFilters.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={status}>

      {failedFirstLoad && (
        <ListError
          what="los cobros"
          onRetry={() => void feed.refetch()}
          retrying={feed.isRefetching}
          className="mt-4"
        />
      )}

      {feed.isPending && !feed.isError && <FeedSkeleton />}

      {charges.length === 0 && !feed.isPending && !feed.isError && (
        <p className="mt-6 max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Sin cobros por aquí todavía. Aparecerán en cuanto tus tiendas empiecen a cobrar.
        </p>
      )}

      {/* design-review D9: the live region is the list, not the page —
          charge-feed asked for the feed to announce, and wrapping <main>
          re-read the heading, the alert and the chips on every filter. */}
      {charges.length > 0 && (
        <Card className="mt-4">
          <ul className="divide-y divide-line-soft" aria-live="polite">
            {charges.map((charge) => (
              <ChargeRow key={charge.id} charge={charge} />
            ))}
          </ul>
        </Card>
      )}

      {feed.isError && feed.data && (
        <ListError
          what="más cobros"
          onRetry={() => void feed.fetchNextPage()}
          retrying={feed.isFetchingNextPage}
          className="mt-4"
        />
      )}

      {feed.hasNextPage && !feed.isError && (
        <div className="mt-4 pb-6">
          <Button variant="outline" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
            {feed.isFetchingNextPage ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      )}
        </TabsContent>
      </Tabs>
    </main>
  );
}

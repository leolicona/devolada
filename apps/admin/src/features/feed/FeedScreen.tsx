import { useEffect, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  type Status,
} from "@devolada/ui";
import type { FeedCharge, FeedResponse, ProofResponse, RetryResponse } from "@devolada/api/payments-schema";
import { roleCan } from "@devolada/api/role-matrix";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { formatTime } from "@/lib/datetime";
import { useDisplaySettings, useSession } from "../auth/session";

/* Pagos (US-A01, payments-and-classes D4/D5). Polling every 5s — "live"
   without sockets (charge-feed D1). The ISP's timezone owns "today" and
   the date filters (settings D5). Every row carries its reconciliation
   class next to the action outcome; the proof opens in place. */

const POLL_MS = 5000;
const ALL = "all";

/* D4: chips are the questions an ISP actually asks — the queue's states
   (D5 keeps the action outcome its own dimension) plus the class chip
   "Pago parcial" (= `short`). The API's full lifecycle filter exists
   underneath; the UI grows into it. */
const statusFilters = [
  { value: ALL, label: "Todos" },
  { value: "queued", label: "En cola" },
  { value: "failed", label: "Fallidos" },
  { value: "withheld", label: "Sin reactivar" },
  { value: "reconnected", label: "Reconectados" },
  { value: "short", label: "Pago parcial" },
] as const;

type Filters = { chip: string; q: string; from: string; to: string };

function feedPath(opts: Partial<Filters> & { cursor?: number }): string {
  const params = new URLSearchParams();
  if (opts.cursor) params.set("cursor", String(opts.cursor));
  if (opts.chip === "short") params.set("class", "short");
  else if (opts.chip && opts.chip !== ALL) params.set("reconnection", opts.chip);
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  const qs = params.toString();
  return `/payments/feed${qs ? `?${qs}` : ""}`;
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

/* A row with no action outcome wears its lifecycle instead — an
   `unapplied` payment never met the router (D3). */
const lifecycleBadge: Partial<Record<FeedCharge["status"], Status>> = {
  validating: "validating",
  queued_for_credit: "validating",
  invalid: "paymentInvalid",
  expired: "paymentExpired",
  superseded: "paymentExpired",
  unapplied: "unapplied",
};

const classBadge: Record<NonNullable<FeedCharge["reconciliationClass"]>, Status> = {
  exact: "classExact",
  short: "classShort",
  over: "classOver",
};

/* D4: the proof is the whole truth — the CEP as Banxico answered it and
   the payer's capture — read for every role. */
function ProofDialog({ charge }: { charge: FeedCharge }) {
  const [open, setOpen] = useState(false);
  const proof = useQuery<ProofResponse, ApiError>({
    queryKey: ["payment-proof", charge.id],
    queryFn: () => api<ProofResponse>(`/payments/${charge.id}/proof`),
    enabled: open,
  });
  const line = (label: string, value: ReactNode) => (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-right">{value ?? "—"}</dd>
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Ver comprobante</Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Comprobante · {charge.customerName}</DialogTitle>
        {proof.isPending && <Skeleton className="h-24 w-full" />}
        {proof.error && (
          <Alert variant="destructive">
            No pudimos cargar el comprobante.{" "}
            <button type="button" className="underline" onClick={() => void proof.refetch()}>
              Reintentar
            </button>
          </Alert>
        )}
        {proof.data && (
          <div className="space-y-4">
            {proof.data.cep ? (
              <dl className="grid gap-2 text-sm">
                {line(
                  "Clave de rastreo",
                  proof.data.cep.trackingKey ? (
                    <span className="font-mono">{proof.data.cep.trackingKey}</span>
                  ) : (
                    "—"
                  ),
                )}
                {line("Monto", <Amount cents={proof.data.cep.amountCents} />)}
                {line("Fecha", proof.data.cep.date)}
                {line("Banco emisor", proof.data.cep.senderBank)}
                {line("Ordenante", proof.data.cep.senderName)}
                {line("Beneficiario", proof.data.cep.beneficiaryName)}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Banxico aún no confirma esta transferencia; el CEP aparecerá aquí cuando responda.
              </p>
            )}
            {proof.data.imageUrl ? (
              <figure className="space-y-2">
                <img
                  src={proof.data.imageUrl}
                  alt="Comprobante enviado por el cliente"
                  className="max-h-96 w-full rounded-md border border-border object-contain"
                />
                <a
                  className="text-sm underline"
                  href={proof.data.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir en otra pestaña
                </a>
              </figure>
            ) : (
              <p className="text-sm text-muted-foreground">
                {proof.data.proofMode === "transfer"
                  ? "El cliente capturó los datos a mano; no envió imagen."
                  : "Sin imagen guardada."}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* D4 + D7: detail expands in place with a Collapsible row */
function ChargeRow({
  charge,
  treatment,
  canOperate,
}: {
  charge: FeedCharge;
  treatment: "flag" | "credit";
  canOperate: boolean;
}) {
  const { timeFormat, timezone } = useDisplaySettings();
  const queryClient = useQueryClient();
  const at = (ms: number) => formatTime(ms, timeFormat, timezone);

  /* D5: one click buys exactly one fresh attempt; the sweep does the rest */
  const retry = useMutation<RetryResponse, ApiError>({
    mutationFn: () =>
      api<RetryResponse>(`/payments/${charge.id}/retry-reconnection`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["feed"] }),
  });

  const shortCents = charge.askedCents - charge.receivedCents;
  const badge: Status =
    charge.reconnectionStatus ?? lifecycleBadge[charge.status] ?? "validating";
  const showsMoney = ["confirmed", "partial", "unapplied"].includes(charge.status);
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
            <span className="block text-sm text-muted-foreground">Pago directo · SPEI</span>
          </span>
          <Amount
            cents={charge.receivedCents}
            className="shrink-0 text-right text-sm font-semibold sm:order-last sm:w-20"
          />
          <span className="col-span-2 flex flex-wrap gap-2 sm:contents">
            <StatusBadge status={badge} />
            {/* D4: the class next to the action outcome — a lenient
                threshold can reconnect a short payment, and the class is
                what keeps saying money is missing */}
            {charge.reconciliationClass && (
              <StatusBadge status={classBadge[charge.reconciliationClass]} />
            )}
          </span>
          <ChevronDown
            className="size-4 shrink-0 justify-self-end text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-6 border-t border-line-soft bg-muted/50 p-4 sm:grid-cols-2 sm:pl-20">
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
              {(shortCents > 0 || charge.surplusCents > 0) && (
                <dl className="mt-2 space-y-2 text-base">
                  <div className="flex justify-between gap-4 font-semibold">
                    <dt>Recibido</dt>
                    <dd>
                      <Amount cents={charge.receivedCents} />
                    </dd>
                  </div>
                  {charge.missingCents > 0 && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Faltan</dt>
                      <dd>
                        <Amount cents={charge.missingCents} />
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {/* partial-payment D15's voice, now for `over` too (D2):
                  what the surplus means depends on where the money went —
                  and for `unapplied` nothing absorbed it, so it is always
                  the business's to resolve. */
              charge.surplusCents > 0 && (
                <p className="mt-2 text-sm font-medium">
                  Sobrante <Amount cents={charge.surplusCents} /> —{" "}
                  {charge.status === "unapplied"
                    ? "resolver con el cliente."
                    : treatment === "credit"
                      ? "queda a favor del cliente."
                      : "devolver al cliente."}
                </p>
              )}
              <p className="mt-3 font-mono text-sm text-muted-foreground">
                Folio {charge.folio || "—"}
              </p>
            </div>
            <div className="text-sm text-muted-foreground">
              <p>Registrado a las {at(charge.createdAt)}</p>
              <p className="mt-1">Intentos de reconexión: {charge.attempts}</p>
              {charge.lastError && <p className="mt-1 text-error">{reasonFor(charge.lastError)}</p>}
              {charge.reconnectedAt && (
                <p className="mt-1 text-success">Reconectado a las {at(charge.reconnectedAt)}</p>
              )}
              {retry.error && (
                <p className="mt-1 text-error">
                  {retry.error.code === "NOT_RETRYABLE"
                    ? "Esta reconexión ya no está fallida."
                    : "No pudimos reintentar. Intenta de nuevo."}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {showsMoney && <ProofDialog charge={charge} />}
                {/* D5: promised to operators by the role matrix since
                    phase 2; kept until now only by waiting */}
                {canOperate && charge.reconnectionStatus === "failed" && (
                  <Button disabled={retry.isPending} onClick={() => retry.mutate()}>
                    {retry.isPending ? "Reintentando…" : "Reintentar reconexión"}
                  </Button>
                )}
              </div>
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
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data: actor } = useSession();
  const canOperate = roleCan(actor?.role ?? "viewer", "payments", "operate");

  /* The search travels debounced: a keystroke is not a query */
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const filters: Filters = { chip: status, q, from, to };
  const feed = useInfiniteQuery<FeedResponse, ApiError>({
    queryKey: ["feed", status, q, from, to],
    queryFn: ({ pageParam }) =>
      api<FeedResponse>(feedPath({ ...filters, cursor: pageParam as number | undefined })),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: POLL_MS,
  });

  /* D3: failures beyond page one still surface */
  const failed = useQuery<FeedResponse, ApiError>({
    queryKey: ["feed", "failed-strip"],
    queryFn: () => api<FeedResponse>(feedPath({ chip: "failed" })),
    refetchInterval: POLL_MS,
  });

  const rows = feed.data?.pages.flatMap((p) => p.payments) ?? [];
  /* D1/D5: a failed first load is an error, a failed page keeps its rows */
  const failedFirstLoad = feed.isError && !feed.data;
  const today = feed.data?.pages[0]?.today ?? null;
  const treatment = feed.data?.pages[0]?.effectiveOverTreatment ?? "flag";
  const failedCount = failed.data?.payments.length ?? 0;

  return (
    <main className="px-4 pt-4 lg:px-8 lg:pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Pagos</h1>
        {today && (
          <p className="text-sm text-muted-foreground">
            Hoy: <span className="font-semibold text-foreground">{formatMoney(today.totalCents)}</span> ·{" "}
            {today.count} {today.count === 1 ? "pago" : "pagos"}
          </p>
        )}
      </div>

      {failedCount > 0 && status !== "failed" && (
        <Alert variant="warning" className="mt-4 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {failedCount} {failedCount === 1 ? "pago fallido necesita" : "pagos fallidos necesitan"} tu atención.
          </span>
          <Button variant="outline" onClick={() => setStatus("failed")}>
            Verlos
          </Button>
        </Alert>
      )}

      {/* D4: customer search and the date range, in the business's zone */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Label htmlFor="feed-q">Cliente</Label>
          <Input
            id="feed-q"
            type="search"
            className="mt-1"
            placeholder="Nombre o usuario"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="feed-from">Desde</Label>
          <Input
            id="feed-from"
            type="date"
            className="mt-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="feed-to">Hasta</Label>
          <Input
            id="feed-to"
            type="date"
            className="mt-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

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
          what="los pagos"
          onRetry={() => void feed.refetch()}
          retrying={feed.isRefetching}
          className="mt-4"
        />
      )}

      {feed.isPending && !feed.isError && <FeedSkeleton />}

      {rows.length === 0 && !feed.isPending && !feed.isError && (
        <p className="mt-6 max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Sin pagos por aquí todavía. Aparecerán en cuanto tus clientes empiecen a pagar.
        </p>
      )}

      {/* design-review D9: the live region is the list, not the page —
          charge-feed asked for the feed to announce, and wrapping <main>
          re-read the heading, the alert and the chips on every filter. */}
      {rows.length > 0 && (
        <Card className="mt-4">
          <ul className="divide-y divide-line-soft" aria-live="polite">
            {rows.map((charge) => (
              <ChargeRow key={charge.id} charge={charge} treatment={treatment} canOperate={canOperate} />
            ))}
          </ul>
        </Card>
      )}

      {feed.isError && feed.data && (
        <ListError
          what="más pagos"
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

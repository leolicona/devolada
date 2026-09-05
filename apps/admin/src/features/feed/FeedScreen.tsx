import { useEffect, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Search, TriangleAlert } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { formatTime } from "@/lib/datetime";
import { useDisplaySettings, useSession } from "../auth/session";
import { ListSkeleton, PAGE_STACK, PageFrame } from "../shell/PageFrame";
import { DateRangeField } from "./DateRangeField";

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
  /* pilot-UX round: money in flight is now in the default view too;
     this chip isolates it — status filter, not an action one */
  { value: "validating", label: "Verificando" },
  { value: "queued", label: "En cola" },
  { value: "failed", label: "Fallidos" },
  { value: "withheld", label: "Sin reactivar" },
  { value: "done", label: "Reconectados" },
  { value: "short", label: "Pago parcial" },
] as const;

type Filters = { chip: string; q: string; from: string; to: string };

function feedPath(opts: Partial<Filters> & { cursor?: number }): string {
  const params = new URLSearchParams();
  if (opts.cursor) params.set("cursor", String(opts.cursor));
  if (opts.chip === "short") params.set("class", "short");
  else if (opts.chip === "validating") params.set("status", "validating");
  else if (opts.chip && opts.chip !== ALL) params.set("action", opts.chip);
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  const qs = params.toString();
  return `/payments/feed${qs ? `?${qs}` : ""}`;
}

/* The queue writes a code; the ISP reads a sentence
   (reconnection-queue spec UI contract). */
const reasons: Record<string, string> = {
  WISPHUB_AUTH_FAILED: "WispHub rechazó la llave. Revísala en Integraciones.",
  WISPHUB_NOT_CONFIGURED: "Falta la llave de WispHub en Integraciones.",
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

/* integrations-hub D5: the recorded hypothesis, in the ISP's words */
function hypothesisCopy(observed: string | null): string {
  if (observed === "register_only") return "Se habría registrado (solo registrar).";
  if (observed === "register_and_reconnect:withhold")
    return "Se habría registrado sin reactivar (umbral).";
  return "Se habría reconectado.";
}

const classBadge: Record<NonNullable<FeedCharge["reconciliationClass"]>, Status> = {
  exact: "classExact",
  short: "classShort",
  over: "classOver",
};

/* design-review 2026-09-01 (should fix): the CEP date read as raw ISO
   while every neighbour formats es-MX. Noon anchors the Date so no
   timezone can slide the calendar day. */
const fmtCepDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

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
                {line("Fecha", proof.data.cep.date ? fmtCepDate(proof.data.cep.date) : null)}
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
      api<RetryResponse>(`/payments/${charge.id}/retry-action`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["feed"] }),
  });

  /* integrations-hub D5: dispatch exactly what the gate recorded — one
     row, one human look. Observation rows only. */
  const execute = useMutation<RetryResponse, ApiError>({
    mutationFn: () =>
      api<RetryResponse>(`/payments/${charge.id}/execute-action`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["feed"] }),
  });

  const shortCents = charge.askedCents - charge.receivedCents;
  /* integrations-hub D7: the row speaks the generic vocabulary; the
     badge keeps the action-specific es-MX word, from the ledger's last
     dispatch — "Reconectado" under register_and_reconnect, "Registrado"
     under register_only. */
  const badge: Status =
    charge.actionOutcome === "done"
      ? charge.dispatchedAction === "register_only"
        ? "registered"
        : "reconnected"
      : (charge.actionOutcome ?? lifecycleBadge[charge.status] ?? "validating");
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
          <span className="col-span-2 flex flex-wrap gap-2 sm:contents">
            <StatusBadge status={badge} />
            {/* D4: the class next to the action outcome — a lenient
                threshold can reconnect a short payment, and the class is
                what keeps saying money is missing */}
            {charge.reconciliationClass && (
              <StatusBadge status={classBadge[charge.reconciliationClass]} />
            )}
          </span>
          {/* espaciado review E9: the amount ends the row and the chevron
              closes it, as in Cobros. It used to ride `sm:order-last`,
              which put the disclosure affordance *between* the badges and
              the number the eye scans down the right edge. The grid keeps
              its phone placement explicitly, since the DOM order that
              fixes the flex row would otherwise wrap it to a third row. */}
          <Amount
            cents={charge.receivedCents}
            className="col-start-3 row-start-1 shrink-0 text-right text-sm font-semibold sm:w-20"
          />
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
              {charge.actionOutcome === "observation" ? (
                /* D5: the hypothesis is the ramp's instrument — the ISP
                   compares the oracle against their own hand */
                <p className="mt-1 font-medium text-info">
                  {hypothesisCopy(charge.observedAction)}
                </p>
              ) : (
                <p className="mt-1">Intentos de reconexión: {charge.actionAttempts}</p>
              )}
              {charge.actionError && <p className="mt-1 text-error">{reasonFor(charge.actionError)}</p>}
              {charge.actionDoneAt && (
                <p className="mt-1 text-success">Reconectado a las {at(charge.actionDoneAt)}</p>
              )}
              {execute.error && (
                <p className="mt-1 text-error">
                  {execute.error.code === "NOT_OBSERVED"
                    ? "Esta acción ya se ejecutó."
                    : execute.error.code === "NOT_CONFIGURED"
                      ? "Conecta WispHub para poder ejecutarla."
                      : "No pudimos ejecutar la acción. Intenta de nuevo."}
                </p>
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
                {canOperate && charge.actionOutcome === "failed" && (
                  <Button disabled={retry.isPending} onClick={() => retry.mutate()}>
                    {retry.isPending ? "Reintentando…" : "Reintentar reconexión"}
                  </Button>
                )}
                {/* D5: only observation rows — `withheld` offers nothing;
                    the threshold is the owner's law */}
                {canOperate && charge.actionOutcome === "observation" && (
                  <Button disabled={execute.isPending} onClick={() => execute.mutate()}>
                    {execute.isPending ? "Ejecutando…" : "Ejecutar ahora"}
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
    <ListSkeleton
      leading={<Skeleton className="h-4 w-12" />}
      trailing={
        <>
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-4 w-16" />
        </>
      }
    />
  );
}

export function FeedScreen() {
  const [status, setStatus] = useState<string>(ALL);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data: actor } = useSession();
  const { timezone } = useDisplaySettings();
  const canOperate = roleCan(actor?.role ?? "viewer", "payments", "operate");

  /* The search travels debounced: a keystroke is not a query */
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const filters: Filters = { chip: status, q, from, to };
  /* D10: a list filtered down to nothing is not a business that was
     never paid — the empty copy must say which it is. */
  const hasFilters = status !== ALL || q !== "" || from !== "" || to !== "";
  const clearFilters = () => {
    setStatus(ALL);
    setQInput("");
    setQ("");
    setFrom("");
    setTo("");
  };
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
    <PageFrame
      title="Pagos"
      actions={
        today && (
          <p className="text-sm text-muted-foreground">
            Hoy: <span className="font-semibold text-foreground">{formatMoney(today.totalCents)}</span> ·{" "}
            {today.count} {today.count === 1 ? "pago" : "pagos"}
          </p>
        )
      }
    >
      {failedCount > 0 && status !== "failed" && (
        <Alert variant="warning" className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {failedCount} {failedCount === 1 ? "pago fallido necesita" : "pagos fallidos necesitan"} tu atención.
          </span>
          <Button variant="outline" onClick={() => setStatus("failed")}>
            Verlos
          </Button>
        </Alert>
      )}

      {/* D7: status filters are shadcn Tabs. D8 (US-P04): the list lives
          inside TabsContent — a tab that advertises aria-controls without
          a panel points a screen reader at nothing.
          design-review 2026-09-02 (pagos-filtros, D4): the chips come
          first — they choose the view, the search and the dates narrow it
          — and the whole bar sits directly on the panel it labels, as in
          Cobros. */}
      <Tabs value={status} onValueChange={setStatus} className={PAGE_STACK}>
        <section aria-label="Filtros">
          {/* design-review 2026-09-01 (should fix): one scrollable line on
              a phone instead of three wrapped ones; desktop keeps the wrap.
              design-review 2026-09-02: the rail bleeds to the screen edge
              (a cut that stops 16px short read as clipping, not as "more"),
              keeps 4px on both axes for the 3px focus ring that
              `overflow-x: auto` — which forces `overflow-y: auto` — was
              slicing off, and hides the scrollbar a classic-scrollbar OS
              would paint under the chips. */}
          <TabsList
            aria-label="Filtrar por estado"
            className="-mx-4 -my-1 flex flex-nowrap overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:my-0 sm:flex-wrap sm:overflow-x-visible sm:p-0"
          >
            {statusFilters.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* D4 (2026-09-02 revision): the search leads with the verb and
              carries a magnifier, so it needs no label; the dates are a
              calendar of our own — the native pickers rendered
              `mm/dd/yyyy` whatever `lang` said. The row wraps: two rows
              in the common case, the trigger drops to its own line only
              when a wide range makes it wide. */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="min-w-48 flex-1 sm:max-w-sm">
              <Input
                id="feed-q"
                type="search"
                icon={Search}
                className="h-11 sm:h-10"
                placeholder="Buscar cliente"
                aria-label="Buscar por nombre o usuario"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
            </div>
            <DateRangeField
              from={from}
              to={to}
              onChange={(f, t) => {
                setFrom(f);
                setTo(t);
              }}
              timezone={timezone}
              todayMs={today?.startedAtMs}
            />
          </div>
        </section>
        <TabsContent value={status} className={PAGE_STACK}>
          {failedFirstLoad && (
            <ListError what="los pagos" onRetry={() => void feed.refetch()} retrying={feed.isRefetching} />
          )}

          {feed.isPending && !feed.isError && <FeedSkeleton />}

          {rows.length === 0 && !feed.isPending && !feed.isError && (
            <p className="max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
              {hasFilters ? (
                <>
                  Ningún pago coincide con estos filtros.{" "}
                  <button type="button" className="underline" onClick={clearFilters}>
                    Limpiar filtros
                  </button>
                </>
              ) : (
                "Sin pagos por aquí todavía. Aparecerán en cuanto tus clientes empiecen a pagar."
              )}
            </p>
          )}

          {/* design-review D9: the live region is the list, not the page —
              charge-feed asked for the feed to announce, and wrapping <main>
              re-read the heading, the alert and the chips on every filter.
              espaciado review E3: the card clips, or a row's hover fill
              squares off the 10px corner it is painted over. */}
          {rows.length > 0 && (
            <Card className="overflow-hidden">
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
            />
          )}

          {feed.hasNextPage && !feed.isError && (
            <div>
              <Button variant="outline" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
                {feed.isFetchingNextPage ? "Cargando…" : "Cargar más"}
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PageFrame>
  );
}

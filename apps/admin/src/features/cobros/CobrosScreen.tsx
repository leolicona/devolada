import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, RefreshCw, TriangleAlert, Check, Link as LinkIcon, Share2 } from "lucide-react";
import { Alert, Amount, Card, Skeleton } from "@devolada/ui";
import type { CobroRow, PaymentRequestsResponse } from "@devolada/api/payment-requests-schema";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { roleCan } from "@devolada/api/role-matrix";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { useDisplaySettings, useSession } from "../auth/session";

/* Cobros — who owes what, read live from WispHub (cobros-live spec,
   US-R01). No copy exists anywhere (D6): this screen holds WispHub's
   answer in query memory for two minutes (D3) and says how old it is.
   The whole list travels once; grouping, search, filter and paging are
   local (D4). */

const STALE_MS = 2 * 60_000; /* D3: the owner's navigate-and-return case */
const PAGE = 50; /* customer rows per local page (D4) */

type CustomerGroup = {
  usuario: string;
  name: string;
  totalCents: number;
  cobros: CobroRow[];
  /* The oldest due date drives order and the Vencidas filter */
  oldestDue: string | null;
  overdue: boolean;
};

/* YYYY-MM-DD in the business's zone (settings D5) — "overdue" must not
   flip at UTC midnight */
function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

const fmtDay = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : null;

export function groupCobros(cobros: CobroRow[], today: string): CustomerGroup[] {
  const byCustomer = new Map<string, CustomerGroup>();
  for (const c of cobros) {
    const g = byCustomer.get(c.customerUsuario) ?? {
      usuario: c.customerUsuario,
      name: c.customerName ?? c.customerUsuario,
      totalCents: 0,
      cobros: [],
      oldestDue: null,
      overdue: false,
    };
    g.totalCents += c.amountCents;
    g.cobros.push(c);
    if (c.customerName) g.name = c.customerName;
    const due = c.dueDate ?? c.invoiceDate;
    if (due && (g.oldestDue === null || due < g.oldestDue)) g.oldestDue = due;
    if (c.dueDate && c.dueDate < today) g.overdue = true;
    byCustomer.set(c.customerUsuario, g);
  }
  for (const g of byCustomer.values()) {
    /* Oldest first inside the customer too — the payer's link agrees (D8) */
    g.cobros.sort(
      (a, b) => (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "") || a.externalId - b.externalId,
    );
  }
  /* The oldest debt is the urgent one (D4) */
  return [...byCustomer.values()].sort((a, b) =>
    (a.oldestDue ?? "9999").localeCompare(b.oldestDue ?? "9999"),
  );
}

/* "Consultado hace X" — the label a mirror-less screen owes (D3/D5's
   spirit: fresh data still says when it was asked for) */
function Freshness({ at }: { at: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.floor((Date.now() - at) / 60_000);
  return (
    <span className="text-sm text-muted-foreground">
      {mins < 1 ? "Consultado hace un momento" : `Consultado hace ${mins} min`}
    </span>
  );
}

function CustomerRow({ group, canOperate }: { group: CustomerGroup; canOperate: boolean }) {
  const n = group.cobros.length;
  /* pilot-UX round: the link is per person — one pair of actions per
     customer, in the expansion (the collapsed row is full at 360px).
     Null (roster not visited yet) simply hides them. */
  const linkUrl = group.cobros[0]?.linkUrl ?? null;
  const waLink = group.cobros[0]?.waLink ?? null;
  const [copied, setCopied] = useState<null | boolean>(null);
  const copyLink = async () => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(linkUrl!);
    } catch {
      ok = false;
    }
    setCopied(ok);
    setTimeout(() => setCopied(null), 2000);
  };
  return (
    <li>
      <Collapsible>
        <CollapsibleTrigger className="group grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 p-4 text-left transition-colors duration-150 hover:bg-muted sm:flex sm:gap-4">
          <span className="min-w-0 sm:flex-1">
            <span className="block text-sm font-medium">{group.name}</span>
            <span className="block text-sm text-muted-foreground">
              {group.usuario} · {n} {n === 1 ? "factura" : "facturas"}
            </span>
          </span>
          {/* status never by color alone: the word carries it (FRONTEND law) */}
          {group.overdue ? (
            <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-error">
              <TriangleAlert className="size-4" aria-hidden />
              Venció {fmtDay(group.oldestDue)}
            </span>
          ) : (
            group.oldestDue && (
              <span className="shrink-0 text-sm text-muted-foreground">Vence {fmtDay(group.oldestDue)}</span>
            )
          )}
          <Amount cents={group.totalCents} className="shrink-0 text-right text-sm font-semibold sm:w-24" />
          <ChevronDown
            className="size-4 shrink-0 justify-self-end text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {canOperate && linkUrl && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft bg-muted/50 px-4 pt-3">
              <Button variant="outline" aria-live="polite" onClick={() => void copyLink()}>
                {copied === null ? (
                  <>
                    <LinkIcon className="size-4" aria-hidden /> Copiar link
                  </>
                ) : copied ? (
                  <>
                    <Check className="size-4" aria-hidden /> Copiado
                  </>
                ) : (
                  "No se copió"
                )}
              </Button>
              {waLink && (
                <Button onClick={() => window.open(waLink, "_blank", "noopener,noreferrer")}>
                  <Share2 className="size-4" aria-hidden /> WhatsApp
                </Button>
              )}
            </div>
          )}
          <ul className="border-t border-line-soft bg-muted/50 px-4 py-2" aria-label={`Facturas de ${group.name}`}>
            {group.cobros.map((c) => (
              <li key={c.externalId} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
                <span className="text-muted-foreground">
                  {fmtDay(c.invoiceDate) ?? `Factura ${c.externalId}`}
                  {c.dueDate && <span> · vence {fmtDay(c.dueDate)}</span>}
                </span>
                <Amount cents={c.amountCents} />
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

const filters = [
  { value: "all", label: "Todas" },
  { value: "overdue", label: "Vencidas" },
  { value: "upcoming", label: "Por vencer" },
] as const;

export function CobrosScreen() {
  const { timezone } = useDisplaySettings();
  const { data: actor } = useSession();
  const canOperate = roleCan(actor?.role ?? "viewer", "payments", "operate");
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [pages, setPages] = useState(1);

  const query = useQuery<PaymentRequestsResponse, ApiError>({
    queryKey: ["payment-requests"],
    queryFn: () => api<PaymentRequestsResponse>("/payment-requests"),
    staleTime: STALE_MS,
    retry: false,
  });

  const groups = useMemo(
    () => groupCobros(query.data?.cobros ?? [], todayIn(timezone)),
    [query.data, timezone],
  );
  const needle = q.trim().toLowerCase();
  const visible = groups
    .filter((g) => (filter === "overdue" ? g.overdue : filter === "upcoming" ? !g.overdue : true))
    .filter((g) => !needle || g.name.toLowerCase().includes(needle) || g.usuario.toLowerCase().includes(needle));
  const shown = visible.slice(0, pages * PAGE);

  /* D9: without an integration there are no Cobros — the section says
     how to connect. (Integraciones is phase 5; the key lives in
     Configuración today.) */
  if (query.error?.code === "NOT_CONFIGURED") {
    return (
      <main className="px-4 pt-4 lg:px-8 lg:pt-8">
        <h1 className="text-xl font-semibold">Cobros</h1>
        <Card className="mt-4 p-6">
          <p className="text-sm">Conecta WispHub para ver tus cobros.</p>
          <Link to="/settings" className="mt-3 block">
            <Button variant="outline">Ir a Configuración</Button>
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="px-4 pt-4 lg:px-8 lg:pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Cobros</h1>
        <div className="flex items-center gap-3">
          {query.dataUpdatedAt > 0 && <Freshness at={query.dataUpdatedAt} />}
          <Button
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-label="Actualizar"
          >
            <RefreshCw className={`size-4 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden />
            Actualizar
          </Button>
        </div>
      </div>

      {/* D7: a failed read says so — never an empty claim, never stale
          data presented as fresh */}
      {query.error && (
        <Alert variant="destructive" className="mt-4 flex items-center justify-between gap-4">
          <span>No pudimos consultar tus cobros en WispHub.</span>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}

      {query.data && !query.data.complete && (
        /* D4: a cut-off read warns, never a silent truncation */
        <Alert variant="warning" className="mt-4 flex items-center gap-2">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          La lista puede estar incompleta: WispHub devolvió más facturas de las que pudimos leer.
        </Alert>
      )}

      {query.isPending && (
        <Card className="mt-4 p-4">
          {[0, 1, 2].map((k) => (
            <div key={k} className="flex items-center gap-4 py-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </Card>
      )}

      {query.data && (
        <Tabs value={filter} onValueChange={(v) => { setFilter(v); setPages(1); }} className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList aria-label="Filtrar cobros">
              {filters.map((f) => (
                <TabsTrigger key={f.value} value={f.value}>
                  {f.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <Input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPages(1); }}
              placeholder="Buscar por nombre o usuario"
              aria-label="Buscar por nombre o usuario"
              className="w-full sm:w-64"
            />
          </div>
          {filters.map((f) => (
            <TabsContent key={f.value} value={f.value}>
              {visible.length === 0 ? (
                <Card className="mt-4 p-6 text-sm text-muted-foreground">
                  {needle
                    ? "Nadie coincide con tu búsqueda."
                    : f.value === "overdue"
                      ? "No hay cobros vencidos."
                      : "Nadie te debe hoy."}
                </Card>
              ) : (
                <Card className="mt-4 overflow-hidden p-0">
                  <ul className="divide-y divide-line-soft" aria-label="Cobros pendientes">
                    {shown.map((g) => (
                      <CustomerRow key={g.usuario} group={g} canOperate={canOperate} />
                    ))}
                  </ul>
                </Card>
              )}
              {visible.length > shown.length && (
                <Button variant="outline" className="mt-3" onClick={() => setPages((p) => p + 1)}>
                  Mostrar más ({visible.length - shown.length} restantes)
                </Button>
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </main>
  );
}

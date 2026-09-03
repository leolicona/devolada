import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Share2, Link as LinkIcon, AlertCircle, Check, WifiOff } from "lucide-react";
import { Card, ListError, Skeleton, Alert } from "@devolada/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { liveReadOptions, usePresence } from "@/lib/presence";
import type { LinksRosterResponse } from "@devolada/api/direct-payments-schema";
import { roleCan } from "@devolada/api/role-matrix";
import { useSession } from "../auth/session";

/* US-D07, amended by the pilot-UX round: the page is the ROSTER — every
   customer with their permanent link, alive on arrival — and search is
   a local contains over name, usuario and phone at once. The old
   WispHub search guessed one exact-match parameter from the text's
   shape, started blank, and forgot everything on navigation; the
   Cobros pattern (whole list, 30s server cache, 2min query memory,
   50 per local page) kills all three at once.

   presence-freshness (US-P07): no "Actualizar". The roster re-reads on
   return to the tab, on a slow heartbeat while someone is present, and
   a failed background read keeps the rows with a quiet note. */

const STALE_MS = 2 * 60_000;
const PAGE = 50;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function Freshness({ readAt }: { readAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(0, Math.round((Date.now() - readAt) / 60_000));
  return (
    <span className="text-sm text-muted-foreground">
      {mins === 0 ? "consultado hace un momento" : `consultado hace ${mins} min`}
    </span>
  );
}

type Row = LinksRosterResponse["results"][number];

function LinkRow({ row, canOperate }: { row: Row; canOperate: boolean }) {
  const [copyResult, setCopyResult] = useState<{ ok: boolean } | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const handleCopy = async () => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(row.url);
    } catch {
      ok = false;
    }
    setCopyResult({ ok });
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyResult(null), 2000);
  };

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 p-4 sm:flex">
      <div className="min-w-0 sm:flex-1">
        <span className="block text-sm font-medium">{row.name || row.usuario}</span>
        {/* a nameless customer must not read their usuario twice */}
        <span className="block text-sm text-muted-foreground">
          {row.name ? row.usuario : "Sin nombre en WispHub"}
          {row.phone ? ` · ${row.phone}` : ""}
        </span>
      </div>
      {/* business-and-memberships D3: sharing is `payments: operate`;
          a viewer sees the customer and nothing to press */}
      {canOperate && (
        <div className="col-span-2 flex items-center justify-end gap-2 sm:contents">
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => void handleCopy()}
            title="Copiar enlace"
            aria-live="polite"
          >
            {copyResult ? (
              copyResult.ok ? (
                <>
                  <Check className="mr-2 size-4" aria-hidden />
                  Copiado
                </>
              ) : (
                <>
                  <AlertCircle className="mr-2 size-4" aria-hidden />
                  No se copió
                </>
              )
            ) : (
              <>
                <LinkIcon className="size-4" aria-hidden />
                <span className="sr-only">Copiar</span>
              </>
            )}
          </Button>
          <Button
            className="shrink-0"
            onClick={() => window.open(row.waLink, "_blank", "noopener,noreferrer")}
          >
            <Share2 className="mr-2 size-4" aria-hidden />
            WhatsApp
          </Button>
        </div>
      )}
    </li>
  );
}

export function LinksScreen() {
  const { data: actor } = useSession();
  /* D5 (2026-09-02): a link nobody can pay is not shared — until the
     CLABE lands, the roster reads and the buttons wait */
  const speiConfigured = actor?.speiConfigured ?? true;
  const canOperate = roleCan(actor?.role ?? "viewer", "payments", "operate") && speiConfigured;
  const present = usePresence();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const roster = useQuery<LinksRosterResponse, ApiError>({
    queryKey: ["links-roster"],
    queryFn: () => api<LinksRosterResponse>("/direct-payments/links/roster"),
    staleTime: STALE_MS,
    retry: false,
    ...liveReadOptions(present),
  });

  const q = norm(search.trim());
  const filtered = useMemo(() => {
    const all = roster.data?.results ?? [];
    if (!q) return all;
    return all.filter(
      (r) =>
        norm(r.name).includes(q) || norm(r.usuario).includes(q) || (r.phone ?? "").includes(q),
    );
  }, [roster.data, q]);
  const visible = filtered.slice(0, limit);

  /* The code, not the status: the roster answers 503 both for a missing
     key (WISPHUB_NOT_CONFIGURED) and for a provider that stalled
     (WISPHUB_UNAVAILABLE), and only the first one is "conecta tu llave"
     (found by presence-freshness scenario 5) */
  const isConfigError = roster.isError && roster.error?.code === "WISPHUB_NOT_CONFIGURED";
  /* D9: a background failure with rows on screen is a quiet note, never
     the error block — that one is for a failure with nothing to show */
  const staleAfterFailure = roster.isError && !!roster.data && !isConfigError;

  return (
    <main className="px-4 pt-4 lg:px-8 lg:pt-8 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* The glossary's full term; the nav carries the short form */}
        <h1 className="text-xl font-semibold">Links de pago</h1>
        {/* D7/D9: the only freshness signal — it ticks from the provider
            read's time, and there is nothing to press */}
        {roster.data && <Freshness readAt={roster.data.readAt} />}
      </div>

      <div className="mt-6">
        <label className="relative block max-w-md">
          <span className="sr-only">Buscar cliente</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden />
          {/* name + autoComplete: without them, phone password managers
              saw a field near the word "usuario" and offered credentials */}
          <Input
            type="search"
            name="roster-search"
            autoComplete="off"
            placeholder="Buscar por nombre, usuario o teléfono..."
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(PAGE);
            }}
          />
        </label>
      </div>

      {/* No page notice for the missing CLABE: the shell's banner already
          says it one screen above (design review identidad-2, should fix 2) */}

      {isConfigError && (
        <Alert variant="destructive" layout="icon" className="mt-6">
          <AlertCircle aria-hidden />
          <span>
            <strong>Sin conexión a WispHub.</strong> Conecta tu llave en Integraciones para ver a
            tus clientes y sus links.
          </span>
        </Alert>
      )}

      {staleAfterFailure && (
        <p
          role="status"
          className="mt-6 flex max-w-lg items-center gap-2 rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden />
          Sin conexión a WispHub. Mostrando la última lectura.
        </p>
      )}

      {roster.isError && !roster.data && !isConfigError && (
        <ListError
          what="los links"
          onRetry={() => void roster.refetch()}
          retrying={roster.isRefetching}
          className="mt-6"
        />
      )}

      {roster.isPending && !roster.isError && (
        <Card className="mt-6 p-4">
          {[0, 1, 2].map((k) => (
            <div key={k} className="flex items-center gap-4 py-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
          ))}
        </Card>
      )}

      <div aria-live="polite">
        {roster.data && !roster.data.complete && (
          <Alert variant="warning" className="mt-6">
            La lista puede estar incompleta: WispHub devolvió más clientes de los que podemos leer
            de una vez.
          </Alert>
        )}

        {roster.data && filtered.length === 0 && (
          <p className="mt-6 max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
            {q
              ? `Ningún cliente coincide con "${search.trim()}".`
              : "WispHub no devolvió clientes todavía."}
          </p>
        )}

        {visible.length > 0 && (
          <Card className="mt-6">
            <ul className="divide-y divide-line-soft">
              {visible.map((row) => (
                <LinkRow key={row.usuario} row={row} canOperate={canOperate} />
              ))}
            </ul>
          </Card>
        )}

        {filtered.length > limit && (
          <div className="mt-4">
            <Button variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
              Mostrar más ({filtered.length - limit} restantes)
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

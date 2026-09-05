import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Share2, Link as LinkIcon, AlertCircle, Check, RefreshCw } from "lucide-react";
import { Card, ListError, Skeleton, Alert } from "@devolada/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LinksRosterResponse } from "@devolada/api/direct-payments-schema";
import { roleCan } from "@devolada/api/role-matrix";
import { useSession } from "../auth/session";
import { ListSkeleton, PAGE_STACK, PageFrame } from "../shell/PageFrame";

/* US-D07, amended by the pilot-UX round: the page is the ROSTER — every
   customer with their permanent link, alive on arrival — and search is
   a local contains over name, usuario and phone at once. The old
   WispHub search guessed one exact-match parameter from the text's
   shape, started blank, and forgot everything on navigation; the
   Cobros pattern (whole list, 30s server cache, 2min query memory,
   50 per local page) kills all three at once. */

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
          a viewer sees the customer and nothing to press.
          espaciado review E6/E7: no `mr-2` on the glyphs — the `Button`
          already sets `gap-2`, and the two together made this the only
          16px icon gap in the admin against Cobros' 8px, on the same two
          buttons. The copy button keeps its label at every state too: as
          an icon in a text button's box it was 58px wide and jumped to
          128px on the click, dragging the row's controls 70px left for
          two seconds. */}
      {canOperate && (
        <div className="col-span-2 flex items-center justify-end gap-2 sm:contents">
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => void handleCopy()}
            aria-live="polite"
          >
            {copyResult ? (
              copyResult.ok ? (
                <>
                  <Check className="size-4" aria-hidden />
                  Copiado
                </>
              ) : (
                <>
                  <AlertCircle className="size-4" aria-hidden />
                  No se copió
                </>
              )
            ) : (
              <>
                <LinkIcon className="size-4" aria-hidden />
                Copiar link
              </>
            )}
          </Button>
          <Button
            className="shrink-0"
            onClick={() => window.open(row.waLink, "_blank", "noopener,noreferrer")}
          >
            <Share2 className="size-4" aria-hidden />
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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const roster = useQuery<LinksRosterResponse, ApiError>({
    queryKey: ["links-roster"],
    queryFn: () => api<LinksRosterResponse>("/direct-payments/links/roster"),
    staleTime: STALE_MS,
    retry: false,
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

  const isConfigError = roster.isError && roster.error?.status === 503;

  return (
    <PageFrame
      title="Links de pago"
      /* The glossary's full term; the nav carries the short form.
         espaciado review E4: Actualizar renders in both states — gated on
         `roster.data` it appeared only once the roster landed, growing the
         header from 34 to 40px and sliding the search and the whole list
         6px down on load. Cobros already gates only the freshness label. */
      actions={
        <span className="flex items-center gap-3">
          {roster.data && <Freshness readAt={roster.data.readAt} />}
          <Button
            variant="outline"
            disabled={roster.isFetching}
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["links-roster"] });
            }}
          >
            <RefreshCw className={cn("size-4", roster.isFetching && "animate-spin")} aria-hidden />
            Actualizar
          </Button>
        </span>
      }
    >
      {/* espaciado review E8: the atom's own magnifier and the shared
          384px cap, in place of a hand-rolled absolute `Search` and a
          448px `max-w-md`. */}
      <div className="w-full sm:max-w-sm">
        {/* name + autoComplete: without them, phone password managers saw
            a field near the word "usuario" and offered credentials */}
        <Input
          icon={Search}
          type="search"
          name="roster-search"
          autoComplete="off"
          placeholder="Buscar por nombre, usuario o teléfono..."
          /* The name the sr-only label carried before the atom's icon
             replaced it — unchanged on purpose: what the accessible name
             should say is a copy decision this round did not take (Pagos
             says "Buscar por nombre o usuario", Cobros a third thing). */
          aria-label="Buscar cliente"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(PAGE);
          }}
        />
      </div>

      {/* No page notice for the missing CLABE: the shell's banner already
          says it one screen above (design review identidad-2, should fix 2) */}

      {isConfigError && (
        <Alert variant="destructive" layout="icon">
          <AlertCircle aria-hidden />
          <span>
            <strong>Sin conexión a WispHub.</strong> Conecta tu llave en Integraciones para ver a
            tus clientes y sus links.
          </span>
        </Alert>
      )}

      {roster.isError && !isConfigError && (
        <ListError
          what="los links"
          onRetry={() => void roster.refetch()}
          retrying={roster.isRefetching}
        />
      )}

      {roster.isPending && !roster.isError && (
        <ListSkeleton trailing={<Skeleton className="h-10 w-32 rounded-md" />} />
      )}

      <div className={PAGE_STACK} aria-live="polite">
        {roster.data && !roster.data.complete && (
          <Alert variant="warning">
            La lista puede estar incompleta: WispHub devolvió más clientes de los que podemos leer
            de una vez.
          </Alert>
        )}

        {roster.data && filtered.length === 0 && (
          <p className="max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
            {q
              ? `Ningún cliente coincide con "${search.trim()}".`
              : "WispHub no devolvió clientes todavía."}
          </p>
        )}

        {visible.length > 0 && (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line-soft">
              {visible.map((row) => (
                <LinkRow key={row.usuario} row={row} canOperate={canOperate} />
              ))}
            </ul>
          </Card>
        )}

        {filtered.length > limit && (
          <div>
            <Button variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
              Mostrar más ({filtered.length - limit} restantes)
            </Button>
          </div>
        )}
      </div>
    </PageFrame>
  );
}

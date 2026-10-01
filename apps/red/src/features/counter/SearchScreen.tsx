import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Search, Store, TriangleAlert } from "lucide-react";
import { Alert, Input, ListError, Pending, Skeleton } from "@devolada/ui";
import { STORE_SEARCH_MIN } from "@devolada/api/store-schema";
import { ApiError } from "@/lib/api";
import { useSession } from "@/features/auth/session";
import { searchCustomers } from "./api";

/* cash-at-stores D24, FR-015–FR-017: *Cobrar*. The business's name in
   view; a search box and nothing else until three characters are typed —
   there is no list to scroll, so a store cannot browse a business's
   customers. Results show name, usuario and zone. */

/* The links search's pause (links-on-demand-search FR-002) */
const PAUSE_MS = 400;

function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/* L2: no business to collect for — the counter says so, and *Caja* and
   *Movimientos* keep working for the cash already held */
function ChannelOff() {
  return (
    <Alert layout="icon">
      <Store aria-hidden />
      Por ahora no hay negocios para cobrar en esta tienda.
    </Alert>
  );
}

/* D32: the section's title. On a phone it heads the search screen; on a
   computer it heads both halves of *Cobrar* */
export function CounterHeading() {
  const session = useSession();
  const businessName = session.data?.businessName ?? null;
  return (
    <header>
      <h1 id="cobrar-title" className="text-xl font-semibold">
        Cobrar
      </h1>
      {businessName && (
        <p className="text-base text-ink-soft">
          Cobras para <span className="font-semibold text-ink">{businessName}</span>
        </p>
      )}
    </header>
  );
}

export function SearchScreen() {
  return (
    <section className="space-y-4" aria-labelledby="cobrar-title">
      <CounterHeading />
      <SearchPanel autoFocus />
    </section>
  );
}

/* The search box and its results. On a computer it stays on the left
   while the debt and the payment show on the right (D32): the router
   marks the customer in view (`aria-current="page"`, the soft accent),
   and `autoFocus` is off once a payment is on screen, so the focus is
   not taken from it. */
export function SearchPanel({ autoFocus = false }: { autoFocus?: boolean }) {
  const session = useSession();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), PAUSE_MS);
  const businessName = session.data?.businessName ?? null;
  const ready = q.length >= STORE_SEARCH_MIN;

  const search = useQuery({
    queryKey: ["store-search", q],
    queryFn: () => searchCustomers(q),
    enabled: ready && businessName !== null,
    staleTime: 30_000,
  });
  const channelOff = businessName === null || (search.error instanceof ApiError && search.error.code === "CHANNEL_OFF");

  if (channelOff) return <ChannelOff />;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="buscar" className="mb-1 block text-base font-medium">
          Buscar cliente
        </label>
        <Input
          id="buscar"
          type="search"
          autoFocus={autoFocus}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nombre, teléfono o usuario"
          aria-describedby="buscar-ayuda"
        />
        <p id="buscar-ayuda" className="mt-1 text-sm text-ink-soft">
          {text.trim().length < STORE_SEARCH_MIN
            ? "Escribe al menos 3 letras o números."
            : "Buscamos por nombre, apellido, teléfono o usuario."}
        </p>
      </div>

      {ready && (
        <Pending
          active={search.isFetching && !search.data}
          label="Buscando clientes"
          shape={<Skeleton className="h-16 w-full" />}
        >
          {search.isError ? (
            <ListError what="los clientes" onRetry={() => search.refetch()} />
          ) : search.data?.integration === "unavailable" ? (
            /* FR-028: an outage is said, never "sin resultados" */
            <Alert variant="warning" layout="icon">
              <TriangleAlert aria-hidden />
              El sistema de {businessName} no responde ahora. Intenta en unos minutos; no cobres
              mientras tanto.
            </Alert>
          ) : search.data && search.data.rows.length === 0 ? (
            <p className="text-base text-ink-soft">No encontramos clientes con «{q}». Revisa cómo lo escribiste.</p>
          ) : search.data ? (
            <>
              <ul
                aria-label="Clientes encontrados"
                className="divide-y divide-line-soft overflow-hidden rounded-md border border-line bg-card"
              >
                {search.data.rows.map((row) => (
                  <li key={row.usuario}>
                    <Link
                      to="/cobro/$usuario"
                      params={{ usuario: row.usuario }}
                      activeProps={{ className: "bg-accent-soft" }}
                      className="flex min-h-12 items-center justify-between gap-3 px-4 py-3"
                    >
                      <span className="min-w-0">
                        {/* design-review D1: identity wraps, it never truncates */}
                        <span className="block break-words text-base font-medium">{row.name || row.usuario}</span>
                        <span className="block break-words text-sm text-ink-soft">
                          {row.usuario}
                          {row.zone ? ` · ${row.zone}` : ""}
                        </span>
                      </span>
                      <ChevronRight className="size-5 shrink-0 text-ink-soft" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
              {search.data.more && (
                /* D24: no paging — a more specific search */
                <p className="flex items-center gap-2 text-sm text-ink-soft">
                  <Search className="size-4 shrink-0" aria-hidden />
                  Hay más clientes con ese texto. Escribe más para encontrar al tuyo.
                </p>
              )}
            </>
          ) : null}
        </Pending>
      )}
    </div>
  );
}

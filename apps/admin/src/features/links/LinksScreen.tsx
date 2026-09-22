import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Search, Share2, Link as LinkIcon, AlertCircle, Check, TriangleAlert, WifiOff } from "lucide-react";
import { Alert, Button, Card, formatMoney, Input, ListError, Pending, Skeleton, StatusBadge } from "@devolada/ui";
import type { CustomerRow } from "@devolada/api/direct-payments-schema";
import { roleCan } from "@devolada/api/role-matrix";
import { useSession } from "../auth/session";
import { rowKey } from "./seen";
import { SEARCH_MIN_CHARS, useCustomers } from "./useCustomers";
import { useLinkAction, type ActionState } from "./useLinkAction";

/* links-on-demand-search US1: the page stops reading the ISP's customer
   base and starts asking for what it shows.

   It opens with the search box and ONE block of customers read live
   (FR-001), asks for the next block only when the operator scrolls
   toward it (FR-020), and puts a search to WispHub's four `__contains`
   filters at once (FR-003). The roster this replaces read 6,513
   customers on arrival and wrote a link for every one of them.

   Three things this screen deliberately no longer has:

   - **A read age.** FR-027 / D15: a block is read when it renders, so
     there is no shared age to report. `presence-freshness`'s
     "consultado hace X min" printed a doubt this page does not have.
     The re-read on returning to the tab stays, first block only, in
     `useCustomers`.
   - **"La lista puede estar incompleta".** FR-018: nothing is read
     whole, so nothing can be cut short. What the page says instead is
     how many customers the ISP has, which the provider answers with
     every block.
   - **A link for everyone.** FR-008: a row with no link shows the same
     two buttons as one with a link, and pressing either is what brings
     the link into existence (D8, `useLinkAction`). */

const COUNT = new Intl.NumberFormat("es-MX");

/* FR-022: the mark the operator's own session remembers. Not a delivery
   state — Devolada records none — and never colour alone. */
function ActionMark({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line-soft bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <Check className="size-3" aria-hidden />
      {label}
    </span>
  );
}

function CopyLabel({ state }: { state: ActionState }) {
  if (state === "copied") {
    return (
      <>
        <Check className="mr-2 size-4" aria-hidden />
        Copiado
      </>
    );
  }
  if (state === "not_copied" || state === "failed") {
    return (
      <>
        <AlertCircle className="mr-2 size-4" aria-hidden />
        {state === "failed" ? "No se pudo" : "No se copió"}
      </>
    );
  }
  return (
    <>
      <LinkIcon className="size-4" aria-hidden />
      <span className="sr-only">Copiar</span>
    </>
  );
}

function CustomerLine({ row }: { row: CustomerRow }) {
  if (row.channel === "api") {
    /* An API row's second line: the reference (when a label heads the
       row), the ask, and a closed link's state in words */
    const detail = [
      row.label ? row.customerRef : null,
      row.askCents !== null ? formatMoney(row.askCents) : null,
      row.linkState === "paid" ? "link pagado" : row.linkState === "expired" ? "link vencido" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return detail ? <span className="block text-sm text-muted-foreground">{detail}</span> : null;
  }
  return (
    /* FR-007: usuario, name and phone as WispHub answers them now — and
       a nameless customer must not read their usuario twice */
    <span className="block text-sm text-muted-foreground">
      {row.name ? row.usuario : "Sin nombre en WispHub"}
      {row.phone ? ` · ${row.phone}` : ""}
    </span>
  );
}

function CustomerRowItem({
  row,
  canOperate,
  action,
}: {
  row: CustomerRow;
  canOperate: boolean;
  action: ReturnType<typeof useLinkAction>;
}) {
  const state = action.stateOf(row);
  const mark = action.markOf(row);
  const working = state === "working";

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 p-4 sm:flex">
      <div className="min-w-0 sm:flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span>{row.name || row.usuario || row.customerRef}</span>
          <StatusBadge status={row.channel === "api" ? "channelApi" : "channelPanel"} />
          {mark && <ActionMark label={mark === "copied" ? "Copiado" : "Enviado"} />}
        </span>
        <CustomerLine row={row} />
      </div>
      {/* business-and-memberships D3: sharing is `payments: operate`;
          a viewer sees the customer and nothing to press (FR-016) */}
      {canOperate && (
        <div className="col-span-2 flex items-center justify-end gap-2 sm:contents">
          <Button
            size="compact"
            variant="secondary"
            className="shrink-0"
            disabled={working}
            onClick={() => void action.copy(row)}
            title="Copiar enlace"
            aria-live="polite"
          >
            <CopyLabel state={state} />
          </Button>
          <Button size="compact" className="shrink-0" disabled={working} onClick={() => void action.send(row)}>
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
     CLABE lands, the customers read and the buttons wait */
  const speiConfigured = actor?.speiConfigured ?? true;
  const canOperate = roleCan(actor?.role ?? "viewer", "payments", "operate") && speiConfigured;
  const wisphubConnected = actor?.integrationConfigured ?? true;

  const [search, setSearch] = useState("");
  const customers = useCustomers(search);
  const action = useLinkAction();

  const typed = search.trim();
  const tooShort = typed.length > 0 && typed.length < SEARCH_MIN_CHARS;
  const searching = customers.answering !== "";
  const shown = customers.rows.length;

  /* automated-collections-api FR-011 / bug links-refused-key: a key the
     installation refused is SETUP, not weather. It gets the Integraciones
     door and the same sentence as Cobros — the installation before the
     key (provider-address-per-isp D7) — never a Reintentar that re-sends
     the same key to the same place. No search box and no rows: there is
     nothing to search until the read is allowed again. */
  if (customers.error?.code === "WISPHUB_AUTH_FAILED") {
    return (
      <main className="px-4 pt-4 lg:px-8 lg:pt-8 pb-8">
        <h1 className="text-xl font-semibold">Links de pago</h1>
        {/* The shell's recipe for a setup problem with a way out */}
        <Alert
          variant="warning"
          className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <span className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              WispHub rechazó la conexión. Una llave solo sirve en la instalación donde la
              generaste: revisa primero la instalación y luego la llave en Integraciones.
            </span>
          </span>
          <Link to="/integrations/wisphub" className="block">
            <Button size="compact" variant="secondary">Ir a Integraciones</Button>
          </Link>
        </Alert>
      </main>
    );
  }

  return (
    <main className="px-4 pt-4 lg:px-8 lg:pt-8 pb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        {/* The glossary's full term; the nav carries the short form */}
        <h1 className="text-xl font-semibold">Links de pago</h1>
        {/* FR-018: how many customers the ISP HAS — the provider answers
            it with every block — in place of the old warning about a
            list that might have been cut short */}
        {customers.total !== null && (
          <span className="text-sm text-muted-foreground">
            {COUNT.format(customers.total)} clientes en WispHub
          </span>
        )}
      </div>

      <div className="mt-6">
        <label className="relative block max-w-md">
          <span className="sr-only">Buscar cliente</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden />
          {/* name + autoComplete: without them, phone password managers
              saw a field near the word "usuario" and offered credentials */}
          <Input
            size="compact"
            type="search"
            name="customer-search"
            autoComplete="off"
            placeholder="Buscar por nombre, usuario o teléfono..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {/* FR-002: below three characters the page says so and searches
            nothing — while the first block stays where it was */}
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {tooShort
            ? "Escribe al menos 3 letras para buscar. Mientras tanto sigues viendo el primer bloque de tus clientes."
            : "Escribe 3 letras o más del nombre, el usuario o el teléfono."}
        </p>
      </div>

      {/* FR-014 / D9: the provider being away is a quiet note over the
          rows that are already there — never the error block, which is
          for a failure with nothing to show. US3 (T030) makes the door
          answer `wisphub: "unavailable"` inside the envelope; until then
          it is a background read that failed, which reads the same to
          the operator. */}
      {customers.offline && (
        <p
          role="status"
          className="mt-6 flex max-w-lg items-center gap-2 rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden />
          Sin conexión a WispHub. Mostrando la última lectura.
        </p>
      )}

      {customers.isError && !customers.rows.length && !customers.isPending && (
        <ListError what="tus clientes" onRetry={customers.retry} className="mt-6" />
      )}

      {/* feedback-vocabulary-rollout D1/D5/D7: the shape holds the space
          while the threshold runs; the region breathes once past it.
          Outside the aria-live region below, never inside — nesting one
          live region in another is how a state gets read out twice. */}
      <Pending
        active={customers.isPending && !customers.isError}
        label="Leyendo tus clientes"
        shape={
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
        }
      >
        <div aria-live="polite">
          {/* FR-006 / D5: the count is a FLOOR. The union of four filters
              cannot be sized without fetching all four whole, so the page
              says "más de N" and asks for more letters rather than
              claiming a total it did not compute. */}
          {searching && !customers.searching && shown > 0 && (
            <p className="mt-6 max-w-lg text-sm text-muted-foreground">
              {customers.matched !== null && customers.matched > shown
                ? `Más de ${COUNT.format(customers.matched)} clientes coinciden con «${customers.answering}». Mostramos los primeros ${COUNT.format(shown)}: escribe más letras para acotar la búsqueda.`
                : `${COUNT.format(shown)} ${shown === 1 ? "cliente coincide" : "clientes coinciden"} con «${customers.answering}».`}
            </p>
          )}

          {!customers.isPending && !customers.searching && shown === 0 && !customers.isError && (
            <p className="mt-6 max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
              {searching
                ? `Ningún cliente coincide con «${customers.answering}».`
                : wisphubConnected
                  ? "WispHub no devolvió clientes todavía."
                  : /* FR-015: a business without WispHub — its links come
                       from the API, or from connecting WispHub */
                    "Todavía no hay links de pago. Tu sistema puede crearlos desde la API de cobros, o conecta WispHub en Integraciones."}
            </p>
          )}

          {shown > 0 && (
            <Card className="mt-6">
              <ul className="divide-y divide-line-soft">
                {customers.rows.map((row) => (
                  <CustomerRowItem key={rowKey(row)} row={row} canOperate={canOperate} action={action} />
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* FR-020: the next block is asked for when the operator scrolls
            toward this, and never by the page walking to the end on its
            own. A search answers one block, so there is nothing below it. */}
        {customers.hasMore && (
          <div ref={customers.sentinelRef} className="mt-4 min-h-10">
            {customers.loadingMore && (
              <p role="status" className="text-sm text-muted-foreground">
                Leyendo el siguiente bloque de clientes…
              </p>
            )}
          </div>
        )}
      </Pending>
    </main>
  );
}

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Search, Share2, Link as LinkIcon, AlertCircle, Check, TriangleAlert } from "lucide-react";
import { Alert, Amount, Button, Card, formatMoney, Input, ListError, Pending, Skeleton, StatusBadge } from "@devolada/ui";
import type { CustomerRow } from "@devolada/api/direct-payments-schema";
import { roleCan } from "@devolada/api/role-matrix";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LinksView } from "../../router";
import { useDisplaySettings, useSession } from "../auth/session";
import { OfflineNote } from "./OfflineNote";
import { PruneNotice } from "./PruneNotice";
import { ReceivablesList } from "./ReceivablesList";
import { rememberLinksAddress, rowKey } from "./seen";
import { useCustomerDebt } from "./useCustomerDebt";
import { SEARCH_MIN_CHARS, useCustomers, type CustomersView } from "./useCustomers";
import { useLinkAction, type ActionState } from "./useLinkAction";
import { useReceivables } from "./useReceivables";

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
     the link into existence (D8, `useLinkAction`).

   cobros-in-links: the page keeps its name and gains a second VIEW. A
   chip beside the search box — *Todos* / *Por cobrar* — looks like a
   filter and is a different read (spec Context): Por cobrar reads the
   business's open invoices from its integration, one block per scroll,
   live, never from the sweep's copy (D1–D7). The chip shows because the
   integration can read open invoices, as the session says (D13). The
   Cobros section it replaces is gone (D16). With Todos chosen, every
   behaviour above is exactly as it was (FR-001). */

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

/* cobros-in-links FR-018 (D11, D15): what a search result in Por cobrar
   owes — one of three answers, never a guess, and never a zero while it
   waits. The row shows the customer at once; one slow answer never holds
   back the others, because each row asks on its own.

   `ask` is false when the customers door itself answered from its
   offline fallback: the integration is away, so nothing can be confirmed
   and nothing is asked (FR-010). */
function DebtCell({ usuario, ask, onRefused }: { usuario: string | null; ask: boolean; onRefused: () => void }) {
  const debt = useCustomerDebt(usuario, ask);
  useEffect(() => {
    if (debt.refused) onRefused();
  }, [debt.refused, onRefused]);

  if (!ask) return <StatusBadge status="debtUnconfirmed" />;
  if (debt.state === "waiting") {
    return (
      /* The row's own wait. The list already owns a live region, so this
         one breathes without speaking (feedback-vocabulary-rollout D4). */
      <Pending active announce={false} label="Consultando adeudo">
        <span className="text-sm text-muted-foreground">Consultando adeudo</span>
      </Pending>
    );
  }
  if (debt.state === "owes" && debt.totalCents !== null) {
    return (
      <span className="text-sm">
        <span className="text-muted-foreground">Debe </span>
        <Amount cents={debt.totalCents} className="font-semibold" />
      </span>
    );
  }
  if (debt.state === "none") return <StatusBadge status="debtNone" />;
  return <StatusBadge status="debtUnconfirmed" />;
}

function CustomerRowItem({
  row,
  canOperate,
  action,
  debt,
}: {
  row: CustomerRow;
  canOperate: boolean;
  action: ReturnType<typeof useLinkAction>;
  /* cobros-in-links US3: the result's debt, in Por cobrar only */
  debt?: ReactNode;
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
      {debt !== undefined && <div className="shrink-0 justify-self-end">{debt}</div>}
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

/* The customers door's answer, browse or search — one rendering for the
   customer view and for Por cobrar's search, because FR-010 says the
   search finds customers EXACTLY as the customer view's does: the same
   rows, blocks, count line, empty states and offline note. What Por
   cobrar adds is each result's debt (`debtOf`). */
function CustomersResults({
  customers,
  canOperate,
  action,
  wisphubConnected,
  debtOf,
}: {
  customers: CustomersView;
  canOperate: boolean;
  action: ReturnType<typeof useLinkAction>;
  wisphubConnected: boolean;
  debtOf?: (row: CustomerRow) => ReactNode;
}) {
  const searching = customers.answering !== "";
  const shown = customers.rows.length;
  /* The count line stays up while the NEXT block loads — it is the same
     search, and a number that blinks out on every scroll reads as the
     page losing its place. It hides only while a different search is on
     its way, when the number on screen would be the last one's. */
  const showCount = searching && shown > 0 && (!customers.searching || customers.loadingMore);

  return (
    <>
      {/* FR-014 / D9: the provider being away is a quiet note over the
          rows that are already there — never the error block, which is
          for a failure with nothing to show. The door says so itself,
          inside the envelope (`wisphub: "unavailable"`, D10); a
          background read that failed reads the same way to the operator
          and lands here too. */}
      {customers.offline && (
        <OfflineNote>
          {/* FR-014 / FR-021: what the operator can still do, said once
              and plainly. Searching by name needs WispHub — Devolada's own
              rows carry the usuario and the reference and nothing about
              the person (FR-010) — so a name only finds someone this
              session already saw. */}
          {searching && (
            <span className="block">
              Buscar por nombre necesita WispHub: por ahora encontramos por usuario, por
              referencia y a quienes ya viste en esta sesión.
            </span>
          )}
        </OfflineNote>
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
          {/* FR-006 / D5 (amended 2026-09-23): while the walk continues the
              count is a FLOOR — the union of four filters cannot be sized
              without walking it — so the page says "más de N" and points
              DOWN rather than telling the operator to type more letters.
              It used to do the latter, which counted 39 matches for «Leo»
              and left 29 of them unreachable.

              When the walk ends there is nothing left to estimate: what
              the page holds IS what the search found, so it says so. */}
          {showCount && (
            <p className="mt-6 max-w-lg text-sm text-muted-foreground">
              {customers.hasMore
                ? `Más de ${COUNT.format(Math.max(customers.matched ?? 0, shown))} clientes coinciden con «${customers.answering}». Mostramos ${COUNT.format(shown)}: desplázate para ver más.`
                : `${COUNT.format(shown)} ${shown === 1 ? "cliente coincide" : "clientes coinciden"} con «${customers.answering}».`}
            </p>
          )}

          {!customers.isPending && !customers.searching && shown === 0 && !customers.isError && (
            <p className="mt-6 max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
              {customers.wisphub === "not_configured"
                ? /* FR-015: a business without WispHub — its links come
                     from the API, or from connecting WispHub. The same
                     sentence whether the box is empty or not: what is
                     missing is the connection, not the search. */
                  "Todavía no hay links de pago. Tu sistema puede crearlos desde la API de cobros, o conecta WispHub en Integraciones."
                : customers.offline && searching
                  ? /* FR-014: not "nobody matched" — we could not ask */
                    `Sin WispHub no encontramos a «${customers.answering}». Devolada solo puede buscar por usuario, por referencia y entre quienes ya viste.`
                  : searching
                    ? `Ningún cliente coincide con «${customers.answering}».`
                    : wisphubConnected
                      ? "WispHub no devolvió clientes todavía."
                      : "Todavía no hay links de pago. Tu sistema puede crearlos desde la API de cobros, o conecta WispHub en Integraciones."}
            </p>
          )}

          {shown > 0 && (
            <Card className="mt-6">
              <ul className="divide-y divide-line-soft">
                {customers.rows.map((row) => (
                  <CustomerRowItem
                    key={rowKey(row)}
                    row={row}
                    canOperate={canOperate}
                    action={action}
                    debt={debtOf?.(row)}
                  />
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* FR-020: the next block is asked for when the operator scrolls
            toward this, and never by the page walking to the end on its
            own. A SEARCH hangs its blocks here too (D5, amended
            2026-09-23) — the same sentinel, because reaching the bottom
            of a search means the same thing as reaching the bottom of a
            browse. */}
        {customers.nextFailed ? (
          /* A next block that failed stops the walk here; the page never
             retries on its own (cobros-in-links, review of 2026-09-28) */
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">No pudimos leer el siguiente bloque de clientes.</p>
            <Button size="compact" variant="secondary" onClick={customers.retryNext}>
              Reintentar
            </Button>
          </div>
        ) : (
          customers.hasMore && (
            <div ref={customers.sentinelRef} className="mt-4 min-h-10">
              {customers.loadingMore && (
                <p role="status" className="text-sm text-muted-foreground">
                  Leyendo el siguiente bloque de clientes…
                </p>
              )}
            </div>
          )
        )}
      </Pending>
    </>
  );
}

export function LinksScreen() {
  const { data: actor } = useSession();
  const { timezone } = useDisplaySettings();
  /* D5 (2026-09-02): a link nobody can pay is not shared — until the
     CLABE lands, the customers read and the buttons wait */
  const speiConfigured = actor?.speiConfigured ?? true;
  const canOperate = roleCan(actor?.role ?? "viewer", "payments", "operate") && speiConfigured;
  const wisphubConnected = actor?.integrationConfigured ?? true;
  /* cobros-in-links D13, FR-013 (constitution IX): the chip is offered
     because the integration can read open invoices, and a result's debt
     because it can say what one customer owes — never because it is
     WispHub. Without the capability there is no chip, and the page is
     the customer view as it always was. */
  const capabilities = actor?.integrationCapabilities ?? [];
  const canReadReceivables = capabilities.includes("receivables");
  const canReadDebt = capabilities.includes("customerDebt");

  /* FR-011 / D11: the address is where the search text lives, so a
     pasted address opens on that search and the back button and a
     reload both land on it. The box keeps its own state so typing stays
     immediate; the address follows once the text settles — `replace`,
     because a history entry per keystroke would make the back button
     walk the word backwards instead of leaving the search.

     cobros-in-links D12 (FR-009): the chosen view lives there too, for
     the same reasons, and is written the same way. */
  const { q, view: viewParam } = useSearch({ from: "/app/links" });
  const view: LinksView = viewParam === "receivables" && canReadReceivables ? "receivables" : "customers";
  const navigate = useNavigate();
  const [search, setSearch] = useState(q ?? "");
  const customers = useCustomers(search, { view });
  const receivables = useReceivables(view === "receivables");
  const action = useLinkAction();
  /* D11: one result's debt answering with a refused key switches the
     whole page to the setup message */
  const [debtRefused, setDebtRefused] = useState(false);
  const onDebtRefused = useCallback(() => setDebtRefused(true), []);

  /* The address changing from outside — back, forward, a pasted link */
  useEffect(() => {
    setSearch((current) => (current.trim() === (q ?? "") ? current : (q ?? "")));
  }, [q]);

  useEffect(() => {
    if ((q ?? "") === customers.settled) return;
    void navigate({
      to: "/links",
      search: { q: customers.settled === "" ? undefined : customers.settled, view: viewParam },
      replace: true,
    });
  }, [customers.settled, q, viewParam, navigate]);

  /* cobros-in-links SC-005 (FR-009): the address is the page's memory for
     the back button and a reload; the menu's Links entry is a plain
     `/links`, so it reads the last address from the session instead
     (`seen.ts`, store 4; `Shell.tsx`). Written on every change, so the
     way back is always the page the operator left. */
  useEffect(() => {
    if (actor) rememberLinksAddress(actor.id, { q, view: viewParam });
  }, [actor, q, viewParam]);

  /* D13 / FR-013 (T038): an address that asks for Por cobrar when the
     integration cannot answer it — the session says so, or the door
     answers NOT_CONFIGURED because the key went meanwhile — falls back
     to the customer view instead of showing an error. The view leaves
     the address, so a reload does not ask again. */
  const dropView =
    viewParam === "receivables" &&
    ((actor !== undefined && !canReadReceivables) || receivables.error?.code === "NOT_CONFIGURED");
  useEffect(() => {
    if (!dropView) return;
    void navigate({ to: "/links", search: { q }, replace: true });
  }, [dropView, q, navigate]);

  const choose = (next: string) => {
    void navigate({
      to: "/links",
      search: { q, view: next === "receivables" ? "receivables" : undefined },
      replace: true,
    });
  };

  const typed = search.trim();
  const tooShort = typed.length > 0 && typed.length < SEARCH_MIN_CHARS;
  /* Por cobrar with a search active shows the search, and only the
     search: a list row and a search result are never on one screen
     (FR-010) — the list's total is open invoices on screen, a result's
     is the customer's whole debt (spec Assumptions). */
  const receivablesSearching = view === "receivables" && customers.answering !== "";

  /* automated-collections-api FR-011 / bug links-refused-key: a key the
     installation refused is SETUP, not weather. It gets the Integraciones
     door and the same sentence everywhere — the installation before the
     key (provider-address-per-isp D7) — never a Reintentar that re-sends
     the same key to the same place. No search box and no rows: there is
     nothing to search until the read is allowed again.

     cobros-in-links D7, D11: Por cobrar's list and a result's debt say it
     with the core's code, `INTEGRATION_AUTH_FAILED`, and land here too. */
  const refused =
    customers.error?.code === "WISPHUB_AUTH_FAILED" ||
    (view === "receivables" && receivables.error?.code === "INTEGRATION_AUTH_FAILED") ||
    debtRefused;
  if (refused) {
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

  const searchBox = (
    <div className="w-full max-w-md">
      <label className="relative block">
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
          nothing — while what the view shows stays where it was */}
      <p className="mt-2 text-sm text-muted-foreground">
        {view === "receivables"
          ? tooShort
            ? "Escribe al menos 3 letras para buscar. Mientras tanto sigues viendo quién tiene facturas abiertas."
            : canReadDebt
              ? /* cobros-in-links FR-010: the search finds ANY customer,
                   with what they owe — a short-payer included, whom the
                   list cannot hold until their next billing run */
                "Busca a cualquier cliente y ve lo que debe hoy, aunque no esté en la lista."
              : "Escribe 3 letras o más del nombre, el usuario o el teléfono."
          : tooShort
            ? "Escribe al menos 3 letras para buscar. Mientras tanto sigues viendo el primer bloque de tus clientes."
            : "Escribe 3 letras o más del nombre, el usuario o el teléfono."}
      </p>
    </div>
  );

  const customersBody = (
    <CustomersResults
      customers={customers}
      canOperate={canOperate}
      action={action}
      wisphubConnected={wisphubConnected}
    />
  );

  /* The header's count names what the view counts (FR-007): customers
     in the customer view, open INVOICES in Por cobrar — never customers,
     because a customer with two invoices is two. Nothing when the
     integration does not report one. */
  const count =
    view === "receivables"
      ? !receivablesSearching && receivables.total !== null
        ? `${COUNT.format(receivables.total)} ${receivables.total === 1 ? "factura abierta" : "facturas abiertas"}`
        : null
      : customers.total !== null
        ? `${COUNT.format(customers.total)} clientes en WispHub`
        : null;

  return (
    <main className="px-4 pt-4 lg:px-8 lg:pt-8 pb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        {/* The glossary's full term; the nav carries the short form */}
        <h1 className="text-xl font-semibold">Links de pago</h1>
        {/* FR-018: how many customers the ISP HAS — the provider answers
            it with every block — in place of the old warning about a
            list that might have been cut short */}
        {count !== null && <span className="text-sm text-muted-foreground">{count}</span>}
      </div>

      {/* FR-023: the one-time cleanup's count, above the search, because
          it explains a link a customer may already be holding */}
      <PruneNotice />

      {canReadReceivables ? (
        /* cobros-in-links D14: the chip is the admin's own Tabs, compact
           40px on desktop and 44px under a finger. It sits before the
           search box and wraps above it at 360px with no horizontal
           scroll. The panels take no tab stop of their own: they hold
           the rows' buttons. */
        <Tabs value={view} onValueChange={choose}>
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start">
            <TabsList aria-label="Qué ver" className="flex-nowrap">
              <TabsTrigger value="customers" className="group gap-1.5 sm:h-10">
                <Check className="hidden size-3.5 group-data-[state=active]:inline" aria-hidden />
                Todos
              </TabsTrigger>
              <TabsTrigger value="receivables" className="group gap-1.5 sm:h-10">
                <Check className="hidden size-3.5 group-data-[state=active]:inline" aria-hidden />
                Por cobrar
              </TabsTrigger>
            </TabsList>
            {searchBox}
          </div>
          <TabsContent value="customers" tabIndex={-1}>
            {view === "customers" && customersBody}
          </TabsContent>
          <TabsContent value="receivables" tabIndex={-1}>
            {view === "receivables" &&
              (receivablesSearching ? (
                <CustomersResults
                  customers={customers}
                  canOperate={canOperate}
                  action={action}
                  wisphubConnected={wisphubConnected}
                  debtOf={
                    canReadDebt
                      ? (row) => (
                          <DebtCell
                            usuario={row.usuario}
                            ask={customers.wisphub === "ok" && row.usuario !== null}
                            onRefused={onDebtRefused}
                          />
                        )
                      : undefined
                  }
                />
              ) : (
                <ReceivablesList receivables={receivables} canOperate={canOperate} action={action} timezone={timezone} />
              ))}
          </TabsContent>
        </Tabs>
      ) : (
        <>
          <div className="mt-6">{searchBox}</div>
          {customersBody}
        </>
      )}
    </main>
  );
}

import { useMemo } from "react";
import { ChevronDown, Check, Link as LinkIcon, Share2, TriangleAlert } from "lucide-react";
import { Amount, Button, Card, ListError, Pending, Skeleton } from "@devolada/ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { OfflineNote } from "./OfflineNote";
import { groupReceivables, todayIn, type ReceivableGroup, type ReceivablesView } from "./useReceivables";
import type { useLinkAction } from "./useLinkAction";

/* cobros-in-links US1: the Por cobrar list — customers with open
   invoices, grouped as the blocks arrive (D6), each with the same
   Copiar and WhatsApp as the customer view (FR-008).

   The row, its expansion and the date helpers moved here from the
   retired Cobros section (D16). What did not move: the sort by oldest
   debt, the Vencidas / Por vencer filters and the local search, which
   all needed the whole list in memory (spec Assumptions); "Consultado
   hace X" and the heartbeat, retired for the view's re-read on return
   to the tab (FR-011); and "La lista puede estar incompleta", because
   nothing is read whole any more. */

/* A calendar day, shown as the business reads it. Noon keeps a
   YYYY-MM-DD from sliding to the day before in a western timezone. */
export const fmtDay = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : null;

/* FR-005: the oldest due date as Venció (past, with a warning icon) or
   Vence (future). Status is never colour alone: the icon and the word
   carry it. An invoice with no due date shows its issue date instead and
   never reads as overdue (spec edge case). */
function DueLine({ group }: { group: ReceivableGroup }) {
  if (group.overdue) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-error">
        <TriangleAlert className="size-4" aria-hidden />
        Venció {fmtDay(group.oldestDue)}
      </span>
    );
  }
  if (group.oldestDue) {
    return <span className="shrink-0 text-sm text-muted-foreground">Vence {fmtDay(group.oldestDue)}</span>;
  }
  if (group.oldestIssued) {
    return <span className="shrink-0 text-sm text-muted-foreground">Emitida {fmtDay(group.oldestIssued)}</span>;
  }
  return null;
}

function ReceivableRow({
  group,
  canOperate,
  action,
}: {
  group: ReceivableGroup;
  canOperate: boolean;
  action: ReturnType<typeof useLinkAction>;
}) {
  const n = group.invoices.length;
  /* links-on-demand-search D14: the act is one hook and one door for
     every screen. The link is per person — one pair of actions per
     customer, in the expansion, because the collapsed row is full at
     360px. */
  const debtor = { usuario: group.usuario };
  const state = action.stateOf(debtor);
  const mark = action.markOf(debtor);
  const working = state === "working";
  return (
    <li>
      <Collapsible>
        <CollapsibleTrigger className="group grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 p-4 text-left transition-colors hover:bg-muted sm:flex sm:gap-4">
          <span className="min-w-0 sm:flex-1">
            <span className="block text-sm font-medium">{group.name}</span>
            {/* FR-005: how many invoices the total covers — the ones on
                screen, which grows if a later block brings more */}
            <span className="block text-sm text-muted-foreground">
              {group.usuario} · {n} {n === 1 ? "factura" : "facturas"}
            </span>
          </span>
          <DueLine group={group} />
          <Amount cents={group.totalCents} className="shrink-0 text-right text-sm font-semibold sm:w-24" />
          <ChevronDown
            className="size-4 shrink-0 justify-self-end text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {/* business-and-memberships D3: sharing is `payments: operate`;
              a viewer, or a business with no CLABE, reads the debt and
              has nothing to press (US1 scenario 7) */}
          {canOperate && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft bg-muted/50 px-4 pt-3">
              <Button
                size="compact"
                variant="secondary"
                aria-live="polite"
                disabled={working}
                onClick={() => void action.copy(debtor)}
              >
                {state === "copied" ? (
                  <>
                    <Check className="size-4" aria-hidden /> Copiado
                  </>
                ) : state === "not_copied" ? (
                  "No se copió"
                ) : state === "failed" ? (
                  "No se pudo"
                ) : (
                  <>
                    <LinkIcon className="size-4" aria-hidden /> Copiar link
                  </>
                )}
              </Button>
              <Button size="compact" disabled={working} onClick={() => void action.send(debtor)}>
                <Share2 className="size-4" aria-hidden /> WhatsApp
              </Button>
              {/* FR-022: the mark this operator's own session remembers.
                  Devolada records no delivery — "Enviado" means "you
                  pressed it". */}
              {mark && (
                <span className="inline-flex items-center gap-1 rounded-full border border-line-soft bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <Check className="size-3" aria-hidden />
                  {mark === "copied" ? "Copiado" : "Enviado"}
                </span>
              )}
            </div>
          )}
          <ul
            className={cn(!canOperate && "border-t border-line-soft", "bg-muted/50 px-4 py-2")}
            aria-label={`Facturas de ${group.name}`}
          >
            {group.invoices.map((invoice) => (
              <li key={invoice.externalId} className="py-1.5 text-sm">
                {/* FR-006: the period, the total and — when the invoice
                    carries one — the part that came from before, all read
                    from the invoice itself */}
                <span className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0">
                    {invoice.period ?? fmtDay(invoice.invoiceDate) ?? `Factura ${invoice.externalId}`}
                  </span>
                  <Amount cents={invoice.amountCents} />
                </span>
                <span className="flex flex-wrap items-baseline justify-between gap-x-4 text-muted-foreground">
                  <span>
                    {invoice.period && invoice.invoiceDate ? `Emitida ${fmtDay(invoice.invoiceDate)}` : null}
                    {invoice.period && invoice.invoiceDate && invoice.dueDate ? " · " : null}
                    {invoice.dueDate ? `vence ${fmtDay(invoice.dueDate)}` : null}
                  </span>
                  {invoice.carriedCents !== null && invoice.carriedCents > 0 && (
                    <span>
                      Incluye saldo anterior <Amount cents={invoice.carriedCents} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

export function ReceivablesList({
  receivables,
  canOperate,
  action,
  timezone,
}: {
  receivables: ReceivablesView;
  canOperate: boolean;
  action: ReturnType<typeof useLinkAction>;
  timezone: string;
}) {
  const groups = useMemo(
    () => groupReceivables(receivables.invoices, todayIn(timezone)),
    [receivables.invoices, timezone],
  );

  return (
    <>
      {/* D7 / FR-012: rows on screen and a later read failed — they stay,
          under the note the customer view already uses */}
      {receivables.offline && <OfflineNote />}

      {/* D7: could not read, with nothing to show. Never "nobody has an
          open invoice" (SC-004): this is a Reintentar, not an empty state. */}
      {(receivables.unreadable || (receivables.error && groups.length === 0)) && (
        <ListError what="tus facturas abiertas" onRetry={receivables.retry} className="mt-6" />
      )}

      {/* feedback-vocabulary-rollout D1/D5/D7: the shape holds the space
          while the threshold runs, and the region breathes once past it */}
      <Pending
        active={receivables.isPending && !receivables.error}
        label="Leyendo facturas abiertas"
        shape={
          <Card className="mt-6 p-4">
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
        }
      >
        <div aria-live="polite">
          {/* D7: the integration answered and nobody has an open invoice —
              the one empty state, with no warning (US1 scenario 8). It
              names invoices, not debt: a short-payer owes and has none
              until the next billing run (FR-007). */}
          {receivables.nobody && (
            <p className="mt-6 max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
              Nadie tiene facturas abiertas hoy.
            </p>
          )}

          {groups.length > 0 && (
            <Card className="mt-6 overflow-hidden p-0">
              <ul className="divide-y divide-line-soft" aria-label="Clientes con facturas abiertas">
                {groups.map((group) => (
                  <ReceivableRow key={group.usuario} group={group} canOperate={canOperate} action={action} />
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* FR-003: the next block is asked for when the operator scrolls
            toward this — never by the page walking to the end on its own */}
        {receivables.hasMore && (
          <div ref={receivables.sentinelRef} className="mt-4 min-h-10">
            {receivables.loadingMore && (
              <p role="status" className="text-sm text-muted-foreground">
                Leyendo el siguiente bloque de facturas…
              </p>
            )}
          </div>
        )}
      </Pending>
    </>
  );
}

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Clock3, Search, X } from "lucide-react";
import { Alert, Amount, Card, Input, StatusBadge } from "@devolada/ui";
import type { CustomerResult } from "@devolada/api/charges-schema";
import { useCustomerSearch } from "./useCustomerSearch";

/* First screen of the charge path (US-C01). The input focuses on open:
   the customer is waiting at the counter. */

function CustomerCard({ customer }: { customer: CustomerResult }) {
  return (
    <li>
      <Card asChild>
        <Link
          to="/charge/$customerId"
          /* The quote endpoint loads by usuario, never by the numeric id
             (charge-confirm spec D1): WispHub's detail endpoint is empty. */
          params={{ customerId: customer.usuario }}
          /* design-review D1: below sm the card stacks, so the name gets
             the whole width instead of wrapping around the badge. */
          className="flex min-h-16 flex-col gap-2 p-4 transition-colors duration-150 hover:bg-well sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <div className="min-w-0">
            <p className="text-base font-medium">{customer.name}</p>
            <p className="mt-0.5 text-sm text-ink-soft">{customer.zone ?? "Sin zona"}</p>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1.5">
            <StatusBadge
              status={customer.serviceStatus === "unknown" ? "active" : customer.serviceStatus}
            />
            {/* debt-truth D7: what they owe, invoices plus anything
                carried — not the plan's list price, which is what this
                showed before and could be short of the real debt. */}
            <Amount
              cents={customer.invoiceCents + customer.carriedBalanceCents}
              className="text-sm font-semibold"
            />
          </div>
        </Link>
      </Card>
    </li>
  );
}

export function SearchScreen() {
  const [text, setText] = useState("");
  const { data, isFetching, enabled, errorCode } = useCustomerSearch(text);

  return (
    <main className="px-6 pt-8">
      <h1 className="text-xl font-semibold">Cobrar</h1>
      {/* design-review D7: the clear button is ours. Chromium's own paints
          in the browser's accent — blue, the only off-palette colour in
          the product — at ~13px, on the control the shopkeeper uses
          between every customer, inside shadow DOM our target-size
          assertion cannot reach. */}
      <div className="relative mt-5">
        <label className="block">
          <span className="sr-only">Buscar cliente</span>
          <Input
            icon={Search}
            type="search"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ID, teléfono o nombre"
            className={text ? "pr-14" : undefined}
          />
        </label>
        {text && (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            onClick={() => setText("")}
            className="absolute top-1/2 right-0 flex size-12 -translate-y-1/2 items-center justify-center text-ink-soft hover:text-ink"
          >
            <X className="size-5" aria-hidden />
          </button>
        )}
      </div>

      <div className="mt-5" aria-live="polite">
        {!enabled && (
          <p className="text-sm text-ink-soft">
            {/* design-review: the old sentence repeated the placeholder */}
            Si no lo encuentras por nombre, pídele su ID o su teléfono.
          </p>
        )}

        {enabled && isFetching && <p className="text-sm text-ink-soft">Buscando…</p>}

        {errorCode === "WISPHUB_UNAVAILABLE" && (
          /* The results region is already aria-live; a nested live region
             would announce the same sentence twice */
          <Alert variant="warning" layout="icon" role={undefined}>
            <Clock3 aria-hidden />
            El sistema del ISP no responde. Los cobros quedarán en cola y se aplicarán solos.
          </Alert>
        )}

        {errorCode === "WISPHUB_NOT_CONFIGURED" && (
          <Alert className="font-normal">
            Tu ISP todavía no conecta su sistema. Pídele que lo configure para poder cobrar.
          </Alert>
        )}

        {enabled && !isFetching && !errorCode && data && data.customers.length === 0 && (
          <p className="text-sm text-ink-soft">Sin resultados. Revisa el dato e intenta de nuevo.</p>
        )}

        {data && data.customers.length > 0 && (
          <ul className="space-y-3">
            {data.customers.map((customer) => (
              <CustomerCard key={customer.wisphubId} customer={customer} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

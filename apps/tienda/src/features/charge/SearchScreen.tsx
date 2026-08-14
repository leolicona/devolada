import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Clock3, Search } from "lucide-react";
import { Amount, Input, StatusBadge } from "@devolada/ui";
import type { CustomerResult } from "@devolada/api/charges-schema";
import { useCustomerSearch } from "./useCustomerSearch";

/* First screen of the charge path (US-C01). The input focuses on open:
   the customer is waiting at the counter. */

function CustomerCard({ customer }: { customer: CustomerResult }) {
  return (
    <li>
      <Link
        to="/charge/$customerId"
        /* The quote endpoint loads by usuario, never by the numeric id
           (charge-confirm spec D1): WispHub's detail endpoint is empty. */
        params={{ customerId: customer.usuario }}
        className="flex min-h-16 items-center justify-between gap-4 rounded-md border border-line bg-card p-4 transition-colors duration-150 hover:bg-well"
      >
        <div className="min-w-0">
          <p className="truncate text-base font-medium">{customer.name}</p>
          <p className="mt-0.5 truncate text-sm text-ink-faint">
            {customer.zone ?? "Sin zona"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge
            status={customer.serviceStatus === "unknown" ? "active" : customer.serviceStatus}
          />
          <Amount cents={customer.monthlyFeeCents} className="text-sm font-semibold" />
        </div>
      </Link>
    </li>
  );
}

export function SearchScreen() {
  const [text, setText] = useState("");
  const { data, isFetching, enabled, errorCode } = useCustomerSearch(text);

  return (
    <main className="px-6 pt-8">
      <h1 className="text-xl font-semibold">Cobrar</h1>
      <label className="mt-5 block">
        <span className="sr-only">Buscar cliente</span>
        <Input
          icon={Search}
          type="search"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="ID, teléfono o nombre"
        />
      </label>

      <div className="mt-5" aria-live="polite">
        {!enabled && (
          <p className="text-sm text-ink-soft">
            Escribe el nombre, teléfono o ID del cliente para buscarlo.
          </p>
        )}

        {enabled && isFetching && <p className="text-sm text-ink-faint">Buscando…</p>}

        {errorCode === "WISPHUB_UNAVAILABLE" && (
          <p className="flex items-start gap-2 rounded-md border border-warning-line bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
            <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden />
            El sistema del ISP no responde. Los cobros quedarán en cola y se aplicarán solos.
          </p>
        )}

        {errorCode === "WISPHUB_NOT_CONFIGURED" && (
          <p className="rounded-md border border-line bg-well px-4 py-3 text-sm text-ink-soft">
            Tu ISP todavía no conecta su sistema. Pídele que lo configure para poder cobrar.
          </p>
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

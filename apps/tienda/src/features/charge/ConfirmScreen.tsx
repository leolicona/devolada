import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { Amount, AmountBreakdown, Button, StatusBadge, formatMoney } from "@devolada/ui";
import type { ChargeResponse, CustomerQuoteResponse } from "@devolada/api/charges-schema";
import { api, ApiError } from "../../api/client";

/* Confirm & charge (US-C02). One screen: who, how much, one button.
   The shopkeeper confirms the identity out loud before taking money. */

function useCustomerQuote(usuario: string) {
  const query = useQuery<CustomerQuoteResponse, ApiError>({
    queryKey: ["customer-quote", usuario],
    queryFn: () => api<CustomerQuoteResponse>(`/charges/customers/${encodeURIComponent(usuario)}`),
    retry: false,
  });
  return { ...query, errorCode: query.error?.code ?? null };
}

export function ConfirmScreen() {
  const { customerId } = useParams({ strict: false }) as { customerId: string };
  const { data, isPending, errorCode } = useCustomerQuote(customerId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /* Charging: the server re-computes the amount; we only send the customer */
  const charge = useMutation<ChargeResponse, ApiError>({
    mutationFn: () =>
      api<ChargeResponse>("/charges", {
        method: "POST",
        body: JSON.stringify({ usuario: customerId }),
      }),
    onSuccess: (created) => {
      void navigate({ to: "/charges/$chargeId", params: { chargeId: created.id } });
    },
    onError: (e) => {
      /* The quote changed under us: reload it so the screen tells the truth */
      if (e.code === "NOTHING_DUE" || e.code === "BALANCE_CAP_EXCEEDED") {
        void queryClient.invalidateQueries({ queryKey: ["customer-quote", customerId] });
      }
    },
  });

  if (isPending) {
    return (
      <main className="px-6 pt-8">
        <p className="text-sm text-ink-faint">Cargando…</p>
      </main>
    );
  }

  if (errorCode === "CUSTOMER_NOT_FOUND") {
    return (
      <main className="px-6 pt-8">
        <h1 className="text-xl font-semibold">Confirmar y cobrar</h1>
        <p className="mt-6 rounded-md border border-line bg-well px-4 py-3 text-sm text-ink-soft">
          No encontramos a este cliente. Regresa y búscalo de nuevo.
        </p>
      </main>
    );
  }

  if (errorCode || !data) {
    return (
      <main className="px-6 pt-8">
        <h1 className="text-xl font-semibold">Confirmar y cobrar</h1>
        <p className="mt-6 rounded-md border border-warning-line bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
          El sistema del ISP no responde. Intenta de nuevo en un momento.
        </p>
      </main>
    );
  }

  const { customer, quote, cap } = data;
  const paid = customer.billingStatus === "paid";
  const chargeable = !paid && !cap.blocked;

  return (
    <main className="flex min-h-[calc(100dvh-5rem)] flex-col px-6 pt-8 pb-6">
      {/* Identity: confirm out loud before the money */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{customer.name}</h1>
          <p className="mt-0.5 text-sm text-ink-faint">{customer.zone ?? "Sin zona"}</p>
        </div>
        <StatusBadge
          status={customer.serviceStatus === "unknown" ? "active" : customer.serviceStatus}
        />
      </div>

      {paid ? (
        <p className="mt-8 flex items-start gap-2 rounded-md border border-success-line bg-success-soft px-4 py-3 text-sm font-medium text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          Sin adeudo. Este cliente no tiene nada pendiente por pagar.
        </p>
      ) : (
        <div className="mt-8 rounded-md border border-line bg-card p-6">
          <p className="text-sm text-ink-soft">Total a cobrar</p>
          <Amount
            cents={quote.totalCents}
            className="mt-1 block font-semibold tracking-tight text-amount leading-[1.15]"
          />
          <AmountBreakdown
            className="mt-5 border-t border-line-soft pt-4"
            lines={[
              { label: "Mensualidad", cents: quote.monthlyFeeCents },
              { label: "Cargo por servicio", cents: quote.serviceFeeCents },
            ]}
          />
        </div>
      )}

      {cap.blocked && !paid && (
        <p className="mt-4 flex items-start gap-2 rounded-md border border-warning-line bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Tu caja llegó a su límite. Registra una entrega para seguir cobrando.
        </p>
      )}

      {charge.isError && !charge.error.code.startsWith("WISPHUB") && (
        <p className="mt-4 rounded-md border border-error-line bg-error-soft px-4 py-3 text-sm font-medium text-error" role="alert">
          No se pudo registrar el cobro. Intenta de nuevo.
        </p>
      )}

      {!paid && (
        <div className="mt-auto pt-8">
          <Button
            size="critical"
            disabled={!chargeable || charge.isPending}
            onClick={() => charge.mutate()}
          >
            {charge.isPending ? "Cobrando…" : `Cobrar ${formatMoney(quote.totalCents)}`}
          </Button>
        </div>
      )}
    </main>
  );
}

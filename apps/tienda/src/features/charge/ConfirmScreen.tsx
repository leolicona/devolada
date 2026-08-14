import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import {
  Alert,
  Amount,
  AmountBreakdown,
  Button,
  Card,
  Skeleton,
  StatusBadge,
  formatMoney,
} from "@devolada/ui";
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

  /* D7: the identity and the amount keep their place while they load —
     the shopkeeper is already holding the customer's money. */
  if (isPending) {
    return (
      <main className="px-6 pt-8" aria-busy="true" aria-label="Cargando el cobro">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="mt-2 h-4 w-24" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <Card className="mt-8 p-6">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-12 w-52" />
          <Skeleton className="mt-6 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />
        </Card>
      </main>
    );
  }

  if (errorCode === "CUSTOMER_NOT_FOUND") {
    return (
      <main className="px-6 pt-8">
        <h1 className="text-xl font-semibold">Confirmar y cobrar</h1>
        <Alert className="mt-6 font-normal">
          No encontramos a este cliente. Regresa y búscalo de nuevo.
        </Alert>
      </main>
    );
  }

  if (errorCode || !data) {
    return (
      <main className="px-6 pt-8">
        <h1 className="text-xl font-semibold">Confirmar y cobrar</h1>
        <Alert variant="warning" className="mt-6">
          El sistema del ISP no responde. Intenta de nuevo en un momento.
        </Alert>
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
          <p className="mt-0.5 text-sm text-ink-soft">{customer.zone ?? "Sin zona"}</p>
        </div>
        <StatusBadge
          status={customer.serviceStatus === "unknown" ? "active" : customer.serviceStatus}
        />
      </div>

      {paid ? (
        <Alert variant="success" layout="icon" className="mt-8">
          <CheckCircle2 aria-hidden />
          Sin adeudo. Este cliente no tiene nada pendiente por pagar.
        </Alert>
      ) : (
        <Card className="mt-8 p-6">
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
        </Card>
      )}

      {cap.blocked && !paid && (
        <Alert variant="warning" layout="icon" className="mt-4">
          <TriangleAlert aria-hidden />
          Tu caja llegó a su límite. Registra una entrega para seguir cobrando.
        </Alert>
      )}

      {charge.isError && !charge.error.code.startsWith("WISPHUB") && (
        <Alert variant="destructive" className="mt-4">
          No se pudo registrar el cobro. Intenta de nuevo.
        </Alert>
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

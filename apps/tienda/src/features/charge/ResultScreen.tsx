import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Amount, Button, StatusBadge } from "@devolada/ui";
import type { ChargeResponse } from "@devolada/api/charges-schema";
import { api, ApiError } from "../../api/client";

/* The charge result (US-C03). While queued, the screen polls: the green
   "Reconectado" must appear without any tap from the shopkeeper. */

export function ResultScreen() {
  const { chargeId } = useParams({ strict: false }) as { chargeId: string };
  const { data, isPending } = useQuery<ChargeResponse, ApiError>({
    queryKey: ["charge", chargeId],
    queryFn: () => api<ChargeResponse>(`/charges/${chargeId}`),
    refetchInterval: (query) =>
      query.state.data?.reconnectionStatus === "queued" ? 3000 : false,
  });

  if (isPending || !data) {
    return (
      <main className="px-6 pt-8">
        <p className="text-sm text-ink-faint">Cargando…</p>
      </main>
    );
  }

  const queued = data.reconnectionStatus === "queued";

  return (
    <main
      className="flex min-h-[calc(100dvh-5rem)] flex-col items-center px-6 pt-12 pb-6 text-center"
      aria-live="polite"
    >
      <p className="text-sm text-ink-soft">Cobro registrado</p>
      <Amount
        cents={data.totalCents}
        className="mt-1 block font-semibold tracking-tight text-amount leading-[1.15]"
      />
      <p className="mt-2 text-base text-ink-soft">{data.customerName}</p>

      <div className="mt-6">
        <StatusBadge status={data.reconnectionStatus} size="md" />
      </div>

      {queued && (
        <p className="mt-4 max-w-sm text-sm text-ink-soft">
          El pago quedó guardado. La reconexión se aplicará sola en cuanto el sistema del ISP
          responda.
        </p>
      )}

      <p className="mt-6 font-mono text-sm text-ink-faint">Folio {data.folio}</p>

      <div className="mt-auto w-full pt-8">
        <Link to="/">
          <Button size="critical" variant="secondary">
            Nuevo cobro
          </Button>
        </Link>
      </div>
    </main>
  );
}

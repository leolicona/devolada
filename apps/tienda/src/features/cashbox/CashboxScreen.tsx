import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ChevronRight, LogOut, TriangleAlert } from "lucide-react";
import { Amount, Button, StatusBadge } from "@devolada/ui";
import type { CashboxResponse } from "@devolada/api/cashbox-schema";
import { api, ApiError } from "../../api/client";
import { logout } from "../../auth/session";

/* The Caja tab (US-K01). The ledger is the truth: every number here
   can explain itself — the balance taps through to Movimientos. */

export function CashboxScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery<CashboxResponse, ApiError>({
    queryKey: ["cashbox"],
    queryFn: () => api<CashboxResponse>("/cashbox"),
  });

  async function onLogout() {
    await logout().catch(() => {});
    queryClient.clear();
    void navigate({ to: "/login" });
  }

  if (isPending || !data) {
    return (
      <main className="px-6 pt-8">
        <p className="text-sm text-ink-faint">Cargando…</p>
      </main>
    );
  }

  return (
    <main className="px-6 pt-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="truncate text-xl font-semibold">{data.storeName}</h1>
        <button
          type="button"
          onClick={() => void onLogout()}
          className="flex h-12 shrink-0 items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink"
        >
          <LogOut className="size-4" aria-hidden />
          Cerrar sesión
        </button>
      </div>

      {/* D2: the balance explains itself — it links to the entries it sums */}
      <Link
        to="/ledger"
        className="mt-5 block rounded-md border border-line bg-card p-6 transition-colors duration-150 hover:bg-well"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm text-ink-soft">Efectivo del ISP en tu poder</p>
          <ChevronRight className="size-4 text-ink-faint" aria-hidden />
        </div>
        <Amount
          cents={data.balanceCents}
          className="mt-1 block text-3xl font-semibold tracking-tight"
        />
        <p className="mt-2 text-sm text-ink-faint">Toca para ver tus movimientos</p>
      </Link>

      <div className="mt-3 rounded-md border border-line bg-card p-6">
        <p className="text-sm text-ink-soft">Tu comisión ganada</p>
        <Amount
          cents={data.commissionEarnedCents}
          className="mt-1 block text-2xl font-semibold text-success"
        />
      </div>

      {data.cap.blocked ? (
        <p className="mt-4 flex items-start gap-2 rounded-md border border-warning-line bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Tu caja llegó a su límite. Registra una entrega para seguir cobrando.
        </p>
      ) : data.cap.approaching ? (
        <p className="mt-4 flex items-start gap-2 rounded-md border border-warning-line bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
          <ArrowDownToLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          Tu caja se acerca a su límite. Registra una entrega pronto.
        </p>
      ) : null}

      {data.lastCashDrop && (
        <div className="mt-4 flex items-center justify-between rounded-md border border-line bg-card p-4">
          <div>
            <p className="text-sm font-medium">Última entrega</p>
            <Amount cents={data.lastCashDrop.cents} className="text-sm text-ink-soft" />
          </div>
          <StatusBadge status={data.lastCashDrop.status} />
        </div>
      )}

      <div className="mt-6">
        <Link to="/cashbox/drop">
          <Button className="w-full">
            <ArrowDownToLine className="size-5" aria-hidden />
            Registrar entrega
          </Button>
        </Link>
      </div>
    </main>
  );
}

/* Honest placeholder: recording the drop is the next task. */
export function CashDropPlaceholder() {
  return (
    <main className="px-6 pt-8">
      <h1 className="text-xl font-semibold">Registrar entrega</h1>
      <p className="mt-6 rounded-md border border-line bg-well px-4 py-3 text-sm text-ink-soft">
        El registro de entregas llega con la siguiente tarea del plan.
      </p>
    </main>
  );
}

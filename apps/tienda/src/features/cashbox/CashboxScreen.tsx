import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ChevronRight, LogOut, TriangleAlert } from "lucide-react";
import { Alert, Amount, Button, Card, ListError, Skeleton, StatusBadge } from "@devolada/ui";
import type { CashboxResponse } from "@devolada/api/cashbox-schema";
import { api, ApiError } from "../../api/client";
import { logout } from "../../auth/session";
import { PasskeyOffer } from "../../auth/PasskeyOffer";

/* The Caja tab (US-K01). The ledger is the truth: every number here
   can explain itself — the balance taps through to Movimientos. */

export function CashboxScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isPending, isError, refetch, isRefetching } = useQuery<CashboxResponse, ApiError>({
    queryKey: ["cashbox"],
    queryFn: () => api<CashboxResponse>("/cashbox"),
  });

  async function onLogout() {
    await logout().catch(() => {});
    queryClient.clear();
    void navigate({ to: "/login" });
  }

  /* list-states D1: a balance we could not load is not a balance of zero */
  if (isError) {
    return (
      <main className="px-6 pt-8">
        <h1 className="text-xl font-semibold">Caja</h1>
        <ListError
          what="tu caja"
          onRetry={() => void refetch()}
          retrying={isRefetching}
          className="mt-6"
        />
      </main>
    );
  }

  /* shell D7: the balance is the screen — it holds its place while it loads */
  if (isPending || !data) {
    return (
      <main className="px-6 pt-8" aria-busy="true" aria-label="Cargando tu caja">
        <Skeleton className="h-6 w-40" />
        <Card className="mt-5 p-6">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-2 h-9 w-36" />
          <Skeleton className="mt-3 h-4 w-40" />
        </Card>
        <Card className="mt-3 p-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-7 w-28" />
        </Card>
      </main>
    );
  }

  return (
    <main className="px-6 pt-8">
      <div className="flex items-center justify-between gap-4">
        {/* design-review D1: the store's own name wraps rather than losing
            its ending to "Cerrar sesión" at the 360px floor. */}
        <h1 className="text-xl font-semibold">{data.storeName}</h1>
        <Button
          variant="ghost"
          onClick={() => void onLogout()}
          className="shrink-0 gap-1.5 px-0 text-sm"
        >
          <LogOut className="size-4" aria-hidden />
          Cerrar sesión
        </Button>
      </div>

      {/* D2: the balance explains itself — it links to the entries it sums */}
      <Card asChild>
        <Link
          to="/ledger"
          className="mt-5 block p-6 transition-colors duration-150 hover:bg-well"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-soft">Efectivo del ISP en tu poder</p>
            <ChevronRight className="size-4 text-ink-faint" aria-hidden />
          </div>
          <Amount
            cents={data.balanceCents}
            className="mt-1 block text-3xl font-semibold tracking-tight"
          />
          <p className="mt-2 text-sm text-ink-soft">Toca para ver tus movimientos</p>
        </Link>
      </Card>

      <Card className="mt-3 p-6">
        <p className="text-sm text-ink-soft">Tu comisión ganada</p>
        {/* design-review D3: green is a status colour. The amount is ink;
            what it means is in the label above it. */}
        <Amount
          cents={data.commissionEarnedCents}
          className="mt-1 block text-2xl font-semibold"
        />
      </Card>

      {data.cap.blocked ? (
        <Alert variant="warning" layout="icon" className="mt-4">
          <TriangleAlert aria-hidden />
          Tu caja llegó a su límite. Registra una entrega para seguir cobrando.
        </Alert>
      ) : data.cap.approaching ? (
        <Alert variant="warning" layout="icon" className="mt-4">
          <ArrowDownToLine aria-hidden />
          Tu caja se acerca a su límite. Registra una entrega pronto.
        </Alert>
      ) : null}

      {data.lastCashDrop && (
        <Card className="mt-4 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Última entrega</p>
              <Amount cents={data.lastCashDrop.cents} className="text-sm text-ink-soft" />
            </div>
            <StatusBadge status={data.lastCashDrop.status} />
          </div>
          {/* cash-drops D7: the store reads the same dispute the ISP wrote */}
          {data.lastCashDrop.note && (
            <p className="mt-3 border-t border-line-soft pt-3 text-sm text-error">
              {data.lastCashDrop.note}
            </p>
          )}
        </Card>
      )}

      <div className="mt-6">
        <Link to="/cashbox/drop" className="block">
          <Button className="w-full">
            <ArrowDownToLine className="size-5" aria-hidden />
            Registrar entrega
          </Button>
        </Link>
      </div>
      {/* US-S07: enrolment offered after login, never forced */}
      <PasskeyOffer />
    </main>
  );
}

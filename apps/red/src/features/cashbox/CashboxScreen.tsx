import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LogOut, MessageSquareWarning } from "lucide-react";
import { Alert, Button, Card, ListError, Pending, Skeleton, StatusBadge, formatMoney } from "@devolada/ui";
import type { CashboxResponse } from "@devolada/api/store-schema";
import { dateOf } from "@/lib/datetime";
import { PasskeyCard } from "@/features/auth/PasskeyCard";
import { signOut } from "@/features/auth/session";
import { getCashbox } from "./api";

/* cash-at-stores FR-037, D19, D20: *Mi caja* — for each business the
   store collects for, the cash it holds and the fees it earned since its
   last confirmed hand-over. Every number opens into the movements behind
   it (`cashbox` D2). Signing out and the passkey live here (`cashbox` D3). */

type Business = CashboxResponse["businesses"][number];

function BusinessCash({ b }: { b: Business }) {
  const canDeclare = b.heldCents > 0 && !b.pendingHandover;
  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">{b.businessName}</h2>
      <dl className="space-y-2">
        <Link
          to="/movimientos"
          search={{ businessId: b.businessId }}
          className="flex min-h-12 items-center justify-between gap-3 rounded-md bg-well px-4 py-2"
        >
          <dt className="text-base">Efectivo que tienes</dt>
          <dd className="flex items-center gap-2 text-xl font-semibold tabular-nums">
            {formatMoney(b.heldCents)}
            <ChevronRight className="size-5 text-ink-soft" aria-hidden />
          </dd>
        </Link>
        <Link
          to="/movimientos"
          search={{ businessId: b.businessId, kind: "collection" }}
          className="flex min-h-12 items-center justify-between gap-3 rounded-md px-4 py-2"
        >
          <dt className="text-base">Tus cargos desde la última entrega</dt>
          <dd className="flex items-center gap-2 text-base font-semibold tabular-nums">
            {formatMoney(b.feesSinceHandoverCents)}
            <ChevronRight className="size-5 text-ink-soft" aria-hidden />
          </dd>
        </Link>
      </dl>

      {b.pendingHandover && (
        <div className="space-y-1">
          <StatusBadge status="pending" size="standard" />
          <p className="text-base">
            Entregaste {formatMoney(b.pendingHandover.cents)} el {dateOf(b.pendingHandover.declaredAt)}. Esperamos a
            que {b.businessName} la confirme.
          </p>
        </div>
      )}
      {b.lastHandover && (
        <div className="space-y-1">
          <StatusBadge status={b.lastHandover.status === "confirmed" ? "confirmed" : "disputed"} size="standard" />
          <p className="text-base text-ink-soft">
            Última entrega: {formatMoney(b.lastHandover.cents)} el {dateOf(b.lastHandover.at)}.
          </p>
          {b.lastHandover.status === "disputed" && b.lastHandover.note && (
            /* confirm-cash-drop D7: the store sees the business's note */
            <Alert variant="warning" layout="icon">
              <MessageSquareWarning aria-hidden />
              {b.businessName} dice: «{b.lastHandover.note}»
            </Alert>
          )}
        </div>
      )}

      <Link
        to="/caja/entrega"
        search={{ businessId: b.businessId }}
        disabled={!canDeclare}
        aria-disabled={!canDeclare}
        className={`flex h-12 items-center justify-center rounded-md px-6 text-base font-medium ${
          canDeclare ? "bg-accent text-ink-inverse" : "pointer-events-none border border-line bg-well text-ink-faint"
        }`}
      >
        Registrar entrega
      </Link>
    </Card>
  );
}

export function CashboxScreen() {
  const cashbox = useQuery({ queryKey: ["store-cashbox"], queryFn: getCashbox });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return (
    <section className="space-y-4" aria-labelledby="caja-title">
      <h1 id="caja-title" className="text-xl font-semibold">
        Mi caja
      </h1>
      <Pending active={cashbox.isPending} label="Cargando tu caja" shape={<Skeleton className="h-48 w-full" />}>
        {cashbox.isError ? (
          <ListError what="tu caja" onRetry={() => cashbox.refetch()} />
        ) : cashbox.data && cashbox.data.businesses.length === 0 ? (
          <p className="text-base text-ink-soft">Todavía no tienes efectivo de ningún negocio.</p>
        ) : (
          cashbox.data?.businesses.map((b) => <BusinessCash key={b.businessId} b={b} />)
        )}
      </Pending>
      <PasskeyCard />
      <Button
        variant="ghost"
        className="w-full"
        onClick={async () => {
          await signOut().catch(() => undefined);
          queryClient.clear();
          void navigate({ to: "/entrar" });
        }}
      >
        <LogOut className="size-5" aria-hidden />
        Cerrar sesión
      </Button>
    </section>
  );
}

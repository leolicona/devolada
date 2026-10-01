import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LogOut, MessageSquareWarning } from "lucide-react";
import { Alert, Button, Card, ListError, Pending, Skeleton, StatusBadge, buttonVariants, cn, formatMoney } from "@devolada/ui";
import type { CashboxResponse } from "@devolada/api/store-schema";
import { dateOf } from "@/lib/datetime";
import { PasskeyCard } from "@/features/auth/PasskeyCard";
import { signOut } from "@/features/auth/session";
import { useWide } from "@/lib/wide";
import { getCashbox } from "./api";
import { HandoverHistory } from "./HandoversScreen";

/* cash-at-stores FR-037, D19, D20: *Mi caja* — for each business the
   store collects for, the cash it holds and the fees it earned since its
   last confirmed hand-over. Every number opens into the movements behind
   it (`cashbox` D2). Signing out and the passkey live here (`cashbox` D3). */

type Business = CashboxResponse["businesses"][number];

/* D32: on a computer the card sits beside the hand-overs (`historyBeside`:
   its last hand-over is a line, not a way into them) or beside the
   hand-over form (`declare` off: the form is the action) */
export function BusinessCash({ b, historyBeside = false, declare = true }: { b: Business; historyBeside?: boolean; declare?: boolean }) {
  const canDeclare = b.heldCents > 0 && !b.pendingHandover;
  const lastLine = b.lastHandover ? (
    <span>
      Última entrega: {formatMoney(b.lastHandover.cents)} el {dateOf(b.lastHandover.at)}.
    </span>
  ) : null;
  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">{b.businessName}</h2>
      {/* `cashbox` D2: each number is a link into the movements behind
          it — a link names itself by its words, so no definition list
          (a <dl> may hold only its terms) */}
      <div className="space-y-2">
        <Link
          to="/movimientos"
          search={{ businessId: b.businessId }}
          className="flex min-h-12 items-center justify-between gap-3 rounded-md bg-well px-4 py-2"
        >
          <span className="text-base">Efectivo que tienes</span>
          <span className="flex items-center gap-2 text-xl font-semibold tabular-nums">
            {formatMoney(b.heldCents)}
            <ChevronRight className="size-5 text-ink-soft" aria-hidden />
          </span>
        </Link>
        {/* T079 (FR-037): the fees open into the collections they count —
            from the last confirmed hand-over on */}
        <Link
          to="/movimientos"
          search={{ businessId: b.businessId, kind: "collection", since: b.feesSince ?? undefined }}
          className="flex min-h-12 items-center justify-between gap-3 rounded-md px-4 py-2"
        >
          <span className="text-base">Tus cargos desde la última entrega</span>
          <span className="flex items-center gap-2 text-base font-semibold tabular-nums">
            {formatMoney(b.feesSinceHandoverCents)}
            <ChevronRight className="size-5 text-ink-soft" aria-hidden />
          </span>
        </Link>
      </div>

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
          {/* T079, T080: the last hand-over opens into every hand-over to
              this business, disputes and their notes included */}
          {historyBeside || !declare ? (
            <p className="text-base text-ink-soft">{lastLine}</p>
          ) : (
            <Link
              to="/caja/entregas"
              search={{ businessId: b.businessId }}
              className="flex min-h-12 items-center justify-between gap-3 text-base text-ink-soft"
            >
              {lastLine}
              <ChevronRight className="size-5 shrink-0" aria-hidden />
            </Link>
          )}
          {b.lastHandover.status === "disputed" && b.lastHandover.note && (
            /* confirm-cash-drop D7: the store sees the business's note */
            <Alert variant="warning" layout="icon">
              <MessageSquareWarning aria-hidden />
              {b.businessName} dice: «{b.lastHandover.note}»
            </Alert>
          )}
        </div>
      )}

      {/* T087 (constitution VI): the shared button recipe on a link; a
          link cannot be :disabled, so the recipe's own disabled fill is
          spelled from its variant (design-review D6: a different fill,
          never an opacity) */}
      {declare && (
        <Link
          to="/caja/entrega"
          search={{ businessId: b.businessId }}
          disabled={!canDeclare}
          aria-disabled={!canDeclare}
          className={cn(
            buttonVariants({ size: "standard" }),
            "w-full",
            !canDeclare && "pointer-events-none border border-line bg-well text-ink-faint",
          )}
        >
          Registrar entrega
        </Link>
      )}
      {declare && !historyBeside && !b.lastHandover && b.pendingHandover && (
        <Link to="/caja/entregas" search={{ businessId: b.businessId }} className="inline-flex min-h-12 items-center text-base font-medium text-link">
          Ver entregas
        </Link>
      )}
    </Card>
  );
}

export function CashboxScreen() {
  const cashbox = useQuery({ queryKey: ["store-cashbox"], queryFn: getCashbox });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const wide = useWide();
  const businesses = cashbox.data?.businesses ?? [];

  const cash = (
    <Pending active={cashbox.isPending} label="Cargando tu caja" shape={<Skeleton className="h-48 w-full" />}>
      {cashbox.isError ? (
        <ListError what="tu caja" onRetry={() => cashbox.refetch()} />
      ) : cashbox.data && businesses.length === 0 ? (
        <p className="text-base text-ink-soft">Todavía no tienes efectivo de ningún negocio.</p>
      ) : (
        <div className="space-y-4">
          {businesses.map((b) => (
            <BusinessCash key={b.businessId} b={b} historyBeside={wide} />
          ))}
        </div>
      )}
    </Pending>
  );
  const account = (
    <>
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
    </>
  );

  return (
    <section className={wide ? "space-y-6" : "space-y-4"} aria-labelledby="caja-title">
      <h1 id="caja-title" className="text-xl font-semibold">
        Mi caja
      </h1>
      {wide ? (
        /* D32: the cash on the left, the hand-overs to each business on
           the right — a dispute's note in view without another screen */
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            {cash}
            {account}
          </div>
          <div className="space-y-8">
            {businesses.map((b) => (
              <HandoverHistory key={b.businessId} businessId={b.businessId} level="h2" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {cash}
          {account}
        </>
      )}
    </section>
  );
}

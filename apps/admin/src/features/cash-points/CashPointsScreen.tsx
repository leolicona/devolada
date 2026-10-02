import { Alert, Amount, Button, Card, ListError, Pending, Skeleton, StatusBadge, formatMoney, type Status } from "@devolada/ui";
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CashPointStore, CashPointsResponse, HandoverHistoryResponse, HandoverRow } from "@devolada/api/cash-points-schema";
import { roleCan } from "@devolada/api/role-matrix";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { useDisplaySettings, useSession } from "../auth/session";

/* cash-at-stores D20, D23 — *Puntos de pago*: each store holding this
   business's cash, the amount, the last confirmed hand-over and the pending
   one. Confirming takes two taps, the second naming the store and the
   amount, because the write cannot be undone (`confirm-cash-drop` D6). A
   dispute needs a note the store will read. A viewer reads everything and
   acts on nothing (FR-035). */

const STORE_STATUS: Record<CashPointStore["storeStatus"], Status> = {
  invited: "invited",
  active: "storeActive",
  suspended: "storeSuspended",
};
const HANDOVER_STATUS: Record<HandoverRow["status"], Status> = {
  pending: "pending",
  confirmed: "confirmed",
  disputed: "disputed",
};

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["cash-points"] });
    void queryClient.invalidateQueries({ queryKey: ["cash-points-history"] });
  };
}

function Confirm({ store }: { store: CashPointStore }) {
  const refresh = useRefresh();
  const confirm = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/cash-points/handovers/${store.pending!.id}/confirm`, { method: "POST" }),
    onSuccess: refresh,
  });
  return (
    <>
      <Pending active={confirm.isPending} label="Confirmando la entrega">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="compact" disabled={confirm.isPending}>
              Confirmar
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>
              ¿Recibiste {formatMoney(store.pending!.cents)} de {store.storeName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Confírmalo solo después de contar el efectivo. No se puede deshacer: la caja de la tienda baja{" "}
              {formatMoney(store.pending!.cents)}.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => confirm.mutate()}>Sí, lo recibí</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Pending>
      {confirm.error && (
        <p role="alert" className="text-sm font-medium text-error">
          {confirm.error.code === "HANDOVER_NOT_PENDING" ? "Esta entrega ya se resolvió." : "No se pudo confirmar. Intenta de nuevo."}
        </p>
      )}
    </>
  );
}

function Dispute({ store }: { store: CashPointStore }) {
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const dispute = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api(`/cash-points/handovers/${store.pending!.id}/dispute`, { method: "POST", body: JSON.stringify({ note: note.trim() }) }),
    onSuccess: () => {
      setOpen(false);
      setNote("");
      refresh();
    },
  });
  const valid = note.trim().length >= 3 && note.trim().length <= 280;
  const id = `dispute-${store.storeId}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="compact" variant="secondary">
          Disputar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Disputar la entrega de {store.storeName}</DialogTitle>
        <DialogDescription>
          La tienda declaró {formatMoney(store.pending!.cents)}. Di qué pasó: la tienda leerá esta nota. La caja no cambia.
        </DialogDescription>
        <Label htmlFor={id}>Nota (de 3 a 280 letras)</Label>
        <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: faltaron $200 en el sobre" />
        {note.length > 0 && !valid && <p className="text-sm font-medium text-error">La nota debe tener de 3 a 280 letras.</p>}
        {dispute.error && (
          <p role="alert" className="text-sm font-medium text-error">
            {dispute.error.code === "HANDOVER_NOT_PENDING" ? "Esta entrega ya se resolvió." : "No se pudo guardar la disputa."}
          </p>
        )}
        <Pending active={dispute.isPending} label="Guardando la disputa">
          <Button size="compact" variant="destructive" disabled={!valid || dispute.isPending} onClick={() => dispute.mutate()}>
            Disputar entrega
          </Button>
        </Pending>
      </DialogContent>
    </Dialog>
  );
}

function History({ store }: { store: CashPointStore }) {
  const { timezone, timeFormat } = useDisplaySettings();
  /* T075: every hand-over, page by page */
  const history = useInfiniteQuery<HandoverHistoryResponse, ApiError>({
    queryKey: ["cash-points-history", store.storeId],
    queryFn: ({ pageParam }) =>
      api(`/cash-points/stores/${store.storeId}/history${pageParam ? `?cursor=${encodeURIComponent(String(pageParam))}` : ""}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const handovers = history.data?.pages.flatMap((p) => p.handovers) ?? [];
  return (
    <Pending active={history.isPending} label="Cargando las entregas" shape={<Skeleton className="h-16 w-full" />}>
      {history.error && handovers.length === 0 ? (
        <ListError what="las entregas" onRetry={() => history.refetch()} />
      ) : history.data && handovers.length === 0 ? (
        <p className="text-sm text-ink-soft">Todavía no hay entregas.</p>
      ) : (
        <div className="space-y-2">
          <ul className="divide-y divide-line-soft text-sm" aria-label={`Entregas de ${store.storeName}`}>
            {handovers.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 py-2">
                <StatusBadge status={HANDOVER_STATUS[h.status]} />
                <Amount cents={h.cents} className="font-medium" />
                {/* T076 (US5/AC5): the day, and when it was resolved */}
                <span className="text-ink-soft">declarada {formatDateTime(h.declaredAt, timeFormat, timezone)}</span>
                {h.resolvedBy && (
                  <span className="text-ink-soft">
                    · {h.status === "confirmed" ? "confirmó" : "disputó"} {h.resolvedBy}
                    {h.resolvedAt ? ` el ${formatDateTime(h.resolvedAt, timeFormat, timezone)}` : ""}
                  </span>
                )}
                {h.note && <span className="basis-full text-ink-soft">«{h.note}»</span>}
              </li>
            ))}
          </ul>
          {history.hasNextPage && (
            <Pending active={history.isFetchingNextPage} label="Cargando más entregas">
              <Button size="compact" variant="secondary" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
                Cargar más
              </Button>
            </Pending>
          )}
        </div>
      )}
    </Pending>
  );
}

function StoreCard({ store, canOperate }: { store: CashPointStore; canOperate: boolean }) {
  const { timezone, timeFormat } = useDisplaySettings();
  const [showHistory, setShowHistory] = useState(false);
  return (
    <Card className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{store.storeName}</h2>
          <p className="text-sm text-ink-soft">{store.address}</p>
        </div>
        <StatusBadge status={STORE_STATUS[store.storeStatus]} />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-ink-soft">Efectivo tuyo en la tienda</p>
        <Amount cents={store.heldCents} className="text-xl font-semibold" />
      </div>
      {store.lastConfirmed && (
        <p className="text-sm text-ink-soft">
          Última entrega confirmada: {formatMoney(store.lastConfirmed.cents)} · {formatDateTime(store.lastConfirmed.at, timeFormat, timezone)}
        </p>
      )}
      {store.pending && (
        <div className="space-y-3 rounded-md border border-warning-line bg-warning-soft p-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status="pending" />
            <span className="text-sm">
              La tienda declaró <span className="font-semibold">{formatMoney(store.pending.cents)}</span> ·{" "}
              {formatDateTime(store.pending.declaredAt, timeFormat, timezone)}
            </span>
          </div>
          {canOperate && (
            <div className="flex flex-wrap gap-2">
              <Confirm store={store} />
              <Dispute store={store} />
            </div>
          )}
        </div>
      )}
      <Button size="compact" variant="ghost" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
        {showHistory ? "Ocultar entregas" : "Ver entregas"}
      </Button>
      {showHistory && <History store={store} />}
    </Card>
  );
}

export function CashPointsScreen() {
  const { data: actor } = useSession();
  const points = useQuery<CashPointsResponse, ApiError>({ queryKey: ["cash-points"], queryFn: () => api("/cash-points") });
  const canOperate = roleCan(actor?.role ?? "viewer", "payments", "operate");
  return (
    <main className="space-y-4 px-4 pb-8 pt-4 lg:px-8 lg:pt-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Puntos de pago</h1>
        <p className="max-w-2xl text-sm text-ink-soft">
          El efectivo que cobran las tiendas se queda en la tienda hasta que te lo entregan. Confirma cada entrega cuando
          cuentes el dinero.
        </p>
      </header>
      <Pending active={points.isPending} label="Cargando los puntos de pago" shape={<Skeleton className="h-40 w-full" />}>
        {points.error ? (
          <ListError what="los puntos de pago" onRetry={() => points.refetch()} />
        ) : points.data && points.data.stores.length === 0 ? (
          <Alert>
            {points.data.channelOn
              ? "Todavía ninguna tienda tiene efectivo de tu negocio."
              : "Ninguna tienda tiene efectivo de tu negocio."}
          </Alert>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {points.data?.stores.map((s) => <StoreCard key={s.storeId} store={s} canOperate={canOperate} />)}
          </div>
        )}
      </Pending>
    </main>
  );
}

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, Check, MessageSquareWarning } from "lucide-react";
import { Amount, ListError, StatusBadge, formatMoney } from "@devolada/ui";
import type { AdminCashDrop, CashDropsResponse } from "@devolada/api/cash-drops-schema";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { useDisplaySettings } from "../auth/session";
import { pendingDropsQuery } from "./usePendingDrops";

/* Entregas (US-E01, US-E02). Confirming here is what finally writes the
   cash_drop ledger entry — so it takes two taps (D6), and the second one
   is a shadcn AlertDialog. Disputing writes a note and no entry. */

/* Settings D6: the ISP's zone and format decide how a time reads */
function useWhen() {
  const { timeFormat, timezone } = useDisplaySettings();
  return (ms: number) => formatDateTime(ms, timeFormat, timezone);
}

function PendingCard({ drop }: { drop: AdminCashDrop }) {
  const queryClient = useQueryClient();
  const when = useWhen();
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["cash-drops"] });
    void queryClient.invalidateQueries({ queryKey: ["stores"] });
  };

  const confirm = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/cash-drops/${drop.id}/confirm`, { method: "POST" }),
    onSuccess: refresh,
  });

  const dispute = useMutation<unknown, ApiError, string>({
    mutationFn: (text) =>
      api(`/cash-drops/${drop.id}/dispute`, {
        method: "POST",
        body: JSON.stringify({ note: text }),
      }),
    onSuccess: refresh,
  });

  function onDispute() {
    if (note.trim().length < 3) {
      setNoteError(true);
      return;
    }
    setNoteError(false);
    dispute.mutate(note.trim());
  }

  const busy = confirm.isPending || dispute.isPending;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{drop.storeName}</p>
          <p className="truncate text-sm text-muted-foreground">
            {drop.storeZone ?? "Sin zona"} · Registrada el {when(drop.createdAt)}
          </p>
        </div>
        <Amount cents={drop.cents} className="text-2xl font-semibold tracking-tight" />
      </div>

      {/* D5: what the store still holds, so the ISP can count against it */}
      {drop.storeBalanceCents !== null && (
        <p className="mt-3 text-sm text-muted-foreground">
          Saldo actual de la tienda:{" "}
          <span className="font-medium text-foreground">{formatMoney(drop.storeBalanceCents)}</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {/* D6: the second tap lives in a dialog — the write cannot be undone */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={busy}>
              <Check className="size-4" aria-hidden />
              Confirmar entrega
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>
              ¿Recibiste {formatMoney(drop.cents)} de {drop.storeName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Al confirmar, el saldo de la tienda baja {formatMoney(drop.cents)}. Queda registrado en
              sus movimientos y no se puede deshacer.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button variant="outline">Cancelar</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button onClick={() => confirm.mutate()}>Sí, la recibí</Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* The rare, slower path: writing a reason */}
        <Collapsible className="w-full">
          <CollapsibleTrigger asChild>
            <Button variant="outline" disabled={busy}>
              <MessageSquareWarning className="size-4" aria-hidden />
              Marcar en disputa
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 rounded-md border border-border bg-muted p-3">
              <label htmlFor={`note-${drop.id}`} className="text-sm font-medium">
                ¿Qué pasó con esta entrega?
              </label>
              <Textarea
                id={`note-${drop.id}`}
                className="mt-2 bg-card"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ejemplo: el sobre traía $200 menos de lo registrado."
                maxLength={280}
              />
              {noteError && (
                <p className="mt-2 text-sm font-medium text-error">
                  Escribe qué pasó para que la tienda pueda responder.
                </p>
              )}
              <Button
                variant="destructive"
                className="mt-3"
                disabled={busy}
                onClick={onDispute}
              >
                Enviar disputa
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {(confirm.error || dispute.error) && (
        <p className="mt-3 text-sm font-medium text-error">
          No pudimos guardar el cambio. Vuelve a intentarlo.
        </p>
      )}
    </Card>
  );
}

function HistoryRow({ drop }: { drop: AdminCashDrop }) {
  const when = useWhen();
  return (
    <li className="flex flex-wrap items-center gap-4 p-4">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{drop.storeName}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {when(drop.confirmedAt ?? drop.createdAt)}
        </span>
        {drop.note && <span className="mt-1 block text-sm text-error">{drop.note}</span>}
      </span>
      <StatusBadge status={drop.status} />
      <Amount cents={drop.cents} className="w-24 shrink-0 text-right text-sm font-semibold" />
    </li>
  );
}

function ListSkeleton() {
  return (
    <Card className="mt-4 p-4">
      {[0, 1].map((k) => (
        <div key={k} className="flex items-center gap-4 py-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-6 w-32 rounded-full" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </Card>
  );
}

export function CashDropsScreen() {
  const pending = useQuery<CashDropsResponse, ApiError>(pendingDropsQuery);

  const history = useInfiniteQuery<CashDropsResponse, ApiError>({
    queryKey: ["cash-drops", "resolved"],
    queryFn: ({ pageParam }) =>
      api<CashDropsResponse>(
        `/cash-drops?scope=resolved${pageParam ? `&cursor=${pageParam as number}` : ""}`,
      ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const resolved = history.data?.pages.flatMap((p) => p.drops) ?? [];

  return (
    <main className="px-4 pt-4 lg:px-8 lg:pt-8" aria-live="polite">
      <h1 className="text-xl font-semibold">Entregas</h1>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Por confirmar
      </h2>
      {pending.isError && (
        <ListError
          what="las entregas por confirmar"
          onRetry={() => void pending.refetch()}
          retrying={pending.isRefetching}
          className="mt-3"
        />
      )}
      {pending.isPending && !pending.isError && <ListSkeleton />}
      {!pending.isPending && !pending.isError && pending.data?.drops.length === 0 && (
        <p className="mt-3 flex max-w-lg items-center gap-2 rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          <ArrowDownToLine className="size-4 shrink-0" aria-hidden />
          No hay entregas por confirmar.
        </p>
      )}
      {pending.data && pending.data.drops.length > 0 && (
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          {pending.data.drops.map((drop) => (
            <PendingCard key={drop.id} drop={drop} />
          ))}
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Historial
      </h2>
      {history.isError && !history.data && (
        <ListError
          what="el historial de entregas"
          onRetry={() => void history.refetch()}
          retrying={history.isRefetching}
          className="mt-3"
        />
      )}
      {history.isPending && !history.isError && <ListSkeleton />}
      {!history.isPending && !history.isError && resolved.length === 0 && (
        <p className="mt-3 max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Aún no has confirmado ninguna entrega.
        </p>
      )}
      {resolved.length > 0 && (
        <Card className="mt-3">
          <ul className="divide-y divide-line-soft">
            {resolved.map((drop) => (
              <HistoryRow key={drop.id} drop={drop} />
            ))}
          </ul>
        </Card>
      )}

      {history.isError && history.data && (
        <ListError
          what="más entregas"
          onRetry={() => void history.fetchNextPage()}
          retrying={history.isFetchingNextPage}
          className="mt-4"
        />
      )}

      {history.hasNextPage && !history.isError && (
        <div className="mt-4 pb-6">
          <Button
            variant="outline"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {history.isFetchingNextPage ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      )}
    </main>
  );
}

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, TriangleAlert } from "lucide-react";
import { Amount, Card, ListError, Skeleton, StatusBadge } from "@devolada/ui";
import type { StoresResponse } from "@devolada/api/stores-schema";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";

/* Tiendas list (US-A03): every store with its balance and cap alert —
   the ISP's cash exposure at a glance. */

export function StoresScreen() {
  const { data, isPending, isError, refetch, isRefetching } = useQuery<StoresResponse, ApiError>({
    queryKey: ["stores"],
    queryFn: () => api<StoresResponse>("/stores"),
  });

  return (
    <main className="px-4 pt-4 lg:px-8 lg:pt-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Tiendas</h1>
        <Link to="/stores/new" className="block">
          <Button>
            <Plus className="size-4" aria-hidden />
            Nueva tienda
          </Button>
        </Link>
      </div>

      {isError && (
        <ListError
          what="tus tiendas"
          onRetry={() => void refetch()}
          retrying={isRefetching}
          className="mt-4"
        />
      )}

      {isPending && !isError && (
        <Card className="mt-4 p-4">
          {[0, 1, 2].map((k) => (
            <div key={k} className="flex items-center gap-4 py-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </Card>
      )}

      {!isPending && !isError && data?.stores.length === 0 && (
        <p className="mt-6 max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Todavía no tienes tiendas. Registra la primera y envíale su invitación.
        </p>
      )}

      {data && data.stores.length > 0 && (
        <Card className="mt-4">
          <ul className="divide-y divide-line-soft">
            {data.stores.map((store) => (
              <li key={store.id}>
                {/* design-review D1: the shape the feed row already takes.
                    Squeezed into one line at 360px the name collapsed to
                    nothing and the row named no store at all. */}
                <Link
                  to="/stores/$storeId"
                  params={{ storeId: store.id }}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 p-4 transition-colors duration-150 hover:bg-muted sm:flex"
                >
                  <span className="min-w-0 sm:flex-1">
                    <span className="block text-sm font-medium">{store.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {store.zone ?? "Sin zona"} · {store.phone}
                    </span>
                  </span>
                  <Amount
                    cents={store.balanceCents}
                    className="shrink-0 text-right text-sm font-semibold sm:order-last sm:w-24"
                  />
                  <span className="col-span-2 flex flex-wrap items-center gap-2 sm:contents">
                    {store.cap.approaching && (
                      <span
                        title="Cerca del techo de saldo"
                        className="flex items-center gap-1 text-sm font-medium text-warning"
                      >
                        <TriangleAlert className="size-4 shrink-0" aria-hidden />
                        {store.cap.blocked ? "En el límite" : "Cerca del límite"}
                      </span>
                    )}
                    {/* D2: a store is a store, not an internet service */}
                    <StatusBadge
                      status={
                        store.status === "invited"
                          ? "invited"
                          : store.status === "suspended"
                            ? "storeSuspended"
                            : "storeActive"
                      }
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}

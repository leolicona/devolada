import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plug, PlugZap } from "lucide-react";
import { Card, ListError, Skeleton } from "@devolada/ui";
import type { IntegrationsResponse } from "@devolada/api/integrations-schema";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";

/* The catalog (integrations-hub D1, US-I01): one real card — WispHub —
   and the D17 backlog as a dead second card, so the road to webhooks is
   visible without pretending it exists. */

export function IntegrationsScreen() {
  const integrations = useQuery<IntegrationsResponse, ApiError>({
    queryKey: ["integrations"],
    queryFn: () => api<IntegrationsResponse>("/integrations"),
  });

  return (
    <main className="max-w-3xl px-4 pt-4 lg:px-8 lg:pt-8">
      <h1 className="text-xl font-semibold">Integraciones</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        El sistema donde vive tu operación. Devolada valida y clasifica; aquí decides qué puede
        ejecutar.
      </p>

      {integrations.isPending && <Skeleton className="mt-4 h-32 w-full" />}
      {integrations.error && (
        <ListError
          what="tus integraciones"
          onRetry={() => void integrations.refetch()}
          retrying={integrations.isRefetching}
          className="mt-4"
        />
      )}

      {integrations.data && (
        <div className="mt-4 space-y-4 pb-8">
          <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
            <div className="flex items-center gap-4">
              <span className="flex size-12 items-center justify-center rounded-md border border-border bg-well">
                <PlugZap className="size-6 text-foreground" aria-hidden />
              </span>
              <div>
                <h2 className="text-base font-semibold">WispHub</h2>
                {/* status: icon + text, never color alone */}
                {integrations.data.wisphub.configured ? (
                  <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                    <PlugZap className="size-4" aria-hidden /> Conectada
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    <Plug className="size-4" aria-hidden /> Sin conectar
                  </p>
                )}
              </div>
            </div>
            <Link to="/integrations/wisphub">
              <Button variant={integrations.data.wisphub.configured ? "outline" : "default"}>
                {integrations.data.wisphub.configured ? "Configurar" : "Conectar"}
              </Button>
            </Link>
          </Card>

          {/* D17's backlog, visible and honest: no door yet */}
          {/* muted tokens do the dimming — stacking opacity on top put
              this text at the app's contrast floor (design review fase 5) */}
          <Card className="flex items-center gap-4 p-6">
            <span className="flex size-12 items-center justify-center rounded-md border border-border bg-well">
              <Plug className="size-6 text-muted-foreground" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold text-muted-foreground">Integración genérica</h2>
              <p className="text-sm text-muted-foreground">
                API de Cobros + webhook firmado — en el futuro.
              </p>
            </div>
          </Card>
        </div>
      )}
    </main>
  );
}

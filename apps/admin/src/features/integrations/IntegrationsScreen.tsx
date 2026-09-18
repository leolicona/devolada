import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Code2, KeyRound, Plug, PlugZap } from "lucide-react";
import { Button, Card, ListError, Pending, Skeleton } from "@devolada/ui";
import type { IntegrationsResponse } from "@devolada/api/integrations-schema";
import { api, ApiError } from "@/lib/api";

/* The catalog (integrations-hub D1, US-I01): two live cards — WispHub,
   and the collections API (automated-collections-api US1), the door the
   business's own software collects through. The D17 teaser this second
   card replaces promised exactly this. */

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

      {integrations.error && (
        <ListError
          what="tus integraciones"
          onRetry={() => integrations.refetch()}
          className="mt-4"
        />
      )}

      {/* feedback-vocabulary-rollout D1/D5/D7: the region owns the wait. The shape
          holds the space while the threshold runs; `isPending` is the first
          load, never a refetch the operator did not start. */}
      <Pending
        active={integrations.isPending}
        label="Cargando tus integraciones"
        shape={
          <Skeleton className="mt-4 h-32 w-full" />
        }
      >
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
                <Button size="compact" variant={integrations.data.wisphub.configured ? "secondary" : "primary"}>
                  {integrations.data.wisphub.configured ? "Configurar" : "Conectar"}
                </Button>
              </Link>
            </Card>

            {/* automated-collections-api US1 (FR-001): the API card. "Activa"
                the moment one live credential exists — status as icon + text */}
            <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
              <div className="flex items-center gap-4">
                <span className="flex size-12 items-center justify-center rounded-md border border-border bg-well">
                  <Code2 className="size-6 text-foreground" aria-hidden />
                </span>
                <div>
                  <h2 className="text-base font-semibold">API de cobros</h2>
                  {integrations.data.api.activeCredentials > 0 ? (
                    <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                      <KeyRound className="size-4" aria-hidden /> Activa
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      <Plug className="size-4" aria-hidden /> Sin activar
                    </p>
                  )}
                </div>
              </div>
              <Link to="/integrations/api">
                <Button size="compact" variant={integrations.data.api.activeCredentials > 0 ? "secondary" : "primary"}>
                  {integrations.data.api.activeCredentials > 0 ? "Administrar" : "Activar"}
                </Button>
              </Link>
            </Card>
          </div>
        )}
      </Pending>
    </main>
  );
}

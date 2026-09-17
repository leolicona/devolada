import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, Link2, TriangleAlert } from "lucide-react";
import { Alert, Card, ListError, Pending, Skeleton, StatusBadge } from "@devolada/ui";
import type { WebhookHealthDelivery, WebhookIntegrationResponse } from "@devolada/api/integrations-schema";
import { api, ApiError } from "@/lib/api";
import { useSession } from "../auth/session";
import { formatDateTime } from "@/lib/datetime";

/* The webhook's health (automated-collections-api US2, FR-018, research
   D10): the address the business's software registered, whether
   deliveries are landing, and — when they are not — why, in the
   business's own terms, because an endpoint the business broke is the
   business's to fix. There is no secret to show: deliveries are signed
   with Devolada's own key, and this screen says where the public half
   is published. "Signing not configured" is Devolada's condition and is
   worded as such. Built from @devolada/ui atoms; status is icon + text,
   never colour alone; every wait sits in <Pending>. */

const QUERY_KEY = ["integrations", "webhook"];

function useWebhookIntegration() {
  return useQuery<WebhookIntegrationResponse, ApiError>({
    queryKey: QUERY_KEY,
    queryFn: () => api<WebhookIntegrationResponse>("/integrations/webhook"),
  });
}

/* The delivery's last reason, in the business's words (es-MX). The
   codes are the queue's (`webhooks/queue.ts`); a code this list does
   not know is shown as it is rather than hidden. */
function reasonCopy(error: string | null): string | null {
  if (error === null) return null;
  if (error === "TIMEOUT") return "Tu servidor no respondió en 10 segundos.";
  if (error === "UNREACHABLE") return "No se pudo conectar con tu servidor.";
  if (error === "ENDPOINT_REMOVED") return "La dirección fue eliminada antes de entregar.";
  if (error === "SIGNING_KEY_MISSING") return "La firma de los webhooks no está configurada en Devolada.";
  const http = /^HTTP_(\d{3})$/.exec(error);
  if (http) return `Tu servidor respondió ${http[1]}.`;
  return error;
}

/* `payment.confirmed` → "confirmed", the row's own word (research D17) */
const eventWord = (type: string) => type.replace(/^payment\./, "");

function DeliveryRow({ delivery, when }: { delivery: WebhookHealthDelivery; when: (ms: number) => string }) {
  const badge =
    delivery.status === "delivered" ? "deliveryDelivered" : delivery.status === "pending" ? "deliveryPending" : "deliveryFailed";
  const reason = delivery.status === "delivered" ? null : reasonCopy(delivery.lastError);
  return (
    <li className="space-y-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <code className="rounded-md border border-border bg-well px-2 py-0.5 font-mono text-xs">{eventWord(delivery.type)}</code>
          <span className="text-muted-foreground">{when(delivery.createdAt)}</span>
        </p>
        <StatusBadge status={badge} />
      </div>
      <p className="text-sm text-muted-foreground">
        {delivery.attempts === 1 ? "1 intento" : `${delivery.attempts} intentos`}
        {delivery.deliveredAt !== null ? ` · entregado ${when(delivery.deliveredAt)}` : ""}
        {delivery.status === "pending" && delivery.nextAttemptAt !== null ? ` · siguiente intento ${when(delivery.nextAttemptAt)}` : ""}
      </p>
      {reason && (
        <p className="flex items-start gap-2 text-sm font-medium text-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {reason}
        </p>
      )}
    </li>
  );
}

export function WebhookScreen() {
  const { data: actor } = useSession();
  const integration = useWebhookIntegration();
  const timezone = actor?.timezone ?? "America/Mexico_City";
  const timeFormat = actor?.timeFormat ?? "12h";
  const when = (ms: number) => formatDateTime(ms, timeFormat, timezone);

  return (
    <main className="max-w-3xl px-4 pt-4 lg:px-8 lg:pt-8">
      <Link to="/integrations/api" className="flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> API de cobros
      </Link>
      <h1 className="mt-2 text-xl font-semibold">Webhook</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Devolada avisa a tu sistema cada vez que un pago cambia de estado: cuando acepta el
        comprobante y cuando Banxico confirma la transferencia.
      </p>

      {integration.error && <ListError what="el webhook" onRetry={() => integration.refetch()} className="mt-4" />}

      <Pending
        active={integration.isPending}
        label="Cargando el webhook"
        shape={
          <div className="mt-4 space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        }
      >
        {integration.data && (
          <div className="mt-4 space-y-4 pb-8">
            {/* research D10 / constitution VIII: Devolada's condition, in
                Devolada's words. Nothing here is the business's to configure. */}
            {!integration.data.signingConfigured && (
              <Alert variant="warning" layout="icon">
                <TriangleAlert aria-hidden />
                <span>
                  <strong>La firma de los webhooks no está configurada en Devolada.</strong> Los avisos se
                  registran y se entregarán en cuanto lo esté; mientras tanto no se envía ninguno sin
                  firma. No hay nada que cambiar de tu lado.
                </span>
              </Alert>
            )}

            <Card className="space-y-3 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Dirección</h2>
                {integration.data.endpoint &&
                  (integration.data.endpoint.consecutiveFailures > 0 ? (
                    <StatusBadge status="webhookFailing" />
                  ) : (
                    <StatusBadge status="webhookHealthy" />
                  ))}
              </div>
              {integration.data.endpoint ? (
                <>
                  <p className="flex items-start gap-2 text-sm">
                    <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <code className="min-w-0 break-all font-mono" aria-label="Dirección del webhook">
                      {integration.data.endpoint.url}
                    </code>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Registrada {when(integration.data.endpoint.createdAt)}
                    {integration.data.endpoint.lastSuccessAt !== null
                      ? ` · última entrega ${when(integration.data.endpoint.lastSuccessAt)}`
                      : " · sin entregas todavía"}
                  </p>
                  {integration.data.endpoint.consecutiveFailures > 0 && (
                    <p role="status" className="flex items-start gap-2 text-sm font-medium text-error">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <span>
                        {integration.data.endpoint.consecutiveFailures === 1
                          ? "El último intento falló."
                          : `Los últimos ${integration.data.endpoint.consecutiveFailures} intentos fallaron.`}{" "}
                        Revisa que tu servidor responda con un código 2xx en menos de 10 segundos. Cada
                        aviso se reintenta durante unas cinco horas y después queda pendiente de que tu
                        sistema pida el reenvío.
                      </span>
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Tu sistema todavía no registra una dirección. La registra él mismo con su llave de la
                  API (<code className="font-mono">PUT /v1/webhook</code>); tiene que ser una dirección{" "}
                  <code className="font-mono">https</code>.
                </p>
              )}
            </Card>

            {/* research D10: nothing to copy, nothing to rotate — only where to verify */}
            <Card className="flex items-start gap-3 p-6">
              <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Cada aviso va firmado con la llave de Devolada; no hay ningún secreto que guardar ni
                rotar. Tu sistema verifica la firma con las llaves públicas en{" "}
                <a href={integration.data.jwksUrl} className="break-all font-mono text-link hover:underline">
                  {integration.data.jwksUrl}
                </a>
                .
              </p>
            </Card>

            <Card>
              <h2 className="px-4 pt-4 text-base font-semibold">Últimas entregas</h2>
              {integration.data.deliveries.length === 0 ? (
                <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">Todavía no hay avisos que entregar.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line-soft border-t border-line-soft">
                  {integration.data.deliveries.map((delivery) => (
                    <DeliveryRow key={delivery.id} delivery={delivery} when={when} />
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </Pending>
    </main>
  );
}

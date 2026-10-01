import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Copy, MessageCircle, Plus, TriangleAlert } from "lucide-react";
import { Alert, Amount, Button, Card, Field, Input, Pending, Skeleton, StatusBadge, formatMoney, type Status } from "@devolada/ui";
import type { CollectionOutcome } from "@devolada/api/store-schema";
import { nationalPhone } from "@/lib/phone";
import { openExternal } from "@/lib/open";
import { getCollection, getReceipt } from "./api";

/* cash-at-stores D25, FR-025–FR-027: the folio at once, the outcome as it
   changes, and the receipt by WhatsApp from the shopkeeper's phone. */

/* D25: the old ResultScreen's cadence */
const POLL_MS = 3000;

/* FR-025: every outcome as icon + text, through StatusBadge alone */
const BADGE: Record<CollectionOutcome, Status> = {
  reconnected: "reconnected",
  registered: "registered",
  queued: "queued",
  not_reconnected_short: "withheld",
  observation: "observation",
  failed: "failed",
};

/* What the shopkeeper can tell the customer, outcome by outcome */
const SAY: Record<CollectionOutcome, string> = {
  reconnected: "El servicio del cliente ya está activo.",
  registered: "El negocio registró el pago. Su regla no reactiva el servicio desde aquí.",
  queued: "Estamos avisando al negocio. El servicio se reactivará en unos minutos.",
  not_reconnected_short: "El pago quedó registrado, pero no alcanza para reactivar el servicio.",
  observation: "El pago quedó registrado. El negocio reactivará el servicio a mano.",
  failed: "No pudimos avisar al negocio. El pago sí quedó registrado y el negocio lo revisará.",
};

/* FR-027: a number typed here builds the link in the app and never
   reaches the server */
function TypedNumber({ text, onCancel }: { text: string; onCancel?: () => void }) {
  const [typed, setTyped] = useState("");
  const digits = nationalPhone(typed);
  return (
    <div className="space-y-3">
      <Field label="WhatsApp del cliente (10 dígitos)">
        <Input inputMode="tel" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="55 1234 5678" />
      </Field>
      <p className="text-sm text-ink-soft">Solo se usa para este comprobante; no se guarda.</p>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={!digits}
          onClick={() => digits && openExternal(`https://wa.me/52${digits}?text=${encodeURIComponent(text)}`)}
        >
          <MessageCircle className="size-5" aria-hidden />
          Abrir WhatsApp
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}

function Receipt({ id }: { id: string }) {
  /* D18: asked for at the tap, never when the screen opens — the phone is
     read only when it is needed */
  const [state, setState] = useState<
    | { step: "idle" }
    | { step: "busy" }
    | { step: "typed"; text: string }
    | { step: "copied" }
    | { step: "error" }
  >({ step: "idle" });

  const fetchReceipt = async () => {
    setState({ step: "busy" });
    try {
      return await getReceipt(id);
    } catch {
      setState({ step: "error" });
      return null;
    }
  };

  return (
    <div className="space-y-3">
      {state.step === "typed" ? (
        <TypedNumber text={state.text} onCancel={() => setState({ step: "idle" })} />
      ) : (
        <Pending active={state.step === "busy"} label="Preparando el comprobante">
          <div className="space-y-3">
            <Button
              className="w-full"
              disabled={state.step === "busy"}
              onClick={async () => {
                const receipt = await fetchReceipt();
                if (!receipt) return;
                if (receipt.hasPhone) {
                  setState({ step: "idle" });
                  openExternal(receipt.waLink);
                } else {
                  /* FR-027: no phone, or the system did not answer — ask */
                  setState({ step: "typed", text: receipt.text });
                }
              }}
            >
              <MessageCircle className="size-5" aria-hidden />
              Enviar comprobante
            </Button>
            <div className="grid grid-cols-2 gap-3">
              {/* the spec's edge case: a wrong phone on file */}
              <Button
                variant="secondary"
                disabled={state.step === "busy"}
                onClick={async () => {
                  const receipt = await fetchReceipt();
                  if (receipt) setState({ step: "typed", text: receipt.text });
                }}
              >
                Usar otro número
              </Button>
              <Button
                variant="secondary"
                disabled={state.step === "busy"}
                onClick={async () => {
                  const receipt = await fetchReceipt();
                  if (!receipt) return;
                  try {
                    await navigator.clipboard.writeText(receipt.text);
                    setState({ step: "copied" });
                  } catch {
                    setState({ step: "error" });
                  }
                }}
              >
                <Copy className="size-5" aria-hidden />
                Copiar
              </Button>
            </div>
          </div>
        </Pending>
      )}
      {state.step === "copied" && (
        <Alert variant="success" layout="icon">
          <CheckCircle2 aria-hidden />
          Comprobante copiado. Pégalo en el chat del cliente.
        </Alert>
      )}
      {state.step === "error" && (
        <Alert variant="destructive" layout="icon">
          <TriangleAlert aria-hidden />
          No pudimos preparar el comprobante. Revisa tu conexión e intenta de nuevo.
        </Alert>
      )}
    </div>
  );
}

export function ResultScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const collection = useQuery({
    queryKey: ["store-collection", id],
    queryFn: () => getCollection(id),
    /* D25: while the business's system has not answered */
    refetchInterval: (q) => (q.state.data?.outcome === "queued" ? POLL_MS : false),
  });
  const data = collection.data;

  return (
    <section className="space-y-4" aria-labelledby="resultado-title">
      <Pending active={collection.isPending} label="Cargando el pago" shape={<Skeleton className="h-48 w-full" />}>
        {collection.isError ? (
          <Alert variant="destructive" layout="icon">
            <TriangleAlert aria-hidden />
            No pudimos cargar este pago. Revisa tu conexión.
          </Alert>
        ) : data ? (
          <>
            <Card className="space-y-4 p-6">
              <header className="space-y-1">
                <h1 id="resultado-title" className="text-lg font-semibold">
                  Pago registrado
                </h1>
                <p className="text-sm text-ink-soft">
                  {data.customerName} · {data.businessName}
                </p>
              </header>
              <div>
                <p className="text-sm text-ink-soft">Folio</p>
                <p className="font-mono text-2xl font-medium tracking-wide">{data.folio}</p>
              </div>
              <dl className="space-y-1 text-base">
                <div className="flex justify-between gap-4">
                  <dt>Al adeudo</dt>
                  <dd>
                    <Amount cents={data.amountCents} />
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Cargo por servicio</dt>
                  <dd>
                    <Amount cents={data.feeCents} />
                  </dd>
                </div>
                {data.remainingCents > 0 && (
                  <div className="flex justify-between gap-4 font-medium text-warning">
                    <dt>Queda por pagar</dt>
                    <dd className="tabular-nums">{formatMoney(data.remainingCents)}</dd>
                  </div>
                )}
              </dl>
              {/* waiting breathes (constitution VI): the queued outcome is a
                  region still working, never a frozen one */}
              <Pending active={data.outcome === "queued"} label="Esperando al negocio" announce={false}>
                <div aria-live="polite" className="space-y-2">
                  <StatusBadge status={BADGE[data.outcome]} size="standard" />
                  <p className="text-base">{SAY[data.outcome]}</p>
                </div>
              </Pending>
            </Card>
            <Receipt id={data.id} />
            <Button variant="ghost" className="w-full" onClick={() => navigate({ to: "/" })}>
              <Plus className="size-5" aria-hidden />
              Nuevo cobro
            </Button>
          </>
        ) : null}
      </Pending>
    </section>
  );
}

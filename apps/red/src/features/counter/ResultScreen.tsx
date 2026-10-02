import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Copy, MessageCircle, Plus, TriangleAlert } from "lucide-react";
import { Alert, Amount, Button, Card, Field, Input, Pending, Reveal, Skeleton, StatusBadge, formatMoney, type Status } from "@devolada/ui";
import type { CollectionOutcome, CollectionStatusResponse } from "@devolada/api/store-schema";
import { nationalPhone } from "@/lib/phone";
import { openExternal } from "@/lib/open";
import { useWide } from "@/lib/wide";
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

/* T071 (FR-025, the spec's edge case on a short payment below the
   threshold): a queued payment says what its verdict decided. Only a
   decided reconnection is "Reconexión en cola"; anything else is told as
   it will end, while the registration is still on its way. */
function outcomeShown(data: CollectionStatusResponse): { badge: Status; say: string; registering: boolean } {
  if (data.outcome !== "queued" || data.reconnects) {
    return { badge: BADGE[data.outcome], say: SAY[data.outcome], registering: false };
  }
  return {
    badge: "withheld",
    say:
      data.class === "short"
        ? `Con este monto el servicio no se reactiva. Dile al cliente que queda a deber ${formatMoney(data.remainingCents)}.`
        : "El negocio registrará el pago. Su regla no reactiva el servicio desde aquí.",
    registering: true,
  };
}

function Outcome({ data }: { data: CollectionStatusResponse }) {
  const shown = outcomeShown(data);
  return (
    <>
      <StatusBadge status={shown.badge} size="standard" />
      <p className="text-base">{shown.say}</p>
      {shown.registering && <p className="text-sm text-ink-soft">Registrando el pago en {data.businessName}.</p>}
    </>
  );
}

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
            {/* T094: the full label needs the width — stacked on a phone
                (the tokens' `sm` is 375px, a phone, so `md`), and in the
                right half of *Cobrar* until that half is wide enough (D32) */}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
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
                Copiar comprobante
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
  /* D32: on a computer this is the right half of *Cobrar* */
  const Title = useWide() ? "h2" : "h1";

  return (
    <section className="space-y-4" aria-labelledby="resultado-title">
      <Pending active={collection.isPending} label="Cargando el pago" shape={<Skeleton className="h-48 w-full" />}>
        {/* T082 (US1/AC10): one failed poll keeps the folio on screen — the
            query still holds the last answer; only no answer at all is an error */}
        {collection.isError && !data ? (
          <Alert variant="destructive" layout="icon">
            <TriangleAlert aria-hidden />
            No pudimos cargar este pago. Revisa tu conexión.
          </Alert>
        ) : data ? (
          <div className="space-y-4">
            <Card className="space-y-4 p-6">
              <header className="space-y-1">
                <Title id="resultado-title" className="text-lg font-semibold">
                  Pago registrado
                </Title>
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
                <div aria-live="polite">
                  {/* T084 (constitution VI): the outcome cross-fades when it changes */}
                  <Reveal key={`${data.outcome}-${data.reconnects}`} className="space-y-2">
                    <Outcome data={data} />
                  </Reveal>
                </div>
              </Pending>
              {collection.isError && (
                <Alert variant="warning" layout="icon">
                  <TriangleAlert aria-hidden />
                  No pudimos actualizar el estado. Revisa tu conexión; seguimos intentando.
                </Alert>
              )}
            </Card>
            <Receipt id={data.id} />
            <Button variant="ghost" className="w-full" onClick={() => navigate({ to: "/" })}>
              <Plus className="size-5" aria-hidden />
              Nuevo cobro
            </Button>
          </div>
        ) : null}
      </Pending>
    </section>
  );
}

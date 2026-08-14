import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, MessageCircle } from "lucide-react";
import { Amount, Button, StatusBadge } from "@devolada/ui";
import type { ChargeResponse, ReceiptResponse } from "@devolada/api/charges-schema";
import { api, ApiError } from "../../api/client";

/* The charge result (US-C03). While queued, the screen polls: the green
   "Reconectado" must appear without any tap from the shopkeeper. */

/* US-C05: the shopkeeper sends the receipt from their own WhatsApp
   (receipt spec D1). The API owns the words; this owns the two taps. */
function ReceiptActions({ chargeId }: { chargeId: string }) {
  const [copied, setCopied] = useState(false);
  const { data } = useQuery<ReceiptResponse, ApiError>({
    queryKey: ["receipt", chargeId],
    queryFn: () => api<ReceiptResponse>(`/charges/${chargeId}/receipt`),
  });

  if (!data) return null;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(data!.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Some in-app browsers deny the clipboard; the text stays visible
         on screen and the folio is written above either way. */
    }
  }

  return (
    <div className="mt-6 w-full max-w-sm space-y-3">
      <a href={data.waLink} target="_blank" rel="noreferrer" className="block">
        <Button className="w-full">
          <MessageCircle className="size-5" aria-hidden />
          Enviar comprobante
        </Button>
      </a>
      <Button variant="secondary" className="w-full" onClick={() => void onCopy()}>
        {copied ? (
          <>
            <Check className="size-5" aria-hidden />
            Copiado
          </>
        ) : (
          <>
            <Copy className="size-5" aria-hidden />
            Copiar comprobante
          </>
        )}
      </Button>
    </div>
  );
}

export function ResultScreen() {
  const { chargeId } = useParams({ strict: false }) as { chargeId: string };
  const { data, isPending } = useQuery<ChargeResponse, ApiError>({
    queryKey: ["charge", chargeId],
    queryFn: () => api<ChargeResponse>(`/charges/${chargeId}`),
    refetchInterval: (query) =>
      query.state.data?.reconnectionStatus === "queued" ? 3000 : false,
  });

  if (isPending || !data) {
    return (
      <main className="px-6 pt-8">
        <p className="text-sm text-ink-faint">Cargando…</p>
      </main>
    );
  }

  const queued = data.reconnectionStatus === "queued";

  return (
    <main
      className="flex min-h-[calc(100dvh-5rem)] flex-col items-center px-6 pt-12 pb-6 text-center"
      aria-live="polite"
    >
      <p className="text-sm text-ink-soft">Cobro registrado</p>
      <Amount
        cents={data.totalCents}
        className="mt-1 block font-semibold tracking-tight text-amount leading-[1.15]"
      />
      <p className="mt-2 text-base text-ink-soft">{data.customerName}</p>

      <div className="mt-6">
        <StatusBadge status={data.reconnectionStatus} size="md" />
      </div>

      {queued && (
        <p className="mt-4 max-w-sm text-sm text-ink-soft">
          El pago quedó guardado. La reconexión se aplicará sola en cuanto el sistema del ISP
          responda.
        </p>
      )}

      {/* The folio is the receipt of last resort: the customer can write
          it down even if nothing sends (receipt spec UI contract) */}
      <p className="mt-6 font-mono text-sm text-ink-faint">Folio {data.folio}</p>

      <ReceiptActions chargeId={chargeId} />

      <div className="mt-auto w-full pt-8">
        <Link to="/">
          <Button size="critical" variant="secondary">
            Nuevo cobro
          </Button>
        </Link>
      </div>
    </main>
  );
}

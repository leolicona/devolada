import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { Alert, AmountBreakdown, Button, Card, Field, Input, Pending, Skeleton, StatusBadge, formatMoney, parseMoney } from "@devolada/ui";
import type { StoreQuoteResponse } from "@devolada/api/store-schema";
import { ApiError } from "@/lib/api";
import { getQuote, recordCollection } from "./api";

/* cash-at-stores D14, FR-018–FR-021: the quote and the confirmation. The
   debt is read live; the amount is the whole debt by default and may be
   typed down, never up; the fee rides on top of whatever is collected;
   and *Cobrar $X* is the decisive action. A changed debt or fee re-asks
   with the new amounts (AMOUNT_CHANGED). */

type Owes = Extract<StoreQuoteResponse, { state: "owes" }>;

const asText = (cents: number) => (cents / 100).toFixed(2);

/* The spec's edge case "a short payment below the business's threshold":
   said before confirming, so the shopkeeper can tell the customer */
function ReconnectNotice({ quote, amountCents }: { quote: Owes; amountCents: number }) {
  const from = quote.reconnectsFromCents;
  if (from === null) {
    return (
      <Alert layout="icon">
        <Info aria-hidden />
        Este negocio reactiva el servicio por su cuenta: el pago queda registrado y el negocio decide.
      </Alert>
    );
  }
  if (amountCents >= quote.debtCents) return null;
  return amountCents >= from ? (
    <Alert layout="icon">
      <Info aria-hidden />
      Con este monto el servicio se reactiva. Quedará a deber {formatMoney(quote.debtCents - amountCents)}.
    </Alert>
  ) : (
    <Alert variant="warning" layout="icon">
      <TriangleAlert aria-hidden />
      Con este monto el servicio no se reactiva: quedará a deber {formatMoney(quote.debtCents - amountCents)}.
      {from < quote.debtCents ? ` Para reactivarlo, cobra al menos ${formatMoney(from)}.` : " Para reactivarlo, cobra todo el adeudo."}
    </Alert>
  );
}

const RECORD_ERRORS: Record<string, string> = {
  AMOUNT_CHANGED: "El adeudo o el cargo cambiaron. Revisa los montos nuevos y vuelve a cobrar.",
  NOTHING_DUE: "Este cliente ya no tiene adeudo. No se registró ningún pago.",
  AMOUNT_ABOVE_DEBT: "El monto es mayor que el adeudo. No se registró ningún pago.",
  INTEGRATION_UNAVAILABLE: "El sistema del negocio no respondió. No se registró ningún pago; intenta de nuevo.",
  CHANNEL_OFF: "Por ahora no hay negocios para cobrar en esta tienda. No se registró ningún pago.",
  NOT_CAPABLE: "Por ahora no se puede cobrar a clientes de este negocio. No se registró ningún pago.",
  /* FR-023: the key makes a second tap safe — say so */
  NETWORK_ERROR: "Sin conexión. Si ya tocaste Cobrar, vuelve a tocarlo cuando regrese la señal: no se cobra dos veces.",
};

/* T095 (FR-028): a refused quote says its real reason — a lost signal is
   one reason among several, never the word for all of them */
function quoteErrorSay(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "";
  if (code === "CHANNEL_OFF") return "Por ahora no hay negocios para cobrar en esta tienda.";
  if (code === "NOT_CAPABLE") return "Por ahora no se puede cobrar a clientes de este negocio.";
  if (code === "NETWORK_ERROR") return "Revisa tu conexión e intenta de nuevo.";
  return "El sistema del negocio no respondió. Intenta de nuevo en unos minutos.";
}

function Collect({ quote, usuario }: { quote: Owes; usuario: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  /* D15: one key per confirm screen — a retry after a lost signal answers
     the payment the first tap made */
  const [collectionKey] = useState(() => crypto.randomUUID());
  const [amountText, setAmountText] = useState(asText(quote.debtCents));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = parseMoney(amountText);
  const problem =
    amountCents === null || amountCents <= 0
      ? "Escribe un monto mayor a $0."
      : amountCents > quote.debtCents
        ? `Lo más que puedes cobrar es ${formatMoney(quote.debtCents)}.`
        : null;
  const whole = amountCents === quote.debtCents;
  const totalCents = (amountCents ?? 0) + quote.feeCents;

  const submit = async () => {
    if (problem || amountCents === null) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await recordCollection({
        usuario,
        amountCents,
        expectedDebtCents: quote.debtCents,
        expectedFeeCents: quote.feeCents,
        collectionKey,
      });
      /* T081: the debt this quote read is spent — the next quote for this
         customer reads it again, never from the cache */
      queryClient.removeQueries({ queryKey: ["store-quote", usuario] });
      void navigate({ to: "/cobros/$id", params: { id } });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "UNKNOWN_ERROR";
      setError(RECORD_ERRORS[code] ?? "No se pudo registrar el pago. Intenta de nuevo.");
      if (code === "AMOUNT_CHANGED" || code === "NOTHING_DUE") {
        /* FR-021: the new amounts, read again */
        const fresh = await queryClient.fetchQuery({ queryKey: ["store-quote", usuario], queryFn: () => getQuote(usuario) }).catch(() => null);
        if (fresh?.state === "owes") setAmountText(asText(fresh.debtCents));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Monto a cobrar del adeudo">
        <Input
          prefix="$"
          inputMode="decimal"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          aria-invalid={problem ? true : undefined}
          aria-describedby="monto-ayuda"
        />
      </Field>
      <p id="monto-ayuda" role={problem ? "alert" : undefined} className={`text-sm ${problem ? "font-medium text-error" : "text-ink-soft"}`}>
        {problem ?? "Puedes cobrar todo el adeudo o una parte. El cargo por servicio se suma siempre."}
      </p>

      <AmountBreakdown
        lines={[
          { label: whole ? "Adeudo" : "Abono al adeudo", cents: amountCents ?? 0 },
          { label: "Cargo por servicio", cents: quote.feeCents },
        ]}
        totalLabel="Total a cobrar"
      />

      {!problem && amountCents !== null && <ReconnectNotice quote={quote} amountCents={amountCents} />}

      {error && (
        <Alert variant="destructive" layout="icon">
          <TriangleAlert aria-hidden />
          {error}
        </Alert>
      )}

      <Pending active={busy} label="Registrando el pago">
        <Button size="decisive" disabled={Boolean(problem) || busy} onClick={submit}>
          Cobrar {formatMoney(totalCents)}
        </Button>
      </Pending>
    </div>
  );
}

export function QuoteScreen() {
  const { usuario } = useParams({ strict: false }) as { usuario: string };
  const quote = useQuery({ queryKey: ["store-quote", usuario], queryFn: () => getQuote(usuario), staleTime: 0 });
  /* T081 (FR-018, the spec's edge case "never shows an amount it did not
     just read"): a quote still in the cache waits for the fresh read —
     *Cobrar* is never offered on an amount from before */
  const reading = quote.isPending || (quote.isFetching && !quote.isFetchedAfterMount);

  return (
    <section className="space-y-4" aria-labelledby="cobro-title">
      <Link to="/" className="inline-flex min-h-12 items-center gap-2 text-base font-medium text-link">
        <ArrowLeft className="size-5" aria-hidden />
        Buscar otro cliente
      </Link>
      <Pending active={reading} label="Leyendo el adeudo" shape={<Skeleton className="h-40 w-full" />}>
        {reading ? null : quote.isError ? (
          <Card className="space-y-3 p-6">
            <h1 id="cobro-title" className="text-lg font-semibold">
              No pudimos leer el adeudo
            </h1>
            <p className="text-base text-ink-soft">{quoteErrorSay(quote.error)}</p>
            <Button variant="secondary" onClick={() => quote.refetch()}>
              <RefreshCw className="size-5" aria-hidden />
              Intentar de nuevo
            </Button>
          </Card>
        ) : quote.data?.state === "unavailable" ? (
          /* D14: an unproven amount is never shown — and never collected */
          <Card className="space-y-3 p-6">
            <h1 id="cobro-title" className="text-lg font-semibold">
              No pudimos leer el adeudo
            </h1>
            <Alert variant="warning" layout="icon">
              <TriangleAlert aria-hidden />
              El sistema del negocio no responde ahora. No cobres un monto que no veas aquí; intenta en unos minutos.
            </Alert>
            <Button variant="secondary" onClick={() => quote.refetch()}>
              <RefreshCw className="size-5" aria-hidden />
              Intentar de nuevo
            </Button>
          </Card>
        ) : quote.data ? (
          <Card className="space-y-4 p-6">
            <header>
              <h1 id="cobro-title" className="text-lg font-semibold">
                {quote.data.name || quote.data.usuario}
              </h1>
              <p className="text-sm text-ink-soft">
                {quote.data.usuario}
                {quote.data.zone ? ` · ${quote.data.zone}` : ""}
              </p>
            </header>
            {quote.data.state === "none" ? (
              /* FR-018: nothing owed is said, and nothing is offered */
              <div className="space-y-2">
                <StatusBadge status="debtNone" size="standard" />
                <p className="text-base">Este cliente no tiene adeudo. No hay nada que cobrar.</p>
              </div>
            ) : (
              <>
                <p className="text-base">
                  Debe <span className="font-semibold tabular-nums">{formatMoney(quote.data.debtCents)}</span>
                  {quote.data.carriedBalanceCents > 0 && (
                    <span className="text-ink-soft">
                      {" "}
                      ({formatMoney(quote.data.invoiceCents)} del periodo y {formatMoney(quote.data.carriedBalanceCents)} de adeudo anterior)
                    </span>
                  )}
                </p>
                <Collect quote={quote.data} usuario={usuario} />
              </>
            )}
          </Card>
        ) : null}
      </Pending>
    </section>
  );
}

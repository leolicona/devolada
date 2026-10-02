import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Info, TriangleAlert } from "lucide-react";
import { Alert, Button, Card, Field, Input, Pending, Skeleton, buttonVariants, cn, formatMoney, parseMoney } from "@devolada/ui";
import { ApiError } from "@/lib/api";
import { useWide } from "@/lib/wide";
import { declareHandover, getCashbox } from "./api";
import { BusinessCash } from "./CashboxScreen";

/* cash-at-stores FR-038, D20: declare a hand-over to one business — above
   zero and no more than what is held. It stays pending until the business
   confirms or disputes it; the balance does not move before. */

const ERRORS: Record<string, string> = {
  HANDOVER_PENDING: "Ya tienes una entrega pendiente con este negocio. Espera a que la confirme.",
  AMOUNT_EXCEEDS_HELD: "Es más de lo que tienes de este negocio.",
  NETWORK_ERROR: "Sin conexión. Intenta cuando regrese la señal.",
};

export function HandoverScreen() {
  const { businessId } = useSearch({ strict: false }) as { businessId?: string };
  const cashbox = useQuery({ queryKey: ["store-cashbox"], queryFn: getCashbox });
  const business = cashbox.data?.businesses.find((b) => b.businessId === businessId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountText = text ?? (business ? (business.heldCents / 100).toFixed(2) : "");
  const cents = parseMoney(amountText);
  const problem = !business
    ? null
    : cents === null || cents <= 0
      ? "Escribe un monto mayor a $0."
      : cents > business.heldCents
        ? `Lo más que puedes entregar es ${formatMoney(business.heldCents)}.`
        : null;

  /* D32: on a computer the form sits beside the business's card, under
     the section's h1 *Mi caja* */
  const wide = useWide();
  const Title = wide ? "h2" : "h1";

  return (
    <section className={wide ? "space-y-6" : "space-y-4"} aria-labelledby={wide ? "caja-title" : "entrega-title"}>
      {wide ? (
        <h1 id="caja-title" className="text-xl font-semibold">
          Mi caja
        </h1>
      ) : (
        <Link to="/caja" className="inline-flex min-h-12 items-center gap-2 text-base font-medium text-link">
          <ArrowLeft className="size-5" aria-hidden />
          Mi caja
        </Link>
      )}
      <Pending active={cashbox.isPending} label="Cargando tu caja" shape={<Skeleton className="h-40 w-full" />}>
        {!business ? (
          cashbox.isPending ? null : <p className="text-base text-ink-soft">No encontramos ese negocio en tu caja.</p>
        ) : (
          <div className={wide ? "grid items-start gap-6 lg:grid-cols-2" : undefined}>
            {wide && <BusinessCash b={business} declare={false} />}
            <Card className="space-y-4 p-6">
              <header>
                <Title id="entrega-title" className="text-lg font-semibold">
                  Registrar entrega
                </Title>
                <p className="text-base text-ink-soft">
                  A {business.businessName}. Tienes {formatMoney(business.heldCents)}.
                </p>
              </header>
              <Field label="Monto que entregaste">
                <Input prefix="$" inputMode="decimal" value={amountText} onChange={(e) => setText(e.target.value)} aria-describedby="entrega-ayuda" />
              </Field>
              {problem && (
                <p id="entrega-ayuda" role="alert" className="text-sm font-medium text-error">
                  {problem}
                </p>
              )}
              <Alert layout="icon">
                <Info aria-hidden />
                La entrega quedará pendiente hasta que el negocio confirme que recibió el efectivo.
              </Alert>
              {error && (
                <Alert variant="destructive" layout="icon">
                  <TriangleAlert aria-hidden />
                  {error}
                </Alert>
              )}
              <Pending active={busy} label="Registrando la entrega">
                <Button
                  size="decisive"
                  disabled={Boolean(problem) || busy}
                  onClick={async () => {
                    if (problem || cents === null) return;
                    setBusy(true);
                    setError(null);
                    try {
                      await declareHandover({ businessId: business.businessId, cents });
                      await queryClient.invalidateQueries({ queryKey: ["store-cashbox"] });
                      void navigate({ to: "/caja" });
                    } catch (e) {
                      const code = e instanceof ApiError ? e.code : "UNKNOWN_ERROR";
                      setError(ERRORS[code] ?? "No se pudo registrar la entrega. Intenta de nuevo.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Registrar entrega de {formatMoney(cents ?? 0)}
                </Button>
              </Pending>
              {wide && (
                /* on a phone the way back is the link above the form */
                <Link to="/caja" className={cn(buttonVariants({ variant: "ghost", size: "standard" }), "w-full")}>
                  Cancelar
                </Link>
              )}
            </Card>
          </div>
        )}
      </Pending>
    </section>
  );
}

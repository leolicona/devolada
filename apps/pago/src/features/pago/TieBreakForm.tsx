import { useId, useState } from "react";
import { Alert, Button, Field, Input, Pending } from "@devolada/ui";
import type { DirectPaymentStatusResponse } from "@devolada/api/direct-payments-schema";
import { ShieldCheck, TriangleAlert } from "lucide-react";

/* The tie-break screen (confirmation-hierarchy D9, D12; spec FR-011–FR-014,
   FR-018, FR-031; contracts/payment-page.md "The tie-break screen").

   A reference the payer typed found one transfer or several, and nothing
   Devolada learned ties one of them to this payer. One screen, two ways
   to answer — the last four digits of the account they paid from, or the
   last four characters of their clave de rastreo — and either one is
   enough (clarified 2026-09-30). The server says which fields to show
   (`tieBreak.ways`): after the digits chose another person's account only
   the characters; after one way left several only the other.

   Nothing of a transfer found is shown or suggested (FR-018): the fields
   start empty, and the figure above them marks where each answer is found
   in a transfer's detail with placeholders, never with a value — any real
   digit would hand a guesser the answer (D22). An answer is read against
   the transfers already found, with no new search (FR-012). */

type TieBreak = NonNullable<DirectPaymentStatusResponse["tieBreak"]>;

export type TieBreakAnswer = { senderTail?: string; claveTail?: string };

/* D12: the screen's opening sentence, by what is still asked */
function opening(tieBreak: TieBreak): string {
  const [only] = tieBreak.ways.length === 1 ? tieBreak.ways : [null];
  if (only === "clave_tail") {
    return "Para confirmar que esta transferencia es tuya, escribe los últimos 4 caracteres de tu clave de rastreo.";
  }
  if (only === "sender_tail") return "Escribe también los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste.";
  return tieBreak.several
    ? "Encontramos más de una transferencia con esos datos. Para saber cuál es la tuya, escribe uno de estos datos. Con uno basta."
    : "Encontramos una transferencia con esos datos. Para confirmar que es tuya, escribe uno de estos datos. Con uno basta.";
}

export function TieBreakForm({
  tieBreak,
  busy,
  onSubmit,
}: {
  tieBreak: TieBreak;
  busy: boolean;
  onSubmit: (answer: TieBreakAnswer) => void;
}) {
  const digitsWay = tieBreak.ways.includes("sender_tail");
  const charsWay = tieBreak.ways.includes("clave_tail");
  const [digits, setDigits] = useState("");
  const [chars, setChars] = useState("");
  const digitsOk = digitsWay && /^\d{4}$/.test(digits);
  const charsOk = charsWay && /^[A-Z0-9]{4}$/.test(chars);
  const figureId = useId();

  return (
    <div className="space-y-4">
      <p className="text-base text-ink">{opening(tieBreak)}</p>

      {tieBreak.missed && (
        /* FR-014: what was searched, never that the payer is wrong */
        <Alert variant="warning" layout="icon">
          <TriangleAlert aria-hidden />
          Ese dato no coincide con ninguna de las transferencias que encontramos. Revísalo en el detalle de tu
          transferencia.
        </Alert>
      )}

      {/* FR-031, D22: where each answer is, as placeholders only */}
      <figure aria-labelledby={figureId} className="space-y-2 rounded-sm bg-well px-4 py-3">
        <figcaption id={figureId} className="text-sm font-medium text-ink">
          Búscalos en el detalle de tu transferencia:
        </figcaption>
        <dl className="divide-y divide-line-soft text-sm">
          {digitsWay && (
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-ink-soft">Cuenta de origen</dt>
              <dd className="flex items-center gap-2">
                <span className="font-mono text-ink" aria-hidden>
                  ••••
                </span>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-sm text-ink">4 dígitos</span>
              </dd>
            </div>
          )}
          {charsWay && (
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-ink-soft">Clave de rastreo</dt>
              <dd className="flex items-center gap-2">
                <span className="font-mono text-ink" aria-hidden>
                  …
                </span>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-sm text-ink">4 caracteres</span>
              </dd>
            </div>
          )}
        </dl>
      </figure>

      <div className="space-y-3">
        {digitsWay && (
          <Field label="Últimos 4 dígitos de la cuenta o tarjeta con la que pagaste">
            <Input
              inputMode="numeric"
              value={digits}
              onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="font-mono text-sm"
              autoComplete="off"
              /* the screen arrives with the ask; the first field takes
                 focus, as 012's ask did */
              autoFocus
            />
          </Field>
        )}
        {digitsWay && charsWay && (
          <p className="text-center text-sm font-medium text-ink-soft" aria-hidden>
            o
          </p>
        )}
        {charsWay && (
          <Field label="Últimos 4 caracteres de tu clave de rastreo">
            <Input
              value={chars}
              /* upper-cased as typed: a clave is printed in capitals, and
                 the server reads O as 0 and I as 1 anyway (D6) */
              onChange={(e) => setChars(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
              className="font-mono text-sm"
              autoComplete="off"
              autoCapitalize="characters"
              autoFocus={!digitsWay}
            />
          </Field>
        )}
      </div>

      {/* The Card around this is already aria-live="polite" */}
      <Pending active={busy} announce={false} label="Estamos enviando tus datos.">
        <Button
          className="w-full"
          disabled={!(digitsOk || charsOk) || busy}
          onClick={() =>
            onSubmit({
              ...(digitsOk ? { senderTail: digits } : {}),
              ...(charsOk ? { claveTail: chars } : {}),
            })
          }
        >
          <ShieldCheck className="size-5" aria-hidden />
          {busy ? "Enviando…" : "Confirmar"}
        </Button>
      </Pending>
    </div>
  );
}

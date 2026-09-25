import type { ComponentType } from "react";
import { Amount, cn, Pending, Reveal } from "@devolada/ui";
import type { LinkStatusResponse, ProofReading } from "@devolada/api/direct-payments-schema";
import { isGenericReference } from "@devolada/api/direct-payments-schema";
import {
  Banknote,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronDown,
  Circle,
  Hash,
  Landmark,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BANK_HINTS, bankLabel } from "./bank-hints";

/* receipt-triage D8, D20 (Story 4, redesigned and refined 2026-09-25) —
   what a good capture shows, told before the payer takes it.

   A light card above the upload control, four rows: the key (the clave or
   the reference), the amount, the date and the account the money went to,
   each with a 32px icon tile, its name and one precise line. One line of
   capture rules at its foot and the bank tips one tap away (FR-024,
   FR-025). No receipt drawing: the rows are what the payer checks their
   own screen against.

   After the reading the same card answers: its title becomes "Lo que
   vimos en tu captura" and each row says, with an icon and a word, whether
   the capture showed it (FR-026). The design system's motion only — the
   tiles breathe while `/read` runs (opacity, kept under reduced motion),
   each outcome cross-fades in through `Reveal`. No transform, no new token.
   App-local because only the payer's page renders it (plan D20). */

export type GuideState = "idle" | "reading" | { reading: ProofReading };

type CollectAccount = NonNullable<LinkStatusResponse["collectAccount"]>;

const KIND_LABEL: Record<CollectAccount["kind"], string> = {
  clabe: "CLABE",
  card: "Tarjeta",
  phone: "Celular",
};

type Item = {
  key: "key" | "amount" | "date" | "account";
  icon: ComponentType<{ className?: string }>;
  name: string;
  line: React.ReactNode;
  fix: string;
};

/* Whether the capture showed an item. A generic reference is no key (D2);
   the account is "seen" when at least three digits of it were read and
   they fit one of the business's accounts. */
function seenIn(reading: ProofReading, key: Item["key"]): boolean {
  switch (key) {
    case "key":
      return Boolean(
        reading.trackingKey || (reading.referenceNumber && !isGenericReference(reading.referenceNumber)),
      );
    case "amount":
      return reading.amountCents != null;
    case "date":
      return Boolean(reading.date);
    case "account":
      return reading.destinationSeen && reading.ask?.reason !== "wrong_destination";
  }
}

export function CaptureGuide({
  state,
  amountCents,
  collectAccount,
}: {
  state: GuideState;
  amountCents: number | null | undefined;
  collectAccount: LinkStatusResponse["collectAccount"];
}) {
  const reading = typeof state === "object" ? state.reading : null;
  const busy = state === "reading";
  const last4 = collectAccount?.value.slice(-4);
  const items: Item[] = [
    {
      key: "key",
      icon: Hash,
      name: "Clave de rastreo o número de referencia",
      line: "Aparecen en el detalle, no en el resumen",
      fix: "Busca «Ver más detalles» en tu app",
    },
    {
      key: "amount",
      icon: Banknote,
      name: "Monto",
      line: amountCents != null ? <Amount cents={amountCents} /> : "Lo que transferiste",
      fix: "Que se vea el monto completo",
    },
    {
      key: "date",
      icon: Calendar,
      name: "Fecha",
      line: "Del día que transferiste",
      fix: "Que se vea la fecha de la operación",
    },
    {
      key: "account",
      icon: Landmark,
      name: "Cuenta destino",
      line: collectAccount ? `${KIND_LABEL[collectAccount.kind]} que termina en ${last4}` : "La cuenta a la que pagaste",
      fix: last4 ? `Esperábamos la cuenta que termina en ${last4}` : "Que se vea la cuenta a la que pagaste",
    },
  ];
  const hints = Object.entries(BANK_HINTS);

  return (
    /* A plain block, not a <section> landmark: the page has none, and
       one landmark would leave the rest of the step "outside" them */
    <div className="rounded-md border border-line bg-card">
      <header className="flex items-baseline justify-between gap-3 px-4 pt-4">
        <h2 className="text-base font-semibold text-ink">
          {reading ? "Lo que vimos en tu captura" : "Tu captura debe mostrar"}
        </h2>
        {busy ? (
          /* The word is a claim the screen makes, so it rides a region
             that shows it (feedback-vocabulary FR-008) */
          <Pending active label="Revisando tu captura.">
            <span data-motion="breath" className="animate-breath text-sm text-ink-soft">
              Revisando…
            </span>
          </Pending>
        ) : (
          !reading && <span className="text-sm text-ink-soft">4 datos</span>
        )}
      </header>
      <ol className="divide-y divide-line-soft px-4">
        {items.map((item) => {
          const seen = reading ? seenIn(reading, item.key) : null;
          const Icon = seen === null ? item.icon : seen ? CheckCircle2 : Circle;
          const tile = (
            <span
              {...(busy ? { "data-motion": "breath" } : {})}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-sm",
                seen === null ? "bg-well text-ink-soft" : seen ? "bg-accent-soft text-accent" : "bg-warning-soft text-warning",
                busy && "animate-breath",
              )}
              aria-hidden
            >
              <Icon className="size-4" />
            </span>
          );
          const text = (
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">{item.name}</span>
              <span className="block text-sm text-ink-soft">
                {seen === false ? item.fix : item.line}
              </span>
            </span>
          );
          return (
            <li key={item.key} data-item={item.key} className="py-3">
              {seen === null ? (
                <div className="flex items-center gap-3">
                  {tile}
                  {text}
                </div>
              ) : (
                <Reveal className="flex items-center gap-3">
                  {tile}
                  {text}
                  {/* The word rides the status inks, measured for text in
                      both themes; the accent is a fill colour and fails
                      4.5:1 as small text on the dark card (measured
                      2026-09-25: 3.95:1) */}
                  <span className={cn("shrink-0 text-sm font-medium", seen ? "text-success" : "text-warning")}>
                    {seen ? "Se ve" : "No se ve"}
                  </span>
                </Reveal>
              )}
            </li>
          );
        })}
      </ol>
      <p className="flex items-center gap-2 border-t border-line-soft px-4 py-3 text-sm text-ink-soft">
        <Camera className="size-4 shrink-0" aria-hidden />
        <span>
          Pantalla de <strong className="font-semibold text-ink">detalle</strong>, completa y sin reflejos.
        </span>
      </p>
      {hints.length > 0 && (
        <Collapsible className="border-t border-line-soft px-4">
          <CollapsibleTrigger className="group flex h-12 w-full items-center justify-between text-sm font-medium text-ink-soft transition-colors hover:text-ink">
            ¿Dónde lo encuentro en mi banco?
            <ChevronDown className="size-5 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="space-y-1 pb-3 text-sm text-ink-soft">
              {hints.map(([bank, hint]) => (
                <li key={bank}>
                  <span className="font-medium text-ink">{bankLabel(bank)}:</span> {hint!.where}.
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

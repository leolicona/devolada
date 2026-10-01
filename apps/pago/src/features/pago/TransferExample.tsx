import { useId, useState, type CSSProperties } from "react";
import { Button, formatMoney } from "@devolada/ui";
import type { LinkStatusResponse } from "@devolada/api/direct-payments-schema";
import { groupReferenceDigits } from "@devolada/api/direct-payments-schema";

/* "Así se llena en tu app" — a bank's transfer form filling itself in
   (confirmation-hierarchy D20; spec FR-026, FR-033; proposal E).

   CSS only: each value is revealed by a stepped `clip-path`, one after
   another, and the reference row gains the focus-colour outline last
   (`example-value`, `example-reference` in the app's stylesheet, on the
   duration tokens). The text is in the DOM from the first frame, so a
   screen reader hears the filled form; nothing is typed by a timer, so
   there is no state per character and nothing to turn off separately
   under reduced motion — the stylesheet simply runs no keyframe there,
   and every value shows. "Ver otra vez" replays it by remounting the
   list (a new `key`), so no timer is ever kept.

   The field names are generic — «Referencia numérica», «Concepto» — and
   the page says they change by bank (clarified 2026-10-01): a bank's own
   words appear only in the reference box's sentence, and only verified
   (012 D21). */

type Account = NonNullable<LinkStatusResponse["collectAccount"]>;

const ACCOUNT_FIELD: Record<Account["kind"], string> = {
  clabe: "Cuenta CLABE",
  card: "Número de tarjeta",
  phone: "Número de celular",
};

/* the order the values are revealed in, as the stylesheet reads it */
const step = (n: number) => ({ "--example-step": n }) as CSSProperties;

export function TransferExample({
  account,
  totalCents,
  digits,
}: {
  account: Account;
  totalCents: number;
  digits: string;
}) {
  const id = useId();
  const [run, setRun] = useState(0);
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="text-base font-semibold text-ink">
          Así se llena en tu app
        </h2>
        <Button variant="ghost" className="h-12 px-3 text-sm" onClick={() => setRun((n) => n + 1)}>
          Ver otra vez
        </Button>
      </div>
      <dl key={run} data-example-run={run} className="divide-y divide-line-soft rounded-sm bg-well px-4">
        <div className="py-2">
          <dt className="text-sm text-ink-soft">{ACCOUNT_FIELD[account.kind]}</dt>
          <dd className="example-value break-all font-mono text-sm text-ink" style={step(0)}>
            {account.value}
          </dd>
        </div>
        <div className="py-2">
          <dt className="text-sm text-ink-soft">Monto</dt>
          <dd className="example-value font-mono text-sm text-ink" style={step(1)}>
            {formatMoney(totalCents)}
          </dd>
        </div>
        <div className="example-reference -mx-2 rounded-sm px-2 py-2">
          <dt className="flex items-center justify-between gap-2 text-sm text-ink-soft">
            Referencia numérica
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-sm font-medium text-link">Tu referencia</span>
          </dt>
          <dd className="example-value font-mono text-sm text-ink" style={step(2)}>
            {groupReferenceDigits(digits)}
          </dd>
        </div>
        <div className="py-2">
          <dt className="text-sm text-ink-soft">Concepto</dt>
          {/* proposal E draws it in the faint ink, which reads 2.19:1 on the
              well — below AA (measured for the select, 012 T051). The soft
              ink still reads as "optional" beside the values, and passes. */}
          <dd className="example-value text-sm text-ink-soft" style={step(3)}>
            Opcional: lo que quieras
          </dd>
        </div>
      </dl>
      <p className="text-sm text-ink-soft">
        Los nombres cambian un poco según tu banco. La referencia siempre va en el campo de números.
      </p>
    </section>
  );
}

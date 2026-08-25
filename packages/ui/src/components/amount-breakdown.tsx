import { formatMoney } from "../lib/money";

/* Single source of visible money formatting: receipt, charge confirmation,
   admin detail and the WhatsApp template all derive from here. */

export function Amount({
  cents,
  sign = false,
  className = "",
}: {
  cents: number;
  sign?: boolean;
  className?: string;
}) {
  return (
    <data value={(cents / 100).toFixed(2)} className={`tabular-nums ${className}`}>
      {formatMoney(cents, { sign })}
    </data>
  );
}

export interface BreakdownLine {
  label: string;
  cents: number;
}

export interface AmountBreakdownProps {
  /* e.g. [{ label: "Cargo del periodo", cents: 40000 },
           { label: "Cargo por servicio", cents: 1500 }] */
  lines: BreakdownLine[];
  totalLabel?: string;
  className?: string;
}

export function AmountBreakdown({
  lines,
  totalLabel = "Total",
  className = "",
}: AmountBreakdownProps) {
  const total = lines.reduce((sum, line) => sum + line.cents, 0);
  return (
    <dl className={`space-y-2 text-base ${className}`}>
      {lines.map((line) => (
        <div key={line.label} className="flex justify-between gap-4">
          <dt className="text-ink-soft">{line.label}</dt>
          <dd>
            <Amount cents={line.cents} />
          </dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-line-soft pt-2 font-semibold">
        <dt>{totalLabel}</dt>
        <dd>
          <Amount cents={total} />
        </dd>
      </div>
    </dl>
  );
}

import { useId } from "react";
import { Circle, CircleCheck } from "lucide-react";
import { cn } from "@devolada/ui";

/* A group of native radio inputs, deliberately — payment-without-receipt
   D21, for the reasons direct-payment D16 gave the native select beside it.

   The confirmation is two short questions answered on a phone, most often
   with the answer already chosen ("Hoy", the bank the payer used last). A
   custom listbox or a row of toggle buttons would have to rebuild what the
   platform already gives a radio group: one Tab stop for the group, the
   arrow keys moving the choice, "seleccionado, 1 de 3" read by the screen
   reader the payer already has configured — and it would add weight to a
   public page whose load time sits on the critical path of a payment.

   Constitution VI: every item is a 48px target (the whole row is the
   label), tokens only, and the focus ring is drawn on the row, because the
   input itself is visually hidden (the same move as the receipt picker's
   label). The chosen item is marked by an icon and a word, never by colour
   alone; the word is hidden from assistive tech, which already hears the
   radio's own "seleccionado". */

export type Choice = { value: string; label: string };

export function ChoiceGroup({
  legend,
  options,
  value,
  onChange,
  name,
}: {
  /* The question, read as the group's name */
  legend: string;
  options: readonly Choice[];
  /* Null when nothing is chosen yet: a question with no likely answer
     starts empty rather than guessing (FR-040's "which reference") */
  value: string | null;
  onChange: (value: string) => void;
  name?: string;
}) {
  const generated = useId();
  const group = name ?? generated;
  return (
    <fieldset>
      <legend className="mb-2 text-base font-medium text-ink">{legend}</legend>
      <div className="grid gap-2">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-sm border px-4 py-2 text-base text-ink transition-colors",
                checked ? "border-focus bg-accent-soft" : "border-line-input bg-well hover:bg-card",
                "has-[:focus-visible]:[box-shadow:var(--shadow-focus)]",
              )}
            >
              <input
                type="radio"
                name={group}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {checked ? (
                <CircleCheck className="size-5 shrink-0 text-accent" aria-hidden />
              ) : (
                <Circle className="size-5 shrink-0 text-ink-faint" aria-hidden />
              )}
              <span className="min-w-0 flex-1">{option.label}</span>
              {checked && (
                <span className="shrink-0 text-sm font-medium text-ink-soft" aria-hidden>
                  Elegido
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

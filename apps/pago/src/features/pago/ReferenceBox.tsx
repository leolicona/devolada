import { useId } from "react";
import { groupReferenceDigits } from "@devolada/api/direct-payments-schema";
import { CopyButton } from "./CopyButton";

/* The payer's reference on step 1 (confirmation-hierarchy D19; spec FR-025,
   proposal E) — after the amount, the most visible thing on the page: a box
   of its own, the digits large and grouped, "Solo tuya", a copy button that
   writes the seven digits, the phone's note when they are the phone's (012
   FR-004), where to type it (012 D21: a bank's own words only when
   verified) and why it matters.

   A region named "Tu referencia", on the accent-subtle surface with a
   focus-colour border: two inks are read on that surface — the body ink
   and the link ink — and both are measured by contrast-lint in both themes
   (D17). It glows once when the step opens (`reference-glow`, FR-033);
   with reduced motion, not at all. "Solo tuya" stays on an assigned number
   too: it still belongs to one person (spec Edge Cases). */
export function ReferenceBox({
  digits,
  fromPhone,
  hint,
}: {
  digits: string;
  fromPhone: boolean;
  /* `referenceHint(learnedBanks[0])` — where it goes, in the payer's bank */
  hint: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="reference-glow space-y-3 rounded-md border border-focus bg-accent-soft p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="text-base font-semibold text-ink">
          Tu referencia
        </h2>
        <span className="rounded-full border border-focus px-3 py-0.5 text-sm font-medium text-link">Solo tuya</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-3xl font-semibold tabular-nums text-ink">{groupReferenceDigits(digits)}</p>
        {/* D19: a bank takes "2345678", never "234 5678" */}
        <CopyButton value={digits} copied="Copiada" srSuffix="Tu referencia" className="h-12" />
      </div>
      {fromPhone && <p className="text-sm text-ink">Son los últimos 7 números de tu celular.</p>}
      <div className="space-y-1 border-t border-line pt-3 text-sm">
        <p className="font-medium text-ink">{hint}</p>
        <p className="text-ink">Con ella reconocemos tu transferencia: no tendrás que mandar comprobante.</p>
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Amount } from "@devolada/ui";
import { TriangleAlert, X } from "lucide-react";
import type { BusinessActor } from "../auth/session";

/* account-hub D9 (PR B): the phone's word for "Saldo bajo". One line
   above the content, dismissed by hand and remembered per business and
   step until the step changes — no timer (a notice that fades while the
   owner reads Pagos is a notice nobody saw; WCAG 2.2.1). From lg the
   sidebar's chip already says it, so the strip is a phone thing. Sin
   saldo and Pausa keep their persistent banners (CreditBanner). */

const key = (businessId: string) => `devolada:credit-strip:${businessId}`;

function readDismissed(businessId: string): string | null {
  try {
    return localStorage.getItem(key(businessId));
  } catch {
    return null;
  }
}
function writeDismissed(businessId: string, step: string | null) {
  try {
    if (step === null) localStorage.removeItem(key(businessId));
    else localStorage.setItem(key(businessId), step);
  } catch {
    /* private mode, blocked storage: the strip simply shows again */
  }
}

export function CreditStrip({
  credit,
  businessId,
  canTopUp,
}: {
  credit: BusinessActor["credit"];
  businessId: string;
  canTopUp: boolean;
}) {
  const [dismissed, setDismissed] = useState(() => readDismissed(businessId) === credit.step);
  useEffect(() => {
    /* A step that moved on forgets the dismissal: a balance that hits
       zero and comes back to low is a new crossing, announced again */
    const stored = readDismissed(businessId);
    if (stored !== null && stored !== credit.step) writeDismissed(businessId, null);
    setDismissed(stored === credit.step);
  }, [businessId, credit.step]);

  if (credit.step !== "low" || dismissed) return null;
  return (
    <div
      role="status"
      className="flex h-11 items-center gap-2 border-b border-warning-line bg-warning-soft px-4 text-sm text-warning lg:hidden"
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        Saldo bajo: <Amount cents={credit.balanceCents} className="font-semibold" />
      </span>
      {canTopUp && (
        <Link to="/settings/credit" className="shrink-0 font-medium underline underline-offset-2">
          Recargar
        </Link>
      )}
      <button
        type="button"
        aria-label="Cerrar aviso"
        className="-mr-2 flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-muted"
        onClick={() => {
          writeDismissed(businessId, credit.step);
          setDismissed(true);
        }}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

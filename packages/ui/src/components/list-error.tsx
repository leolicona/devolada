import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Alert } from "./alert";
import { Button } from "./button";
import { Pending } from "./pending";
import { cn } from "../lib/cn";

/* The failed-request state for any list (list-states spec D3).

   It exists as an atom because seven screens need the same recipe, and
   because the state it replaces was a lie: before this, a failed request
   fell through to the empty state and told the shopkeeper they had no
   movements when in fact we could not load them.

   It builds on Alert rather than restating the destructive recipe
   (store-pwa/shell.spec.md D5); only the row layout is its own, because
   this is the one notice that carries an action. */

export interface ListErrorProps {
  /* Names the list, in plain es-MX: "tus movimientos", "los cobros" */
  what: string;
  /* Return the retry's promise and this component waits on it
     (feedback-vocabulary-rollout D10). */
  onRetry: () => void | Promise<unknown>;
  /* The retry's declared size (feedback-vocabulary-rollout D11: a screen
     names a size, never a height). `compact` (40 px) is the back office's,
     where a pointer aims — every list this atom was made for. `standard`
     (48 px) is for an access page, where a thumb does: /welcome's failed
     read is the first screen after a código, very often on a phone
     (passwordless-access contracts/panel-access.md § UI: 48 px standard
     controls on access pages; adversarial review, 2026-10-03). */
  size?: "compact" | "standard";
  className?: string;
}

export function ListError({ what, onRetry, size = "compact", className }: ListErrorProps) {
  /* The waiting state is derived from the CLICK, not passed in
     (feedback-vocabulary-rollout D10).

     Every one of the eight call sites used to pass `isRefetching`, and
     TanStack sets that true when an errored query refetches on window focus —
     apps/admin/src/main.tsx builds `new QueryClient()` with no options, so
     that is the default. The operator came back to the tab and the button
     said "Cargando…" with nothing running. A wait nobody started, showing a
     signal, which is what FR-001 forbids.

     Fixing it at eight call sites would leave eight chances to bring it back.
     Deleting the prop deletes the category. */
  const [retrying, setRetrying] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } catch {
      /* Swallowed on purpose, and only here. A retry that fails again is the
         ordinary case — the notice explaining the failure is already on
         screen, and this component's only job is to stop waiting. Letting the
         rejection escape makes it an unhandled rejection instead, which
         reports nothing to the operator and noise to everyone else. */
    } finally {
      /* A retry that resolves after this row is gone must not set state on an
         unmounted component — the list it belonged to may well have been
         replaced by the answer it was waiting for. */
      if (mounted.current) setRetrying(false);
    }
  }

  return (
    <Alert
      variant="destructive"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-3", className)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {/* Colour never travels alone (FRONTEND law) */}
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        No pudimos cargar {what}.
      </span>
      {/* announce={false} on purpose (D4). `variant="destructive"` gives this
          Alert role="alert", an ASSERTIVE live region, so the button's own
          word changing to "Cargando…" is already announced. A polite
          role="status" nested inside it would be the same state read twice. */}
      <Pending active={retrying} announce={false} label={`Reintentando cargar ${what}.`} className="shrink-0">
        <Button
          variant="secondary"
          /* A screen names a size; it never states a height
             (feedback-vocabulary-rollout D11). This read `h-10 px-4 text-sm`,
             which is `compact` spelled out in literals — the same defect as a
             component inventing its own size name, one level down. The
             screen's own size, declared above. */
          size={size}
          onClick={() => void retry()}
          disabled={retrying}
          className="shrink-0"
        >
          {/* Nothing rotates (feedback-vocabulary-rollout D3). A retry waits
              the way every started action waits: the region breathes. A
              spinning icon here was a third waiting movement, and it was
              flattened under reduced motion, so those operators got no
              movement on a retry at all. */}
          <RotateCw className="size-4" aria-hidden />
          {retrying ? "Cargando…" : "Reintentar"}
        </Button>
      </Pending>
    </Alert>
  );
}

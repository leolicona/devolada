import { useState } from "react";
import { Fingerprint } from "lucide-react";
import { Alert, Button, Card } from "@devolada/ui";
import { authClient, passkeysSupported } from "./auth-client";

/* Passkey enrolment (US-S07, better-auth.spec.md D7): offered, never
   forced. The caveat is the copy — a passkey belongs to this device
   (the store phone), not to a person. */
export function PasskeyOffer() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  if (!passkeysSupported()) return null;

  return (
    <Card className="mt-6 p-5">
      <h2 className="text-base font-semibold">Entrar con huella o rostro</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Activa la huella o el rostro de <strong>este teléfono</strong> para entrar sin
        escribir la contraseña. La contraseña sigue funcionando.
      </p>
      <div className="mt-3 space-y-3">
        {state === "done" ? (
          <Alert variant="success">Listo. Este teléfono ya entra con huella o rostro.</Alert>
        ) : (
          <Button
            variant="secondary"
            disabled={state === "busy"}
            className="w-full"
            onClick={async () => {
              setState("busy");
              const result = await authClient.passkey.addPasskey();
              setState(result?.error ? "error" : "done");
            }}
          >
            <Fingerprint className="size-5" aria-hidden />
            {state === "busy" ? "Esperando al teléfono…" : "Activar en este teléfono"}
          </Button>
        )}
        {state === "error" && (
          <Alert variant="destructive">
            No se pudo activar. Intenta de nuevo, o sigue usando tu contraseña.
          </Alert>
        )}
      </div>
    </Card>
  );
}

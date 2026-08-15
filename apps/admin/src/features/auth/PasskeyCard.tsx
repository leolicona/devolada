import { useState } from "react";
import { Fingerprint } from "lucide-react";
import { Alert, Card } from "@devolada/ui";
import { Button } from "@/components/ui/button";
import { authClient, passkeysSupported } from "@/lib/auth-client";

/* Passkey enrolment (US-S07, better-auth.spec.md D7): offered, never
   forced. The caveat is part of the copy — a passkey identifies this
   device, not a person. */
export function PasskeyCard() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  if (!passkeysSupported()) return null;

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold">Entrar con huella o rostro</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Activa el acceso con la huella o el rostro de <strong>este dispositivo</strong>. Tu
        contraseña sigue funcionando; esto solo agrega un camino más rápido aquí.
      </p>
      <div className="mt-4 space-y-3">
        {state === "done" ? (
          <Alert variant="success">
            Listo. Este dispositivo ya puede entrar con huella o rostro.
          </Alert>
        ) : (
          <Button
            variant="outline"
            disabled={state === "busy"}
            onClick={async () => {
              setState("busy");
              const result = await authClient.passkey.addPasskey();
              setState(result?.error ? "error" : "done");
            }}
          >
            <Fingerprint className="size-5" aria-hidden />
            {state === "busy" ? "Esperando a tu dispositivo…" : "Activar en este dispositivo"}
          </Button>
        )}
        {state === "error" && (
          <Alert variant="destructive">
            No se pudo activar. Intenta de nuevo, o sigue entrando con tu contraseña.
          </Alert>
        )}
      </div>
    </Card>
  );
}

import { useState } from "react";
import { Fingerprint } from "lucide-react";
import { Alert, Button, Card, Pending } from "@devolada/ui";
import { authClient, passkeysSupported } from "@/lib/auth-client";

/* cash-at-stores FR-010, D26: *huella o rostro*, offered in *Caja*, never
   forced. The admin's card (better-auth D7, D18) without its list: one
   shopkeeper, one phone. */
export function PasskeyCard() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  if (!passkeysSupported()) return null;
  return (
    <Card className="space-y-3 p-6">
      <h2 className="text-base font-semibold">Entrar con huella o rostro</h2>
      <p className="text-sm text-ink-soft">
        Actívalo en este teléfono y entra sin escribir tu contraseña. Tu contraseña sigue funcionando.
      </p>
      {state === "done" ? (
        <Alert variant="success">Listo. La próxima vez entra con tu huella o rostro.</Alert>
      ) : (
        <Pending active={state === "busy"} label="Esperando a tu teléfono">
          <Button
            variant="secondary"
            className="w-full"
            disabled={state === "busy"}
            onClick={async () => {
              setState("busy");
              const result = await authClient.passkey.addPasskey({ name: "Tienda" }).catch(() => ({ error: true }));
              setState(result && "error" in result && result.error ? "error" : "done");
            }}
          >
            <Fingerprint className="size-5" aria-hidden />
            Activar huella o rostro
          </Button>
        </Pending>
      )}
      {state === "error" && (
        <Alert variant="destructive">No se pudo activar. Intenta de nuevo, o sigue entrando con tu contraseña.</Alert>
      )}
    </Card>
  );
}

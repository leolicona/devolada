import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { Alert, Card } from "@devolada/ui";
import { Button } from "@/components/ui/button";
import { authClient, passkeysSupported } from "@/lib/auth-client";
import { baGet, baPost } from "@/lib/api";

/* Passkey enrolment and management (US-S07, better-auth.spec.md D7 and
   D18): offered, never forced; every credential listed and removable.
   The copy names the synced case — a passkey in an iCloud or Google
   keychain follows the person to their other devices, so "this device"
   alone was a half-truth. */

type Passkey = { id: string; name?: string | null; createdAt?: Date | string | null; backedUp?: boolean };

const dateOf = (value: Passkey["createdAt"]) =>
  value ? new Date(value).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : null;

export function PasskeyCard() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [removeError, setRemoveError] = useState(false);
  const supported = passkeysSupported();
  const passkeys = useQuery<Passkey[]>({
    queryKey: ["passkeys"],
    enabled: supported,
    /* Plain fetches, not the Better Auth client: it is for the WebAuthn
       ceremonies alone (lib/auth-client.ts); list and delete are ordinary
       endpoints, and its Request wrapper does not survive MSW */
    queryFn: () => baGet<Passkey[]>("/auth/passkey/list-user-passkeys"),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["passkeys"] });

  if (!supported) return null;

  return (
    <Card className="p-6" id="acceso">
      <h2 className="scroll-mt-24 text-base font-semibold">Entrar con huella o rostro</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Activa el acceso con la huella o el rostro de este dispositivo. Tu contraseña sigue
        funcionando; esto solo agrega un camino más rápido. Si tu llavero de iCloud o de Google
        sincroniza tus llaves, también servirá en tus otros dispositivos.
      </p>

      {passkeys.data && passkeys.data.length > 0 && (
        <ul aria-label="Dispositivos con acceso" className="mt-4 divide-y divide-border rounded-md border border-border">
          {passkeys.data.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.name?.trim() || "Llave de acceso"}</span>
                <span className="block text-muted-foreground">
                  {[dateOf(p.createdAt) && `Activada el ${dateOf(p.createdAt)}`, p.backedUp && "sincronizada con tu llavero"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <Button
                variant="outline"
                aria-label={`Quitar ${p.name?.trim() || "llave de acceso"}`}
                onClick={async () => {
                  setRemoveError(false);
                  try {
                    await baPost("/auth/passkey/delete-passkey", { id: p.id });
                    refresh();
                  } catch {
                    setRemoveError(true);
                  }
                }}
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}
      {passkeys.data && passkeys.data.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">Ningún dispositivo tiene acceso con huella o rostro todavía.</p>
      )}
      {removeError && (
        <Alert variant="destructive" className="mt-3">
          No pudimos quitar esa llave. Intenta de nuevo.
        </Alert>
      )}

      <div className="mt-4 space-y-3">
        {state === "done" ? (
          <Alert variant="success">Listo. Este dispositivo ya puede entrar con huella o rostro.</Alert>
        ) : (
          <Button
            variant="outline"
            disabled={state === "busy"}
            onClick={async () => {
              setState("busy");
              const result = await authClient.passkey.addPasskey();
              setState(result?.error ? "error" : "done");
              if (!result?.error) refresh();
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

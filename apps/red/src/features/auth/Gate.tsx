import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Ban, UserX } from "lucide-react";
import { Alert, Button, Card } from "@devolada/ui";
import { signOut } from "./session";

/* The two screens a session can end on that are not the sign-in:
   another kind of account (FR-013), and a suspended store (FR-014). */

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-6">{children}</main>;
}

/* cash-at-stores D2: a business member's account in the store app */
export function WrongAccountScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <Centered>
      <Card className="space-y-4 p-6">
        <h1 className="text-lg font-semibold">Esta cuenta no es de una tienda</h1>
        <Alert layout="icon">
          <UserX aria-hidden />
          Entraste con la cuenta de un negocio. Para cobrar en la tienda, cierra sesión y entra con el
          teléfono de la tienda.
        </Alert>
        <Button
          className="w-full"
          onClick={async () => {
            await signOut().catch(() => undefined);
            queryClient.clear();
            void navigate({ to: "/entrar" });
          }}
        >
          Cerrar sesión
        </Button>
      </Card>
    </Centered>
  );
}

/* FR-005, FR-014: the store was suspended; its session is already gone.
   `onBack` is for the sign-in's own código step, which shows this screen
   at /entrar already (passwordless-access D10: the API keeps no session for
   a suspended store) — there, "Volver a entrar" goes back to its first step. */
export function SuspendedScreen({ onBack }: { onBack?: () => void } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <Centered>
      <Card className="space-y-4 p-6">
        <h1 className="text-lg font-semibold">Tu tienda está suspendida</h1>
        <Alert variant="warning" layout="icon">
          <Ban aria-hidden />
          Por ahora no puedes cobrar ni entrar. Si crees que es un error, comunícate con Devolada.
        </Alert>
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            queryClient.clear();
            if (onBack) onBack();
            else void navigate({ to: "/entrar" });
          }}
        >
          Volver a entrar
        </Button>
      </Card>
    </Centered>
  );
}

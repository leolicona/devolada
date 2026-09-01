import { Alert } from "@devolada/ui";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AccessLayout } from "../auth/AccessLayout";
import { acceptInvitation, useUser } from "../auth/session";

/* The link the invitation email carries (business-and-memberships D8):
   `/invitaciones/:id`. An invitee with an account just gains the
   membership (US-B02); one without is sent to create it first. */
export function AcceptInvitationScreen() {
  const { invitationId } = useParams({ strict: false }) as { invitationId: string };
  const user = useUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "accepting" | "failed">("idle");

  useEffect(() => {
    if (!user.data || state !== "idle") return;
    setState("accepting");
    acceptInvitation(invitationId)
      .then(() => {
        queryClient.clear();
        void navigate({ to: "/" });
      })
      .catch(() => setState("failed"));
  }, [user.data, state, invitationId, queryClient, navigate]);

  if (user.isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background">
        <p className="text-sm text-ink-soft">Cargando…</p>
      </main>
    );
  }

  if (!user.data) {
    return (
      <AccessLayout title="Te invitaron a un negocio" description="Entra o crea tu cuenta con el correo que recibió la invitación.">
        <div className="space-y-2">
          <Link to="/login" className="block">
            <Button size="lg" className="w-full">
              Entrar
            </Button>
          </Link>
          <Link to="/signup" className="block">
            <Button size="lg" variant="outline" className="w-full">
              Crear cuenta
            </Button>
          </Link>
          <p className="text-center text-sm text-ink-soft">Después vuelve a abrir el link de la invitación.</p>
        </div>
      </AccessLayout>
    );
  }

  return (
    <AccessLayout title="Aceptando la invitación" description={user.data.email}>
      {state === "failed" ? (
        <Alert variant="destructive">
          La invitación no es válida o ya venció. Pide una nueva a quien te invitó.
        </Alert>
      ) : (
        <p className="text-sm text-ink-soft">Un momento…</p>
      )}
    </AccessLayout>
  );
}

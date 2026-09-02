import { Alert } from "@devolada/ui";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { AccessLayout } from "../auth/AccessLayout";
import { acceptInvitation, logout, useUser } from "../auth/session";

/* The link the invitation email carries (business-and-memberships D8):
   `/invitaciones/:id`. An invitee with an account just gains the
   membership (US-B02); one without is sent to create it first — and
   brought back here by `next` (better-auth.spec.md D12), so nobody
   holding an invitation lands in the "Crea tu negocio" wizard. */
export function AcceptInvitationScreen() {
  const { invitationId } = useParams({ strict: false }) as { invitationId: string };
  const here = `/invitaciones/${invitationId}`;
  const user = useUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "accepting" | "wrong_email" | "failed">("idle");

  useEffect(() => {
    if (!user.data || state !== "idle") return;
    setState("accepting");
    acceptInvitation(invitationId)
      .then(() => {
        queryClient.clear();
        void navigate({ to: "/" });
      })
      .catch((e: unknown) =>
        /* The plugin names the one cause the person can fix themselves:
           they signed in with a different email than the invited one. */
        setState(
          e instanceof ApiError && e.code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION"
            ? "wrong_email"
            : "failed",
        ),
      );
  }, [user.data, state, invitationId, queryClient, navigate]);

  async function switchAccount() {
    await logout().catch(() => {});
    queryClient.clear();
    void navigate({ to: "/login", search: { next: here } });
  }

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
          <Link to="/login" search={{ next: here }} className="block">
            <Button size="lg" className="w-full">
              Entrar
            </Button>
          </Link>
          <Link to="/signup" search={{ next: here }} className="block">
            <Button size="lg" variant="outline" className="w-full">
              Crear cuenta
            </Button>
          </Link>
          <p className="text-center text-sm text-ink-soft">Al terminar te traemos de vuelta a la invitación.</p>
        </div>
      </AccessLayout>
    );
  }

  return (
    <AccessLayout title="Aceptando la invitación" description={user.data.email}>
      {state === "wrong_email" ? (
        <div className="space-y-3">
          <Alert variant="destructive">
            Esta invitación fue enviada a otro correo. Entraste como {user.data.email}.
          </Alert>
          <Button size="lg" variant="outline" className="w-full" onClick={() => void switchAccount()}>
            Entrar con el correo invitado
          </Button>
        </div>
      ) : state === "failed" ? (
        <Alert variant="destructive">
          La invitación no es válida o ya venció. Pide una nueva a quien te invitó.
        </Alert>
      ) : (
        <p className="text-sm text-ink-soft">Un momento…</p>
      )}
    </AccessLayout>
  );
}

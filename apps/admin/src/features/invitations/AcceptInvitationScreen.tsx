import { Alert, Button, Input, Pending } from "@devolada/ui";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InvitationPreviewResponse } from "@devolada/api/businesses-schema";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { AccessLayout } from "../auth/AccessLayout";
import { ROLE_LABELS } from "../auth/roles";
import {
  acceptInvitation,
  acceptInvitationAsNewUser,
  login,
  logout,
  setActiveBusiness,
  useUser,
} from "../auth/session";

/* The link the invitation email carries (business-and-memberships D8):
   `/invitaciones/:id`. better-auth D14: the page reads the invitation
   first and decides for the invitee — the address is the invitation's,
   never typed; the only question left is a password: a new one when the
   address has no account here, the existing one otherwise. Signed in
   with the invited address, it just accepts; with another, it says so. */
export function AcceptInvitationScreen() {
  const { invitationId } = useParams({ strict: false }) as { invitationId: string };
  const here = `/invitaciones/${invitationId}`;
  const user = useUser();
  const preview = useQuery<InvitationPreviewResponse, ApiError>({
    queryKey: ["invitation", invitationId],
    queryFn: () => api<InvitationPreviewResponse>(`/businesses/invitations/${invitationId}/preview`),
    retry: false,
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "accepting" | "failed">("idle");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inv = preview.data;
  const sameEmail =
    Boolean(user.data && inv?.email) && user.data!.email.toLowerCase() === inv!.email!.toLowerCase();

  /* Signed in with the invited address: accept, activate, go */
  useEffect(() => {
    if (!user.data || !inv || inv.status !== "pending" || !sameEmail || state !== "idle") return;
    setState("accepting");
    acceptInvitation(invitationId)
      .then(async ({ organizationId }) => {
        await setActiveBusiness(organizationId).catch(() => {});
        queryClient.clear();
        void navigate({ to: "/" });
      })
      .catch(() => setState("failed"));
  }, [user.data, inv, sameEmail, state, invitationId, queryClient, navigate]);

  async function switchAccount() {
    await logout().catch(() => {});
    queryClient.clear();
    void navigate({ to: "/login", search: { next: here } });
  }

  async function join(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      queryClient.clear();
      void navigate({ to: "/" });
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "INVITATION_NOT_FOUND"
          ? "La invitación ya no es válida. Pide una nueva a quien te invitó."
          : fallback,
      );
    } finally {
      setBusy(false);
    }
  }

  /* feedback-vocabulary-rollout D1/D5. The word used to appear the instant the
     request left, so a session check answered from cache flashed a full screen
     of "Cargando…" and took it away again — the flicker the threshold exists to
     prevent. It rides as the shape so nothing shows until the wait is real. */
  if (user.isPending || preview.isPending) {
    return (
      <Pending
        active
        label="Cargando la invitación."
        shape={
          <main className="flex min-h-dvh items-center justify-center bg-background">
            <p className="text-sm text-ink-soft">Cargando…</p>
          </main>
        }
      >
        {null}
      </Pending>
    );
  }

  if (preview.isError || !inv || inv.status === "gone") {
    return (
      <AccessLayout title="Esta invitación ya no existe" description="Puede que la hayan cancelado o que ya se haya usado.">
        <p className="text-sm text-muted-foreground">Pide una nueva a quien te invitó.</p>
        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="text-link hover:underline">
            Ir a iniciar sesión
          </Link>
        </p>
      </AccessLayout>
    );
  }

  const business = inv.businessName ?? "un negocio";
  const roleLabel = inv.role ? ROLE_LABELS[inv.role].toLowerCase() : null;
  const title = `Te invitaron a ${business}`;

  if (inv.status === "expired") {
    return (
      <AccessLayout title={title} description={roleLabel ? `Como ${roleLabel}.` : undefined}>
        <Alert variant="warning">Esta invitación venció. Las invitaciones duran 48 horas.</Alert>
        <p className="mt-4 text-sm text-muted-foreground">Pide una nueva a quien te invitó.</p>
        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="text-link hover:underline">
            Ir a iniciar sesión
          </Link>
        </p>
      </AccessLayout>
    );
  }

  /* Signed in as somebody else */
  if (user.data && !sameEmail) {
    return (
      <AccessLayout title={title} description={`La invitación es para ${inv.email}.`}>
        <div className="space-y-3">
          <Alert variant="destructive">Entraste como {user.data.email}, y esta invitación fue enviada a otro correo.</Alert>
          <Button size="standard" variant="secondary" className="w-full" onClick={() => void switchAccount()}>
            Entrar con el correo invitado
          </Button>
          <p className="text-center text-sm">
            <Link to="/login" className="text-link hover:underline">
              Ir a iniciar sesión
            </Link>
          </p>
        </div>
      </AccessLayout>
    );
  }

  if (user.data) {
    return (
      <AccessLayout title={title} description={user.data.email}>
        {state === "failed" ? (
          <Alert variant="destructive">No pudimos aceptar la invitación. Pide una nueva a quien te invitó.</Alert>
        ) : (
          <p className="text-sm text-ink-soft">Un momento…</p>
        )}
      </AccessLayout>
    );
  }

  const description = inv.hasAccount
    ? `Como ${roleLabel}. Entra con tu contraseña.`
    : `Como ${roleLabel}. Crea tu contraseña para entrar.`;

  return (
    <AccessLayout title={title} description={description}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (inv.hasAccount) {
            void join(async () => {
              await login(inv.email!, password);
              const { organizationId } = await acceptInvitation(invitationId);
              await setActiveBusiness(organizationId).catch(() => {});
            }, "Correo o contraseña incorrectos");
          } else {
            if (name.trim().length < 2 || password.length < 8) {
              setError("Escribe tu nombre y una contraseña de al menos 8 caracteres.");
              return;
            }
            void join(
              () => acceptInvitationAsNewUser(invitationId, { name: name.trim(), password }),
              "No pudimos crear tu cuenta. Intenta de nuevo.",
            );
          }
        }}
      >
        {/* The invitation's address, never typed (D14) — shown as text, not
            as a field that looks editable (design review identidad-2) */}
        <p className="text-sm">
          <span className="text-muted-foreground">Correo:</span>{" "}
          <span className="font-medium">{inv.email}</span>
        </p>
        {!inv.hasAccount && (
          <div>
            <Label htmlFor="name">Tu nombre</Label>
            <Input size="compact" id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div>
          <Label htmlFor="password">{inv.hasAccount ? "Contraseña" : "Crea tu contraseña"}</Label>
          <Input size="compact"
            id="password"
            type="password"
            autoComplete={inv.hasAccount ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={inv.hasAccount ? undefined : "password-hint"}
          />
          {!inv.hasAccount && (
            <p id="password-hint" className="mt-1 text-sm text-muted-foreground">
              Al menos 8 caracteres.
            </p>
          )}
        </div>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" size="standard" className="w-full" disabled={busy}>
          {busy ? "Entrando…" : inv.hasAccount ? "Entrar" : "Crear cuenta y entrar"}
        </Button>
        {inv.hasAccount && (
          <p className="text-center text-sm">
            <Link to="/recover" className="text-link hover:underline">
              Olvidé mi contraseña
            </Link>
          </p>
        )}
      </form>
    </AccessLayout>
  );
}

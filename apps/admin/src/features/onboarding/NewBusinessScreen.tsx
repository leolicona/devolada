import { Alert, Button, Input, Pending } from "@devolada/ui";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { AccessLayout } from "../auth/AccessLayout";
import { SignOutLink } from "../auth/SignOutLink";
import { createBusiness, useUser } from "../auth/session";
import { PendingInvitations } from "../invitations/PendingInvitations";

/* The onboarding wizard (business-and-memberships D5, US-B01). Since
   2026-09-02 the business is born with its name alone: registering on
   the platform and configuring how you get paid are two moments, and
   the CLABE waits in Configuración with a banner until it lands. One
   call, one decision; an abandoned form creates nothing. The verify
   banner left this screen with better-auth D13 — nothing here needs a
   verified email. */
export function NewBusinessScreen() {
  const user = useUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* passwordless-access D6: the wizard is where a person born through the
     sign-in door lands — no business yet — so the shell's nameless guard
     stands here too: the name is asked first, once, then back here. */
  const nameless = Boolean(user.data) && !user.data!.name.trim();
  const sentToWelcome = useRef(false);
  useEffect(() => {
    if (!nameless || sentToWelcome.current) return;
    sentToWelcome.current = true;
    void navigate({ to: "/welcome", search: { next: "/nuevo-negocio" }, replace: true });
  }, [nameless, navigate]);

  /* feedback-vocabulary-rollout D1/D5. The word used to appear the instant the
     request left, so a session check answered from cache flashed a full screen
     of "Cargando…" and took it away again — the flicker the threshold exists to
     prevent. It rides as the shape so nothing shows until the wait is real. */
  if (user.isPending) {
    return (
      <Pending
        active
        label="Cargando tu sesión."
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
  if (!user.data) return <Navigate to="/login" />;
  if (nameless) return null;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await createBusiness({ name: name.trim() });
      /* Only the session is stale (it said NO_BUSINESS); the user query
         stays, or this screen falls into "Cargando…" between steps. */
      queryClient.removeQueries({ queryKey: ["session"] });
      setDone(true);
    } catch {
      setError("No pudimos crear tu negocio. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccessLayout
      title={done ? "Tu negocio está listo" : "Crea tu negocio"}
      description={
        done ? "Falta un paso para cobrar: la CLABE donde recibes el dinero." : "Ponle nombre. Cómo cobras se configura después."
      }
    >
      {/* bug: invitee-lands-own-business — someone invited who signed up on
          their own (the email had not arrived) lands here with no business:
          the invitation is offered before a business of their own is made.
          Nothing renders when there is none. */}
      {!done && <PendingInvitations stacked className="mb-4" />}
      {!done ? (
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2 && !busy) void create();
          }}
        >
          <div>
            <Label htmlFor="business-name">Nombre del negocio</Label>
            <Input size="compact"
              id="business-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Como lo conocen tus clientes"
            />
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          {/* feedback-vocabulary-rollout D1/D4. A wait driven by a local `busy` flag
              is still a wait the operator is having — the earlier sweeps keyed on
              `isPending` and could not see these (converge F1/F2). */}
          <Pending active={busy} label="Creando tu negocio.">
            <Button type="submit" size="standard" className="w-full" disabled={name.trim().length < 2 || busy}>
              {busy ? "Creando…" : "Crear negocio"}
            </Button>
          </Pending>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Tus clientes te pagan por transferencia a tu propia cuenta. Configura la CLABE donde
            quieres recibirlas y comparte tu primer link.
          </p>
          <Button size="standard" className="w-full" onClick={() => void navigate({ to: "/settings/direct-payment", hash: "spei" })}>
            Configurar mi CLABE
          </Button>
          <Button size="standard" variant="secondary" className="w-full" onClick={() => void navigate({ to: "/" })}>
            Ir a Pagos
          </Button>
        </div>
      )}
      <SignOutLink email={user.data.email} />
    </AccessLayout>
  );
}

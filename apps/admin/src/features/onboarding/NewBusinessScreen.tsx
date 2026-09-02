import { Alert } from "@devolada/ui";
import { useState } from "react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AccessLayout } from "../auth/AccessLayout";
import { SignOutLink } from "../auth/SignOutLink";
import { createBusiness, useUser } from "../auth/session";

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

  if (user.isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background">
        <p className="text-sm text-ink-soft">Cargando…</p>
      </main>
    );
  }
  if (!user.data) return <Navigate to="/login" />;

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
            <Input
              id="business-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Como lo conocen tus clientes"
            />
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" disabled={name.trim().length < 2 || busy}>
            {busy ? "Creando…" : "Crear negocio"}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Tus clientes te pagan por transferencia a tu propia cuenta. Configura la CLABE donde
            quieres recibirlas y comparte tu primer link.
          </p>
          <Button size="lg" className="w-full" onClick={() => void navigate({ to: "/settings", hash: "spei" })}>
            Configurar mi CLABE
          </Button>
          <Button size="lg" variant="outline" className="w-full" onClick={() => void navigate({ to: "/" })}>
            Ir a Pagos
          </Button>
        </div>
      )}
      <SignOutLink email={user.data.email} />
    </AccessLayout>
  );
}

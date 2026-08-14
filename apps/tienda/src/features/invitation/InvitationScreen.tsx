import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { Button, Field, Input } from "@devolada/ui";
import { api, ApiError } from "../../api/client";

/* Invitation redemption (US-S05): one screen, one step. The link
   arrived by WhatsApp/SMS; the shopkeeper sets a password and lands
   signed in on Cobrar. */

export function InvitationScreen() {
  const { token } = useParams({ strict: false }) as { token: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/store/accept-invitation", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void navigate({ to: "/" });
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "INVALID_TOKEN"
          ? "Este enlace ya no sirve. Pídele a tu ISP que te envíe una invitación nueva."
          : "Algo salió mal. Intenta de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[40rem] flex-col justify-center bg-surface px-8">
      <p className="text-2xl font-semibold tracking-tight">Devolada</p>
      <p className="mt-1 mb-8 text-base text-ink-soft">
        Bienvenido. Crea tu contraseña para empezar a cobrar.
      </p>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Nueva contraseña">
          <Input
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Repite la contraseña">
          <Input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-sm border border-error-line bg-error-soft px-4 py-3 text-sm font-medium text-error">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          <KeyRound className="size-5" aria-hidden />
          {busy ? "Guardando…" : "Guardar y entrar"}
        </Button>
      </form>
    </main>
  );
}

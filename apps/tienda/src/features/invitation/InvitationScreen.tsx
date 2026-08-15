import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, MailCheck } from "lucide-react";
import { Alert, Button, Field, Input } from "@devolada/ui";
import { api, ApiError } from "../../api/client";
import { verifyEmailCode } from "../../auth/session";

/* Invitation redemption (US-S05, better-auth.spec.md D8): the link
   arrived by WhatsApp/SMS; the shopkeeper sets a password and a
   recovery email, lands signed in, and may confirm the email with the
   código right away — or later. Activation never waits for the email. */

export function InvitationScreen() {
  const { token } = useParams({ strict: false }) as { token: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"form" | "code">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function goToApp() {
    void queryClient.invalidateQueries({ queryKey: ["session"] });
    void navigate({ to: "/" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.includes("@")) {
      setError("Escribe un correo válido.");
      return;
    }
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
        body: JSON.stringify({ token, email, password }),
      });
      /* Signed in already (D8); the código step is optional */
      setStep("code");
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "INVALID_TOKEN"
          ? "Este enlace ya no sirve. Pídele a tu ISP que te envíe una invitación nueva."
          : e instanceof ApiError && e.code === "EMAIL_TAKEN"
            ? "Ese correo ya está en uso. Usa otro."
            : "Algo salió mal. Intenta de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyEmailCode(email, code);
      goToApp();
    } catch {
      setError("El código no es válido o ya venció. Puedes confirmarlo después.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-content flex-col justify-center bg-surface px-8">
        <p className="text-2xl font-semibold tracking-tight">Devolada</p>
        <p className="mt-1 mb-8 text-base text-ink-soft">
          Te enviamos un código a {email} para confirmar tu correo. Puedes hacerlo ahora o después.
        </p>
        <form onSubmit={confirmCode} className="space-y-5" noValidate>
          <Field label="Código">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" disabled={busy || code.length < 6} className="w-full">
            <MailCheck className="size-5" aria-hidden />
            {busy ? "Confirmando…" : "Confirmar correo"}
          </Button>
          <Button type="button" variant="secondary" className="w-full" onClick={goToApp}>
            Después
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-content flex-col justify-center bg-surface px-8">
      <p className="text-2xl font-semibold tracking-tight">Devolada</p>
      <p className="mt-1 mb-8 text-base text-ink-soft">
        Bienvenido. Crea tu contraseña para empezar a cobrar.
      </p>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Correo (para recuperar tu acceso)">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
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
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" disabled={busy} className="w-full">
          <KeyRound className="size-5" aria-hidden />
          {busy ? "Guardando…" : "Guardar y entrar"}
        </Button>
      </form>
    </main>
  );
}

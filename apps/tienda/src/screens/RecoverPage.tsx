import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { KeyRound, Send } from "lucide-react";
import { Alert, Button, Field, Input } from "@devolada/ui";
import { requestPasswordReset, resetPasswordWithCode } from "../auth/session";

/* Store recovery (US-S06, better-auth.spec.md): the email set at the
   invitation is the master key. Two steps on one screen — email, then
   código + new password. Same confirmation whether the account exists
   or not: no existence leak. */

export function RecoverPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.includes("@")) {
      setError("Escribe un correo válido.");
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email);
    } catch {
      /* Same screen either way: no existence leak */
    } finally {
      setStep("code");
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
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
      await resetPasswordWithCode(email, code, password);
      void navigate({ to: "/login" });
    } catch {
      setError("El código no es válido o ya venció. Pide uno nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-content flex-col justify-center bg-surface px-8">
      <p className="text-2xl font-semibold tracking-tight">Devolada</p>
      <p className="mt-1 mb-8 text-base text-ink-soft">Recupera tu acceso con tu correo.</p>
      {step === "email" ? (
        <form onSubmit={ask} className="space-y-5" noValidate>
          <Field label="Correo">
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" disabled={busy} className="w-full">
            <Send className="size-5" aria-hidden />
            {busy ? "Enviando…" : "Enviar código"}
          </Button>
          <p className="text-center text-sm">
            <Link to="/login" className="text-link hover:underline">
              Volver a entrar
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={reset} className="space-y-5" noValidate>
          <Alert>Si existe una cuenta con ese correo, le enviamos un código.</Alert>
          <Field label="Código">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
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
          <Button type="submit" disabled={busy || code.length < 6} className="w-full">
            <KeyRound className="size-5" aria-hidden />
            {busy ? "Guardando…" : "Guardar y entrar"}
          </Button>
        </form>
      )}
    </main>
  );
}

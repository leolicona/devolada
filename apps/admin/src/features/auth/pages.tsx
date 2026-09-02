import { Alert } from "@devolada/ui";
import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { authClient, passkeysSupported } from "@/lib/auth-client";
import { AccessLayout } from "./AccessLayout";
import { login, requestPasswordReset, resetPasswordWithCode, signup } from "./session";

/* Access pages (better-auth.spec.md UI contract). Controlled forms,
   plain es-MX copy, generic errors that never leak account existence.
   Codes, never links (D4): recovery types a código, it never clicks.
   D12: `next` (validated by the route) is where login and signup go
   afterwards — the page the guard bounced, or an invitation. */

function useSubmit(action: () => Promise<unknown>, onDone: () => void, fallback: string) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return {
    error,
    setError,
    busy,
    async run() {
      setBusy(true);
      setError(null);
      try {
        await action();
        onDone();
      } catch (e) {
        setError(
          e instanceof ApiError && e.code === "EMAIL_TAKEN"
            ? "Ya existe una cuenta con ese correo."
            : e instanceof ApiError && /OTP|CODE/i.test(e.code)
              ? "El código no es válido o ya venció. Pide uno nuevo."
              : fallback,
        );
      } finally {
        setBusy(false);
      }
    },
  };
}

/* Field-level problems, named before the request leaves (identity round
   2026-09-02): the server's 400 used to be the first word the person
   heard about a one-letter name or a short password. The rules mirror
   the API's Zod input (name ≥ 2, email, password ≥ 8). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nameProblem = (v: string) => (v.trim().length < 2 ? "Escribe tu nombre, al menos 2 letras." : null);
const emailProblem = (v: string) => (EMAIL_SHAPE.test(v.trim()) ? null : "Escribe un correo válido, como nombre@dominio.com.");
const passwordProblem = (v: string) => (v.length < 8 ? "Usa al menos 8 caracteres." : null);

/* `next` is any same-app path the route already validated; the router's
   `to` wants a literal route name, so the string goes through unchecked. */
const asRoute = (path: string) => path as "/";

function FieldError({ id, children }: { id: string; children: string | null }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm font-medium text-error">
      {children}
    </p>
  );
}

/* design-review 2026-09-01 (must fix): the login subtitle pitched the
   store network that left to devolada-red; it now speaks the pivot. */
export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { next } = useSearch({ from: "/login" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const goOn = () => {
    void queryClient.invalidateQueries({ queryKey: ["session"] });
    void navigate({ to: next ? asRoute(next) : "/" });
  };
  const submit = useSubmit(() => login(email, password), goOn, "Correo o contraseña incorrectos");

  return (
    <AccessLayout title="Iniciar sesión" description="Cobra por transferencia con validación automática.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit.run();
        }}
        className="space-y-4"
        noValidate
      >
        <div>
          <Label htmlFor="email">Correo</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {submit.error && <Alert variant="destructive">{submit.error}</Alert>}
        <Button type="submit" size="lg" className="w-full" disabled={submit.busy}>
          {submit.busy ? "Entrando…" : "Entrar"}
        </Button>
        {/* US-S07: one-touch sign-in for devices with an enrolled passkey */}
        {passkeysSupported() && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            onClick={async () => {
              const { error } = await authClient.signIn.passkey();
              if (error) {
                submit.setError("No pudimos usar tu huella o rostro. Entra con tu contraseña.");
                return;
              }
              goOn();
            }}
          >
            <Fingerprint className="size-5" aria-hidden />
            Entrar con huella o rostro
          </Button>
        )}
        <div className="flex justify-between text-sm">
          <Link to="/recover" className="text-link hover:underline">
            Olvidé mi contraseña
          </Link>
          <Link to="/signup" search={{ next }} className="text-link hover:underline">
            Crear cuenta
          </Link>
        </div>
      </form>
    </AccessLayout>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { next } = useSearch({ from: "/signup" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean; password?: boolean }>({});
  const problems = { name: nameProblem(name), email: emailProblem(email), password: passwordProblem(password) };
  const shown = (field: keyof typeof problems) => (touched[field] ? problems[field] : null);
  const submit = useSubmit(
    () => signup(name, email, password),
    () => {
      /* business-and-memberships D5: the account exists, the business is
         born in the wizard; its banner asks for the código that went out.
         D12: an invitee goes back to the invitation instead. */
      queryClient.clear();
      void navigate({ to: next ? asRoute(next) : "/nuevo-negocio" });
    },
    "No pudimos crear la cuenta. Intenta de nuevo.",
  );

  return (
    <AccessLayout title="Crear cuenta" description="Tu ISP, cobrando por transferencia sin trabajo manual.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched({ name: true, email: true, password: true });
          if (problems.name || problems.email || problems.password) return;
          void submit.run();
        }}
        className="space-y-4"
        noValidate
      >
        <div>
          <Label htmlFor="name">Tu nombre</Label>
          <Input
            id="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            aria-invalid={Boolean(shown("name")) || undefined}
            aria-describedby={shown("name") ? "name-error" : undefined}
          />
          <FieldError id="name-error">{shown("name")}</FieldError>
        </div>
        <div>
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            aria-invalid={Boolean(shown("email")) || undefined}
            aria-describedby={shown("email") ? "email-error" : undefined}
          />
          <FieldError id="email-error">{shown("email")}</FieldError>
        </div>
        <div>
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={Boolean(shown("password")) || undefined}
            aria-describedby={shown("password") ? "password-error" : "password-hint"}
          />
          {shown("password") ? (
            <FieldError id="password-error">{shown("password")}</FieldError>
          ) : (
            <p id="password-hint" className="mt-1 text-sm text-muted-foreground">
              Al menos 8 caracteres.
            </p>
          )}
        </div>
        {submit.error && <Alert variant="destructive">{submit.error}</Alert>}
        <Button type="submit" size="lg" className="w-full" disabled={submit.busy}>
          {submit.busy ? "Creando…" : "Crear cuenta"}
        </Button>
        <p className="text-center text-sm">
          <Link to="/login" search={{ next }} className="text-link hover:underline">
            Ya tengo cuenta
          </Link>
        </p>
      </form>
    </AccessLayout>
  );
}

/* Recovery in two steps on one screen (better-auth.spec.md): email →
   código + new password. The confirmation copy is identical whether the
   account exists or not — no existence leak. Scenario 7 says "restores
   access": the new password signs the person in right here, instead of
   sending them to type it once more on the login page. */
export function RecoverPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [resent, setResent] = useState(false);

  const ask = useSubmit(
    () => requestPasswordReset(email),
    () => setStep("code"),
    "No pudimos enviar el código. Intenta de nuevo.",
  );

  const reset = useSubmit(
    async () => {
      if (password.length < 8) throw new ApiError("VALIDATION", 400);
      if (password !== confirm) throw new ApiError("VALIDATION", 400);
      await resetPasswordWithCode(email, code, password);
      await login(email, password);
    },
    () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void navigate({ to: "/" });
    },
    "Revisa que la contraseña tenga 8 caracteres y coincida.",
  );

  return (
    <AccessLayout title="Recuperar contraseña">
      {step === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask.run();
          }}
          className="space-y-4"
          noValidate
        >
          <div>
            <Label htmlFor="email">Correo</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {ask.error && <Alert variant="destructive">{ask.error}</Alert>}
          <Button type="submit" size="lg" className="w-full" disabled={ask.busy}>
            {ask.busy ? "Enviando…" : "Enviar código"}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void reset.run();
          }}
          className="space-y-4"
          noValidate
        >
          <Alert>Si existe una cuenta con ese correo, le enviamos un código.</Alert>
          <div>
            <Label htmlFor="code">Código</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div>
            <Label htmlFor="password">Nueva contraseña</Label>
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="confirm">Repite la contraseña</Label>
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {reset.error && <Alert variant="destructive">{reset.error}</Alert>}
          {ask.error && <Alert variant="destructive">{ask.error}</Alert>}
          <Button type="submit" size="lg" className="w-full" disabled={reset.busy}>
            {reset.busy ? "Guardando…" : "Guardar contraseña"}
          </Button>
          <p className="text-center text-sm">
            {/* The same confirmation the verify banner gives: a resend that
                says nothing looks like a button that did nothing. */}
            <button
              type="button"
              className="text-link hover:underline"
              disabled={ask.busy}
              onClick={() => {
                setResent(true);
                void ask.run();
              }}
            >
              {resent ? "Código reenviado" : "Reenviar código"}
            </button>
          </p>
        </form>
      )}
    </AccessLayout>
  );
}

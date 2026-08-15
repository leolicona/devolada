import { Alert } from "@devolada/ui";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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
   Codes, never links (D4): recovery types a código, it never clicks. */

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

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = useSubmit(
    () => login(email, password),
    () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void navigate({ to: "/" });
    },
    "Correo o contraseña incorrectos",
  );

  return (
    <AccessLayout title="Iniciar sesión" description="Administra tu red de puntos de cobro.">
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
              void queryClient.invalidateQueries({ queryKey: ["session"] });
              void navigate({ to: "/" });
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
          <Link to="/signup" className="text-link hover:underline">
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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = useSubmit(
    () => signup(name, email, password),
    () => {
      /* The shell's banner asks for the código that just went out */
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void navigate({ to: "/" });
    },
    "No pudimos crear la cuenta. Revisa los datos.",
  );

  return (
    <AccessLayout title="Crear cuenta" description="Tu ISP, cobrando en las tiendas de tu zona.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit.run();
        }}
        className="space-y-4"
        noValidate
      >
        <div>
          <Label htmlFor="name">Nombre del ISP</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="email">Correo</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {submit.error && <Alert variant="destructive">{submit.error}</Alert>}
        <Button type="submit" size="lg" className="w-full" disabled={submit.busy}>
          {submit.busy ? "Creando…" : "Crear cuenta"}
        </Button>
        <p className="text-center text-sm">
          <Link to="/login" className="text-link hover:underline">
            Ya tengo cuenta
          </Link>
        </p>
      </form>
    </AccessLayout>
  );
}

/* Recovery in two steps on one screen (better-auth.spec.md): email →
   código + new password. The confirmation copy is identical whether the
   account exists or not — no existence leak. */
export function RecoverPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

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
    },
    () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void navigate({ to: "/login" });
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
          <Button type="submit" size="lg" className="w-full" disabled={reset.busy}>
            {reset.busy ? "Guardando…" : "Guardar contraseña"}
          </Button>
          <p className="text-center text-sm">
            <button
              type="button"
              className="text-link hover:underline"
              onClick={() => void ask.run()}
            >
              Reenviar código
            </button>
          </p>
        </form>
      )}
    </AccessLayout>
  );
}

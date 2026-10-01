import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Fingerprint, TriangleAlert } from "lucide-react";
import { Alert, Button, Field, Input, Pending } from "@devolada/ui";
import { ApiError } from "@/lib/api";
import { authClient, passkeysSupported } from "@/lib/auth-client";
import { nationalPhone } from "@/lib/phone";
import { AccessLayout, EMAIL_SHAPE, FieldError } from "./AccessLayout";
import { sendCode, signIn, verifyEmail } from "./session";

/* cash-at-stores FR-010, D3: the shopkeeper's phone and password, or the
   phone's *huella o rostro*. A sign-in of a shopkeeper who left the
   invitation before the código answers EMAIL_NOT_VERIFIED, and the screen
   offers the código again (D5). */

function VerifyStep({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Alert variant="warning" layout="icon">
        <TriangleAlert aria-hidden />
        Falta verificar tu correo. Escribe el correo que diste al aceptar la invitación y te enviamos un código.
      </Alert>
      <Field label="Correo de recuperación">
        <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {sent && (
        <Field label="Código">
          <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </Field>
      )}
      <FieldError id="verify-error">{error}</FieldError>
      <Pending active={busy} label={sent ? "Verificando el código" : "Enviando el código"}>
        <Button
          className="w-full"
          disabled={busy || !EMAIL_SHAPE.test(email.trim()) || (sent && code.length !== 6)}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              if (!sent) {
                await sendCode(email.trim(), "email-verification");
                setSent(true);
              } else {
                await verifyEmail(email.trim(), code);
                onDone();
              }
            } catch {
              setError(sent ? "El código no es válido o ya venció. Pide uno nuevo." : "No pudimos enviar el código. Intenta de nuevo.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {sent ? "Verificar y entrar" : "Enviar código"}
        </Button>
      </Pending>
    </div>
  );
}

export function LoginScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [passkeyError, setPasskeyError] = useState(false);

  const digits = nationalPhone(phone);
  const landed = async () => {
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    void navigate({ to: "/" });
  };

  if (unverified) {
    return (
      <AccessLayout title="Verifica tu correo">
        <VerifyStep onDone={landed} />
      </AccessLayout>
    );
  }

  return (
    <AccessLayout title="Entrar">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!digits) {
            setError("Escribe los 10 dígitos de tu teléfono.");
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await signIn(digits, password);
            await landed();
          } catch (err) {
            const code = err instanceof ApiError ? err.code : "";
            if (code === "EMAIL_NOT_VERIFIED") setUnverified(true);
            else if (err instanceof ApiError && err.status === 429) setError("Demasiados intentos. Espera un momento.");
            /* never which half was wrong */
            else setError("Teléfono o contraseña incorrectos.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Teléfono">
          <Input type="tel" inputMode="tel" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="55 1234 5678" />
        </Field>
        <Field label="Contraseña">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FieldError id="login-error">{error}</FieldError>
        <Pending active={busy} label="Entrando">
          <Button type="submit" className="w-full" disabled={busy || !phone || !password}>
            Entrar
          </Button>
        </Pending>
      </form>

      {passkeysSupported() && (
        <div className="space-y-2">
          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => {
              setPasskeyError(false);
              const result = await authClient.signIn.passkey().catch(() => ({ error: true }));
              if (result && "error" in result && result.error) setPasskeyError(true);
              else await landed();
            }}
          >
            <Fingerprint className="size-5" aria-hidden />
            Entrar con huella o rostro
          </Button>
          {passkeyError && (
            <p role="alert" className="text-sm font-medium text-error">
              No se pudo usar tu huella o rostro. Entra con tu teléfono y contraseña.
            </p>
          )}
        </div>
      )}

      <Link to="/recuperar" className="block text-center text-sm font-medium text-link">
        Olvidé mi contraseña
      </Link>
    </AccessLayout>
  );
}

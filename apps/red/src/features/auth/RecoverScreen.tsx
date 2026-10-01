import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { Alert, Button, Field, Input, Pending } from "@devolada/ui";
import { AccessLayout, EMAIL_SHAPE, FieldError } from "./AccessLayout";
import { resetPassword, sendCode } from "./session";

/* cash-at-stores FR-011: a código to the recovery email, then a new
   password. Copy says *código*, never "token" or "OTP", and no link is
   ever sent. */
export function RecoverScreen() {
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (step === "done") {
    return (
      <AccessLayout title="Listo">
        <Alert variant="success" layout="icon">
          <CheckCircle2 aria-hidden />
          Cambiaste tu contraseña. Entra con tu teléfono y tu contraseña nueva.
        </Alert>
        <Link to="/entrar" className="block text-center text-base font-medium text-link">
          Entrar
        </Link>
      </AccessLayout>
    );
  }

  return (
    <AccessLayout title="Recuperar acceso">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            if (step === "email") {
              await sendCode(email.trim(), "forget-password");
              setStep("code");
            } else {
              await resetPassword(email.trim(), code, password);
              setStep("done");
            }
          } catch {
            setError(step === "email" ? "No pudimos enviar el código. Intenta de nuevo." : "El código no es válido o ya venció. Pide uno nuevo.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-base text-ink-soft">
          {step === "email"
            ? "Te enviamos un código al correo que diste al aceptar la invitación."
            : `Escribe el código que enviamos a ${email.trim()} y tu contraseña nueva.`}
        </p>
        {step === "email" ? (
          <Field label="Correo de recuperación">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        ) : (
          <>
            <Field label="Código">
              <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            </Field>
            <Field label="Contraseña nueva">
              <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {password.length > 0 && password.length < 8 && <FieldError id="pass-error">Usa al menos 8 caracteres.</FieldError>}
          </>
        )}
        <FieldError id="recover-error">{error}</FieldError>
        <Pending active={busy} label={step === "email" ? "Enviando el código" : "Cambiando tu contraseña"}>
          <Button
            type="submit"
            className="w-full"
            disabled={busy || (step === "email" ? !EMAIL_SHAPE.test(email.trim()) : code.length !== 6 || password.length < 8)}
          >
            {step === "email" ? "Enviar código" : "Cambiar contraseña"}
          </Button>
        </Pending>
      </form>
      <Link to="/entrar" className="block text-center text-sm font-medium text-link">
        Volver a entrar
      </Link>
    </AccessLayout>
  );
}

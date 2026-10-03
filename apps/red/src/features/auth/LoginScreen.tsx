import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Fingerprint, MailCheck } from "lucide-react";
import { Alert, Button, Field, Input, Pending } from "@devolada/ui";
import { ApiError } from "@/lib/api";
import { canVerifyPerson, passkeysSupported } from "@/lib/auth-client";
import { nationalPhone } from "@/lib/phone";
import { useWide } from "@/lib/wide";
import { AccessLayout, FieldError } from "./AccessLayout";
import { CodeStep, OrWithCode } from "./CodeStep";
import { SuspendedScreen } from "./Gate";
import { sendProblemLine, signInWithKey } from "./keys";
import { OfferStep } from "./OfferStep";
import { sendSignInCode, signInWithCode } from "./session";

/* cash-at-stores FR-010, D3; passwordless-access D7, D10 (contracts/
   store-access.md § /entrar): the phone's *huella o rostro* first, where
   the browser supports passkeys, then the store's phone and a código. The
   network knows the shopkeeper by the phone, so the phone is what is
   typed; the código goes to the store account's email, and the screen
   says the same for every phone (FR-033) — naming the address would tell
   a stranger whose phone it is. No line mentions a password: the screen
   reads as if it had always been this way (spec Clarifications, Q4). A
   key goes to `/`; a código goes through the activation (D7). */
export function LoginScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"start" | "code" | "offer" | "suspended">("start");
  const [phone, setPhone] = useState("");
  const [phoneProblem, setPhoneProblem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyFailed, setKeyFailed] = useState(false);
  /* cash-at-stores D32: on a computer at the counter the device is not a phone */
  const noun = useWide() ? "computadora" : "teléfono";
  const withKey = passkeysSupported();
  const digits = nationalPhone(phone);

  /* A new session: whatever the cache knew of the last one is stale */
  const landed = () => {
    queryClient.removeQueries({ queryKey: ["session"] });
    void navigate({ to: "/", replace: true });
  };

  if (step === "offer") return <OfferStep onDone={landed} />;

  /* FR-014: a suspended store's código opens nothing (the API keeps no
     session), and the screen says why rather than "wrong código" */
  if (step === "suspended") return <SuspendedScreen onBack={() => setStep("start")} />;

  if (step === "code" && digits) {
    return (
      <AccessLayout title="Escribe el código">
        <Alert layout="icon">
          <MailCheck aria-hidden />
          Si ese teléfono es de una tienda, te enviamos un código al correo de la tienda. Vence en 10 minutos.
        </Alert>
        <CodeStep
          onSubmit={async (otp) => {
            try {
              await signInWithCode(digits, otp);
            } catch (e) {
              if (e instanceof ApiError && e.code === "STORE_SUSPENDED") return setStep("suspended");
              throw e;
            }
            queryClient.removeQueries({ queryKey: ["session"] });
            if (await canVerifyPerson()) setStep("offer");
            else landed();
          }}
          onResend={() => sendSignInCode(digits)}
          other={{ label: "Usar otro teléfono", onClick: () => setStep("start") }}
        />
      </AccessLayout>
    );
  }

  return (
    <AccessLayout title="Entrar">
      {withKey && (
        <>
          <div className="space-y-2">
            <Pending active={keyBusy} label={`Esperando a tu ${noun}`}>
              <Button
                className="w-full"
                disabled={keyBusy}
                /* D7: the device's window opens inside this click */
                onClick={async () => {
                  setKeyBusy(true);
                  setKeyFailed(false);
                  const opened = await signInWithKey();
                  setKeyBusy(false);
                  /* FR-012: one line, and the código right below it */
                  if (!opened) setKeyFailed(true);
                  else landed();
                }}
              >
                <Fingerprint className="size-5" aria-hidden />
                Entrar con huella o rostro
              </Button>
            </Pending>
            <FieldError id="key-error">{keyFailed ? "No se pudo usar tu huella o rostro. Entra con un código." : null}</FieldError>
          </div>
          <OrWithCode />
        </>
      )}
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (!digits) {
            setPhoneProblem(true);
            return;
          }
          setPhoneProblem(false);
          setBusy(true);
          setError(null);
          try {
            await sendSignInCode(digits);
            setStep("code");
          } catch (err) {
            setError(sendProblemLine(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Tu teléfono">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="username"
            placeholder="55 1234 5678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={phoneProblem || undefined}
          />
        </Field>
        <FieldError id="phone-error">{phoneProblem ? "Escribe los 10 dígitos de tu teléfono." : null}</FieldError>
        <FieldError id="login-error">{error}</FieldError>
        <Pending active={busy} label="Enviando el código">
          {/* Without the key, the código is the way in and its button the primary */}
          <Button type="submit" variant={withKey ? "secondary" : "primary"} className="w-full" disabled={busy || !phone.trim()}>
            Enviar código
          </Button>
        </Pending>
      </form>
    </AccessLayout>
  );
}

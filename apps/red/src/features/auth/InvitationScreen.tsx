import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MailCheck, TriangleAlert } from "lucide-react";
import { Alert, Button, Field, Input, Pending, Skeleton } from "@devolada/ui";
import { ApiError } from "@/lib/api";
import { canVerifyPerson, passkeysSupported } from "@/lib/auth-client";
import { AccessLayout, EMAIL_SHAPE, FieldError } from "./AccessLayout";
import { CodeStep } from "./CodeStep";
import { sendProblemLine } from "./keys";
import { OfferStep } from "./OfferStep";
import { acceptInvitation, previewInvitation, sendInvitationCode } from "./session";

/* cash-at-stores FR-009, D4; passwordless-access D10 (contracts/
   store-access.md § /invitacion/:token): the invitation in three steps —
   the email, its código, then the key where the device can verify the
   person (D7). The código goes to whatever address was typed; a taken one
   is named only after its código (FR-032), and the store becomes active at
   the código, not at the email (FR-031). Every bad invitation reads the
   same: it no longer works. */

function Invalid() {
  return (
    <AccessLayout title="Esta invitación ya no funciona">
      <Alert variant="warning" layout="icon">
        <TriangleAlert aria-hidden />
        Ya se usó, se reemplazó por otra o pasaron más de siete días. Pide a Devolada una invitación nueva.
      </Alert>
    </AccessLayout>
  );
}

const TAKEN = "Ese correo ya tiene una cuenta en Devolada. Usa otro para tu tienda.";
const isInvalid = (e: unknown) => e instanceof ApiError && e.code === "INVALID_INVITATION";

export function InvitationScreen() {
  const { token } = useParams({ strict: false }) as { token: string };
  const invitation = useQuery({ queryKey: ["store-invitation", token], queryFn: () => previewInvitation(token) });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"email" | "code" | "offer">("email");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const address = email.trim().toLowerCase();
  const goHome = () => void navigate({ to: "/", replace: true });

  /* Accepted: the invitation is spent, so whatever its preview says now
     must not take the activation away */
  if (step === "offer") return <OfferStep onDone={goHome} />;

  if (invitation.isPending) {
    return (
      <AccessLayout title="Invitación">
        <Pending active label="Revisando tu invitación" shape={<Skeleton className="h-24 w-full" />}>
          {null}
        </Pending>
      </AccessLayout>
    );
  }
  if (invalid || invitation.isError || invitation.data?.state !== "open") return <Invalid />;
  const { storeName } = invitation.data;

  if (step === "code") {
    return (
      <AccessLayout title="Escribe el código">
        <Alert layout="icon">
          <MailCheck aria-hidden />
          Te enviamos un código a {address}. Vence en 10 minutos.
        </Alert>
        <CodeStep
          onSubmit={async (otp) => {
            try {
              await acceptInvitation(token, address, otp);
            } catch (e) {
              if (isInvalid(e)) return setInvalid(true);
              /* FR-032: named only now, after a right código. Back to the
                 address, kept, so one letter can be changed */
              if (e instanceof ApiError && e.code === "EMAIL_TAKEN") {
                setError(TAKEN);
                setStep("email");
                return;
              }
              throw e;
            }
            /* A new session: whatever the cache knew of the last one is stale */
            queryClient.removeQueries({ queryKey: ["session"] });
            if (await canVerifyPerson()) setStep("offer");
            else goHome();
          }}
          onResend={() =>
            sendInvitationCode(token, address).catch((e: unknown) => {
              if (isInvalid(e)) setInvalid(true);
              throw e;
            })
          }
          other={{ label: "Usar otro correo", onClick: () => setStep("email") }}
        />
      </AccessLayout>
    );
  }

  const emailProblem = touched && !EMAIL_SHAPE.test(address) ? "Escribe un correo válido, como nombre@dominio.com." : null;

  return (
    <AccessLayout title={`Bienvenido a Devolada, ${storeName}`}>
      {/* FR-015: a browser without passkeys hears of the código alone — no
          screen names the fingerprint or face on a device that cannot use
          them (adversarial review, 2026-10-02). The same test as /entrar's
          key button (FR-016). */}
      <p className="text-base text-ink-soft">
        {passkeysSupported()
          ? "Entrarás con tu huella o rostro, o con un código que te enviamos a tu correo."
          : "Entrarás con un código que te enviamos a tu correo."}
      </p>
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setTouched(true);
          if (!EMAIL_SHAPE.test(address) || busy) return;
          setBusy(true);
          setError(null);
          try {
            await sendInvitationCode(token, address);
            setStep("code");
          } catch (err) {
            if (isInvalid(err)) setInvalid(true);
            else if (err instanceof ApiError && err.code === "VALIDATION_ERROR") setError("Escribe un correo válido, como nombre@dominio.com.");
            else setError(sendProblemLine(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Tu correo">
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error === TAKEN) setError(null);
            }}
            onBlur={() => setTouched(Boolean(email))}
            aria-invalid={Boolean(emailProblem || error === TAKEN) || undefined}
          />
        </Field>
        <FieldError id="email-error">{emailProblem}</FieldError>
        <FieldError id="invitation-error">{error}</FieldError>
        <Pending active={busy} label="Enviando el código">
          <Button type="submit" className="w-full" disabled={busy || !EMAIL_SHAPE.test(address)}>
            Continuar
          </Button>
        </Pending>
      </form>
    </AccessLayout>
  );
}

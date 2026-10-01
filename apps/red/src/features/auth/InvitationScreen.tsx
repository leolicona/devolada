import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MailCheck, TriangleAlert } from "lucide-react";
import { Alert, Button, Field, Input, Pending, Skeleton } from "@devolada/ui";
import type { AcceptStoreInvitationRequest, InvitationPreviewResponse } from "@devolada/api/store-schema";
import { api, ApiError } from "@/lib/api";
import { AccessLayout, EMAIL_SHAPE, FieldError } from "./AccessLayout";
import { sendCode, verifyEmail } from "./session";

/* cash-at-stores FR-009, D4, D5: the invitation's two steps — an email and
   a password, then the código that signs the shopkeeper in. Every bad
   invitation reads the same: it no longer works. */

const preview = (token: string) => api<InvitationPreviewResponse>(`/store/invitations/${encodeURIComponent(token)}`);
const accept = (token: string, body: AcceptStoreInvitationRequest) =>
  api<{ email: string }>(`/store/invitations/${encodeURIComponent(token)}/accept`, { method: "POST", body: JSON.stringify(body) });

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

export function InvitationScreen() {
  const { token } = useParams({ strict: false }) as { token: string };
  const invitation = useQuery({ queryKey: ["store-invitation", token], queryFn: () => preview(token) });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

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
  const { storeName, phoneTail } = invitation.data;

  if (accepted) {
    return (
      <AccessLayout title="Escribe el código">
        <Alert layout="icon">
          <MailCheck aria-hidden />
          Te enviamos un código a {accepted}. Escríbelo para entrar.
        </Alert>
        <Field label="Código">
          <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </Field>
        <FieldError id="code-error">{error}</FieldError>
        <Pending active={busy} label="Verificando el código">
          <Button
            className="w-full"
            disabled={busy || code.length !== 6}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await verifyEmail(accepted, code);
                await queryClient.invalidateQueries({ queryKey: ["session"] });
                void navigate({ to: "/" });
              } catch {
                setError("El código no es válido o ya venció. Pide uno nuevo.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Entrar
          </Button>
        </Pending>
        <Button
          variant="link"
          onClick={async () => {
            setError(null);
            await sendCode(accepted, "email-verification").catch(() => setError("No pudimos reenviar el código."));
          }}
        >
          Reenviar código
        </Button>
      </AccessLayout>
    );
  }

  const emailProblem = email && !EMAIL_SHAPE.test(email.trim()) ? "Escribe un correo válido, como nombre@dominio.com." : null;
  const passwordProblem = password && password.length < 8 ? "Usa al menos 8 caracteres." : null;

  return (
    <AccessLayout title={`Bienvenido a Devolada, ${storeName}`}>
      <p className="text-base text-ink-soft">
        Entrarás con tu teléfono (termina en <span className="font-mono">{phoneTail}</span>) y una contraseña. Tu correo
        sirve para recuperar el acceso.
      </p>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const { email: sentTo } = await accept(token, { email: email.trim(), password });
            setAccepted(sentTo);
          } catch (err) {
            const code = err instanceof ApiError ? err.code : "";
            if (code === "INVALID_INVITATION") setInvalid(true);
            else if (code === "EMAIL_TAKEN") setError("Ese correo ya tiene una cuenta. Usa otro.");
            else setError("No pudimos aceptar la invitación. Intenta de nuevo.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Correo de recuperación">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <FieldError id="email-error">{emailProblem}</FieldError>
        <Field label="Contraseña">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FieldError id="password-error">{passwordProblem}</FieldError>
        <FieldError id="accept-error">{error}</FieldError>
        <Pending active={busy} label="Aceptando la invitación">
          <Button type="submit" className="w-full" disabled={busy || !email || !password || Boolean(emailProblem || passwordProblem)}>
            Continuar
          </Button>
        </Pending>
      </form>
    </AccessLayout>
  );
}

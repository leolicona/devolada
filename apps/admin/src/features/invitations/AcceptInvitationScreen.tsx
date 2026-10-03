import { Alert, Button, Input, Pending } from "@devolada/ui";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import type { InvitationPreviewResponse } from "@devolada/api/businesses-schema";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { passkeysSupported } from "@/lib/auth-client";
import { AccessLayout } from "../auth/AccessLayout";
import { CodeStep, OrWithCode } from "../auth/CodeStep";
import { accessProblem, signInWithKey, TOO_MANY } from "../auth/keys";
import { FieldError, NAME_MAX, nameProblem } from "../auth/pages";
import { ROLE_LABELS } from "../auth/roles";
import {
  acceptInvitation,
  acceptInvitationAsNewUser,
  logout,
  sendCode,
  setActiveBusiness,
  signInWithCode,
  useUser,
  type SessionUser,
} from "../auth/session";

/* The link the invitation email carries (business-and-memberships D8):
   `/invitaciones/:id`. better-auth D14: the page reads the invitation
   first and decides for the invitee — the address is the invitation's,
   shown as text, never typed. Signed in with the invited address, it just
   accepts; with another, it says so.
   passwordless-access D9: no password in any state (FR-020). An address
   with an account comes in with its key, where the browser supports one,
   or with a código sent to the invited address (FR-017); a new person
   gives a name, then types the código sent to the invited address (FR-019;
   D9 as amended 2026-10-03, spec Clarifications Q5): the invitation's id
   is no proof of the inbox — the inviter and every owner and admin hold
   it too. A código and a birth both go through /welcome, which offers the
   key (FR-006). */
export function AcceptInvitationScreen() {
  const { invitationId } = useParams({ strict: false }) as { invitationId: string };
  const here = `/invitaciones/${invitationId}`;
  const user = useUser();
  const preview = useQuery<InvitationPreviewResponse, ApiError>({
    queryKey: ["invitation", invitationId],
    queryFn: () => api<InvitationPreviewResponse>(`/businesses/invitations/${invitationId}/preview`),
    retry: false,
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "accepting" | "failed">("idle");
  /* Adversarial review, 2026-10-02: what a failed acceptance says. Only the
     invitation's own refusal — the plugin's INVITATION_NOT_FOUND, which
     covers cancelled, used and past its 48 hours — says it is no longer
     valid; the network or the limiter can be tried again. */
  const [failure, setFailure] = useState<"gone" | "tooMany" | "other">("other");
  /* The session was opened here by a código: its way on goes through
     /welcome like every código's (passwordless-access D6) */
  const [byCode, setByCode] = useState(false);
  /* A new person's two steps (D9 as amended 2026-10-03): the name, then
     the código sent to the invited address. The name survives the way back
     ("Corregir mi nombre") and is checked as on every screen that asks it */
  const [newStep, setNewStep] = useState<"name" | "code">("name");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* the código door: closed, asking, or the código step open */
  const [codeStep, setCodeStep] = useState<"closed" | "sending" | "open">("closed");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyFailed, setKeyFailed] = useState(false);

  const inv = preview.data;
  const sameEmail =
    Boolean(user.data && inv?.email) && user.data!.email.toLowerCase() === inv!.email!.toLowerCase();

  function failedWith(e: unknown) {
    setFailure(
      e instanceof ApiError && e.code === "INVITATION_NOT_FOUND" ? "gone" : accessProblem(e) === "tooMany" ? "tooMany" : "other",
    );
    setState("failed");
  }

  /* Signed in with the invited address: accept, activate, go */
  useEffect(() => {
    if (!user.data || !inv || inv.status !== "pending" || !sameEmail || state !== "idle") return;
    setState("accepting");
    acceptInvitation(invitationId)
      .then(async ({ organizationId }) => {
        await setActiveBusiness(organizationId).catch(() => {});
        queryClient.clear();
        if (byCode) void navigate({ to: "/welcome", search: { next: "/" } });
        else void navigate({ to: "/" });
      })
      .catch(failedWith);
  }, [user.data, inv, sameEmail, state, byCode, invitationId, queryClient, navigate]);

  async function switchAccount() {
    await logout().catch(() => {});
    queryClient.clear();
    void navigate({ to: "/login", search: { next: here } });
  }

  const invitationGone = "La invitación ya no es válida. Pide una nueva a quien te invitó.";

  /* passwordless-access D9 (amended 2026-10-03, spec Clarifications Q5): the
     código births the account, verified and named, and accepts the
     invitation in one request; then /welcome (FR-019, FR-006). A refused
     código is thrown back to CodeStep, which reads it as every door does;
     nothing was born. Marked accepting first, like the account's código
     below, so a refetch of the user in between (a window refocus) cannot
     start a second acceptance once the session exists. */
  async function joinAsNew(otp: string) {
    setState("accepting");
    try {
      await acceptInvitationAsNewUser(invitationId, { name: name.trim(), otp });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      if (code === "INVITATION_NOT_FOUND") {
        /* The invitation died while the código travelled. If it died after
           the código was checked, the account it proved stays, with its
           session — its inbox's owner's, as a registration's would be
           (contracts/panel-access.md § accept-new). The page reads who it
           has now, still marked accepting, so the way on it offers is the
           true one; then it says so, never left on «Creando…»
           (adversarial review, 2026-10-02, the account branch's fix). */
        await queryClient.refetchQueries({ queryKey: ["user"], exact: true });
        setByCode(Boolean(queryClient.getQueryData<SessionUser | null>(["user"])));
        failedWith(e);
        return;
      }
      setState("idle");
      if (code === "EMAIL_TAKEN") {
        /* The address got an account meanwhile: the preview, read again,
           shows the account's door (D9 as amended 2026-10-03). Back to the
           first step only after it answered, so the código step never
           flashes the name in between */
        await preview.refetch();
        setNewStep("name");
        return;
      }
      throw e;
    }
    queryClient.clear();
    void navigate({ to: "/welcome", search: { next: "/" } });
  }

  /* passwordless-access D9: every código goes to the invited address, which
     the person never types (better-auth D14). True once it left; a failure
     is said under the button that asked */
  async function sendToInvited() {
    setError(null);
    try {
      await sendCode(inv!.email!);
      return true;
    } catch (e) {
      setError(accessProblem(e) === "tooMany" ? TOO_MANY : "No pudimos enviar el código. Intenta de nuevo.");
      return false;
    }
  }

  async function askCode() {
    setCodeStep("sending");
    setCodeStep((await sendToInvited()) ? "open" : "closed");
  }

  /* A new person's «Continuar»: the código step opens only once its código
     was sent */
  async function continueAsNew() {
    setSending(true);
    const sent = await sendToInvited();
    setSending(false);
    if (sent) setNewStep("code");
  }

  /* feedback-vocabulary-rollout D1/D5. The word used to appear the instant the
     request left, so a session check answered from cache flashed a full screen
     of "Cargando…" and took it away again — the flicker the threshold exists to
     prevent. It rides as the shape so nothing shows until the wait is real. */
  if (user.isPending || preview.isPending) {
    return (
      <Pending
        active
        label="Cargando la invitación."
        shape={
          <main className="flex min-h-dvh items-center justify-center bg-background">
            <p className="text-sm text-ink-soft">Cargando…</p>
          </main>
        }
      >
        {null}
      </Pending>
    );
  }

  if (preview.isError || !inv || inv.status === "gone") {
    return (
      <AccessLayout title="Esta invitación ya no existe" description="Puede que la hayan cancelado o que ya se haya usado.">
        <p className="text-sm text-muted-foreground">Pide una nueva a quien te invitó.</p>
        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="text-link hover:underline">
            Ir a iniciar sesión
          </Link>
        </p>
      </AccessLayout>
    );
  }

  const business = inv.businessName ?? "un negocio";
  const roleLabel = inv.role ? ROLE_LABELS[inv.role].toLowerCase() : null;
  const title = `Te invitaron a ${business}`;

  if (inv.status === "expired") {
    return (
      <AccessLayout title={title} description={roleLabel ? `Como ${roleLabel}.` : undefined}>
        <Alert variant="warning">Esta invitación venció. Las invitaciones duran 48 horas.</Alert>
        <p className="mt-4 text-sm text-muted-foreground">Pide una nueva a quien te invitó.</p>
        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="text-link hover:underline">
            Ir a iniciar sesión
          </Link>
        </p>
      </AccessLayout>
    );
  }

  /* Adversarial review, 2026-10-02: an acceptance that failed — on sight,
     or after the código had already opened the session. It says what went
     wrong, offers the retry where one can work (back to idle: the effect
     above accepts again once the person is read), and always a way on.
     Ahead of the branches below so the código step never stays on
     "Entrando…" or "Creando…" while the person is read.
     The way on follows the session: the panel when one is open — through
     /welcome when a código opened it (D6) — and the sign-in when none is,
     which only a new person's código refused at the invitation leaves
     (D9 as amended 2026-10-03: nothing was born). */
  if (state === "failed") {
    const wayOn = "inline-flex min-h-12 items-center text-link hover:underline";
    const signedOut = !byCode && !user.data;
    return (
      <AccessLayout title={title} description={inv.email ?? undefined}>
        <div className="space-y-3">
          <Alert variant="destructive">
            {failure === "gone" ? invitationGone : failure === "tooMany" ? TOO_MANY : "No pudimos aceptar la invitación. Intenta de nuevo."}
          </Alert>
          {failure !== "gone" && (
            <Button
              size="standard"
              variant="secondary"
              className="w-full"
              onClick={() => {
                setState("idle");
                void queryClient.invalidateQueries({ queryKey: ["user"] });
              }}
            >
              Intentar de nuevo
            </Button>
          )}
          <p className="text-center text-sm">
            {signedOut ? (
              <Link to="/login" className={wayOn}>
                Ir a iniciar sesión
              </Link>
            ) : byCode ? (
              <Link to="/welcome" search={{ next: "/" }} className={wayOn}>
                Ir al panel
              </Link>
            ) : (
              <Link to="/" className={wayOn}>
                Ir al panel
              </Link>
            )}
          </p>
        </div>
      </AccessLayout>
    );
  }

  /* Signed in as somebody else */
  if (user.data && !sameEmail) {
    return (
      <AccessLayout title={title} description={`La invitación es para ${inv.email}.`}>
        <div className="space-y-3">
          <Alert variant="destructive">Entraste como {user.data.email}, y esta invitación fue enviada a otro correo.</Alert>
          <Button size="standard" variant="secondary" className="w-full" onClick={() => void switchAccount()}>
            Entrar con el correo invitado
          </Button>
          <p className="text-center text-sm">
            <Link to="/login" className="text-link hover:underline">
              Ir a iniciar sesión
            </Link>
          </p>
        </div>
      </AccessLayout>
    );
  }

  if (user.data) {
    return (
      <AccessLayout title={title} description={user.data.email}>
        <p className="text-sm text-ink-soft">Un momento…</p>
      </AccessLayout>
    );
  }

  const description = roleLabel ? `Como ${roleLabel}.` : undefined;

  /* The invitation's address, never typed (D14) — shown as text, not as a
     field that looks editable (design review identidad-2) */
  const address = (
    <p className="text-sm">
      <span className="text-muted-foreground">Correo:</span> <span className="font-medium">{inv.email}</span>
    </p>
  );

  /* passwordless-access D9 as amended 2026-10-03 (contracts/panel-access.md
     § /invitaciones/:invitationId, "No session, no account"): the name,
     then the código from the invited inbox. The address stays text in both
     steps; nothing is born before the código is typed (FR-004, FR-019). */
  if (!inv.hasAccount) {
    if (newStep === "code") {
      return (
        <AccessLayout title={title} description={description}>
          <div className="space-y-4">
            <p className="text-sm">{`Te enviamos un código a ${inv.email}. Vence en 10 minutos.`}</p>
            <CodeStep purpose="create" onSubmit={joinAsNew} onResend={() => sendCode(inv.email!)} />
            {/* 48 px, like every control on the access pages; the name
                waits there as typed */}
            <div className="text-sm">
              <Button size="standard" variant="link" className="min-h-12" onClick={() => setNewStep("name")}>
                Corregir mi nombre
              </Button>
            </div>
          </div>
        </AccessLayout>
      );
    }
    const nameShown = nameTouched ? nameProblem(name) : null;
    return (
      <AccessLayout title={title} description={description}>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setNameTouched(true);
            if (sending || nameProblem(name)) return;
            void continueAsNew();
          }}
        >
          {address}
          <div>
            <Label htmlFor="name">Tu nombre</Label>
            <Input
              id="name"
              autoComplete="name"
              maxLength={NAME_MAX}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setNameTouched(true)}
              aria-invalid={Boolean(nameShown) || undefined}
              aria-describedby={nameShown ? "name-error" : undefined}
            />
            <FieldError id="name-error">{nameShown}</FieldError>
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Pending active={sending} label="Enviando el código.">
            <Button type="submit" size="standard" className="w-full" disabled={sending}>
              {sending ? "Enviando…" : "Continuar"}
            </Button>
          </Pending>
        </form>
      </AccessLayout>
    );
  }

  const withKey = passkeysSupported();
  return (
    <AccessLayout title={title} description={description}>
      <div className="space-y-4">
        {address}
        {withKey && (
          <>
            <Pending active={keyBusy} label="Esperando a tu dispositivo.">
              <Button
                type="button"
                size="standard"
                className="w-full"
                disabled={keyBusy}
                /* D7: the device's window opens inside this click. The
                   session it opens meets the page's own logic above: the
                   invited address accepts on sight, another address gets the
                   "otro correo" state with its switch (FR-018). */
                onClick={async () => {
                  setKeyBusy(true);
                  setKeyFailed(false);
                  const opened = await signInWithKey();
                  setKeyBusy(false);
                  if (!opened) {
                    setKeyFailed(true);
                    return;
                  }
                  void queryClient.invalidateQueries({ queryKey: ["user"] });
                }}
              >
                <Fingerprint className="size-5" aria-hidden />
                {keyBusy ? "Esperando a tu dispositivo…" : "Entrar con huella o rostro"}
              </Button>
            </Pending>
            {keyFailed && <Alert variant="destructive">No pudimos usar tu huella o rostro. Entra con un código.</Alert>}
            <OrWithCode />
          </>
        )}
        {codeStep === "open" ? (
          <CodeStep
            purpose="enter"
            onSubmit={async (otp) => {
              /* The invitation is accepted here, not by the effect above, so
                 it happens once: marked before the session opens, so a
                 refetch of the user in between (a window refocus) cannot
                 start a second acceptance */
              setState("accepting");
              try {
                await signInWithCode(inv.email!, otp);
              } catch (e) {
                setState("idle");
                throw e;
              }
              setByCode(true);
              try {
                const { organizationId } = await acceptInvitation(invitationId);
                await setActiveBusiness(organizationId).catch(() => {});
              } catch (e) {
                /* Adversarial review, 2026-10-02: the session is open
                   although nothing was accepted. The failure replaces this
                   step at once, and the page reads the person it now has */
                failedWith(e);
                void queryClient.invalidateQueries({ queryKey: ["user"] });
                return;
              }
              queryClient.clear();
              void navigate({ to: "/welcome", search: { next: "/" } });
            }}
            onResend={() => sendCode(inv.email!)}
          />
        ) : (
          <Pending active={codeStep === "sending"} label="Enviando el código.">
            <Button
              type="button"
              size="standard"
              variant={withKey ? "secondary" : "primary"}
              className="w-full"
              disabled={codeStep === "sending"}
              onClick={() => void askCode()}
            >
              {codeStep === "sending" ? "Enviando…" : "Enviarme un código"}
            </Button>
          </Pending>
        )}
        {error && <Alert variant="destructive">{error}</Alert>}
      </div>
    </AccessLayout>
  );
}

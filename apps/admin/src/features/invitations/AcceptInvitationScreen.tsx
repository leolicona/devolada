import { Alert, Button, Input, ListError, Pending } from "@devolada/ui";
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
  listOrganizations,
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
  /* Read at load, and again only when EMAIL_TAKEN says the address got an
     account. Not on a window's return: every código takes the person to
     their inbox and back, and a re-read that failed there once stood in
     for a dead invitation (adversarial review, 2026-10-03). Nor on a
     returning signal: on a phone a lost answer and a returning signal are
     one event, and a re-read then answers "gone" for the person's own
     acceptance, which the gone screen would tell to ask for a new
     invitation (adversarial review, 2026-10-03). */
  const preview = useQuery<InvitationPreviewResponse, ApiError>({
    queryKey: ["invitation", invitationId],
    queryFn: () => api<InvitationPreviewResponse>(`/businesses/invitations/${invitationId}/preview`),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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

  /* Inside, once the invitation is the person's: through /welcome when a
     código opened the session here, like every código's way on (D6) */
  function goInside(viaWelcome: boolean) {
    queryClient.clear();
    if (viaWelcome) void navigate({ to: "/welcome", search: { next: "/" } });
    else void navigate({ to: "/" });
  }

  /* Adversarial review, 2026-10-03: INVITATION_NOT_FOUND can be this
     person's own acceptance — a try whose answer was lost on the way, or
     accept-new's 500 after the plugin had accepted (the active business
     failing). Said to someone with a session, "ya no es válida" would send
     them to ask for an invitation they would be refused, as a member. So
     the page first reads their businesses; the invitation's among them, it
     goes on as an acceptance does, its business set active.
     The preview names the business, not its organization, so names are
     compared — one column, the organization's name, on both sides. A
     person in another business of the same name is sent into their own
     panel instead of told; never into one that is not theirs. */
  async function joinedAlready(): Promise<boolean> {
    if (!inv?.businessName) return false;
    try {
      const joined = (await listOrganizations()).find((o) => o.name === inv.businessName);
      if (!joined) return false;
      await setActiveBusiness(joined.id).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  async function failedWith(e: unknown, session: { open: boolean; viaWelcome: boolean }) {
    const gone = e instanceof ApiError && e.code === "INVITATION_NOT_FOUND";
    if (gone && session.open && (await joinedAlready())) {
      goInside(session.viaWelcome);
      return;
    }
    setFailure(gone ? "gone" : accessProblem(e) === "tooMany" ? "tooMany" : "other");
    setState("failed");
  }

  /* Signed in with the invited address: accept, activate, go */
  useEffect(() => {
    if (!user.data || !inv || inv.status !== "pending" || !sameEmail || state !== "idle") return;
    setState("accepting");
    acceptInvitation(invitationId)
      .then(async ({ organizationId }) => {
        await setActiveBusiness(organizationId).catch(() => {});
        goInside(byCode);
      })
      .catch((e) => failedWith(e, { open: true, viaWelcome: byCode }));
  }, [user.data, inv, sameEmail, state, byCode, invitationId, queryClient, navigate]);

  async function switchAccount() {
    await logout().catch(() => {});
    queryClient.clear();
    void navigate({ to: "/login", search: { next: here } });
  }

  const invitationGone = "La invitación ya no es válida. Pide una nueva a quien te invitó.";

  /* passwordless-access D9 (amended 2026-10-03, spec Clarifications Q5): the
     código births the account, verified and named, and accepts the
     invitation in one request; then /welcome (FR-019, FR-006). Marked
     accepting first, like the account's código below, so a refetch of the
     user in between (a window refocus) cannot start a second acceptance
     once the session exists. */
  async function joinAsNew(otp: string) {
    setState("accepting");
    try {
      await acceptInvitationAsNewUser(invitationId, { name: name.trim(), otp });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      /* A refused código, the limiter's wait, a body the server refused:
         nothing was born, and CodeStep reads it as every door does
         (adversarial review, 2026-10-03: only these are the código's) */
      if (accessProblem(e) !== "other" || code === "VALIDATION") {
        setState("idle");
        throw e;
      }
      if (code === "EMAIL_TAKEN") {
        setState("idle");
        /* The address got an account meanwhile: the preview, read again,
           shows the account's door (D9 as amended 2026-10-03). Back to the
           first step only after it answered, so the código step never
           flashes the name in between. A re-read that got no answer keeps
           what EMAIL_TAKEN itself said — the address has an account —
           rather than the name step it just refused (adversarial review,
           2026-10-03) */
        const reread = await preview.refetch();
        if (reread.isError) {
          queryClient.setQueryData<InvitationPreviewResponse>(["invitation", invitationId], (p) => p && { ...p, hasAccount: true });
        }
        setNewStep("name");
        return;
      }
      /* The invitation died while the código travelled, or the acceptance
         failed for another reason — a 500, an answer lost on the way. Past
         the código's check the account it proved stays, with its session:
         its inbox's owner's, as a registration's would be (contracts/
         panel-access.md § accept-new: "any other failure of the acceptance
         is a 500, the proved account kept"). The page reads who it has now,
         still marked accepting, so the way on it offers is the true one,
         and says what failed — never "No pudimos revisar el código" for a
         código that was right, never left on «Creando…» (adversarial
         review, 2026-10-02, the account branch's fix; 2026-10-03, every
         failure but the código's). With a session, «Intentar de nuevo»
         accepts on sight; without one, it opens the código step again. */
      await queryClient.refetchQueries({ queryKey: ["user"], exact: true });
      const signedIn = Boolean(queryClient.getQueryData<SessionUser | null>(["user"]));
      setByCode(signedIn);
      await failedWith(e, { open: signedIn, viaWelcome: true });
      return;
    }
    goInside(true);
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

  /* Adversarial review, 2026-10-03: "gone" is what the server said, never a
     read that failed — the preview answers 200 `{status: "gone"}` for a dead
     invitation, so an error is the network, a 5xx or the limiter. A first
     read with no answer offers a retry; a later one that fails keeps the
     invitation on screen (TanStack keeps the last answer beside the
     error). An access page: the retry is the thumb's 48 px. */
  if (!inv) {
    return (
      <AccessLayout>
        <ListError what="la invitación" size="standard" onRetry={() => preview.refetch()} />
        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="inline-flex min-h-12 items-center text-link hover:underline">
            Ir a iniciar sesión
          </Link>
        </p>
      </AccessLayout>
    );
  }

  if (inv.status === "gone") {
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
                   step — once the person's businesses were read, for an
                   INVITATION_NOT_FOUND that may be their own acceptance
                   (2026-10-03) — and the page reads the person it now has */
                await failedWith(e, { open: true, viaWelcome: true });
                void queryClient.invalidateQueries({ queryKey: ["user"] });
                return;
              }
              goInside(true);
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

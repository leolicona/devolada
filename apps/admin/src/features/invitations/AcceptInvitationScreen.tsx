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
import { ROLE_LABELS } from "../auth/roles";
import {
  acceptInvitation,
  acceptInvitationAsNewUser,
  logout,
  sendCode,
  setActiveBusiness,
  signInWithCode,
  useUser,
} from "../auth/session";

/* The link the invitation email carries (business-and-memberships D8):
   `/invitaciones/:id`. better-auth D14: the page reads the invitation
   first and decides for the invitee — the address is the invitation's,
   shown as text, never typed. Signed in with the invited address, it just
   accepts; with another, it says so.
   passwordless-access D9: no password in any state (FR-020). An address
   with an account comes in with its key, where the browser supports one,
   or with a código sent to the invited address (FR-017); a new person
   gives a name, and the invitation that reached their inbox is the proof
   (FR-019). A código and a birth both go through /welcome, which offers
   the key (FR-006). */
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
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* the código door: closed, asking, or the código step open */
  const [codeStep, setCodeStep] = useState<"closed" | "sending" | "open">("closed");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyFailed, setKeyFailed] = useState(false);

  const inv = preview.data;
  const sameEmail =
    Boolean(user.data && inv?.email) && user.data!.email.toLowerCase() === inv!.email!.toLowerCase();

  /* Signed in with the invited address: accept, activate, go */
  useEffect(() => {
    if (!user.data || !inv || inv.status !== "pending" || !sameEmail || state !== "idle") return;
    setState("accepting");
    acceptInvitation(invitationId)
      .then(async ({ organizationId }) => {
        await setActiveBusiness(organizationId).catch(() => {});
        queryClient.clear();
        void navigate({ to: "/" });
      })
      .catch(() => setState("failed"));
  }, [user.data, inv, sameEmail, state, invitationId, queryClient, navigate]);

  async function switchAccount() {
    await logout().catch(() => {});
    queryClient.clear();
    void navigate({ to: "/login", search: { next: here } });
  }

  const invitationGone = "La invitación ya no es válida. Pide una nueva a quien te invitó.";

  /* passwordless-access D9: a new person's birth, then /welcome (FR-019) */
  async function joinAsNew() {
    setBusy(true);
    setError(null);
    try {
      await acceptInvitationAsNewUser(invitationId, { name: name.trim() });
      queryClient.clear();
      void navigate({ to: "/welcome", search: { next: "/" } });
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "INVITATION_NOT_FOUND"
          ? invitationGone
          : accessProblem(e) === "tooMany"
            ? TOO_MANY
            : "No pudimos crear tu cuenta. Intenta de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }

  /* passwordless-access D9: the código goes to the invited address, which
     the person never types (better-auth D14) */
  async function askCode() {
    setCodeStep("sending");
    setError(null);
    try {
      await sendCode(inv!.email!);
      setCodeStep("open");
    } catch (e) {
      setCodeStep("closed");
      setError(accessProblem(e) === "tooMany" ? TOO_MANY : "No pudimos enviar el código. Intenta de nuevo.");
    }
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
        {state === "failed" ? (
          <Alert variant="destructive">No pudimos aceptar la invitación. Pide una nueva a quien te invitó.</Alert>
        ) : (
          <p className="text-sm text-ink-soft">Un momento…</p>
        )}
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

  if (!inv.hasAccount) {
    const nameShort = name.trim().length < 2;
    return (
      <AccessLayout title={title} description={description}>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (nameShort) {
              setError("Escribe tu nombre, al menos 2 letras.");
              return;
            }
            void joinAsNew();
          }}
        >
          {address}
          <div>
            <Label htmlFor="name">Tu nombre</Label>
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Pending active={busy} label="Creando tu cuenta.">
            <Button type="submit" size="standard" className="w-full" disabled={busy}>
              {busy ? "Creando…" : "Crear cuenta y entrar"}
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
              try {
                const { organizationId } = await acceptInvitation(invitationId);
                await setActiveBusiness(organizationId).catch(() => {});
              } catch {
                setError(invitationGone);
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

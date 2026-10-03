import { Alert, Button, Input, ListError, PasskeyOffer, Pending, type PasskeyOfferState } from "@devolada/ui";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { canVerifyPerson, passkeysSupported } from "@/lib/auth-client";
import { SuspendedScreen } from "../shell/SuspendedScreen";
import { AccessLayout } from "./AccessLayout";
import { CodeStep, OrWithCode } from "./CodeStep";
import { accessProblem, activateKey, signInWithKey, TOO_MANY } from "./keys";
import {
  sendCode,
  signInWithCode,
  updateName,
  useSession,
  useUser,
  type BusinessActor,
  type SessionUser,
} from "./session";

/* Access pages (better-auth.spec.md UI contract; passwordless-access D6).
   Controlled forms, plain es-MX copy, answers that never leak account
   existence. Codes, never links (better-auth D4): a código is typed where
   the session belongs. No password exists to ask for. D12: `next`
   (validated by the route) is where every door goes afterwards — the page
   the guard bounced, or an invitation. */

/* passwordless-access D6: a request that sends a código, or saves a name.
   A 429 is the limiter's wait, said as such (FR-027); anything else is the
   screen's own fallback — except an address Better Auth refuses
   (adversarial review, 2026-10-02). Its check is zod's `z.email()`,
   stricter than EMAIL_SHAPE below (a non-ASCII local part, a one-letter
   ending, two dots in a row), and its 400 INVALID_EMAIL goes under the
   field as `badEmail`: an edit fixes it, a "try again" never could. */
function useSend(action: () => Promise<unknown>, onDone: () => void, fallback = "No pudimos enviar el código. Intenta de nuevo.") {
  const [error, setError] = useState<string | null>(null);
  const [badEmail, setBadEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  return {
    error,
    busy,
    badEmail,
    clearBadEmail: () => setBadEmail(false),
    async run() {
      setBusy(true);
      setError(null);
      setBadEmail(false);
      try {
        await action();
        onDone();
      } catch (e) {
        if (e instanceof ApiError && e.code === "INVALID_EMAIL") setBadEmail(true);
        else setError(accessProblem(e) === "tooMany" ? TOO_MANY : fallback);
      } finally {
        setBusy(false);
      }
    },
  };
}

/* Field-level problems, named before the request leaves (identity round
   2026-09-02): the server's 400 used to be the first word the person
   heard about a one-letter name or a short password. The rules mirror
   the API's (name 2–80 once trimmed: passwordless-access analysis A3;
   email). Both ends of the name, and the field stops at its maximum
   (adversarial review, 2026-10-02): a longer name used to reach the
   server first, whose INVALID_NAME read as a código that failed. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_HINT = "Escribe un correo válido, como nombre@dominio.com.";
export const NAME_MAX = 80;
export const nameProblem = (v: string) => {
  const length = v.trim().length;
  if (length < 2) return "Escribe tu nombre, al menos 2 letras.";
  return length > NAME_MAX ? "Escribe tu nombre en 80 letras o menos." : null;
};
const emailProblem = (v: string) => (EMAIL_SHAPE.test(v.trim()) ? null : EMAIL_HINT);

/* `next` is any same-app path the route already validated; the router's
   `to` wants a literal route name, so the string goes through unchecked. */
const asRoute = (path: string) => path as "/";

export function FieldError({ id, children }: { id: string; children: string | null }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm font-medium text-error">
      {children}
    </p>
  );
}

/* passwordless-access D6, D7 (contracts/panel-access.md § /login): the key
   first, wherever the browser supports passkeys — it can reach a phone
   nearby or a synced key even on a computer without a sensor (FR-016) —
   then the email and a código, for every address alike (FR-013). The
   address stays in this component, never in the URL. No line announces
   that passwords are gone: the screen reads as if it had always been this
   way (spec Clarifications, Q4). A key goes to `next`; a código goes
   through /welcome, which asks a missing name and offers the key (D6). */
export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { next } = useSearch({ from: "/login" });
  const [step, setStep] = useState<"start" | "code">("start");
  const [email, setEmail] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyFailed, setKeyFailed] = useState(false);
  const address = email.trim();
  const shapeOk = EMAIL_SHAPE.test(address);
  const withKey = passkeysSupported();
  const send = useSend(() => sendCode(address), () => setStep("code"));

  if (step === "code") {
    return (
      <AccessLayout title="Escribe tu código" description={`Te enviamos un código de 6 dígitos a ${address}. Vence en 10 minutos.`}>
        <CodeStep
          purpose="enter"
          onSubmit={async (otp) => {
            await signInWithCode(address, otp);
            queryClient.clear();
            void navigate({ to: "/welcome", search: { next } });
          }}
          onResend={() => sendCode(address)}
          onOtherEmail={() => setStep("start")}
        />
      </AccessLayout>
    );
  }

  return (
    <AccessLayout title="Iniciar sesión" description="Cobra por transferencia con validación automática.">
      <div className="space-y-4">
        {withKey && (
          <>
            <Pending active={keyBusy} label="Esperando a tu dispositivo.">
              <Button
                type="button"
                size="standard"
                className="w-full"
                disabled={keyBusy}
                /* D7: the device's window opens inside this click */
                onClick={async () => {
                  setKeyBusy(true);
                  setKeyFailed(false);
                  const opened = await signInWithKey();
                  setKeyBusy(false);
                  if (!opened) {
                    /* FR-012: one line, and the código right below it */
                    setKeyFailed(true);
                    return;
                  }
                  queryClient.clear();
                  void navigate({ to: next ? asRoute(next) : "/" });
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (shapeOk && !send.busy) void send.run();
          }}
          className="space-y-4"
          noValidate
        >
          <div>
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                send.clearBadEmail();
              }}
              aria-invalid={send.badEmail || undefined}
              aria-describedby={send.badEmail ? "email-error" : undefined}
            />
            <FieldError id="email-error">{send.badEmail ? EMAIL_HINT : null}</FieldError>
          </div>
          {send.error && <Alert variant="destructive">{send.error}</Alert>}
          <Pending active={send.busy} label="Enviando el código.">
            <Button type="submit" size="standard" variant={withKey ? "secondary" : "primary"} className="w-full" disabled={!shapeOk || send.busy}>
              {send.busy ? "Enviando…" : "Enviar código"}
            </Button>
          </Pending>
        </form>
        {/* 48 px, like every control on the access pages (contracts/panel-access.md) */}
        <p className="text-center text-sm">
          <Link to="/signup" search={{ next }} className="inline-flex min-h-12 items-center text-link hover:underline">
            Crear cuenta
          </Link>
        </p>
      </div>
    </AccessLayout>
  );
}

/* passwordless-access D1, D6 (contracts/panel-access.md § /signup): name
   and email, then the código. The name stays in this component until the
   código carries it — the account is born there, verified and named, and
   nothing exists before (FR-004). No message ever says an address is taken
   (FR-005): a taken address goes through the same two steps and its código
   opens the existing account. The description names no business type
   (constitution IX, FR-030). */
export function SignupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { next } = useSearch({ from: "/signup" });
  const [step, setStep] = useState<"data" | "code">("data");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean }>({});
  const problems = { name: nameProblem(name), email: emailProblem(email) };
  const address = email.trim();
  const send = useSend(() => sendCode(address), () => setStep("code"));
  const shown = (field: keyof typeof problems) =>
    (touched[field] ? problems[field] : null) ?? (field === "email" && send.badEmail ? EMAIL_HINT : null);

  if (step === "code") {
    return (
      <AccessLayout title="Escribe tu código" description={`Te enviamos un código de 6 dígitos a ${address}. Vence en 10 minutos.`}>
        <CodeStep
          purpose="create"
          onSubmit={async (otp) => {
            await signInWithCode(address, otp, name.trim());
            /* A new session: whatever a query read before it is stale */
            queryClient.clear();
            void navigate({ to: "/welcome", search: { next } });
          }}
          onResend={() => sendCode(address)}
          onOtherEmail={() => setStep("data")}
        />
      </AccessLayout>
    );
  }

  return (
    <AccessLayout title="Crear cuenta" description="Cobra por transferencia con validación automática.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched({ name: true, email: true });
          if (problems.name || problems.email) return;
          void send.run();
        }}
        className="space-y-4"
        noValidate
      >
        <div>
          <Label htmlFor="name">Tu nombre</Label>
          <Input
            id="name"
            autoComplete="name"
            maxLength={NAME_MAX}
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
            onChange={(e) => {
              setEmail(e.target.value);
              send.clearBadEmail();
            }}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            aria-invalid={Boolean(shown("email")) || undefined}
            aria-describedby={shown("email") ? "email-error" : undefined}
          />
          <FieldError id="email-error">{shown("email")}</FieldError>
        </div>
        {send.error && <Alert variant="destructive">{send.error}</Alert>}
        <Pending active={send.busy} label="Enviando el código.">
          <Button type="submit" size="standard" className="w-full" disabled={send.busy}>
            {send.busy ? "Enviando…" : "Continuar"}
          </Button>
        </Pending>
        <p className="text-center text-sm">
          <Link to="/login" search={{ next }} className="inline-flex min-h-12 items-center text-link hover:underline">
            Ya tengo cuenta
          </Link>
        </p>
      </form>
    </AccessLayout>
  );
}

/* "Listo." stays for a beat before the page moves on (the design canvas):
   long enough to be read, short enough not to feel like a wait. */
const OUTCOME_BEAT_MS = 1200;

/* passwordless-access D6, D7 (contracts/panel-access.md § /welcome): where
   every door that opens a session by código lands, and an invitee's birth
   (D9). It does at most two things, in this order, then goes on to `next`:
   1. a person born through the sign-in door has no name — it asks. The
      order is load-bearing (D1): the passkey plugin names the WebAuthn user
      `user.name || user.id`, so a key made before the name would show the
      device's account picker a random id;
   2. a device that can verify the person itself (`canVerifyPerson`, not
      merely `passkeysSupported`: D7) is offered the key, with "Ahora no".
   When neither applies it navigates before painting: nobody sees a flash
   of it.
   Adversarial review, 2026-10-02: it reads the actor the way the shell
   does, and an account the panel refuses is never asked or offered
   anything first — the panel would promise a key, then refuse the
   account. A session with no business yet, none chosen or a revoked
   membership is the panel's person still, and is offered as any other.
   A suspended business is told here, on /welcome itself: the server
   deletes the session in the same answer that says ACCOUNT_SUSPENDED
   (the API's businessActorOf, auth/middleware.ts), so the shell's own
   read, one step on, would hear only "no session" and send the person
   back to /login — a loop of códigos that never named the suspension.
   Every other refusal (a store's account, WRONG_ACTOR: cash-at-stores D2;
   a suspended store; no session) goes on unoffered, and `next` answers it
   as it did before /welcome read the actor. */
const OFFERED_STILL = ["NO_BUSINESS", "NO_ACTIVE_BUSINESS", "MEMBERSHIP_REVOKED"];

/* Adversarial review, 2026-10-02: a read that got no answer — the network,
   a 5xx, a body that is not the envelope — is the only failure a retry can
   mend. A 4xx is the server's answer, and offering «Reintentar» on it
   (a suspended store's, whose session is already gone) promised what no
   retry could give. */
const unanswered = (e: unknown) => !(e instanceof ApiError) || e.status >= 500;

/* D8: the plugin registers a key only on a session younger than Better
   Auth's `freshAge`, one day (measured 2026-10-02, M2). Every door hands
   /welcome a session born seconds before; the nameless guards do not — a
   tab closed at "¿Cómo te llamas?" comes back days later (adversarial
   review, 2026-10-02) — and an older session is not offered what only
   Seguridad's step-up can give it. */
const FRESH_AGE_MS = 24 * 60 * 60 * 1000;

export function WelcomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { next } = useSearch({ from: "/welcome" });
  const user = useUser();
  const actor = useSession();
  const [phase, setPhase] = useState<"deciding" | "name" | "offer">("deciding");
  const [offer, setOffer] = useState<PasskeyOfferState>("idle");
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  /* State, not the read: the next refetch of a suspended session answers
     401, and the screen must not leave with it (adversarial review,
     2026-10-02). */
  const [suspended, setSuspended] = useState(false);
  const decided = useRef(false);
  const goOn = () => void navigate({ to: next ? asRoute(next) : "/", replace: true });

  /* Adversarial review, 2026-10-02: a read that failed is not "no
     session". Right after a código the cookie is valid, and sending the
     person to /login would read as a código that did not work; the
     failure is said, with a retry, and nothing is decided until a read
     answers. Only get-session answering null is "signed out". */
  const actorCode = actor.error?.code;
  const unread = user.isError || (Boolean(user.data) && actor.isError && unanswered(actor.error));

  async function decideOffer() {
    const bornAt = user.data?.sessionBornAt;
    const fresh = bornAt === undefined || Date.now() - bornAt < FRESH_AGE_MS;
    if (fresh && (await canVerifyPerson())) setPhase("offer");
    else goOn();
  }

  /* Decided once, like the shell's bounce (better-auth D12's lesson) */
  useEffect(() => {
    if (decided.current || user.isPending || unread) return;
    if (!user.data) {
      decided.current = true;
      void navigate({ to: "/login", search: { next }, replace: true });
      return;
    }
    if (actor.isPending) return;
    decided.current = true;
    if (actorCode === "ACCOUNT_SUSPENDED") {
      setSuspended(true);
      return;
    }
    if (actor.isError && !OFFERED_STILL.includes(actorCode ?? "")) goOn();
    else if (!user.data.name.trim()) setPhase("name");
    else void decideOffer();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decided once, on the first answers
  }, [user.isPending, user.data, unread, actor.isPending, actorCode]);

  const save = useSend(
    () => updateName(name.trim()),
    () => {
      /* Adversarial review, 2026-10-02: the guard that sent the person here
         (the shell's, the wizard's) mounts again on `next` and reads the
         cache before any refetch answers. A name only marked stale read
         there as no name, and sent the person straight back to be asked
         again. The saved name goes into both cached copies first. */
      const saved = name.trim();
      queryClient.setQueryData<SessionUser | null>(["user"], (u) => (u ? { ...u, name: saved } : u));
      queryClient.setQueryData<BusinessActor>(["session"], (a) => (a ? { ...a, userName: saved } : a));
      void decideOffer();
    },
    "No pudimos guardar tu nombre. Intenta de nuevo.",
  );

  if (suspended) return <SuspendedScreen />;

  if (phase === "deciding" && unread) {
    return (
      <AccessLayout>
        <ListError what="tu sesión" onRetry={() => Promise.all([user.refetch(), actor.refetch()])} />
      </AccessLayout>
    );
  }

  if (phase === "name") {
    const problem = touched ? nameProblem(name) : null;
    return (
      <AccessLayout title="¿Cómo te llamas?">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (nameProblem(name)) return;
            void save.run();
          }}
          className="space-y-4"
          noValidate
        >
          <div>
            <Label htmlFor="name">Tu nombre</Label>
            <Input
              id="name"
              autoComplete="name"
              autoFocus
              maxLength={NAME_MAX}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={Boolean(problem) || undefined}
              aria-describedby={problem ? "name-error" : undefined}
            />
            <FieldError id="name-error">{problem}</FieldError>
          </div>
          {save.error && <Alert variant="destructive">{save.error}</Alert>}
          <Pending active={save.busy} label="Guardando tu nombre.">
            <Button type="submit" size="standard" className="w-full" disabled={save.busy}>
              {save.busy ? "Guardando…" : "Continuar"}
            </Button>
          </Pending>
        </form>
      </AccessLayout>
    );
  }

  if (phase === "offer") {
    return (
      <AccessLayout>
        <PasskeyOffer
          deviceWord="este dispositivo"
          state={offer}
          /* D7: the ceremony starts inside this click — Safari refuses a
             WebAuthn call without a user gesture. Nothing is awaited before
             activateKey(), which calls the client before its own first
             await (welcome.test proves it inside the click's dispatch). */
          onActivate={() => {
            setOffer("busy");
            void activateKey().then((outcome) => {
              if (outcome === "done" || outcome === "alreadyEnrolled") {
                setOffer(outcome);
                void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
                setTimeout(goOn, OUTCOME_BEAT_MS);
              } else if (outcome === "notFresh") {
                /* D8 (adversarial review, 2026-10-02): a session that turned
                   a day old while the offer was open. No retry here can
                   work; Seguridad's step-up can, so the way on is `next` */
                goOn();
              } else {
                /* FR-009: one line, and both ways on */
                setOffer("failed");
              }
            });
          }}
          onSkip={goOn}
        />
      </AccessLayout>
    );
  }

  /* Deciding: the wait shows only if it is real (feedback-vocabulary-rollout D5) */
  return (
    <Pending
      active
      label="Cargando tu sesión."
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

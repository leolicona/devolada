import { Alert, Button, Input, PasskeyOffer, Pending, type PasskeyOfferState } from "@devolada/ui";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { Label } from "@/components/ui/label";
import { canVerifyPerson, passkeysSupported } from "@/lib/auth-client";
import { AccessLayout } from "./AccessLayout";
import { CodeStep, OrWithCode } from "./CodeStep";
import { accessProblem, activateKey, signInWithKey, TOO_MANY } from "./keys";
import { sendCode, signInWithCode, updateName, useUser } from "./session";

/* Access pages (better-auth.spec.md UI contract; passwordless-access D6).
   Controlled forms, plain es-MX copy, answers that never leak account
   existence. Codes, never links (better-auth D4): a código is typed where
   the session belongs. No password exists to ask for. D12: `next`
   (validated by the route) is where every door goes afterwards — the page
   the guard bounced, or an invitation. */

/* passwordless-access D6: a request that sends a código, or saves a name.
   A 429 is the limiter's wait, said as such (FR-027); anything else is the
   screen's own fallback. */
function useSend(action: () => Promise<unknown>, onDone: () => void, fallback = "No pudimos enviar el código. Intenta de nuevo.") {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return {
    error,
    busy,
    async run() {
      setBusy(true);
      setError(null);
      try {
        await action();
        onDone();
      } catch (e) {
        setError(accessProblem(e) === "tooMany" ? TOO_MANY : fallback);
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
   email). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nameProblem = (v: string) => (v.trim().length < 2 ? "Escribe tu nombre, al menos 2 letras." : null);
const emailProblem = (v: string) => (EMAIL_SHAPE.test(v.trim()) ? null : "Escribe un correo válido, como nombre@dominio.com.");

/* `next` is any same-app path the route already validated; the router's
   `to` wants a literal route name, so the string goes through unchecked. */
const asRoute = (path: string) => path as "/";

function FieldError({ id, children }: { id: string; children: string | null }) {
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
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {send.error && <Alert variant="destructive">{send.error}</Alert>}
          <Pending active={send.busy} label="Enviando el código.">
            <Button type="submit" size="standard" variant={withKey ? "secondary" : "primary"} className="w-full" disabled={!shapeOk || send.busy}>
              {send.busy ? "Enviando…" : "Enviar código"}
            </Button>
          </Pending>
        </form>
        <p className="text-center text-sm">
          <Link to="/signup" search={{ next }} className="text-link hover:underline">
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
  const shown = (field: keyof typeof problems) => (touched[field] ? problems[field] : null);
  const address = email.trim();
  const send = useSend(() => sendCode(address), () => setStep("code"));

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
            onChange={(e) => setEmail(e.target.value)}
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
          <Link to="/login" search={{ next }} className="text-link hover:underline">
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
   of it. */
export function WelcomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { next } = useSearch({ from: "/welcome" });
  const user = useUser();
  const [phase, setPhase] = useState<"deciding" | "name" | "offer">("deciding");
  const [offer, setOffer] = useState<PasskeyOfferState>("idle");
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const decided = useRef(false);
  const goOn = () => void navigate({ to: next ? asRoute(next) : "/", replace: true });

  async function decideOffer() {
    if (await canVerifyPerson()) setPhase("offer");
    else goOn();
  }

  /* Decided once, like the shell's bounce (better-auth D12's lesson) */
  useEffect(() => {
    if (user.isPending || decided.current) return;
    decided.current = true;
    if (!user.data) {
      void navigate({ to: "/login", search: { next }, replace: true });
      return;
    }
    if (!user.data.name.trim()) setPhase("name");
    else void decideOffer();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decided once, on the first answer
  }, [user.isPending, user.data]);

  const save = useSend(
    () => updateName(name.trim()),
    () => {
      void queryClient.invalidateQueries({ queryKey: ["user"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void decideOffer();
    },
    "No pudimos guardar tu nombre. Intenta de nuevo.",
  );

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
             WebAuthn call without a user gesture */
          onActivate={() => {
            setOffer("busy");
            void activateKey().then((outcome) => {
              if (outcome === "done" || outcome === "alreadyEnrolled") {
                setOffer(outcome);
                void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
                setTimeout(goOn, OUTCOME_BEAT_MS);
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

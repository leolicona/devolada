import { useId, type FormEvent, type ReactNode } from "react";
import { CircleCheck, CircleX, Fingerprint, LogOut, Mail } from "lucide-react";
import { Alert } from "./alert";
import { Button } from "./button";
import { Card } from "./card";
import { CODE_LENGTH, CodeInput } from "./code-input";
import { Pending } from "./pending";
import { Reveal } from "./reveal";
import { Skeleton } from "./skeleton";
import { cn } from "../lib/cn";
import { deviceNoun, sentenceStart } from "../lib/device-word";

/* "Entrar con huella o rostro": the person's keys and sessions
   (passwordless-access D8, D11, D12). Cuenta → Seguridad in the panel and
   Caja in the store app render this one card; each app keeps its own Better
   Auth client and fetches, and passes state and callbacks in.

   It never mentions a password (FR-030). The card it replaces said "Tu
   contraseña sigue funcionando" and fell back on it after a failed
   activation; there is nothing to fall back on now, and the screen reads as
   if it had always been this way (spec Clarifications, Q4). */

export type KeysCardKey = {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
  backedUp?: boolean | null;
};

export interface KeysCardStepUp {
  /* The address the código went to — the person's own */
  email: string;
  code: string;
  onCodeChange: (code: string) => void;
  /* "Confirmar". Reached only with six digits. */
  onSubmit: () => void;
  /* "Cancelar": closes the step-up and brings back the activate button */
  onCancel: () => void;
  busy: boolean;
  /* What the try came to. Only "invalid" judged the código; a lost signal
     or a server that failed keeps it in the field, and "Confirmar" tries
     it again — never told as a wrong código, which would send the person
     for a new one they do not need (adversarial review, 2026-10-02):
     - "invalid": wrong, expired, or spent after three tries;
     - "tooMany": the limiter's wait (FR-027);
     - "offline": the signal dropped (the store app's word for it,
       cash-at-stores T074);
     - "failed": anything else. */
  error: null | "invalid" | "tooMany" | "offline" | "failed";
}

export interface KeysCardProps {
  title?: string;
  description?: ReactNode;
  keys: KeysCardKey[] | undefined;
  loading: boolean;
  /* "este dispositivo" in the panel, "este teléfono" in the store app */
  deviceWord: string;
  /* The device can verify the person (passwordless-access D7). False, the
     activate button is not offered at all: on a desktop with no sensor the
     browser would otherwise open a window asking for a phone or a security
     key in the middle of a registration. */
  canActivate: boolean;
  /* "failed": the ceremony did not finish (FR-009). "notSent", "tooMany"
     and "offline": the step-up's código could not be sent (D8). The
     step-up opens only once its código is on its way, so a send that
     fails says why beside "Activar", which asks again: the card has no
     resend, and a field waiting for a código that never left would wait
     forever (adversarial review, 2026-10-02).
     "sending": the step-up's código on its way. The ceremony has already
     ended by then — SESSION_NOT_FRESH answers before any system prompt
     opens — so the button holds with the panel's código words, never
     "Esperando a tu teléfono…", which would send the person looking at a
     device that asks for nothing (adversarial review, 2026-10-02). */
  activation: "idle" | "busy" | "sending" | "done" | "failed" | "notSent" | "tooMany" | "offline";
  onActivate: () => void;
  onRemove: (id: string) => void;
  removeFailed?: boolean;
  /* passwordless-access D8: a key needs a session younger than a day. When
     the server answers SESSION_NOT_FRESH, the app sends a código and, once
     it is on its way, opens this; null, the activate button is back. */
  stepUp: null | KeysCardStepUp;
  /* "failed" says so and keeps the button (adversarial review,
     2026-10-02): a person shutting out a lost phone must never read a
     failure as silence */
  signOutOthers: "idle" | "busy" | "done" | "failed";
  onSignOutOthers: () => void;
  /* The panel is desktop-first and aims with a pointer (compact, 40px); the
     store app is phone-first and aims with a thumb (standard, 48px, full
     width). One card, two declared sizes (constitution VI; the design
     canvas draws both). */
  size?: "compact" | "standard";
  className?: string;
}

const SIZES = {
  compact: {
    text: "text-sm",
    row: "px-3 py-2",
    block: "",
    actions: "flex flex-wrap items-center gap-3",
    /* The declared height becomes the floor, not the ceiling, for the two
       long labels. "Cerrar sesión en los demás dispositivos" is wider than
       the card at the 360px floor; a fixed height would clip its second line
       (the design canvas's `btn-wrap`). */
    wrap: "h-auto min-h-10 py-2 whitespace-normal",
  },
  standard: {
    text: "text-base",
    row: "px-4 py-3",
    block: "w-full",
    actions: "flex flex-col gap-3",
    wrap: "h-auto min-h-12 py-3 whitespace-normal",
  },
} as const;

const KEY_NAME = "Llave de acceso";

/* Each app's own words for these (the store app's keys.ts; the panel's
   código step), so the card reads like the doors around it */
const TOO_MANY = "Demasiados intentos. Espera un momento e intenta de nuevo.";
const OFFLINE = "Sin conexión. Revisa tu internet e intenta de nuevo.";

const STEP_UP_PROBLEM: Record<NonNullable<KeysCardStepUp["error"]>, string> = {
  /* the card has no resend: "Cancelar", then "Activar" asks again (the design canvas) */
  invalid: "El código no es válido o ya venció. Pide uno nuevo.",
  tooMany: TOO_MANY,
  offline: OFFLINE,
  failed: "No pudimos revisar el código. Intenta de nuevo.",
};

/* FR-030: no password to fall back on, so each line offers only the retry */
const ACTIVATION_PROBLEM: Partial<Record<KeysCardProps["activation"], string>> = {
  failed: "No se pudo activar. Intenta de nuevo.",
  notSent: "No pudimos enviar el código. Intenta de nuevo.",
  tooMany: TOO_MANY,
  offline: OFFLINE,
};

const dateOf = (value: KeysCardKey["createdAt"]) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
};

const nameOf = (key: KeysCardKey) => key.name?.trim() || null;

export function KeysCard({
  title = "Entrar con huella o rostro",
  description,
  keys,
  loading,
  deviceWord,
  canActivate,
  activation,
  onActivate,
  onRemove,
  removeFailed = false,
  stepUp,
  signOutOthers,
  onSignOutOthers,
  size = "compact",
  className,
}: KeysCardProps) {
  const s = SIZES[size];
  const noun = deviceNoun(deviceWord);
  /* Either wait holds the button: a second press while the step-up's código
     is on its way would meet the same stale session (D8) */
  const waiting = activation === "busy" || activation === "sending";
  const stepUpErrorId = useId();

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stepUp || stepUp.busy || stepUp.code.length < CODE_LENGTH) return;
    stepUp.onSubmit();
  };

  return (
    <Card className={cn("p-6", className)}>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className={cn("mt-2 text-ink-soft", s.text)}>
        {description ?? (
          <>
            Activa el acceso con la huella o el rostro de {deviceWord}. Si tu llavero de iCloud o de
            Google sincroniza tus llaves, también servirá en tus otros dispositivos.
          </>
        )}
      </p>

      {/* feedback-vocabulary-rollout D1/D5/D7: while the list loads the card
          promises its shape, and says so in words, rather than showing no
          list, no empty line and no signal. */}
      <Pending
        active={loading}
        label="Cargando tus dispositivos"
        shape={<Skeleton className="mt-4 h-16 w-full" />}
      >
        {keys && keys.length > 0 && (
          <ul
            aria-label="Dispositivos con acceso"
            className="mt-4 divide-y divide-line rounded-md border border-line"
          >
            {keys.map((key) => {
              const date = dateOf(key.createdAt);
              const detail = [date && `Activada el ${date}`, key.backedUp && "sincronizada con tu llavero"]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={key.id} className={cn("flex items-center justify-between gap-3", s.row, s.text)}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{nameOf(key) ?? KEY_NAME}</span>
                    {detail && <span className="block text-ink-soft">{detail}</span>}
                  </span>
                  <Button
                    size={size}
                    variant="secondary"
                    className="shrink-0"
                    /* Every row's button says "Quitar"; the name and the date
                       say which key, for the person who cannot see the row it
                       sits in — two unnamed keys would otherwise share one
                       name (the design canvas) */
                    aria-label={`Quitar ${nameOf(key) ?? "llave de acceso"}${date ? `, activada el ${date}` : ""}`}
                    onClick={() => onRemove(key.id)}
                  >
                    Quitar
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {keys && keys.length === 0 && (
          /* better-auth D18 */
          <p className={cn("mt-4 text-ink-soft", s.text)}>
            Ningún dispositivo tiene acceso con huella o rostro todavía.
          </p>
        )}
      </Pending>
      {removeFailed && (
        <Alert variant="destructive" layout="icon" className="mt-3">
          <CircleX aria-hidden />
          <span>No pudimos quitar esa llave. Intenta de nuevo.</span>
        </Alert>
      )}

      {(stepUp || canActivate) && (
        <div className="mt-4 flex flex-col gap-3">
          {stepUp ? (
            /* passwordless-access D8: the step-up REPLACES the activate
               button. A second press of "Activar" while a código is on its
               way would hit the same stale session and fail again. */
            <Reveal>
              <form noValidate onSubmit={confirm} className="flex flex-col gap-3">
                <Alert layout="icon">
                  <Mail aria-hidden />
                  <span>Confirma que eres tú: te enviamos un código a {stepUp.email}.</span>
                </Alert>
                <CodeInput
                  size={size}
                  value={stepUp.code}
                  onChange={stepUp.onCodeChange}
                  disabled={stepUp.busy}
                  invalid={stepUp.error === "invalid"}
                  aria-describedby={stepUp.error ? stepUpErrorId : undefined}
                  /* The activate button the person just pressed is gone;
                     the field that replaced it is where they type next */
                  autoFocus
                />
                {stepUp.error && (
                  <Alert id={stepUpErrorId} variant="destructive" layout="icon">
                    <CircleX aria-hidden />
                    <span>{STEP_UP_PROBLEM[stepUp.error]}</span>
                  </Alert>
                )}
                <div className={s.actions}>
                  <Pending active={stepUp.busy} label="Confirmando el código." className={s.block}>
                    <Button
                      type="submit"
                      size={size}
                      className={s.block}
                      disabled={stepUp.busy || stepUp.code.length < CODE_LENGTH}
                    >
                      {stepUp.busy ? "Confirmando…" : "Confirmar"}
                    </Button>
                  </Pending>
                  <Button
                    variant="ghost"
                    size={size}
                    className={s.block}
                    disabled={stepUp.busy}
                    onClick={() => stepUp.onCancel()}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            </Reveal>
          ) : activation === "done" ? (
            /* role="status": it takes the place of the button that was just
               pressed, so focus has nowhere to land and only an announcement
               says what happened */
            <Reveal>
              <Alert variant="success" layout="icon" role="status">
                <CircleCheck aria-hidden />
                <span>Listo. {sentenceStart(deviceWord)} ya puede entrar con huella o rostro.</span>
              </Alert>
            </Reveal>
          ) : (
            <Pending
              active={waiting}
              label={activation === "sending" ? "Enviando el código." : `Esperando a tu ${noun}.`}
            >
              <Button
                size={size}
                variant="secondary"
                className={cn(s.wrap, s.block)}
                disabled={waiting}
                /* passwordless-access D7: the WebAuthn call must start inside
                   this click — Safari refuses one outside a user gesture */
                onClick={() => onActivate()}
              >
                <Fingerprint className="size-5" aria-hidden />
                {activation === "sending"
                  ? "Enviando el código…"
                  : activation === "busy"
                    ? `Esperando a tu ${noun}…`
                    : `Activar en ${deviceWord}`}
              </Button>
            </Pending>
          )}
          {!stepUp && ACTIVATION_PROBLEM[activation] && (
            <Reveal>
              <Alert variant="destructive" layout="icon">
                <CircleX aria-hidden />
                <span>{ACTIVATION_PROBLEM[activation]}</span>
              </Alert>
            </Reveal>
          )}
        </div>
      )}

      {/* passwordless-access D11: Better Auth's revoke-other-sessions keeps
          this session and ends every other. It needs no fresh session — a
          person who lost their phone should not need a código to shut it out. */}
      <div className="mt-6 flex flex-col gap-3 border-t border-line-soft pt-6">
        {signOutOthers === "done" ? (
          <Reveal>
            <Alert variant="success" layout="icon" role="status">
              <CircleCheck aria-hidden />
              <span>Listo. Solo {deviceWord} sigue con tu sesión abierta.</span>
            </Alert>
          </Reveal>
        ) : (
          <Pending active={signOutOthers === "busy"} label="Cerrando las demás sesiones.">
            <Button
              size={size}
              variant="secondary"
              className={cn(s.wrap, s.block)}
              disabled={signOutOthers === "busy"}
              onClick={() => onSignOutOthers()}
            >
              <LogOut className="size-4 shrink-0" aria-hidden />
              {signOutOthers === "busy" ? "Cerrando sesiones…" : "Cerrar sesión en los demás dispositivos"}
            </Button>
          </Pending>
        )}
        {signOutOthers === "failed" && (
          <Alert variant="destructive" layout="icon">
            <CircleX aria-hidden />
            <span>No pudimos cerrar las demás sesiones. Intenta de nuevo.</span>
          </Alert>
        )}
      </div>
    </Card>
  );
}

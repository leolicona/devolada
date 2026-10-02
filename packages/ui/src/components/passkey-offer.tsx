import type { ComponentType } from "react";
import { CircleCheck, CircleX, Fingerprint, Info, KeyRound, ShieldCheck, Users } from "lucide-react";
import { Alert } from "./alert";
import { Button } from "./button";
import { Pending } from "./pending";
import { Reveal } from "./reveal";
import { cn } from "../lib/cn";
import { deviceNoun, sentenceStart } from "../lib/device-word";

/* The activation step's body (passwordless-access D7, D12): what `/welcome`
   shows after a código, and the store app after its own door. Presentational
   — the app keeps the Better Auth client and the platform check, and passes
   the state in.

   The four lines are FR-008's, in its order: what it does, what Devolada never
   sees, where else the key works, and who else it lets in. The last one is the
   reason "Ahora no" is as wide as the offer: on a shared counter computer it
   is the right answer, not a refusal. */

export type PasskeyOfferState = "idle" | "busy" | "done" | "failed" | "alreadyEnrolled";

export interface PasskeyOfferProps {
  /* The device in the person's hand, with its determiner: "este
     dispositivo", "este teléfono", "esta computadora" */
  deviceWord: string;
  state: PasskeyOfferState;
  /* Runs the ceremony. Called synchronously from the button's own click —
     see below. */
  onActivate: () => void;
  onSkip: () => void;
  /* The panel renders this inside a page that already has its h1; the store
     app renders it as the screen itself */
  titleAs?: "h1" | "h2";
  className?: string;
}

export function PasskeyOffer({
  deviceWord,
  state,
  onActivate,
  onSkip,
  titleAs: Title = "h2",
  className,
}: PasskeyOfferProps) {
  const noun = deviceNoun(deviceWord);
  const busy = state === "busy";
  /* `done` and `alreadyEnrolled` are outcomes: the app moves on after a beat
     (contracts/panel-access.md § /welcome), so there is nothing left to press */
  const actions = state === "idle" || state === "busy" || state === "failed";

  const lines: { icon: ComponentType<{ className?: string }>; text: string }[] = [
    { icon: Fingerprint, text: "La próxima vez entras con tu huella o tu rostro, sin escribir nada." },
    { icon: ShieldCheck, text: `Devolada nunca ve tu huella ni tu rostro: se quedan en tu ${noun}.` },
    {
      icon: KeyRound,
      text: "Si tu llavero de iCloud o de Google sincroniza tus llaves, también servirá en tus otros dispositivos.",
    },
    {
      icon: Users,
      text: `Si otras personas desbloquean ${deviceWord}, también podrán entrar. En un equipo compartido, elige «Ahora no».`,
    },
  ];

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Title className={Title === "h1" ? "text-xl font-semibold" : "text-lg font-semibold"}>
        Entra la próxima vez con tu huella o rostro
      </Title>

      <ul className="flex flex-col gap-3">
        {lines.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-base text-ink">
            <Icon className="mt-0.5 size-5 shrink-0 text-ink-soft" aria-hidden />
            <span>{text}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3">
        {actions && (
          <Pending active={busy} label={`Esperando a tu ${noun}.`}>
            <Button
              size="decisive"
              disabled={busy}
              /* passwordless-access D7: Safari refuses a WebAuthn call that
                 does not come from a user gesture. The ceremony starts HERE,
                 inside this click — never from an effect that watches a state
                 this click set, which runs after the gesture has expired. */
              onClick={() => onActivate()}
            >
              <Fingerprint className="size-5" aria-hidden />
              {busy ? `Esperando a tu ${noun}…` : "Activar huella o rostro"}
            </Button>
          </Pending>
        )}

        {state === "failed" && (
          <Reveal>
            <Alert variant="destructive" layout="icon">
              <CircleX aria-hidden />
              <span>No se pudo activar. Intenta de nuevo o elige «Ahora no».</span>
            </Alert>
          </Reveal>
        )}

        {/* passwordless-access D7: the browser refuses a second key for this
            account on this device (InvalidStateError). That is not a failure —
            the person already has what was offered. `role="status"` on both
            outcomes: they replace the button the person just pressed, so focus
            has nowhere to land and only an announcement says what happened. */}
        {state === "alreadyEnrolled" && (
          <Reveal>
            <Alert layout="icon" role="status">
              <Info aria-hidden />
              <span>{sentenceStart(deviceWord)} ya tiene tu huella o rostro.</span>
            </Alert>
          </Reveal>
        )}

        {state === "done" && (
          <Reveal>
            <Alert variant="success" layout="icon" role="status">
              <CircleCheck aria-hidden />
              <span>Listo.</span>
            </Alert>
          </Reveal>
        )}

        {actions && (
          <Button variant="ghost" className="w-full" disabled={busy} onClick={() => onSkip()}>
            Ahora no
          </Button>
        )}
      </div>
    </div>
  );
}

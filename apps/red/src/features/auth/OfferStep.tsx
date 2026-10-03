import { useEffect, useRef, useState } from "react";
import { PasskeyOffer, type PasskeyOfferState } from "@devolada/ui";
import { useWide } from "@/lib/wide";
import { AccessLayout } from "./AccessLayout";
import { activateKey } from "./keys";

/* "Listo." stays for a beat before the screen moves on (the design canvas,
   as the panel's /welcome): long enough to be read, short enough not to
   feel like a wait. */
const OUTCOME_BEAT_MS = 1200;

/* The activation, the third step of both store doors (passwordless-access
   D7, D10; contracts/store-access.md § /invitacion/:token, step 3). A step
   inside the screen that opened the session, not a route: the app has one
   destination, `/`. The screen shows it only where `canVerifyPerson()`
   said yes; anywhere else it goes straight on. */
export function OfferStep({ onDone }: { onDone: () => void }) {
  const [offer, setOffer] = useState<PasskeyOfferState>("idle");
  /* cash-at-stores D32: on a computer at the counter the device is not a phone */
  const deviceWord = useWide() ? "esta computadora" : "este teléfono";
  const beat = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (beat.current) clearTimeout(beat.current);
  }, []);

  return (
    <AccessLayout>
      <PasskeyOffer
        titleAs="h1"
        deviceWord={deviceWord}
        state={offer}
        /* D7: the ceremony starts inside this click — Safari refuses a
           WebAuthn call without a user gesture */
        onActivate={() => {
          setOffer("busy");
          void activateKey().then((outcome) => {
            if (outcome === "done" || outcome === "alreadyEnrolled") {
              setOffer(outcome);
              beat.current = setTimeout(onDone, OUTCOME_BEAT_MS);
            } else {
              /* FR-009: one line, and both ways on. The session is seconds
                 old, so SESSION_NOT_FRESH cannot reach this step (D8) */
              setOffer("failed");
            }
          });
        }}
        onSkip={onDone}
      />
    </AccessLayout>
  );
}

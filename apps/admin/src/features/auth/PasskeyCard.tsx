import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeysCard, type KeysCardKey, type KeysCardStepUp } from "@devolada/ui";
import { canVerifyPerson } from "@/lib/auth-client";
import { baGet, baPost } from "@/lib/api";
import { accessProblem, activateKey } from "./keys";
import { revokeOtherSessions, sendCode, signInWithCode, useUser } from "./session";

/* Cuenta → Seguridad: the account's keys and sessions (US-S07, better-auth
   D18; passwordless-access D8, D11, D12). The card itself is the shared
   `KeysCard` atom; this container keeps the Better Auth calls.

   - The list and "Quitar" are plain fetches, not the Better Auth client: it
     is for the WebAuthn ceremonies alone (lib/auth-client.ts), and its
     Request wrapper does not survive MSW.
   - The card shows on every device. Its list and "Cerrar sesión en los
     demás dispositivos" are how a lost phone is shut out, from whatever is
     at hand (FR-021, FR-022); only the activation needs a device that can
     verify the person (D7).
   - D8: a key outlives every session, so adding one asks for a session
     younger than a day (Better Auth's `freshAge`, measured 2026-10-02, M2).
     An older session meets SESSION_NOT_FRESH, and the card asks for a
     código first: it opens a fresh session, then the ceremony runs again
     in the same click. A browser that will not run a ceremony that late
     after the click answers like a cancel, and "Activar" — on a fresh
     session now — works at the next press.
   - D11: "Cerrar sesión en los demás dispositivos" is Better Auth's own
     `revoke-other-sessions`. With no password there is no reset to end the
     other sessions (better-auth D17's guarantee, kept). */

export function PasskeyCard() {
  const queryClient = useQueryClient();
  const user = useUser();
  const [canActivate, setCanActivate] = useState(false);
  const [activation, setActivation] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const [removeFailed, setRemoveFailed] = useState(false);
  const [stepUp, setStepUp] = useState<Omit<KeysCardStepUp, "email" | "onCodeChange" | "onSubmit" | "onCancel"> | null>(null);
  const [others, setOthers] = useState<"idle" | "busy" | "done" | "failed">("idle");

  useEffect(() => {
    let live = true;
    void canVerifyPerson().then((yes) => live && setCanActivate(yes));
    return () => {
      live = false;
    };
  }, []);

  const passkeys = useQuery<KeysCardKey[]>({
    queryKey: ["passkeys"],
    queryFn: () => baGet<KeysCardKey[]>("/auth/passkey/list-user-passkeys"),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
  const email = user.data?.email ?? "";

  async function activate() {
    setActivation("busy");
    const outcome = await activateKey();
    if (outcome === "done" || outcome === "alreadyEnrolled") {
      setActivation("done");
      refresh();
      return;
    }
    if (outcome === "notFresh" && email) {
      setActivation("idle");
      setStepUp({ code: "", busy: false, error: null });
      try {
        await sendCode(email);
      } catch (e) {
        /* the step-up stays open: "Cancelar", then "Activar", asks again */
        setStepUp({ code: "", busy: false, error: accessProblem(e) === "tooMany" ? "tooMany" : null });
      }
      return;
    }
    /* FR-030: one line, and no password to fall back on */
    setActivation("failed");
  }

  async function confirm() {
    if (!stepUp || stepUp.code.length < 6) return;
    setStepUp({ ...stepUp, busy: true, error: null });
    try {
      await signInWithCode(email, stepUp.code);
    } catch (e) {
      setStepUp({ ...stepUp, busy: false, error: accessProblem(e) === "tooMany" ? "tooMany" : "invalid" });
      return;
    }
    setStepUp(null);
    /* the session the código opened is the browser's now */
    void queryClient.invalidateQueries({ queryKey: ["user"] });
    await activate();
  }

  return (
    <KeysCard
      keys={passkeys.data}
      loading={passkeys.isPending}
      deviceWord="este dispositivo"
      canActivate={canActivate}
      activation={activation}
      onActivate={() => void activate()}
      onRemove={async (id) => {
        setRemoveFailed(false);
        try {
          await baPost("/auth/passkey/delete-passkey", { id });
          refresh();
        } catch {
          setRemoveFailed(true);
        }
      }}
      removeFailed={removeFailed}
      stepUp={
        stepUp && {
          ...stepUp,
          email,
          onCodeChange: (code) => setStepUp((s) => (s ? { ...s, code, error: null } : s)),
          onSubmit: () => void confirm(),
          onCancel: () => setStepUp(null),
        }
      }
      signOutOthers={others}
      onSignOutOthers={async () => {
        setOthers("busy");
        try {
          await revokeOtherSessions();
          setOthers("done");
        } catch {
          setOthers("failed");
        }
      }}
    />
  );
}

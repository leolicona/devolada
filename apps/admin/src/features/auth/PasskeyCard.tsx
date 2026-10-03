import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeysCard, type KeysCardKey, type KeysCardProps, type KeysCardStepUp } from "@devolada/ui";
import { canVerifyPerson } from "@/lib/auth-client";
import { baGet, baPost } from "@/lib/api";
import { accessProblem, activateKey } from "./keys";
import { revokeOtherSessions, sendCode, setActiveBusiness, signInWithCode, useSession, useUser } from "./session";

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
   - The fresh session keeps the business the person was working in
     (adversarial review, 2026-10-02). Better Auth gives a new session an
     active business only when the person has exactly one (the session
     hook in apps/api/src/auth/better.ts); with several, the panel's next
     request would answer NO_ACTIVE_BUSINESS and drop them on "Elige un
     negocio", every open tab with it, for adding a key.
   - D11: "Cerrar sesión en los demás dispositivos" is Better Auth's own
     `revoke-other-sessions`. With no password there is no reset to end the
     other sessions (better-auth D17's guarantee, kept). */

export function PasskeyCard() {
  const queryClient = useQueryClient();
  const user = useUser();
  const actor = useSession();
  const [canActivate, setCanActivate] = useState(false);
  const [activation, setActivation] = useState<KeysCardProps["activation"]>("idle");
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
      /* The step-up opens once its código is on its way, never before: a
         send that fails says why beside "Activar", which asks again
         (adversarial review, 2026-10-02). The button holds as "Enviando el
         código…" meanwhile — the ceremony is over, so nothing on the device
         is waiting — and a second press cannot meet the stale session. */
      setActivation("sending");
      try {
        await sendCode(email);
      } catch (e) {
        setActivation(accessProblem(e) === "tooMany" ? "tooMany" : "notSent");
        return;
      }
      setActivation("idle");
      setStepUp({ code: "", busy: false, error: null });
      return;
    }
    /* FR-030: one line, and no password to fall back on */
    setActivation("failed");
  }

  async function confirm() {
    if (!stepUp || stepUp.code.length < 6) return;
    /* Read before the código replaces the session. With one business the
       new session is born with it (better.ts's session hook), and the
       ceremony waits for no extra request. */
    const business = actor.data && actor.data.businesses.length > 1 ? actor.data.orgId : null;
    setStepUp({ ...stepUp, busy: true, error: null });
    try {
      await signInWithCode(email, stepUp.code);
    } catch (e) {
      /* Only a refused código is a wrong one; anything else keeps it for
         "Confirmar" to try again (adversarial review, 2026-10-02) */
      const problem = accessProblem(e);
      setStepUp({ ...stepUp, busy: false, error: problem === "tooMany" ? "tooMany" : problem === "code" ? "invalid" : "failed" });
      return;
    }
    /* The session the código opened is the browser's now; it gets the
       business back before the ceremony, while the step-up still says
       "Confirmando…": closed earlier, the card would offer an enabled
       "Activar" for that round trip, and a press there would run a second
       ceremony beside the first (adversarial review, 2026-10-02). Closing
       it here lands in the same render as activate()'s "busy". A switch
       that fails leaves only the business to pick again, so it never
       costs the person the key. */
    if (business) await setActiveBusiness(business).catch(() => {});
    setStepUp(null);
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
          /* "Listo. Este dispositivo ya puede entrar…" may have named the
             key just removed, so it gives way to "Activar" again; on a
             device that still holds a key, "Activar" answers "Listo." once
             more (adversarial review, 2026-10-02) */
          setActivation((now) => (now === "done" ? "idle" : now));
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

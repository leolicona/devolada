import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeysCard, type KeysCardKey, type KeysCardProps, type KeysCardStepUp } from "@devolada/ui";
import { canVerifyPerson } from "@/lib/auth-client";
import { baGet, baPost } from "@/lib/api";
import { useWide } from "@/lib/wide";
import { accessProblem, activateKey } from "./keys";
import { confirmStepUpCode, revokeOtherSessions, sendStepUpCode, useSession } from "./session";

/* cash-at-stores FR-010: *huella o rostro*, offered in *Caja*, never forced
   (passwordless-access D8, D11, D12; FR-036). The card itself is the shared
   `KeysCard` atom, as the panel's Seguridad renders it; this container
   keeps the Better Auth calls.

   - The list is here now. cash-at-stores D26 left it out ("one
     shopkeeper, one phone"); without a password, the list, its "Quitar"
     and "Cerrar sesión en los demás dispositivos" are how a lost phone is
     shut out (FR-036). So the card shows on every device; only the
     activation needs one that can verify the person (D7).
   - The list and "Quitar" are plain fetches, not the Better Auth client: it
     is for the WebAuthn ceremonies alone (lib/auth-client.ts), and its
     Request wrapper does not survive MSW.
   - D8: a key outlives every session, so adding one asks for a session
     younger than a day (Better Auth's `freshAge`, measured 2026-10-02, M2).
     An older session meets SESSION_NOT_FRESH, and the card asks for a
     código at the store account's own address (`/auth/me`'s `email`): it
     opens a fresh session, then the ceremony runs again in the same click.
     A browser that will not run a ceremony that late after the click
     answers like a cancel, and "Activar" — on a fresh session now — works
     at the next press.
   - D11: "Cerrar sesión en los demás dispositivos" is Better Auth's own
     `revoke-other-sessions`. It needs no fresh session: a shopkeeper who
     lost the phone should not need a código to shut it out.
   - The store app aims with a thumb: 48 px controls at full width, where
     the panel's are 40 px (contracts/store-access.md § /caja). */
export function PasskeyCard() {
  const queryClient = useQueryClient();
  const session = useSession();
  /* cash-at-stores D32: on a computer at the counter the device is not a phone */
  const deviceWord = useWide() ? "esta computadora" : "este teléfono";
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
  const email = session.data?.email ?? "";

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
         send that fails — a lost signal above all, at a counter — says why
         beside "Activar", which asks again (adversarial review,
         2026-10-02). The button holds as "Enviando el código…" meanwhile:
         the ceremony is over, so "Esperando a tu teléfono…" would have the
         shopkeeper watch a phone that asks for nothing, for as long as a
         weak signal keeps the send open. A second press cannot meet the
         stale session. */
      setActivation("sending");
      try {
        await sendStepUpCode(email);
      } catch (e) {
        const problem = accessProblem(e);
        setActivation(problem === "tooMany" || problem === "offline" ? problem : "notSent");
        return;
      }
      setActivation("idle");
      setStepUp({ code: "", busy: false, error: null });
      return;
    }
    /* FR-035: one line, and no password to fall back on */
    setActivation("failed");
  }

  async function confirm() {
    if (!stepUp || stepUp.code.length < 6) return;
    setStepUp({ ...stepUp, busy: true, error: null });
    try {
      await confirmStepUpCode(email, stepUp.code);
    } catch (e) {
      /* Only a refused código is a wrong one. A lost signal is said as
         such (cash-at-stores T074), and it and anything else keep the
         código for "Confirmar" to try again (adversarial review,
         2026-10-02) */
      const problem = accessProblem(e);
      setStepUp({
        ...stepUp,
        busy: false,
        error: problem === "code" ? "invalid" : problem === "other" ? "failed" : problem,
      });
      return;
    }
    setStepUp(null);
    await activate();
  }

  return (
    <KeysCard
      size="standard"
      keys={passkeys.data}
      loading={passkeys.isPending}
      deviceWord={deviceWord}
      canActivate={canActivate}
      activation={activation}
      onActivate={() => void activate()}
      onRemove={async (id) => {
        setRemoveFailed(false);
        try {
          await baPost("/auth/passkey/delete-passkey", { id });
          /* "Listo. Este teléfono ya puede entrar…" may have named the key
             just removed, so it gives way to "Activar" again; on a phone
             that still holds a key, "Activar" answers "Listo." once more
             (adversarial review, 2026-10-02) */
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

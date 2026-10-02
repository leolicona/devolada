import { useState } from "react";
import { Button, CodeInput, Pending } from "@devolada/ui";
import { FieldError } from "./AccessLayout";
import { accessProblem, CODE_REFUSED, OFFLINE, sendProblemLine, TOO_MANY } from "./keys";

/* The código step both of the store app's doors end in (passwordless-access
   D10, D12): the invitation and the sign-in by phone. The panel's recipe
   (apps/admin/src/features/auth/CodeStep.tsx) in the store's words: six
   digits in the shared `CodeInput`, "Entrar" waiting for them, the resend
   that says it resent, and the way back to the address or the phone. The
   store app keeps its words while it waits — the breath says it is
   working (the design canvas) — so no label changes inside a button.

   The address, the phone and what to do with the código stay with the
   screen; `onSubmit` handles the answers that leave this step (EMAIL_TAKEN,
   INVALID_INVITATION, STORE_SUSPENDED) and throws the rest here. */
export function CodeStep({
  onSubmit,
  onResend,
  other,
}: {
  onSubmit: (code: string) => Promise<void>;
  onResend: () => Promise<unknown>;
  other: { label: "Usar otro correo" | "Usar otro teléfono"; onClick: () => void };
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);

  async function submit() {
    if (code.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(code);
    } catch (e) {
      const problem = accessProblem(e);
      setError(
        problem === "tooMany"
          ? TOO_MANY
          : problem === "code"
            ? CODE_REFUSED
            : problem === "offline"
              ? OFFLINE
              : "No pudimos revisar el código. Intenta de nuevo.",
      );
      setBusy(false);
    }
  }

  async function resend() {
    /* The label flips at once (the design canvas): a resend that says
       nothing looks like a button that did nothing */
    setResent(true);
    setResending(true);
    setError(null);
    try {
      await onResend();
    } catch (e) {
      setResent(false);
      setError(sendProblemLine(e));
    } finally {
      setResending(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4"
      noValidate
    >
      <CodeInput
        id="code"
        autoFocus
        value={code}
        onChange={setCode}
        invalid={error === CODE_REFUSED}
        aria-describedby={error ? "code-error" : undefined}
      />
      <FieldError id="code-error">{error}</FieldError>
      <Pending active={busy} label="Verificando el código">
        <Button type="submit" className="w-full" disabled={busy || code.length < 6}>
          Entrar
        </Button>
      </Pending>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <Pending active={resending} label="Reenviando el código" className="inline-block">
          {/* T083 (constitution VI): a link button keeps a 48px target */}
          <Button variant="link" className="min-h-12" disabled={resending} onClick={() => void resend()}>
            {resent ? "Código reenviado" : "Reenviar código"}
          </Button>
        </Pending>
        <Button variant="link" className="min-h-12" onClick={other.onClick}>
          {other.label}
        </Button>
      </div>
    </form>
  );
}

/* The separator between the key and the código (the design canvas): a rule
   on each side, the words in the middle */
export function OrWithCode() {
  return (
    <p className="flex items-center gap-3 text-sm text-ink-soft before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
      o con un código
    </p>
  );
}

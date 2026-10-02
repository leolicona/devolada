import { Alert, Button, CodeInput, Pending } from "@devolada/ui";
import { useState } from "react";
import { accessProblem, CODE_REFUSED, TOO_MANY } from "./keys";

/* The código step every door of the panel ends in (passwordless-access
   D6): registration, sign-in, the invitation and — inside Seguridad's
   card — the step-up. Six digits, the decisive button waiting for them,
   the resend that says it resent, and the way back to the address where
   there is one to change (contracts/panel-access.md § /login, step 2).

   The address and what to do with the código stay with the screen; this
   holds only the digits and the words for what went wrong. */
export function CodeStep({
  purpose,
  onSubmit,
  onResend,
  onOtherEmail,
}: {
  /* What the código does here: open a new account ("Crear cuenta") or an
     existing one ("Entrar"). The words for both live inside the Pending
     below, where pending-lint can see them. */
  purpose: "create" | "enter";
  onSubmit: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  /* Absent where the address is not the person's to change (an invitation) */
  onOtherEmail?: () => void;
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
      setError(problem === "tooMany" ? TOO_MANY : problem === "code" ? CODE_REFUSED : "No pudimos revisar el código. Intenta de nuevo.");
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
      setError(accessProblem(e) === "tooMany" ? TOO_MANY : "No pudimos reenviar el código. Intenta de nuevo.");
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
      <CodeInput id="code" autoFocus value={code} onChange={setCode} invalid={error === CODE_REFUSED} />
      {error && <Alert variant="destructive">{error}</Alert>}
      <Pending active={busy} label={purpose === "create" ? "Creando tu cuenta." : "Entrando a tu cuenta."}>
        <Button type="submit" size="standard" className="w-full" disabled={busy || code.length < 6}>
          {purpose === "create" ? (busy ? "Creando…" : "Crear cuenta") : busy ? "Entrando…" : "Entrar"}
        </Button>
      </Pending>
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
        <Pending active={resending} label="Reenviando el código." className="inline-block">
          <Button size="standard" variant="link" disabled={resending} onClick={() => void resend()}>
            {resent ? "Código reenviado" : "Reenviar código"}
          </Button>
        </Pending>
        {onOtherEmail && (
          <Button size="standard" variant="link" onClick={onOtherEmail}>
            Usar otro correo
          </Button>
        )}
      </div>
    </form>
  );
}

/* The separator between the key and the código (the design canvas): a
   rule on each side, the words in the middle */
export function OrWithCode() {
  return (
    <p className="flex items-center gap-3 text-sm text-ink-soft before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
      o con un código
    </p>
  );
}

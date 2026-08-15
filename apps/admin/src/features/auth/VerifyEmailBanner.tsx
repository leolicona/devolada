import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MailWarning } from "lucide-react";
import { Alert } from "@devolada/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendVerificationCode, verifyEmailCode } from "./session";

/* Verification banner (better-auth.spec.md UI contract): the código is
   typed right here, where it was asked — never a link (D4). Verification
   gates store registration, not the session. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [resent, setResent] = useState(false);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      await verifyEmailCode(email, code);
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Alert variant="warning" className="m-4 space-y-3 lg:mx-8 lg:mt-6">
      <span className="flex items-center gap-2">
        <MailWarning className="size-4 shrink-0" aria-hidden />
        Confirma tu correo para poder registrar tiendas: escribe el código que enviamos a {email}.
      </span>
      <form onSubmit={confirm} className="flex flex-wrap items-end gap-3" noValidate>
        <div>
          <Label htmlFor="verify-code">Código</Label>
          <Input
            id="verify-code"
            className="w-32"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <Button type="submit" disabled={busy || code.length < 6}>
          {busy ? "Confirmando…" : "Confirmar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setResent(true);
            void sendVerificationCode(email).catch(() => {});
          }}
        >
          {resent ? "Código reenviado" : "Reenviar código"}
        </Button>
      </form>
      {error && (
        <span role="alert" className="block text-sm">
          El código no es válido o ya venció. Reenvíalo e intenta otra vez.
        </span>
      )}
    </Alert>
  );
}

import { useState } from "react";
import { Fingerprint, LogIn } from "lucide-react";
import { Alert, Button, Field, Input } from "@devolada/ui";
import { login } from "./session";
import { authClient, passkeysSupported } from "./auth-client";

/* Standalone so it stays testable without the router (US-S01).
   Generic error copy: no account-existence hints (sessions spec D3). */
export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(phone, password);
      onSuccess();
    } catch {
      /* A suspended store completes the sign-in; the shell's /auth/me
         answers 403 one request later and shows the suspended screen
         (better-auth.spec.md D5). Here only credentials can fail. */
      setError("Teléfono o contraseña incorrectos");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field label="Teléfono">
        <Input
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="10 dígitos"
        />
      </Field>
      <Field label="Contraseña">
        <Input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {error && <Alert variant="destructive">{error}</Alert>}
      <Button type="submit" disabled={busy} className="w-full">
        <LogIn className="size-5" aria-hidden />
        {busy ? "Entrando…" : "Entrar"}
      </Button>
      {/* US-S07: one-touch sign-in on devices with an enrolled passkey */}
      {passkeysSupported() && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={async () => {
            const { error: passkeyError } = await authClient.signIn.passkey();
            if (passkeyError) {
              setError("No pudimos usar tu huella o rostro. Entra con tu contraseña.");
              return;
            }
            onSuccess();
          }}
        >
          <Fingerprint className="size-5" aria-hidden />
          Entrar con huella o rostro
        </Button>
      )}
    </form>
  );
}

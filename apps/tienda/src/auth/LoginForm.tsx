import { useState } from "react";
import { LogIn } from "lucide-react";
import { Button, Field, Input } from "@devolada/ui";
import { ApiError } from "../api/client";
import { login } from "./session";

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
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "ACCOUNT_SUSPENDED"
          ? "Esta cuenta está suspendida. Contacta a tu ISP."
          : "Teléfono o contraseña incorrectos",
      );
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
      {error && (
        <p role="alert" className="rounded-sm border border-error-line bg-error-soft px-4 py-3 text-sm font-medium text-error">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="w-full">
        <LogIn className="size-5" aria-hidden />
        {busy ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}

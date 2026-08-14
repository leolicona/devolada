import { useState } from "react";
import { LogIn } from "lucide-react";
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
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-ink-soft">Teléfono</span>
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="h-12 w-full rounded-sm border border-line bg-well px-4 text-base text-ink placeholder:text-ink-faint focus:border-focus"
          placeholder="10 dígitos"
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-ink-soft">Contraseña</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12 w-full rounded-sm border border-line bg-well px-4 text-base text-ink focus:border-focus"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-sm border border-error-line bg-error-soft px-4 py-3 text-sm font-medium text-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent text-base font-semibold text-ink-inverse transition-colors duration-150 hover:bg-accent-hover active:bg-accent-active disabled:bg-well disabled:text-ink-faint"
      >
        <LogIn className="size-5" aria-hidden />
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

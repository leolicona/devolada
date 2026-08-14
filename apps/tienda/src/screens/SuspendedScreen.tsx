import { WifiOff } from "lucide-react";

/* Full-screen takeover (spec D4): can appear mid-shift, offers no
   navigation escape. Copy is plain es-MX. */
export function SuspendedScreen() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-surface px-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-full border border-error-line bg-error-soft">
        <WifiOff className="size-8 text-error" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">Cuenta suspendida</h1>
      <p className="max-w-sm text-base text-ink-soft">
        Tu punto de cobro está suspendido y no puedes recibir pagos por ahora. Comunícate con tu
        ISP para reactivarlo.
      </p>
    </main>
  );
}

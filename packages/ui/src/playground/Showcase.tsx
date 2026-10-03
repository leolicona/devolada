import { useEffect, useState, type ComponentType } from "react";
import { Monitor, Moon, Search, Sun } from "lucide-react";
import { Button } from "../components/button";
import { Field, Input } from "../components/input";
import { AmountBreakdown, StatusBadge, Amount, Pending, Reveal, type Status } from "../index";
import { Alert } from "../components/alert";

/* Living catalog of tokens and shared atoms. Visible strings are real
   product copy and therefore stay in es-MX. */

type Theme = "light" | "dark" | "system";

function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("devolada-theme") as Theme) ?? "system",
  );
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
      localStorage.removeItem("devolada-theme");
    } else {
      root.dataset.theme = theme;
      localStorage.setItem("devolada-theme", theme);
    }
  }, [theme]);
  return { theme, setTheme };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-6 pb-12">
      <h2 className="mb-6 text-xs font-semibold tracking-[0.06em] uppercase text-ink-faint">
        {title}
      </h2>
      {children}
    </section>
  );
}

const typeRamp = [
  { token: "xs", px: "12", cls: "text-xs", text: "Hace 5 min · Folio DV-000184" },
  { token: "sm", px: "14", cls: "text-sm", text: "Col. El Mirador · Servicio suspendido" },
  { token: "base", px: "16", cls: "text-base", text: "María Guadalupe Hernández" },
  { token: "md", px: "18", cls: "text-md", text: "Confirma el nombre con el cliente" },
  { token: "lg", px: "20", cls: "text-lg", text: "Movimientos de hoy" },
  { token: "xl", px: "24", cls: "text-xl", text: "Caja" },
  { token: "2xl", px: "30", cls: "text-2xl font-semibold", text: "$4,820.00" },
  { token: "3xl", px: "38", cls: "text-3xl font-semibold", text: "$3,215.00" },
];

const sampleStatuses: Status[] = [
  "reconnected",
  "queued",
  "failed",
  "pending",
  "confirmed",
  "disputed",
  "active",
  "suspended",
  "channelPanel",
  "channelApi",
  "credentialActive",
  "credentialRevoked",
  /* cobros-in-links D15: a search result's debt when it is not an amount */
  "debtNone",
  "debtUnconfirmed",
  /* payment-method-per-channel D8: one of Devolada's payment methods in
     the business's WispHub */
  "methodFound",
  "methodMissing",
  "methodDuplicate",
];

const ledgerEntries = [
  {
    title: "Cobro · María G. Hernández",
    meta: "14:32 · Folio DV-000184",
    cents: 41500,
    cls: "text-success",
  },
  {
    title: "Cargo por servicio",
    meta: "14:32 · Sobre folio DV-000184",
    cents: -900,
    cls: "text-ink-soft",
  },
  {
    title: "Entrega al ISP",
    meta: "Ayer · Pendiente de confirmar",
    cents: -320000,
    cls: "text-ink",
  },
];

/* design-foundations US1. The two feedback states side by side, driven by a
   real toggle rather than a still frame: the breath only means anything in
   motion, and the reveal only means anything on arrival.

   Toggle the OS "reduce motion" setting with this open — the breath must keep
   running (opacity is not a vestibular trigger) while nothing on the page
   translates, scales or rotates. */
function FeedbackDemo() {
  const [waiting, setWaiting] = useState(true);

  return (
    <div className="space-y-4">
      <Button variant="secondary" onClick={() => setWaiting((w) => !w)}>
        {waiting ? "Que llegue la respuesta" : "Volver a esperar"}
      </Button>

      <Pending active={waiting} label="Estamos verificando tu transferencia.">
        <div className="rounded-md border border-line bg-card p-4">
          <StatusBadge status="validating" size="standard" />
          <p className="mt-3 text-sm text-ink-soft">
            Estamos verificando tu transferencia. Esto puede tomar unos minutos; puedes dejar esta
            página abierta.
          </p>
        </div>
      </Pending>

      {!waiting && (
        <Reveal>
          <Alert variant="success" layout="icon">
            Tu pago fue registrado. Tu servicio ya está activo.
          </Alert>
        </Reveal>
      )}
    </div>
  );
}

export function Showcase() {
  const { theme, setTheme } = useTheme();

  const options: { value: Theme; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { value: "light", label: "Claro", icon: Sun },
    { value: "dark", label: "Oscuro", icon: Moon },
    { value: "system", label: "Sistema", icon: Monitor },
  ];

  return (
    <main className="mx-auto max-w-3xl px-6 pb-24">
      {/* Header */}
      <header className="flex items-center justify-between py-8">
        <div>
          <p className="text-lg font-semibold tracking-tight">Devolada</p>
          <p className="text-sm text-ink-soft">Tokens vivos · Funcionalista con acento cálido</p>
        </div>
        <div
          role="group"
          aria-label="Tema"
          className="flex rounded-md border border-line bg-card p-0.5"
        >
          {options.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
              className={`flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm font-medium transition-colors ${
                theme === value
                  ? "bg-accent-soft text-link"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Hero amount */}
      <Section title="Monto — lo que el tendero dicta en voz alta">
        <div className="rounded-md border border-line bg-card p-8">
          <p className="text-sm text-ink-soft">Total a cobrar</p>
          <Amount
            cents={41500}
            className="mt-1 block font-semibold tracking-tight text-amount leading-[1.15]"
          />
          <AmountBreakdown
            className="mt-6 border-t border-line-soft pt-4"
            lines={[
              { label: "Cargo del periodo", cents: 40000 },
              { label: "Cargo por servicio", cents: 1500 },
            ]}
          />
        </div>
      </Section>

      {/* Buttons */}
      <Section title="Botones — 64px el crítico, 48px el estándar">
        <div className="space-y-4">
          <Button size="decisive">Cobrar $415.00</Button>
          <div className="flex flex-wrap gap-3">
            <Button>Registrar entrega</Button>
            <Button variant="secondary">Ver movimientos</Button>
            <Button disabled>Cobrar (techo alcanzado)</Button>
          </div>
        </div>
      </Section>

      {/* Status badges */}
      <Section title="Estados — color + ícono + texto, nunca color solo">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {sampleStatuses.map((status) => (
              <StatusBadge key={status} status={status} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <StatusBadge status="reconnected" size="standard" />
            <StatusBadge status="queued" size="standard" />
          </div>
        </div>
      </Section>

      {/* Search field */}
      <Section title="Campos — el buscador es la pantalla inicial">
        <Field label="Buscar cliente">
          <Input icon={Search} type="search" placeholder="ID, teléfono o nombre" />
        </Field>
      </Section>

      {/* Ledger */}
      <Section title="Movimientos — el ledger es la verdad">
        <ul className="divide-y divide-line-soft rounded-md border border-line bg-card">
          {ledgerEntries.map((entry) => (
            <li key={entry.title} className="flex items-baseline justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="truncate text-base font-medium">{entry.title}</p>
                <p className="mt-0.5 text-sm text-ink-faint">{entry.meta}</p>
              </div>
              <Amount
                cents={entry.cents}
                sign
                className={`shrink-0 text-base font-semibold ${entry.cls}`}
              />
            </li>
          ))}
        </ul>
      </Section>

      {/* Type ramp */}
      <Section title="Tipografía — Archivo, escala estricta, números tabulares">
        <ul className="space-y-4">
          {typeRamp.map((row) => (
            <li key={row.token} className="flex items-baseline gap-6">
              <span className="w-16 shrink-0 font-mono text-xs text-ink-faint">
                {row.token} · {row.px}
              </span>
              <span className={`truncate tabular-nums ${row.cls}`}>{row.text}</span>
            </li>
          ))}
          <li className="flex items-baseline gap-6">
            <span className="w-16 shrink-0 font-mono text-xs text-ink-faint">mono</span>
            <span className="font-mono text-base">DV-000184 · wh_live_9f2c…</span>
          </li>
        </ul>
      </Section>

      {/* Palette */}
      <Section title="Color — la calidez vive en los neutros">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { name: "surface", cls: "bg-surface border-line" },
            { name: "card", cls: "bg-card border-line" },
            { name: "well", cls: "bg-well border-line" },
            { name: "accent", cls: "bg-accent border-transparent" },
            { name: "success", cls: "bg-success-soft border-success-line" },
            { name: "warning", cls: "bg-warning-soft border-warning-line" },
            { name: "error", cls: "bg-error-soft border-error-line" },
            { name: "inverse", cls: "bg-inverse border-transparent" },
          ].map((c) => (
            <div key={c.name}>
              <div className={`h-16 rounded-md border ${c.cls}`} />
              <p className="mt-1.5 font-mono text-xs text-ink-faint">{c.name}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Espera y desenlace">
        <FeedbackDemo />
      </Section>

      <footer className="border-t border-line pt-6 text-sm text-ink-soft">
        Claro y oscuro comparten tokens; el oscuro es carbón cálido, no inversión.
      </footer>
    </main>
  );
}

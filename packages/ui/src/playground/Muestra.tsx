import { useEffect, useState, type ComponentType } from "react";
import { Monitor, Moon, Search, Sun } from "lucide-react";
import { DesgloseMonto, EstadoBadge, Monto, type Estado } from "../index";

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

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-6 pb-12">
      <h2 className="mb-6 text-xs font-semibold tracking-[0.06em] uppercase text-ink-faint">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

const rampa = [
  { token: "xs", px: "12", clase: "text-xs", texto: "Hace 5 min · Folio DV-000184" },
  { token: "sm", px: "14", clase: "text-sm", texto: "Col. El Mirador · Servicio suspendido" },
  { token: "base", px: "16", clase: "text-base", texto: "María Guadalupe Hernández" },
  { token: "md", px: "18", clase: "text-md", texto: "Confirma el nombre con el cliente" },
  { token: "lg", px: "20", clase: "text-lg", texto: "Movimientos de hoy" },
  { token: "xl", px: "24", clase: "text-xl", texto: "Caja" },
  { token: "2xl", px: "30", clase: "text-2xl font-semibold", texto: "$4,820.00" },
  { token: "3xl", px: "38", clase: "text-3xl font-semibold", texto: "$3,215.00" },
];

const estadosMuestra: Estado[] = [
  "reconectado",
  "en_cola",
  "fallido",
  "pendiente",
  "confirmada",
  "en_disputa",
  "activo",
  "suspendido",
];

const movimientos = [
  {
    titulo: "Cobro · María G. Hernández",
    meta: "14:32 · Folio DV-000184",
    centavos: 41500,
    clase: "text-success",
  },
  {
    titulo: "Comisión de la tienda",
    meta: "14:32 · Sobre folio DV-000184",
    centavos: -900,
    clase: "text-ink-soft",
  },
  {
    titulo: "Entrega al ISP",
    meta: "Ayer · Pendiente de confirmar",
    centavos: -320000,
    clase: "text-ink",
  },
];

export function Muestra() {
  const { theme, setTheme } = useTheme();

  const opciones: { valor: Theme; etiqueta: string; icono: ComponentType<{ className?: string }> }[] = [
    { valor: "light", etiqueta: "Claro", icono: Sun },
    { valor: "dark", etiqueta: "Oscuro", icono: Moon },
    { valor: "system", etiqueta: "Sistema", icono: Monitor },
  ];

  return (
    <main className="mx-auto max-w-3xl px-6 pb-24">
      {/* Encabezado */}
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
          {opciones.map(({ valor, etiqueta, icono: Icono }) => (
            <button
              key={valor}
              type="button"
              onClick={() => setTheme(valor)}
              aria-pressed={theme === valor}
              className={`flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm font-medium transition-colors duration-150 ${
                theme === valor
                  ? "bg-accent-soft text-link"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              <Icono className="size-4" aria-hidden />
              {etiqueta}
            </button>
          ))}
        </div>
      </header>

      {/* Monto protagonista */}
      <Seccion titulo="Monto — lo que el tendero dicta en voz alta">
        <div className="rounded-md border border-line bg-card p-8">
          <p className="text-sm text-ink-soft">Total a cobrar</p>
          <Monto
            centavos={41500}
            className="mt-1 block font-semibold tracking-tight text-amount leading-[1.15]"
          />
          <DesgloseMonto
            className="mt-6 border-t border-line-soft pt-4"
            lineas={[
              { etiqueta: "Mensualidad", centavos: 40000 },
              { etiqueta: "Cargo por servicio", centavos: 1500 },
            ]}
          />
        </div>
      </Seccion>

      {/* Botones */}
      <Seccion titulo="Botones — 64px el crítico, 48px el estándar">
        <div className="space-y-4">
          <button
            type="button"
            className="h-16 w-full rounded-md bg-accent text-md font-semibold text-ink-inverse transition-colors duration-150 hover:bg-accent-hover active:bg-accent-active"
          >
            Cobrar $415.00
          </button>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="h-12 rounded-md bg-accent px-6 text-base font-medium text-ink-inverse transition-colors duration-150 hover:bg-accent-hover active:bg-accent-active"
            >
              Registrar entrega
            </button>
            <button
              type="button"
              className="h-12 rounded-md border border-line bg-card px-6 text-base font-medium text-ink transition-colors duration-150 hover:bg-well"
            >
              Ver movimientos
            </button>
            <button
              type="button"
              disabled
              className="h-12 rounded-md bg-well px-6 text-base font-medium text-ink-faint"
            >
              Cobrar (techo alcanzado)
            </button>
          </div>
        </div>
      </Seccion>

      {/* Badges de estado */}
      <Seccion titulo="Estados — color + ícono + texto, nunca color solo">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {estadosMuestra.map((estado) => (
              <EstadoBadge key={estado} estado={estado} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <EstadoBadge estado="reconectado" tamano="md" />
            <EstadoBadge estado="en_cola" tamano="md" />
          </div>
        </div>
      </Seccion>

      {/* Campo de búsqueda */}
      <Seccion titulo="Campos — el buscador es la pantalla inicial">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-ink-soft">
            Buscar cliente
          </span>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-faint"
              aria-hidden
            />
            <input
              type="search"
              placeholder="ID, teléfono o nombre"
              className="h-12 w-full rounded-sm border border-line bg-well pl-12 pr-4 text-base text-ink placeholder:text-ink-faint focus:border-focus"
            />
          </div>
        </label>
      </Seccion>

      {/* Ledger */}
      <Seccion titulo="Movimientos — el ledger es la verdad">
        <ul className="divide-y divide-line-soft rounded-md border border-line bg-card">
          {movimientos.map((m) => (
            <li key={m.titulo} className="flex items-baseline justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="truncate text-base font-medium">{m.titulo}</p>
                <p className="mt-0.5 text-sm text-ink-faint">{m.meta}</p>
              </div>
              <Monto
                centavos={m.centavos}
                signo
                className={`shrink-0 text-base font-semibold ${m.clase}`}
              />
            </li>
          ))}
        </ul>
      </Seccion>

      {/* Rampa tipográfica */}
      <Seccion titulo="Tipografía — Archivo, escala estricta, números tabulares">
        <ul className="space-y-4">
          {rampa.map((fila) => (
            <li key={fila.token} className="flex items-baseline gap-6">
              <span className="w-16 shrink-0 font-mono text-xs text-ink-faint">
                {fila.token} · {fila.px}
              </span>
              <span className={`truncate tabular-nums ${fila.clase}`}>{fila.texto}</span>
            </li>
          ))}
          <li className="flex items-baseline gap-6">
            <span className="w-16 shrink-0 font-mono text-xs text-ink-faint">mono</span>
            <span className="font-mono text-base">DV-000184 · wh_live_9f2c…</span>
          </li>
        </ul>
      </Seccion>

      {/* Paleta */}
      <Seccion titulo="Color — la calidez vive en los neutros">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { nombre: "surface", clase: "bg-surface border-line" },
            { nombre: "card", clase: "bg-card border-line" },
            { nombre: "well", clase: "bg-well border-line" },
            { nombre: "accent", clase: "bg-accent border-transparent" },
            { nombre: "success", clase: "bg-success-soft border-success-line" },
            { nombre: "warning", clase: "bg-warning-soft border-warning-line" },
            { nombre: "error", clase: "bg-error-soft border-error-line" },
            { nombre: "inverse", clase: "bg-inverse border-transparent" },
          ].map((c) => (
            <div key={c.nombre}>
              <div className={`h-16 rounded-md border ${c.clase}`} />
              <p className="mt-1.5 font-mono text-xs text-ink-faint">{c.nombre}</p>
            </div>
          ))}
        </div>
      </Seccion>

      <footer className="border-t border-line pt-6 text-sm text-ink-soft">
        Claro y oscuro comparten tokens; el oscuro es carbón cálido, no inversión.
      </footer>
    </main>
  );
}

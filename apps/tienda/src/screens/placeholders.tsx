import { Search } from "lucide-react";

/* Placeholders state their pending feature honestly (spec contract). */

function Pending({ feature }: { feature: string }) {
  return (
    <p className="mx-6 mt-6 rounded-md border border-line bg-well px-4 py-3 text-sm text-ink-soft">
      {feature} llega con la siguiente tarea del plan.
    </p>
  );
}

export function ChargeHome() {
  return (
    <main className="px-6 pt-8">
      <h1 className="text-xl font-semibold">Cobrar</h1>
      <label className="mt-5 block">
        <span className="sr-only">Buscar cliente</span>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <input
            type="search"
            disabled
            placeholder="ID, teléfono o nombre"
            className="h-12 w-full rounded-sm border border-line bg-well pl-12 pr-4 text-base text-ink placeholder:text-ink-faint"
          />
        </div>
      </label>
      <Pending feature="La búsqueda de clientes" />
    </main>
  );
}

export function CashboxScreen() {
  return (
    <main className="px-6 pt-8">
      <h1 className="text-xl font-semibold">Caja</h1>
      <Pending feature="El balance de tu caja" />
    </main>
  );
}

export function LedgerScreen() {
  return (
    <main className="px-6 pt-8">
      <h1 className="text-xl font-semibold">Movimientos</h1>
      <Pending feature="Tu historial de movimientos" />
    </main>
  );
}

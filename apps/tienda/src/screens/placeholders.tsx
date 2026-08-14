import { Search } from "lucide-react";
import { Input } from "@devolada/ui";

/* Placeholders state their pending feature honestly (spec contract). */

function Pending({ feature }: { feature: string }) {
  return (
    <p className="mt-6 rounded-md border border-line bg-well px-4 py-3 text-sm text-ink-soft">
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
        <Input icon={Search} type="search" disabled placeholder="ID, teléfono o nombre" />
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

/* Placeholders state their pending feature honestly (spec contract). */

function Pending({ feature }: { feature: string }) {
  return (
    <p className="mt-6 rounded-md border border-line bg-well px-4 py-3 text-sm text-ink-soft">
      {feature} llega con la siguiente tarea del plan.
    </p>
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

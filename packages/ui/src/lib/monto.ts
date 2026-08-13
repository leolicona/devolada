/* El dinero se maneja siempre en centavos enteros; los floats no tocan montos. */

const formatoMXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  currencyDisplay: "narrowSymbol",
});

export function formatearMonto(centavos: number, opciones?: { signo?: boolean }): string {
  const monto = formatoMXN.format(Math.abs(centavos) / 100);
  if (!opciones?.signo) return formatoMXN.format(centavos / 100);
  if (centavos === 0) return monto;
  return centavos > 0 ? `+${monto}` : `−${monto}`;
}

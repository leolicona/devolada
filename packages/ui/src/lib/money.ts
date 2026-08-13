/* Money is always integer cents; floats never touch amounts. */

const mxnFormat = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  currencyDisplay: "narrowSymbol",
});

export function formatMoney(cents: number, options?: { sign?: boolean }): string {
  const amount = mxnFormat.format(Math.abs(cents) / 100);
  if (!options?.sign) return mxnFormat.format(cents / 100);
  if (cents === 0) return amount;
  return cents > 0 ? `+${amount}` : `−${amount}`;
}

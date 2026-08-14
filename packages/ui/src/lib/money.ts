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

/* Parses user input in pesos ("405", "405.5", "$1,234.00") to integer
   cents. Returns null when the text is not a valid amount. No floats. */
export function parseMoney(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const pesos = Number.parseInt(match[1], 10);
  const cents = Number.parseInt((match[2] ?? "0").padEnd(2, "0"), 10);
  return pesos * 100 + cents;
}

/* WispHub sends money as string decimals ("499.00").
   We convert to integer cents with string parsing. No floats (money law). */

export function decimalToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`invalid decimal amount: ${value}`);
  const pesos = Number.parseInt(match[1], 10);
  const cents = Number.parseInt((match[2] ?? "0").padEnd(2, "0"), 10);
  return pesos * 100 + cents;
}

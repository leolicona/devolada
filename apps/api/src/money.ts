/* The money law's parsers (constitution II). Providers send money two
   ways, and neither is integer cents. We convert both with string
   parsing. No float arithmetic.

   They live in the core, not in an adapter's folder (constitution IX,
   cobros-in-links D18): the validation engine and every adapter convert
   through them, so they serve the whole product. They were
   `wisphub/money.ts` until 014 moved them, unchanged. */

/* String decimals, as the customer list sends them ("499.00").

   The sign matters: `saldo` is a running balance (debt-truth D7), and a
   negative one is a credit — measured `"-10.00"` after an overpayment.
   Rejecting the minus sign here would throw on exactly the customer the
   credit case exists for. */
export function decimalToCents(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`invalid decimal amount: ${value}`);
  const pesos = Number.parseInt(match[2], 10);
  const cents = Number.parseInt((match[3] ?? "0").padEnd(2, "0"), 10);
  const magnitude = pesos * 100 + cents;
  return match[1] === "-" ? -magnitude : magnitude;
}

/* JSON numbers, as the invoice list sends them (`"total": 100.0`).

   It arrives as a float whether we like it or not, so the only choice is
   where to stop trusting it. `toFixed(2)` renders the two decimals money
   has and hands the rest to the string parser above — `value * 100` would
   put a float multiplication between the provider and the ledger. */
export function amountToCents(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`invalid amount: ${value}`);
  return decimalToCents(value.toFixed(2));
}

/* A provider amount in either shape, for a field a screen shows as
   detail (cobros-in-links D5). The same word arrives both ways: an
   invoice row's `saldo` is a JSON number (measured 2026-09-27, M3:
   `0.0`, and `sub_total` `2.0`), the customer record's `saldo` is a
   string (`"0.00"`). One door takes either and still converts through
   the string parser.

   Unreadable input answers `null` instead of throwing. The row it rides
   on keeps its total, and a detail nobody could read is shown as
   absent, never as zero. A missing field is `null` for the same reason. */
export function providerCents(value: unknown): number | null {
  try {
    if (typeof value === "number") return amountToCents(value);
    if (typeof value === "string") return decimalToCents(value);
  } catch {
    return null;
  }
  return null;
}

/* cash-at-stores D17: the house folio, one format and one guard for every
   channel — the SPEI verdict and the store's record both call it. Moved
   from routes/payments/handler.ts, where it began (charge-record heritage).
   DV- + 6 uppercase base36 chars; the unique `folio` column is the real
   guard, and a collision is not retried (unchanged). */
export function makeFolio(): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of bytes) out += chars[b % 36];
  return `DV-${out}`;
}

/* "Todo está bien", remembered per payment on this device
   (payment-without-receipt D15, FR-028).

   The data check is a question the payer answers once: a payer who looked
   at what is searched and said it is right must not be asked again on the
   next poll, the next reload or the next morning. The answer spends no
   search and changes no row — the next round keeps its slot either way —
   so it lives on the device, beside the step (step.ts) and for the same
   reason: the API has no business hearing it (direct-payment D9, this app
   is session-less). Keyed by the payment, because the next payment's data
   are new data. */

const KEY = "devolada-pago-ask-ack";

/* Enough for every payment a device will ever have open; the oldest go
   first, so the key never grows without bound */
const KEEP = 50;

/* localStorage throws in some privacy modes, and what it holds is data we
   do not control. Anything unreadable means "not acknowledged" — the worst
   case is a payer who is shown the check once more, which is the state the
   page was in before they answered. */
function readAll(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function readAskAck(directPaymentId: string): boolean {
  return readAll().includes(directPaymentId);
}

export function rememberAskAck(directPaymentId: string): void {
  const ids = [...readAll().filter((id) => id !== directPaymentId), directPaymentId].slice(-KEEP);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* Denied or out of quota: the check hides for this visit only */
  }
}

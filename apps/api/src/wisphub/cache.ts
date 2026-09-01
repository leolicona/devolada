import type { PendingInvoices, WispHub } from "./client";

/* Provider caches (provider-latency spec D3, D4, D5).

   The freshness rule lives here in one place, but it is enforced at the
   call sites on purpose: a caller that decides money calls the adapter
   directly, a caller that only renders calls this file. Hiding the
   choice inside the adapter would hide the one thing a reader of the
   charge guard has to be able to see.

   In-isolate on purpose (TD-014): a colo-wide Cache API layer would hit
   more often, and it is the documented upgrade once the miss rate is
   measured rather than guessed. */

/* D3: long enough that a shopkeeper's search → confirm shares one
   fetch, short enough that nobody reasons about staleness for long. */
const PENDING_TTL_MS = 30_000;
/* D5: a catalog lookup, not debt. Ten minutes, not forever — an ISP that
   adds a cash method should not wait for an isolate to recycle. */
const PAYMENT_METHOD_TTL_MS = 10 * 60_000;

type Entry<T> = { value: T; expiresAt: number };

const pendingByBusiness = new Map<string, Entry<PendingInvoices>>();
const paymentMethodByBusiness = new Map<string, Entry<number>>();

function read<T>(store: Map<string, Entry<T>>, key: string, now: Date): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now.getTime()) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

/* The tenant's pending-invoice list, for **display only** (D3).
   Never call this from a path that decides whether money moves — the
   charge guard, the SPEI amount and the re-validation all read the
   adapter directly, and debt-truth.spec.md D1/D5 depend on that. */
export async function pendingInvoicesForDisplay(
  businessId: string,
  wisphub: WispHub,
  now: Date,
): Promise<PendingInvoices> {
  const hit = read(pendingByBusiness, businessId, now);
  if (hit) return hit;
  /* Only a successful answer is cached: a provider failure must not
     become 30 seconds of remembered failure (scenario 10). */
  const fresh = await wisphub.pendingInvoices(now);
  pendingByBusiness.set(businessId, { value: fresh, expiresAt: now.getTime() + PENDING_TTL_MS });
  return fresh;
}

/* D4: a charge just changed the answer this cache holds. Dropping the
   entry is what keeps debt-truth's verified behaviour — charge, search
   again at once, read "al corriente" — true with a cache in the path. */
export function invalidatePendingInvoices(businessId: string): void {
  pendingByBusiness.delete(businessId);
}

/* D5: the cash payment-method id, on the charge path every single time
   and unchanged for the life of a tenant. */
export async function cashPaymentMethodId(
  businessId: string,
  wisphub: WispHub,
  now: Date,
): Promise<number> {
  const hit = read(paymentMethodByBusiness, businessId, now);
  if (hit !== null) return hit;
  const fresh = await wisphub.getCashPaymentMethodId();
  paymentMethodByBusiness.set(businessId, {
    value: fresh,
    expiresAt: now.getTime() + PAYMENT_METHOD_TTL_MS,
  });
  return fresh;
}

/* Tests only: module state outlives a test file's isolate, so a suite
   that counts provider calls has to start from empty. */
export function resetProviderCaches(): void {
  pendingByBusiness.clear();
  paymentMethodByBusiness.clear();
}

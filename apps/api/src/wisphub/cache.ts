import { eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { payments } from "../db/schema";
import type { PendingInvoices, WispHub, WispHubCustomer } from "./client";

/* Provider caches (provider-latency spec D3, D4, D5; presence-freshness
   D6, which paid TD-014).

   The freshness rule lives here in one place, but it is enforced at the
   call sites on purpose: a caller that decides money calls the adapter
   directly, a caller that only renders calls this file. Hiding the
   choice inside the adapter would hide the one thing a reader of the
   charge guard has to be able to see.

   The entries live in the colo's Cache API (`caches.default`), not in
   the isolate: a presence heartbeat per open tab is exactly the load an
   isolate map does not dampen, and every request landing in the same
   city now shares one provider read. Two clocks, on purpose: the Cache
   API's `max-age` evicts, the entry's own `expiresAt` — checked against
   the caller's `now` — decides freshness, so the rule is ours and the
   tests can time-travel.

   `cache.delete` is per data center, so the invalidation of D4 rides
   the KEY instead: the pending-list key carries the tenant's
   `MAX(payment_registered_at)`, the same number `/payments/pulse`
   reports, and a registration in any colo is a new key in every colo. */

/* D3: long enough that a search → confirm shares one fetch, short
   enough that nobody reasons about staleness for long. */
const PENDING_TTL_MS = 30_000;
/* D5: a catalog lookup, not debt. Ten minutes, not forever — an ISP that
   adds a cash method should not wait for an isolate to recycle. */
const PAYMENT_METHOD_TTL_MS = 10 * 60_000;

/* Synthetic origin for the cache keys: the entries are never served,
   only matched by this Worker. presence-freshness DoD carries the
   deployed check that the platform accepts a key off the zone. */
const CACHE_ORIGIN = "https://provider-cache.devolada.internal";

/* Tests only (TESTING.md rule 10): the Cache API cannot be enumerated,
   so "start from empty" is a generation prefix in every key. */
let generation = 0;
export function resetProviderCaches(): void {
  generation++;
}

type Entry<T> = { value: T; readAt: number; expiresAt: number };

/* provider-address-per-isp T046 (FR-003): the ADDRESS is part of the
   key, not only the tenant.

   A business can now change installation, and everything cached under
   it was read from the old one. The cash payment-method id is the one
   that bites: it sits on the money path for ten minutes
   (`wisphub/reconnection.ts`), and an id minted on one installation
   means nothing on another — the payment would be registered against a
   `forma_pago` that belongs to somebody else's WispHub, or refused. The
   roster and the pending list are thirty seconds of a stale screen,
   which is milder and wrong in the same way.

   Keying by the address makes the change invalidate by itself: the new
   installation is a new key, so the first read after it goes to the
   provider, and the old entries expire unread. Nothing has to remember
   to clear anything, which is the only kind of invalidation that
   survives a second writer. The address is a host, never a credential
   (FR-013). */
function keyFor(
  kind: string,
  businessId: string,
  address: string,
  version: number | null,
): Request {
  const v = version === null ? "" : `/${version}`;
  return new Request(
    `${CACHE_ORIGIN}/${generation}/${kind}/${encodeURIComponent(businessId)}/${encodeURIComponent(address)}${v}`,
    { method: "GET" },
  );
}

/* Guarded, not assumed: a runtime without the Cache API (a unit test in
   plain node, the dashboard preview) reads as a miss and stores nothing,
   which is slower and never wrong. */
function store(): Cache | null {
  const caches = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  return caches?.default ?? null;
}

async function read<T>(
  kind: string,
  businessId: string,
  address: string,
  version: number | null,
  now: Date,
): Promise<Entry<T> | null> {
  const cache = store();
  const hit = cache ? await cache.match(keyFor(kind, businessId, address, version)) : null;
  const entry = hit ? ((await hit.json()) as Entry<T>) : null;
  const fresh = entry !== null && entry.expiresAt > now.getTime();
  /* TD-014's own payment condition: the hit rate is measured, not guessed */
  console.log(`provider cache ${fresh ? "hit" : "miss"}: ${kind} ${businessId}`);
  return fresh ? entry : null;
}

async function write<T>(
  kind: string,
  businessId: string,
  address: string,
  version: number | null,
  entry: Entry<T>,
): Promise<void> {
  const cache = store();
  if (!cache) return;
  const maxAge = Math.max(1, Math.ceil((entry.expiresAt - entry.readAt) / 1000));
  await cache.put(
    keyFor(kind, businessId, address, version),
    new Response(JSON.stringify(entry), {
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${maxAge}` },
    }),
  );
}

/* The number the pending-list key carries (presence-freshness D5/D6):
   when WispHub last learned about a payment of this tenant. 0 when it
   never did — observation mode registers nothing, and that is right. */
export async function pendingVersion(db: DrizzleD1Database, businessId: string): Promise<number> {
  const [row] = await db
    .select({ v: sql<number | null>`max(${payments.paymentRegisteredAt})` })
    .from(payments)
    .where(eq(payments.businessId, businessId));
  return Number(row?.v ?? 0);
}

/* The tenant's pending-invoice list, for **display only** (D3).
   Never call this from a path that decides whether money moves — the
   charge guard, the SPEI amount and the re-validation all read the
   adapter directly, and debt-truth.spec.md D1/D5 depend on that.
   `readAt` is when the provider was asked (presence-freshness D7).

   D3 as amended by bug: pending-invoice-cap — every reader now enters
   through `readPendingInvoices` (snapshot.ts), which comes here
   for a display read of a tenant the live walk can finish, and serves
   the sweep's snapshot to display and money paths alike for one it
   cannot. The rule above is unchanged for the tenants it was written
   for; for the others "fresh" was never on offer. */
export async function pendingInvoicesForDisplay(
  businessId: string,
  wisphub: WispHub,
  now: Date,
  version = 0,
): Promise<PendingInvoices & { readAt: number }> {
  const hit = await read<PendingInvoices>("pending", businessId, wisphub.baseUrl, version, now);
  if (hit) return { ...hit.value, readAt: hit.readAt };
  /* Only a successful answer is cached: a provider failure must not
     become 30 seconds of remembered failure (scenario 10). */
  const fresh = await wisphub.pendingInvoices(now);
  const readAt = now.getTime();
  await write("pending", businessId, wisphub.baseUrl, version, { value: fresh, readAt, expiresAt: readAt + PENDING_TTL_MS });
  return { ...fresh, readAt };
}

type Roster = { customers: WispHubCustomer[]; complete: boolean };

/* The tenant roster for the Links page — display only, same TTL and
   the same rule as the pending list above: money paths never read it.
   bug: links-roster-cap: reached through `readRoster` (snapshot.ts),
   which serves the sweep's finished pass to a tenant this walk cannot
   finish and comes here for one it can. */
export async function rosterForDisplay(
  businessId: string,
  wisphub: WispHub,
  now: Date,
): Promise<Roster & { readAt: number }> {
  const hit = await read<Roster>("roster", businessId, wisphub.baseUrl, null, now);
  if (hit) return { ...hit.value, readAt: hit.readAt };
  const fresh = await wisphub.listCustomersFull();
  const readAt = now.getTime();
  await write("roster", businessId, wisphub.baseUrl, null, { value: fresh, readAt, expiresAt: readAt + PENDING_TTL_MS });
  return { ...fresh, readAt };
}

/* D5: the cash payment-method id, on the charge path every single time
   and unchanged for the life of a tenant. */
export async function cashPaymentMethodId(
  businessId: string,
  wisphub: WispHub,
  now: Date,
): Promise<number> {
  const hit = await read<number>("payment-method", businessId, wisphub.baseUrl, null, now);
  if (hit) return hit.value;
  const fresh = await wisphub.getCashPaymentMethodId();
  const readAt = now.getTime();
  await write("payment-method", businessId, wisphub.baseUrl, null, { value: fresh, readAt, expiresAt: readAt + PAYMENT_METHOD_TTL_MS });
  return fresh;
}

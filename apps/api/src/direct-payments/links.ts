import { and, eq, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { paymentLinks, type payments } from "../db/schema";

/* The link's kind and state, read from the row (automated-collections-api
   D3, data-model.md). One table carries both collection channels, so the
   invariants the write path enforces are restated here as narrowings
   every reader can lean on instead of re-deriving them. */

export type PaymentLink = typeof paymentLinks.$inferSelect;

/* The token the payer's URL carries: opaque, permanent, non-guessable
   (direct-payment D1). 32-char alphabet without confusables; 256 % 32
   === 0, so the modulo is unbiased. 16 chars ≈ 80 bits. Shared by the
   panel's lazy generation and the API's create (automated-collections-api
   D2: one table, one token space). */
export function makeLinkToken(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const b of bytes) out += alphabet[b % 32];
  return out;
}

/* A panel link: made for a WispHub customer, its ask read live from
   WispHub. `source = 'panel'` ⟹ usuario and numeric id present. */
export type PanelLink = PaymentLink & {
  source: "panel";
  customerUsuario: string;
  wisphubCustomerId: string;
};

/* An API link: made by the business's own software through /v1, its ask
   stored on the row. `source = 'api'` ⟹ reference and ask present. */
export type ApiLink = PaymentLink & {
  source: "api";
  customerRef: string;
  askCents: number;
};

export function isPanelLink(link: PaymentLink): link is PanelLink {
  return link.source === "panel" && link.customerUsuario !== null && link.wisphubCustomerId !== null;
}

export function isApiLink(link: PaymentLink): link is ApiLink {
  return link.source === "api" && link.customerRef !== null && link.askCents !== null;
}

/* Derived, never stored (automated-collections-api D3, data-model.md):
   a fourth column would have to agree with `closed_at` and `expires_at`
   on every write, and the clock decides `expired` without any write at
   all. A reusable link carries neither timestamp, so it is always open. */
export type LinkState = "open" | "paid" | "expired";

export function linkState(
  link: Pick<PaymentLink, "closedAt" | "expiresAt">,
  now: Date,
): LinkState {
  if (link.closedAt !== null) return "paid";
  if (link.expiresAt !== null && link.expiresAt.getTime() <= now.getTime()) return "expired";
  return "open";
}

/* FR-031: only an open link accepts a payment */
export function linkAcceptsPayments(
  link: Pick<PaymentLink, "closedAt" | "expiresAt">,
  now: Date,
): boolean {
  return linkState(link, now) === "open";
}

/* automated-collections-api D12 (FR-035): a test credential's links and
   payments EXIST — the caller reads them through /v1 to test its own
   polling and history — and reach nothing real. Every business-facing
   read (the panel's feed and its totals, the proof and the actions, the
   link roster, the webhook health) spells this one predicate instead of
   remembering `is_test = false` at each call site: the requirement most
   likely to leak is enforced by one rule and one test
   (collections-api-test-mode.test.ts). The fee has its own gate in
   credit/index.ts, and the validation sweep never claims a test row. A
   panel link is never a test link — the write path guarantees it — so
   the panel's own list needs nothing. The payer's page reads by token
   and is not a business-facing read. */
export function realOnly(table: typeof paymentLinks | typeof payments): SQL {
  return eq(table.isTest, false);
}

/* links-on-demand-search D8/D12: `ensureLinks` — the BULK writer — is
   REMOVED with its three callers (the two link doors and the sweep's
   roster pass). It is what made listing create links, and FR-008 ends
   that: no background pass, no list read and no sweep writes one. The
   invariant it carried, "every customer of the roster has a link"
   (direct-payment D5, admin-links-view D5), no longer holds and went
   with it.

   What remains is one customer at a time, below, called from one place:
   the act. SC-009 is that sentence made measurable.

   (The chunking under D1's parameter cap that the bulk insert needed —
   BUG-021, measured 2026-09-17: 150 customers at six values per row
   overran the cap — goes with it. `db/params.ts` and its guard in
   `test/setup.ts` stay: other statements still bind wide.) */

/* ONE customer's link, created by the act and by nothing else
   (links-on-demand-search D8, FR-005/FR-008/FR-009).

   This is the whole write path for a panel link from now on: it is
   called only from `POST /direct-payments/links`, which only an
   operator pressing Copiar or WhatsApp reaches. No list read, no sweep,
   no background pass writes one — which is what SC-009 measures, and
   what `ensureLinks` below stopped being allowed to do.

   An existing link is RETURNED, never replaced: the usuario is the
   identity and the link is permanent while it exists. Only the numeric
   id refreshes, a cache WispHub may recycle to a different person
   (`direct-payment D5`), which keys nothing.

   `created` is what the door echoes to the operator's screen; it also
   makes "a second press creates no second link" a fact the caller can
   assert rather than infer.

   The customer's id is the integration's, opaque and kept as text
   (cash-at-stores T070, constitution IX): the store counter hands over
   the capability's `providerCustomerId` untouched, so no core caller
   assumes one provider's numeric ids. The column keeps its registered
   name (`core-reads-provider-directly`). */
export async function ensureLink(
  db: DrizzleD1Database,
  businessId: string,
  customer: { usuario: string; providerCustomerId: string },
): Promise<{ token: string; created: boolean }> {
  const wisphubCustomerId = customer.providerCustomerId;
  const [existing] = await db
    .select({ token: paymentLinks.token, wisphubCustomerId: paymentLinks.wisphubCustomerId })
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.businessId, businessId),
        /* automated-collections-api D3/D4: the usuario namespace is the
           panel's; an API link never holds one */
        eq(paymentLinks.source, "panel"),
        eq(paymentLinks.customerUsuario, customer.usuario),
      ),
    );
  if (existing) {
    if (existing.wisphubCustomerId !== wisphubCustomerId) {
      await db
        .update(paymentLinks)
        .set({ wisphubCustomerId })
        .where(and(eq(paymentLinks.businessId, businessId), eq(paymentLinks.customerUsuario, customer.usuario)));
    }
    return { token: existing.token, created: false };
  }

  const [inserted] = await db
    .insert(paymentLinks)
    .values({ businessId, token: makeLinkToken(), wisphubCustomerId, customerUsuario: customer.usuario })
    /* Two operators pressing at once: the first insert wins the usuario,
       the second reads its token below. Untargeted for the reason
       the bulk writer recorded — drizzle 0.40 cannot emit the WHERE that
       SQLite needs to match the partial index by name. */
    .onConflictDoNothing()
    .returning({ token: paymentLinks.token });
  if (inserted) return { token: inserted.token, created: true };

  /* Lost the race: the row exists now and it is the one that counts */
  const [raced] = await db
    .select({ token: paymentLinks.token })
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.businessId, businessId),
        eq(paymentLinks.source, "panel"),
        eq(paymentLinks.customerUsuario, customer.usuario),
      ),
    );
  if (!raced) throw new Error("ensureLink: the link neither inserted nor exists");
  return { token: raced.token, created: false };
}

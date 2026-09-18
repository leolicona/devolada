import { eq, type SQL } from "drizzle-orm";
import type { paymentLinks, payments } from "../db/schema";

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

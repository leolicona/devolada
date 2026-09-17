import type { paymentLinks } from "../db/schema";

/* The link's kind and state, read from the row (automated-collections-api
   D3, data-model.md). One table carries both collection channels, so the
   invariants the write path enforces are restated here as narrowings
   every reader can lean on instead of re-deriving them. */

export type PaymentLink = typeof paymentLinks.$inferSelect;

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

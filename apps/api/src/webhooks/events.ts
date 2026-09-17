import type { payments } from "../db/schema";
import type { ApiLink } from "../direct-payments/links";
import type { PaymentStatus, WebhookEvent, WebhookEventType } from "../routes/v1/webhook/schema";

/* The webhook body (automated-collections-api D9, D17, FR-013, FR-014).
   Rendered ONCE, when the delivery is enqueued, and stored on the row:
   a retry four hours later must deliver what the verdict said, not what
   the row looks like now, and a re-send (FR-041) is byte-identical so
   its event id still holds. The policy may move; the record must not —
   the same instinct as `hypothesisOf` in integrations/dispatch.ts. */

type DirectPayment = typeof payments.$inferSelect;

/* Every status the row can enter is announced, named with the row's own
   word (D17). Terminal ones are verdicts; only a verdict's delivery
   writes the payment's `action_outcome` (FR-026). */
const VERDICTS: ReadonlySet<PaymentStatus> = new Set([
  "confirmed",
  "partial",
  "unapplied",
  "invalid",
  "expired",
  "superseded",
]);

export function eventTypeFor(status: PaymentStatus): WebhookEventType {
  return `payment.${status}`;
}

export function isVerdictEvent(type: WebhookEventType): boolean {
  return VERDICTS.has(type.slice("payment.".length) as PaymentStatus);
}

/* Public ids carry a prefix so a caller reading a log can tell an event
   from a payment at a glance (contracts/public-api.md: `evt_`). */
export function makeEventId(): string {
  return `evt_${crypto.randomUUID().replace(/-/g, "")}`;
}

/* FR-040: the moment of the state the message announces. A verdict
   carries the verdict moment; a state before it carries the moment it
   began — `now`, because the event is rendered as the row enters it. */
export function renderEvent(
  payment: DirectPayment,
  link: Pick<ApiLink, "id" | "customerRef" | "askCents">,
  eventId: string,
  now: Date,
): { type: WebhookEventType; event: WebhookEvent; body: string } {
  const status = payment.status as PaymentStatus;
  const type = eventTypeFor(status);
  const verdict = VERDICTS.has(status);
  const event: WebhookEvent = {
    eventId,
    type,
    createdAt: verdict ? (payment.confirmedAt?.getTime() ?? now.getTime()) : now.getTime(),
    data: {
      paymentId: payment.id,
      paymentLinkId: link.id,
      customerRef: payment.customerRef ?? link.customerRef,
      /* what was asked at submission, frozen on the row (D7); rows born
         before the column fall back to the link's ask */
      askedCents: payment.askedCents ?? link.askCents,
      /* the receipt's or the typed form's number — a claim, never money
         received (FR-036); the row's own `claimed_amount_cents` */
      claimedCents: payment.claimedAmountCents,
      proofDoor: payment.proofMode,
      /* the verdict fields are absent, not invented, until the verdict */
      receivedCents: verdict ? payment.receivedCents : null,
      match: verdict ? payment.reconciliationClass : null,
      folio: verdict ? payment.folio : null,
      confirmedAt: verdict ? (payment.confirmedAt?.getTime() ?? null) : null,
      isTest: payment.isTest,
    },
  };
  return { type, event, body: JSON.stringify(event) };
}

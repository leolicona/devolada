import { z } from "zod";

/* The webhook contract of the public collections API
   (contracts/public-api.md, automated-collections-api US2). THE contract
   (constitution III): the handlers produce it, the panel's MSW handlers
   validate against it, and the body Devolada sends is defined here too
   so the reference and the tests read one definition. Nothing here names
   a subscriber, a service, a router or WispHub (FR-028). */

/* automated-collections-api D17: `payment.<status>` for every value of
   `payments.status` — the row's own word, never a synonym. `partial` is
   the row's word for the reconciliation class `short`, which belongs to
   `match` and never to a type. */
export const PAYMENT_STATUSES = [
  "validating",
  "queued_for_credit",
  "confirmed",
  "partial",
  "unapplied",
  "invalid",
  "expired",
  "superseded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const WEBHOOK_EVENT_TYPES = PAYMENT_STATUSES.map((status) => `payment.${status}` as const);
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export const webhookEventType = z.enum(WEBHOOK_EVENT_TYPES as unknown as [WebhookEventType, ...WebhookEventType[]]);

/* The reconciliation class, a different axis from status
   (payments-and-classes D1/D3). Null until the verdict. */
export const MATCHES = ["exact", "short", "over"] as const;

/* FR-014 / D17: the body. Before the verdict it carries what is known —
   `claimedCents` (what the receipt or the typed form says, a claim and
   never money) and `proofDoor` — with the verdict fields null, not
   guessed. After the verdict `receivedCents`, `match`, `folio` and
   `confirmedAt` are set. `claimedCents` and `proofDoor` ride on every
   later message too, so a caller that missed the first one still has
   them. */
export const webhookEventData = z.object({
  paymentId: z.string(),
  paymentLinkId: z.string(),
  customerRef: z.string(),
  askedCents: z.number().int(),
  claimedCents: z.number().int().nullable(),
  /* the row's proof_mode: `transfer` = the customer confirmed or typed
     the details (an image may be attached); `receipt` = the image alone */
  proofDoor: z.enum(["transfer", "receipt"]),
  receivedCents: z.number().int().nullable(),
  match: z.enum(MATCHES).nullable(),
  folio: z.string().nullable(),
  confirmedAt: z.number().int().nullable(),
  isTest: z.boolean(),
});

export const webhookEvent = z.object({
  eventId: z.string(),
  type: webhookEventType,
  /* FR-040: the moment of the state it announces — the verdict moment
     on a verdict, the moment the state began before it — so two
     messages for one payment out of order still tell which is newer */
  createdAt: z.number().int(),
  data: webhookEventData,
});

/* PUT /v1/webhook (FR-012, FR-038): one address per business. Anything
   that cannot protect the message in transit is INSECURE_URL. */
export const registerWebhookRequest = z.object({
  url: z.string().trim().min(1).max(2048),
});

/* What the caller sees of its endpoint. No secret: deliveries are
   signed with Devolada's own key (D10), whose public half is published
   at /.well-known/jwks.json. */
export const webhookEndpoint = z.object({
  url: z.string(),
  createdAt: z.number().int(),
  /* FR-018: what the panel's health line reads */
  consecutiveFailures: z.number().int().nonnegative(),
  lastFailureAt: z.number().int().nullable(),
  lastSuccessAt: z.number().int().nullable(),
});

export const DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const;

/* GET /v1/webhook/deliveries (FR-026): every attempt's result, so a
   disagreement between the two systems can be settled */
export const webhookDelivery = z.object({
  id: z.string(),
  eventId: z.string(),
  type: webhookEventType,
  paymentId: z.string().nullable(),
  status: z.enum(DELIVERY_STATUSES),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.number().int().nullable(),
  /* what the endpoint answered on the latest attempt; null when it
     never answered */
  responseStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
  /* the `kid` that signed the latest attempt (D10) */
  keyId: z.string().nullable(),
  deliveredAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});

export const webhookDeliveryList = z.object({
  deliveries: z.array(webhookDelivery),
});

export const listDeliveriesQuery = z.object({
  status: z.enum(DELIVERY_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const deleteWebhookResponse = z.object({
  removed: z.boolean(),
});

/* GET /.well-known/jwks.json (D10): the JSON Web Key Set every JOSE
   library reads. One set for the platform, never per business. */
export const jwk = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  alg: z.literal("ES256"),
  use: z.literal("sig"),
  kid: z.string(),
  x: z.string(),
  y: z.string(),
});

export const jwks = z.object({
  keys: z.array(jwk),
});

/* The headers a delivery carries (contracts/public-api.md) */
export const WEBHOOK_HEADERS = {
  eventId: "Devolada-Event-Id",
  timestamp: "Devolada-Timestamp",
  keyId: "Devolada-Key-Id",
  signature: "Devolada-Signature",
} as const;

export type WebhookEvent = z.infer<typeof webhookEvent>;
export type WebhookEventData = z.infer<typeof webhookEventData>;
export type RegisterWebhookRequest = z.infer<typeof registerWebhookRequest>;
export type WebhookEndpoint = z.infer<typeof webhookEndpoint>;
export type WebhookDelivery = z.infer<typeof webhookDelivery>;
export type WebhookDeliveryList = z.infer<typeof webhookDeliveryList>;
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuery>;
export type Jwks = z.infer<typeof jwks>;

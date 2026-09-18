import { z } from "zod";
import { PAYMENT_STATUSES, webhookEventData } from "../webhook/schema";

/* The read contract of the public collections API — the verify path
   (contracts/public-api.md, automated-collections-api US3, FR-019,
   FR-023). THE contract (constitution III): the handler produces it and
   the stubs validate against it. Nothing here names a subscriber, a
   service, a router or WispHub (FR-028). */

/* The caller's own identifier, as on the link (US1) */
const customerRef = z.string().trim().min(1).max(128);

/* GET /v1/payments?customerRef= */
export const listPaymentsQuery = z.object({
  customerRef,
});

/* One payment as the caller reads it. Built from the webhook body on
   purpose: the read is the safety net under US2, so a caller that
   missed every message finds here exactly the facts the messages
   carried — claim, door, verdict — plus the row's own `status` (the
   same vocabulary the events are named with, research D17) and when
   it was born. `id` is the payment's own id, the one every message
   names as `paymentId`. */
export const apiPayment = webhookEventData.omit({ paymentId: true }).extend({
  id: z.string(),
  status: z.enum(PAYMENT_STATUSES),
  createdAt: z.number().int(),
});

export const apiPaymentList = z.object({
  payments: z.array(apiPayment),
});

export type ListPaymentsQuery = z.infer<typeof listPaymentsQuery>;
export type ApiPayment = z.infer<typeof apiPayment>;
export type ApiPaymentList = z.infer<typeof apiPaymentList>;

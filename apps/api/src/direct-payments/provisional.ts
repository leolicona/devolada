import { and, eq, gte, inArray, ne } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import type { Integration } from "../integrations/store";
import { payments, businesses, paymentLinks, proofRejections } from "../db/schema";
import { WispHub } from "../wisphub/client";
import { NO_DEBT, debtOf } from "../wisphub/debt";
import { sendProvisionalExpiry } from "../email/sender";
import { settle } from "./partial";
import { isPanelLink } from "./links";

/* Provisional release (provisional-release spec, US-D15).

   Trust is the default: per-transaction evidence buys a WispHub payment
   promise while Banxico confirms, and history only revokes. The promise
   is the whole mechanism (D3, measured 2026-08-27): with `accion: 1` it
   reactivates a suspended customer in the same second, it protects a
   current one from the scheduled cut, WispHub deletes it by itself when
   the payment is registered, and its lapse hands the cut back to WispHub
   — Devolada never touches a router and never registers money it has
   not seen confirmed. */

type DB = DrizzleD1Database;
type DirectPayment = typeof payments.$inferSelect;
type PaymentLink = typeof paymentLinks.$inferSelect;
type Isp = typeof businesses.$inferSelect;

const DAY_MS = 24 * 3600 * 1000;
/* The D7 validation schedule dies 6 h after creation */
const SCHEDULE_MS = 6 * 3600 * 1000;

export type ReleaseEvidence = "pending" | "agreed" | "human" | "history";

/* D12 — the graduation threshold. K does not exist yet, on purpose: it
   is exactly the number the shadow table produces ("at K = 3, the
   history rule would have called X% of outcomes right against the open
   rule's Y%"). Inventing it today is the two-blind-profiles mistake
   again. When the data speaks, K is written into the spec with the
   table that chose it — and only then does the gate below wake. */
export const GRADUATION_K: number | null = null;

/* D12 — the graduation gate: what graduation buys, never what it gates.
   A payer whose own record is rich enough (`effectiveN ≥ K`) and clean
   (no contradicted chain, no reused proof — the same incidents D5
   revokes on) earns privileges above the default; the first named case
   is `blind`, releasing where the machines could not read the image.
   Behind `K != null` it is provably inert: while K is null this returns
   false for every payer and the vote of confidence rules alone. */
export function historyVouches(
  trust: { sample: { effectiveN: number }; raw: { contradicted: number; alreadyUsedAttempts: number } } | undefined,
  k: number | null = GRADUATION_K,
): boolean {
  if (k == null || !trust) return false;
  return (
    trust.sample.effectiveN >= k &&
    trust.raw.contradicted === 0 &&
    trust.raw.alreadyUsedAttempts === 0
  );
}

/* D1 — release fires on the first evidence, never on the upload. The
   kind names who vouched: the provider (`pending` = the transfer exists
   in process), two independent machines (`agreed`), or the payer's own
   fingers (`human`: the manual door has no image and no reader — the
   human IS the reader; a superseding row carries a human correction). */
export function releaseEvidenceFor(
  payment: DirectPayment,
  verdictStatus: "pending" | "not_found",
  classification: { readingCheck?: string | null } = {},
): ReleaseEvidence | null {
  if (verdictStatus === "pending") return "pending";
  if (classification.readingCheck === "agreed" || payment.readingCheck === "agreed") {
    return "agreed";
  }
  if (payment.proofMode === "transfer" && !payment.proofKey) return "human";
  if (payment.supersedesId) return "human";
  return null;
}

/* D5 — only what burned a ride or proved bad faith revokes. Computed
   from Devolada's own rows: an expired payment is client state Consta
   can only infer, and the edge rejections of D6 never even reach it.
   `superseded` rows never count — the reading error was ours. */
export async function isRevoked(db: DB, payment: DirectPayment, now: Date): Promise<boolean> {
  const burnedSince = new Date(now.getTime() - 90 * DAY_MS);
  const incidentSince = new Date(now.getTime() - 365 * DAY_MS);

  const siblings = await db
    .select({
      status: payments.status,
      lastError: payments.lastError,
      provisionalReleaseAt: payments.provisionalReleaseAt,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(
      and(
        eq(payments.paymentLinkId, payment.paymentLinkId),
        ne(payments.id, payment.id),
        ne(payments.status, "superseded"),
        gte(payments.createdAt, incidentSince),
      ),
    );

  /* The burned ride: a release that ended expired and was never resolved
     (a manual retry that validates confirms through the normal flow, so
     a resolved ride simply is not `expired` any more) — 90 days. */
  const burned = siblings.some(
    (s) =>
      s.status === "expired" && s.provisionalReleaseAt != null && s.createdAt >= burnedSince,
  );
  /* Proven bad faith: a DEVUELTO, or a CEP consumed outside this link's
     own history — 12 months. */
  const incident = siblings.some(
    (s) => s.lastError === "TRANSFER_CONTRADICTED" || s.lastError === "TRANSFER_ALREADY_USED",
  );
  if (burned || incident) return true;

  /* D6 — edge rejections: a reused clave owned by ANOTHER customer's
     payment is the shape of double-spending; reusing your own is
     confusion and never counts. */
  const rejections = await db
    .select({ ownerPaymentId: proofRejections.ownerPaymentId })
    .from(proofRejections)
    .where(
      and(
        eq(proofRejections.paymentLinkId, payment.paymentLinkId),
        gte(proofRejections.createdAt, incidentSince),
      ),
    );
  const ownerIds = rejections.map((r) => r.ownerPaymentId).filter((x): x is string => x != null);
  if (!ownerIds.length) return false;
  const owners = await db
    .select({ linkId: payments.paymentLinkId })
    .from(payments)
    .where(inArray(payments.id, ownerIds));
  return owners.some((o) => o.linkId !== payment.paymentLinkId);
}

/* D3 — the promise must outlive the whole ride: `fecha_limite` has day
   granularity (normalised to 00:00), so it lands on the day after the
   schedule's end. Worst extra window after an expiry: under 24 h plus
   WispHub's own cut cadence — bounded, and WispHub's to close. */
export function promiseDeadline(createdAt: Date): string {
  return new Date(createdAt.getTime() + SCHEDULE_MS + DAY_MS).toISOString().slice(0, 10);
}

/* D1/D2 — evaluate once, act at most once, never block the ride. The
   fields returned ride the same row update the verdict was going to
   write; an empty object means "not this time", and a failure inside is
   a skipped release, never a failed validation. */
export async function maybeProvisionalRelease(
  env: Bindings,
  db: DB,
  business: Isp,
  /* integrations-hub D8: the switch, the key and the thresholds live on
     the integration row now */
  integration: Integration | null,
  link: PaymentLink,
  payment: DirectPayment,
  evidence: ReleaseEvidence | null,
  now: Date,
): Promise<Partial<typeof payments.$inferInsert>> {
  if (!evidence) return {};
  /* automated-collections-api D5: a payment promise is a WispHub write on
     the link's usuario — an API link has neither, so there is nothing to
     release and the evaluation is skipped, never failed. */
  if (!isPanelLink(link)) return {};
  if (!integration?.provisionalReleaseEnabled) return {};
  /* integrations-hub D8: observation pauses the release too — a payment
     promise is a WispHub write, and observation means zero writes. */
  if (!integration.actionsEnabled) return {};
  if (payment.provisionalReleaseAt) return {};
  if (!integration.apiKey) return {};

  try {
    if (await isRevoked(db, payment, now)) return {};

    const wisphub = new WispHub(integration.apiKey, env.WISPHUB_BASE_URL);
    const [customer, pending] = await Promise.all([
      wisphub.getCustomer(link.customerUsuario),
      wisphub.pendingInvoices(now),
    ]);
    const debt = customer ? debtOf(customer, pending) : NO_DEBT;
    /* v1: the promise lives on an invoice; a carried-balance-only debt
       has none to live on, so it keeps today's flow (spec D3 note) */
    if (!debt.invoiceId) return {};

    /* D2: the ISP's ONE reconnection policy applies, provisional or
       confirmed — same threshold, same floor, against the claim */
    const claimed = payment.claimedAmountCents ?? payment.amountCents;
    const ok = settle({
      receivedCents: claimed,
      ispDebtCents: debt.totalCents || (customer?.planPriceCents ?? payment.invoiceCents),
      serviceFeeCents: payment.serviceFeeCents,
      thresholdPercent: integration.thresholdPercent,
      floorCents: integration.floorCents,
    }).reconnect;
    if (!ok) return {};

    await wisphub.createPaymentPromise(debt.invoiceId, promiseDeadline(payment.createdAt));
    return {
      provisionalReleaseAt: now,
      releaseEvidence: evidence,
      /* D2/D9: which face acted — recorded now because the page must
         never tell an active customer their internet "came back" */
      releaseKind: customer?.serviceStatus === "suspended" ? ("reconnect" as const) : ("protect" as const),
    };
  } catch (e) {
    console.warn(
      `provisional release skipped for ${payment.id}:`,
      e instanceof Error ? e.message : String(e),
    );
    return {};
  }
}

/* D8 — expiry after release: the promise lapses on its own and the cut
   is WispHub's; Devolada re-checks the debt (the `unapplied` lesson:
   never alarm on stale state) and mails the ISP only when the money
   never showed. Best-effort: an email must never break the sweep. */
export async function notifyProvisionalExpiry(
  env: Bindings,
  business: Isp,
  integration: Integration | null,
  link: PaymentLink,
  now: Date,
): Promise<void> {
  try {
    if (!integration?.apiKey) return;
    /* automated-collections-api D5: only a panel link can have been
       released (above), so only a panel link has an expiry to announce */
    if (!isPanelLink(link)) return;
    const wisphub = new WispHub(integration.apiKey, env.WISPHUB_BASE_URL);
    const [customer, pending] = await Promise.all([
      wisphub.getCustomer(link.customerUsuario),
      wisphub.pendingInvoices(now),
    ]);
    const debt = customer ? debtOf(customer, pending) : NO_DEBT;
    if (debt.totalCents === 0) return;
    await sendProvisionalExpiry(env, business.email, {
      name: customer?.name ?? link.customerUsuario,
      usuario: link.customerUsuario,
    });
  } catch (e) {
    console.warn(
      `provisional expiry notice failed for ${link.customerUsuario}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

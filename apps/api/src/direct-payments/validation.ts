import { and, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { charges, directPayments, isps, paymentLinks } from "../db/schema";
import { BANKS } from "./banks";
import { Consta, ConstaError, type ConstaRequest } from "../consta/client";
import { WispHub, WispHubError } from "../wisphub/client";
import { NO_DEBT, debtOf } from "../wisphub/debt";
import { settle } from "./partial";
import { attemptReconnection } from "../wisphub/reconnection";
import { invalidatePendingInvoices } from "../wisphub/cache";
import { firstAttemptSchedule } from "../reconnection/queue";
import { makeFolio } from "../routes/charges/handler";
import { nextValidationSlot } from "./schedule";
import { signedProofUrl } from "./proofs";
import { demoVerdict, isDemoLink } from "./demo";

/* One validation attempt of a direct payment (direct-payment spec).
   Shared by the inline attempt on submission and the sweep's
   re-validations (D7) — the same rules decide every outcome, exactly
   like the reconnection queue. */

type DB = DrizzleD1Database;
export type DirectPayment = typeof directPayments.$inferSelect;
type PaymentLink = typeof paymentLinks.$inferSelect;
type Isp = typeof isps.$inferSelect;

/* D11: a CEP older than this window cannot pay today's debt. Measured
   2026-08-17: apiCEP treats the claimed date as a hint, not a filter,
   so the returned date is compared here. */
export const STALE_TRANSFER_DAYS = 30;

const LEASE_MINUTES = 2;
const BATCH = 20;
const minutes = (n: number) => n * 60 * 1000;

/* D3: the SPEI fee falls back to the store fee when unset */
export function speiFeeCents(isp: Isp): number {
  return isp.speiServiceFeeCents ?? isp.serviceFeeCents;
}

/* The vocabulary as a lookup. A name outside it cannot resolve a CEP —
   apiCEP answers `invalid`, never an error (D16) — so it is exactly the
   "nothing can validate" case D4 already refuses to show. */
const KNOWN_BANKS: ReadonlySet<string> = new Set(BANKS);

export function speiBankIsKnown(isp: Isp): boolean {
  return Boolean(isp.speiBank && KNOWN_BANKS.has(isp.speiBank));
}

/* D4: the channel exists only when the ISP configured its own account —
   and when Consta itself is reachable in this environment. A page that
   shows a CLABE nothing can validate would let customers transfer into
   the void.

   `speiBank` being non-empty is not enough, and BUG-008 is why: a value
   stored before D16 can be truthy and still outside apiCEP's vocabulary.
   Measured live on dev 2026-08-19 — an ISP held `Klar` where the list says
   `KLAR`, so every payment to it failed the moment D16 shipped, and failed
   *retryably*, which is the six-hour silence rather than an honest refusal. */
export function speiAvailable(env: Bindings, isp: Isp): boolean {
  /* claimed-amount D5: the beneficiary name is recommended, never
     required — apiCEP asks only for clabe + bank, and the gates that
     demanded the name were all ours. */
  return Boolean(
    isp.speiClabe &&
      speiBankIsKnown(isp) &&
      isp.wisphubApiKey &&
      env.CONSTA_BASE_URL &&
      env.CONSTA_API_KEY,
  );
}

export function isUniqueViolation(e: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String(e instanceof Error ? e.message : e));
}

/* reading-check D2/D5: the minute-two comparison. Clave and amount are
   the two Banxico search filters (both measured) — the only fields that
   can raise a dispute; a bank-name or date difference never wakes the
   human. No clave from the provider means no second opinion: blind, and
   the payment keeps today's exact behaviour. */
export function classifyReading(
  payment: Pick<DirectPayment, "trackingKey" | "claimedAmountCents" | "amountCents">,
  reading: { trackingKey: string | null; amountCents: number | null } | null,
): { readingCheck: "agreed" | "disputed" | "blind"; disputedFields: string | null } {
  if (!reading?.trackingKey) return { readingCheck: "blind", disputedFields: null };
  const disputed: string[] = [];
  if (reading.trackingKey.toUpperCase() !== (payment.trackingKey ?? "").toUpperCase()) {
    disputed.push("trackingKey");
  }
  const claimed = payment.claimedAmountCents ?? payment.amountCents;
  if (reading.amountCents != null && reading.amountCents !== claimed) {
    disputed.push("amount");
  }
  return disputed.length
    ? { readingCheck: "disputed", disputedFields: JSON.stringify(disputed) }
    : { readingCheck: "agreed", disputedFields: null };
}

/* validation-status-ux D8: the provider's replay flag is permanent per
   CEP, but the D8 carve-out (`isRetry`) is per row — and supersede
   creates a fresh row with both counters at zero. A payer whose earlier
   attempt validated the CEP (a `valid` whose response was lost) and who
   then corrects or re-uploads the same receipt must not be told their
   own transfer belongs to somebody else. The chain is the trace: any
   superseded ancestor that reached the provider counts, and so does a
   prior payment on the same link holding the same tracking key — the
   receipt door's shape, where no `supersedesId` survives a terminal
   prior. A flag with no trace of either kind still refuses. */
async function tracesToOwnAttempt(
  db: DB,
  payment: DirectPayment,
  cepTrackingKey: string | null,
): Promise<boolean> {
  const attempted = (p: DirectPayment) => p.validationAttempts > 0 || p.constaStatus !== null;

  let cursor = payment.supersedesId;
  for (let hops = 0; cursor && hops < 20; hops++) {
    const [prior] = await db.select().from(directPayments).where(eq(directPayments.id, cursor));
    if (!prior) break;
    if (attempted(prior)) return true;
    cursor = prior.supersedesId;
  }

  const key = payment.trackingKey ?? cepTrackingKey;
  if (!key) return false;
  const siblings = await db
    .select()
    .from(directPayments)
    .where(
      and(
        eq(directPayments.paymentLinkId, payment.paymentLinkId),
        eq(directPayments.trackingKey, key),
        ne(directPayments.id, payment.id),
      ),
    );
  return siblings.some(attempted);
}

export async function runValidation(
  env: Bindings,
  db: DB,
  payment: DirectPayment,
  link: PaymentLink,
  isp: Isp,
  now: Date,
): Promise<DirectPayment> {
  const update = async (
    values: Partial<typeof directPayments.$inferInsert>,
  ): Promise<DirectPayment> => {
    const [row] = await db
      .update(directPayments)
      .set(values)
      .where(eq(directPayments.id, payment.id))
      .returning();
    return row;
  };

  /* A retryable failure rides the D7 schedule like a pending CEP; when
     the schedule is exhausted the honest terminal state is `expired` —
     everything gathered so far stays on the row for the ISP. Only
     `not_found` passes `lateSlot` (validation-status-ux D4): the extra
     T+12h attempt exists for the transfer Banxico may still publish,
     never for our own outages. */
  const retryLater = (
    error: string,
    base: Partial<typeof directPayments.$inferInsert> = {},
    opts: { lateSlot?: boolean } = {},
  ) => {
    const slot = nextValidationSlot(payment.createdAt, now, opts);
    return update(
      slot
        ? { ...base, lastError: error, nextValidationAt: slot }
        : { ...base, status: "expired", lastError: error, nextValidationAt: null },
    );
  };

  if (!env.CONSTA_BASE_URL || !env.CONSTA_API_KEY) {
    return retryLater("CONSTA_NOT_CONFIGURED");
  }
  if (!isp.speiClabe || !isp.speiBank) {
    /* The ISP un-configured SPEI between submission and this attempt.
       The beneficiary name is not part of this check (claimed-amount D5). */
    return retryLater("SPEI_NOT_CONFIGURED");
  }
  if (!speiBankIsKnown(isp)) {
    /* BUG-008: retrying cannot fix the ISP's own configuration, and Consta
       would refuse it with a 400 the client reads as retryable. Stop here
       and name it, so the ISP sees a configuration problem rather than a
       customer seeing "Verificando" for six hours. */
    return retryLater("SPEI_BANK_UNKNOWN");
  }

  const beneficiary = {
    bank: isp.speiBank,
    clabe: isp.speiClabe,
    /* claimed-amount D5: sent when configured, omitted when not — whether
       apiCEP matches on it is unmeasured, so omitting beats guessing. */
    ...(isp.speiBeneficiaryName ? { name: isp.speiBeneficiaryName } : {}),
  };
  /* reading-check D1: attempt 2 sends the image, not the data. A
     reader-sourced payment whose inline attempt found nothing gets the
     provider's own OCR as a second, independent reading — in the same
     paid call the slot was going to spend anyway. `providerOcr` is what
     makes it independent (proof-extraction D11): without it Consta's
     reader runs again, and the same model checking itself is no second
     opinion. Attempt-based, not slot-based, so a payment whose inline
     attempt never ran still gets its cross on the attempt after its
     first not_found. */
  const crossCheck =
    payment.proofMode === "transfer" &&
    payment.proofKey != null &&
    payment.validationAttempts === 1 &&
    payment.lastError === "TRANSFER_NOT_FOUND" &&
    payment.readingCheck === null;

  const request: ConstaRequest = crossCheck
    ? {
        /* D12: a short-lived signed URL, never the bucket itself */
        receiptUrl: await signedProofUrl(env, payment.proofKey ?? "", now),
        beneficiary,
        providerOcr: true,
      }
    : payment.proofMode === "transfer"
      ? {
          transfer: {
            /* D2/Consta D1: amount and beneficiary are server-supplied;
               only the customer's own transfer data travels from input */
            date: payment.transferDate ?? now.toISOString().slice(0, 10),
            /* partial-payment D5: the amount is a **search criterion**,
               not an assertion. Asking with what we expected finds
               nothing when the payer fell short, so what travels is what
               the receipt said — or, on the manual door, what the payer
               typed (claimed-amount D1/D3: the truth about the amount
               lives on the receipt or with the human, never in the
               debt). The fallback covers rows born before that field. */
            amountCents: payment.claimedAmountCents ?? payment.amountCents,
            senderBank: payment.senderBank ?? "",
            trackingKey: payment.trackingKey ?? "",
            beneficiary,
          },
        }
      : {
          /* D12: what Consta receives is a short-lived signed URL, never
             the bucket itself */
          receiptUrl: await signedProofUrl(env, payment.proofKey ?? "", now),
          beneficiary,
        };

  /* D8 carve-out (a): a prior attempt may have set the provider's replay
     flag — a lost `valid` response must not brick a legitimate payment.

     "Prior attempt", not "prior verdict": `constaStatus` is only written
     when a call comes BACK, so a call that never returned left no trace
     and the retry read as a stranger's validation. Found live on
     2026-08-18 — the provider had validated the CEP, our worker died
     before recording it, and the honest retry was told
     TRANSFER_ALREADY_USED. The counter below is written BEFORE the call
     for exactly this reason: what matters is that a call may have
     landed, which is knowable only in advance. */
  const isRetry = payment.validationAttempts > 0 || payment.constaStatus !== null;
  const attempts = payment.validationAttempts + 1;
  await db
    .update(directPayments)
    .set({ validationAttempts: attempts })
    .where(eq(directPayments.id, payment.id));

  let verdict;
  if (isDemoLink(env, link)) {
    /* TD-015: a named link in a dev environment, decided before the fact
       and never by a failure — see `demo.ts`. Everything after this line
       is the real thing: the fresh WispHub read, the charge, the folio,
       the reconnection. Only Banxico is simulated. */
    console.warn(`TD-015 demo verdict for direct payment ${payment.id} — no provider call`);
    verdict = demoVerdict(payment, isp, now);
  } else {
    try {
      verdict = await new Consta(env.CONSTA_BASE_URL, env.CONSTA_API_KEY).validate(request);
    } catch (e) {
      const code = e instanceof ConstaError ? e.code : "CONSTA_UNAVAILABLE";
      console.error("consta validation failed:", code);
      return retryLater(code);
    }
  }

  const base = {
    /* Already written above; repeated so every terminal write carries a
       consistent row, and harmless because it is the same number. */
    validationAttempts: attempts,
    constaValidationId: verdict.validationId,
    constaStatus: verdict.status,
  };

  if (verdict.status === "invalid") {
    /* D17/BUG-003: only a contradicted CEP is a refusal. Consta's
       `not_found` — no cepDetails, no cepStatus — is the absence of an
       answer, and it covers a real transfer whose CEP Banxico has not
       published yet (measured 2026-08-19: a settled transfer with the
       money already delivered had no CEP at T+62 min), a receipt
       captured before the bank accepted it, a misread clave and a wrong
       sender bank. Killing the payment on the first of those calls a
       paying customer a liar. It rides the schedule instead, and the
       code survives on the row so the ISP can see why. */
    if (verdict.reason !== "contradicted") {
      /* reading-check D2–D5: the cross that still found nothing carries
         its classification — agreement is evidence the page can retire
         the clock on; a dispute asks the human now; blindness changes
         nothing. Written once, with the same retry the schedule keeps. */
      return retryLater(
        "TRANSFER_NOT_FOUND",
        { ...base, ...(crossCheck ? classifyReading(payment, verdict.reading ?? null) : {}) },
        { lateSlot: true },
      );
    }
    return update({
      ...base,
      status: "invalid",
      nextValidationAt: null,
      lastError: "TRANSFER_CONTRADICTED",
    });
  }

  if (verdict.status === "pending") {
    /* Consta's D3: "not found yet" is never "fake". Ride the schedule. */
    const slot = nextValidationSlot(payment.createdAt, now);
    return update(
      slot
        ? { ...base, nextValidationAt: slot, lastError: null }
        : { ...base, status: "expired", nextValidationAt: null, lastError: null },
    );
  }

  /* valid — necessary, not sufficient (D11): the CEP must match the debt */

  if (
    verdict.alreadyValidated &&
    !isRetry &&
    !(await tracesToOwnAttempt(db, payment, verdict.cep?.trackingKey ?? null))
  ) {
    /* D8: the flag with no local record means the CEP was validated
       outside Devolada — rejected, but visible in the admin feed so
       the ISP can resolve it with the customer. (A local record would
       have stopped the submission at the unique index already.) */
    return update({
      ...base,
      status: "invalid",
      nextValidationAt: null,
      lastError: "TRANSFER_ALREADY_USED",
    });
  }

  const cep = verdict.cep;
  /* partial-payment D1 replaces the `AMOUNT_MISMATCH` refusal that stood
     here. A CEP that disagrees with the expected total is not a lie — it
     is a transfer that really happened for a different amount, with the
     money already in the ISP's account. Refusing it discarded the only
     record that it arrived.

     What the CEP says was transferred is what settles the debt (D5), and
     how much of it is missing decides `partial` vs `confirmed` (D6). The
     $1-receipt case D11 guarded is still handled, differently and better:
     a real $1 transfer becomes a real $1 partial payment, which buys no
     reconnection at the default threshold and is visible to the ISP
     instead of vanishing. */
  if (cep?.date) {
    const cepMs = Date.parse(`${cep.date}T00:00:00Z`);
    if (Number.isFinite(cepMs) && now.getTime() - cepMs > STALE_TRANSFER_DAYS * 24 * 3600 * 1000) {
      return update({
        ...base,
        status: "invalid",
        nextValidationAt: null,
        lastError: "STALE_TRANSFER",
      });
    }
  }

  /* Claim the tracking key the CEP revealed. The partial unique index is
     the D8 defense — losing this claim means another live payment
     already owns the transfer. Two rows earn it: a receipt-door row that
     never had a key, and (reading-check D7) a cross-validated row whose
     stored key was the misread the CEP just corrected — the index must
     end up holding the truth. */
  const adoptKey =
    cep?.trackingKey &&
    (payment.proofMode === "receipt"
      ? !payment.trackingKey
      : crossCheck && cep.trackingKey !== payment.trackingKey);
  if (adoptKey && cep?.trackingKey) {
    try {
      await db
        .update(directPayments)
        .set({
          trackingKey: cep.trackingKey,
          senderBank: cep.senderBank ?? null,
          transferDate: cep.date ?? null,
        })
        .where(eq(directPayments.id, payment.id));
    } catch (e) {
      if (isUniqueViolation(e)) {
        return update({
          ...base,
          status: "invalid",
          nextValidationAt: null,
          lastError: "TRANSFER_ALREADY_USED",
        });
      }
      throw e;
    }
  }

  /* D14: between submission and confirmation the debt can be settled
     elsewhere. Re-check before touching WispHub's money. */
  if (!isp.wisphubApiKey) return retryLater("WISPHUB_NOT_CONFIGURED", base);
  const wisphub = new WispHub(isp.wisphubApiKey, env.WISPHUB_BASE_URL);
  let customer;
  let pending;
  try {
    /* provider-latency D2 together, D3 **fresh**: this decides whether a
       payment is registered in WispHub (D14), so it never takes the
       display cache. */
    [customer, pending] = await Promise.all([
      wisphub.getCustomer(link.customerUsuario),
      wisphub.pendingInvoices(now),
    ]);
  } catch (e) {
    const code = e instanceof WispHubError ? e.code : "WISPHUB_UNAVAILABLE";
    return retryLater(code, base);
  }
  /* debt-truth D7: the debt is the pending invoices plus what the
     customer carries. Read fresh — between submission and here the debt
     can have been settled elsewhere (D14) or grown. */
  const debt = customer ? debtOf(customer, pending) : NO_DEBT;
  if (debt.totalCents === 0) {
    /* Debt-truth D4/D14: a truncated list cannot prove "owes nothing",
       but `saldo` is never truncated and it said nothing either. */
    const provenSettled = pending.complete || customer?.billingStatus === "paid";
    if (provenSettled) {
      /* The money already moved to the ISP's CLABE: never register a
         second WispHub payment, never drop the proof (D14). */
      return update({
        ...base,
        status: "unapplied",
        nextValidationAt: null,
        lastError: null,
      });
    }
  }
  const ispDebtCents = debt.totalCents || (customer?.planPriceCents ?? payment.invoiceCents);

  /* D5: what the CEP says arrived is what settles the debt, and the
     ISP's threshold decides whether it earns the service back. Both
     branches register the money — the ISP's books are right either way;
     only the router is left alone. */
  const receivedCents = cep?.amountCents ?? payment.amountCents;
  const settlement = settle({
    receivedCents,
    ispDebtCents,
    serviceFeeCents: payment.serviceFeeCents,
    thresholdPercent: isp.reconnectionThresholdPercent,
    floorCents: isp.reconnectionFloorCents,
  });

  /* D6: a direct charge has no store, no commission, no ledger entries —
     but the same folio, the same reconnection flow, the same feed. */
  const [charge] = await db
    .insert(charges)
    .values({
      ispId: isp.id,
      storeId: null,
      channel: "spei",
      directPaymentId: payment.id,
      folio: makeFolio(),
      wisphubCustomerId: link.wisphubCustomerId,
      customerUsuario: link.customerUsuario,
      customerName: customer?.name ?? link.customerUsuario,
      customerZone: customer?.zone ?? null,
      customerPhone: customer?.phone ?? null,
      /* D9: the charge records what actually arrived, not what was
         asked for. The money moved, so the platform statement and the
         ISP's feed must both see it. */
      invoiceCents: settlement.ispRegisteredCents,
      carriedBalanceCents: 0,
      /* D14: the whole fee, always. `settlement` D1 derives the
         platform's share from this column, and the money the payer sent
         reached the ISP's bank whatever its size — so the fee is a
         receivable against the ISP, never something the shortfall
         cancels. */
      serviceFeeCents: settlement.feeAccruedCents,
      totalCents: receivedCents,
    })
    .returning();

  /* provider-latency D4: a charge now exists for this tenant, so the
     display cache is stale by definition — same rule as the store flow. */
  invalidatePendingInvoices(isp.id);

  const attempt = await attemptReconnection(
    wisphub,
    isp.id,
    { usuario: link.customerUsuario, wisphubId: link.wisphubCustomerId },
    settlement.ispRegisteredCents,
    now,
    { invoiceId: debt.invoiceId, paymentRegistered: false },
    settlement.reconnect,
  );
  const schedule = firstAttemptSchedule(attempt, now);
  await db
    .update(charges)
    .set({
      reconnectionStatus: attempt.status,
      reconnectionAttempts: schedule.attempts,
      wisphubInvoiceId: attempt.invoiceId,
      paymentRegisteredAt: attempt.paymentRegistered ? now : null,
      nextAttemptAt: schedule.nextAttemptAt,
      lastError: attempt.error,
      ...(attempt.status === "reconnected" ? { reconnectedAt: now } : {}),
    })
    .where(eq(charges.id, charge.id));

  return update({
    ...base,
    receivedCents,
    status: settlement.status,
    chargeId: charge.id,
    confirmedAt: now,
    /* D18: who Banxico says sent the money. Recorded and acted on by
       nothing — a name unrelated to the subscriber is the only signal
       available that a misread clave matched somebody else's real
       transfer, but people pay for relatives, so it can never be a
       rule. Nothing displays it yet; `apps/admin` has no direct-payment
       view at all. */
    cepSenderName: cep?.senderName ?? null,
    nextValidationAt: null,
    lastError: null,
  });
}

export type DirectSweepReport = {
  claimed: number;
  confirmed: number;
  stillValidating: number;
  invalid: number;
  expired: number;
  unapplied: number;
};

/* The re-validation sweep (D7): rides the api's existing every-minute
   scheduled handler — no new trigger. Same lease discipline as the
   reconnection sweep. */
export async function sweepDirectPayments(
  env: Bindings,
  now: Date = new Date(),
): Promise<DirectSweepReport> {
  const db = drizzle(env.DB);
  const report: DirectSweepReport = {
    claimed: 0,
    confirmed: 0,
    stillValidating: 0,
    invalid: 0,
    expired: 0,
    unapplied: 0,
  };

  const due = await db
    .select()
    .from(directPayments)
    .where(
      and(
        eq(directPayments.status, "validating"),
        isNotNull(directPayments.nextValidationAt),
        lte(directPayments.nextValidationAt, now),
      ),
    )
    .orderBy(directPayments.nextValidationAt)
    .limit(BATCH);
  if (!due.length) return report;

  await db
    .update(directPayments)
    .set({ nextValidationAt: new Date(now.getTime() + minutes(LEASE_MINUTES)) })
    .where(
      inArray(
        directPayments.id,
        due.map((p) => p.id),
      ),
    );
  report.claimed = due.length;

  const linkRows = await db
    .select()
    .from(paymentLinks)
    .where(
      inArray(paymentLinks.id, [...new Set(due.map((p) => p.paymentLinkId))]),
    );
  const linkById = new Map(linkRows.map((l) => [l.id, l]));
  const ispRows = await db
    .select()
    .from(isps)
    .where(inArray(isps.id, [...new Set(due.map((p) => p.ispId))]));
  const ispById = new Map(ispRows.map((i) => [i.id, i]));

  for (const payment of due) {
    const link = linkById.get(payment.paymentLinkId);
    const isp = ispById.get(payment.ispId);
    if (!link || !isp) continue; /* unreachable: FKs guarantee both */
    try {
      const row = await runValidation(env, db, payment, link, isp, now);
      if (row.status === "confirmed") report.confirmed++;
      else if (row.status === "invalid") report.invalid++;
      else if (row.status === "expired") report.expired++;
      else if (row.status === "unapplied") report.unapplied++;
      else report.stillValidating++;
    } catch (e) {
      /* One broken row must not stall the rest; the lease brings it back */
      console.error(`direct-payment sweep failed for ${payment.id}:`, e);
      report.stillValidating++;
    }
  }

  return report;
}

/* Kept for the dev sweep endpoint: how many payments are waiting. */
export async function validatingCount(env: Bindings): Promise<number> {
  const db = drizzle(env.DB);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(directPayments)
    .where(eq(directPayments.status, "validating"));
  return Number(row?.n ?? 0);
}

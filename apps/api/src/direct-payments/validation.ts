import { and, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { cepRecords, payments, businesses, paymentLinks, validations } from "../db/schema";
import { debitValidationFee } from "../credit";
import { BANKS } from "./banks";
import { consta, ConstaError, type ConstaRequest, type ConstaVerdict, type RegisteredAccount } from "../consta";
import { fitClave, fitClaveTail, matchCandidates, shownTail, tailFits } from "../consta/bundle/match";
import { readPendingBundle, recordsFor } from "../consta/bundle/store";
import type { CepRecord, MatchMode, MatchResult, MatchTrail, ReceiptSide, UndecidedReason } from "../consta/bundle/types";
import {
  heldBefore,
  nudgeHolders,
  pendingBundleOf,
  type PendingBundle,
  promote,
  receiptSideOf,
  trailOf,
  unreadableCandidates,
  usedAmong,
} from "./cep-match";
import { asBeneficiary, sameAccount, tieCepAccount } from "../consta/extraction";
import {
  collectAccount,
  collectBankIsKnown,
  collectHalves,
  fromBeneficiary,
  parseAccount,
  parseAccounts,
  toBeneficiary,
} from "./accounts";
import { WispHubError, type PendingInvoices, type WispHub } from "../wisphub/client";
/* provider-address-per-isp D4: the money is registered on the
   business's own installation, never on the platform's. */
import { wisphubFor } from "../wisphub/factory";
import { NO_DEBT, debtFor, nothingOwedIsProven } from "../wisphub/debt";
import { readPendingInvoices } from "../wisphub/snapshot";
import { settle } from "./partial";
import { attemptReconnection } from "../wisphub/reconnection";
import { firstAttemptSchedule } from "../reconnection/queue";
import { makeFolio } from "../routes/payments/handler";
import { ladderSlot, nextValidationSlot, suggestedSlot } from "./schedule";
import { businessWallClock } from "../time/business-day";
import { classifyPayment, type ReconciliationClass } from "./classes";
import { integrationsFor, type Integration } from "../integrations/store";
import {
  actionForClass,
  hypothesisOf,
  outcomeOf,
  recordDispatch,
  settleDispatch,
} from "../integrations/dispatch";
import {
  historyVouches,
  maybeProvisionalRelease,
  notifyProvisionalExpiry,
  releaseEvidenceFor,
} from "./provisional";
import { isApiLink, isPanelLink, realOnly, type ApiLink, type PanelLink } from "./links";
import { enqueueAndDeliver, type Defer } from "../webhooks/queue";
import {
  customerKeyOf,
  endTransitionOnConfirm,
  holdersOf,
  learnedAccounts,
  referenceOfLink,
  transitionOf,
} from "./payer-reference";

/* One validation attempt of a direct payment (direct-payment spec).
   Shared by the inline attempt on submission and the sweep's
   re-validations (D7) — the same rules decide every outcome, exactly
   like the reconnection queue. */

type DB = DrizzleD1Database;
export type DirectPayment = typeof payments.$inferSelect;
type PaymentLink = typeof paymentLinks.$inferSelect;
type Isp = typeof businesses.$inferSelect;

/* D11: a CEP older than this window cannot pay today's debt. Measured
   2026-08-17: apiCEP treats the claimed date as a hint, not a filter,
   so the returned date is compared here. */
export const STALE_TRANSFER_DAYS = 30;

/* bug: valid-lost-on-later-failure — the cadence of a Banxico-confirmed
   row past its schedule: one WispHub read an hour, no provider call */
export const KEPT_RETRY_MINUTES = 60;

const LEASE_MINUTES = 2;
const BATCH = 20;
const minutes = (n: number) => n * 60 * 1000;

/* D3: the SPEI fee falls back to the birth default until one is saved
   (settings D9: the SPEI fee is the only fee the business edits) */
export function speiFeeCents(business: Isp): number {
  return business.speiServiceFeeCents ?? business.serviceFeeCents;
}

/* The vocabulary as a lookup. A name outside it cannot resolve a CEP —
   apiCEP answers `invalid`, never an error (D16) — so it is exactly the
   "nothing can validate" case D4 already refuses to show. */
const KNOWN_BANKS: ReadonlySet<string> = new Set(BANKS);

/* receipt-triage D32: the bank that must be known is the cuenta de
   cobro's — the CLABE's for every business born before this feature */
export function speiBankIsKnown(business: Isp): boolean {
  return collectBankIsKnown(business);
}

/* The channel gate, split in three (automated-collections-api D5). Until
   2026-09-17 one predicate, `speiAvailable`, demanded the CLABE, a known
   bank, the provider token AND the WispHub key — so "no WispHub key" meant
   "this business cannot collect", which was true while every business was
   an ISP and is false the moment a gym collects through /v1. The money
   never needed WispHub: the payer transfers to the business's CLABE and
   Banxico validates it. WispHub is where a *panel* link's ask comes from,
   nothing more. Each gate below names who can fix it, because that is
   what the answer to the caller hangs on:

     businessConfigured  the business's own — the only cause of
                         CHANNEL_UNAVAILABLE on /v1
     validationAvailable the platform's — a VALIDATION_UNAVAILABLE notice
                         on a created link, never a refusal of it
     askAvailable        a panel link's — needs the WispHub key; an API
                         link needs nothing more

   The payer's page still folds all three into one `unavailable` state
   (D4): a page that shows a CLABE nothing can validate would let
   customers transfer into the void, whoever's gap it is. */

/* What the business has not configured, or null when it has (FR-009):
   the account (the cuenta de cobro since receipt-triage D32 — the CLABE
   for every business born before it), or a bank outside apiCEP's
   vocabulary. `speiBank` being
   non-empty is not enough, and BUG-008 is why: a value stored before D16
   can be truthy and still outside the list. Measured live on dev
   2026-08-19 — an ISP held `Klar` where the list says `KLAR`, so every
   payment to it failed the moment D16 shipped, and failed *retryably*,
   which is the six-hour silence rather than an honest refusal.
   claimed-amount D5: the beneficiary name is recommended, never required
   — apiCEP asks only for clabe + bank, and the gates that demanded the
   name were all ours. */
export type ChannelGap = "clabe" | "bank";

/* receipt-triage D32: "clabe" names the gap it always named — no account
   to be paid at — now that the cuenta de cobro may be a card or a phone.
   The word stays because /v1 and the panel already speak it. */
export function channelGap(business: Isp): ChannelGap | null {
  if (!collectHalves(business).value) return "clabe";
  if (!speiBankIsKnown(business)) return "bank";
  return null;
}

export function businessConfigured(business: Isp): boolean {
  return channelGap(business) === null;
}

/* consta-api-merge D9: the engine is local; what can be absent is the
   provider's credential, planted per environment, and that alone decides
   whether an environment validates (constitution VIII). A platform
   condition: refusing a link for it would tell a developer to fix a
   setting they do not have, and punish the business for our outage. */
export function validationAvailable(env: Pick<Bindings, "APICEP_TOKEN">): boolean {
  return Boolean(env.APICEP_TOKEN);
}

/* Where the ask comes from. A panel link reads its debt live from WispHub,
   so without the key there is no amount to show and the channel is
   unavailable for *that link*; an API link carries `ask_cents` on the row
   and asks nothing of any integration. "No WispHub key" now means "no
   panel links", and nothing else. */
export function askAvailable(
  link: Pick<PaymentLink, "source">,
  /* integrations-hub D2: the key lives on the integration row now */
  integration: Pick<Integration, "apiKey"> | null,
): boolean {
  return link.source === "api" || Boolean(integration?.apiKey);
}

export function isUniqueViolation(e: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String(e instanceof Error ? e.message : e));
}

/* reading-check D2/D5: the comparison, **for legacy rows only** since
   two-eyes-receipt D16 — rows born before the cut-over, whose page sent
   a machine reading as typed data and whose two readings therefore only
   meet at minute two. Its sibling for every new row is the engine's own
   `extraction/compare.ts`, which runs at the first paid call with the
   shape rules to break a tie; this one has neither and never will.
   Both die together: `.specify/debt/legacy-minute-two-cross/`.

   Clave and amount are the two Banxico search filters (both measured) —
   the only fields that can raise a dispute; a bank-name or date
   difference never wakes the human. No clave from the provider means no
   second opinion: blind, and the payment keeps today's exact behaviour. */
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
  /* The real clock when this attempt began: a record written by this
     attempt's own search does not count as an earlier one */
  startedAt: Date,
): Promise<boolean> {
  const attempted = (p: DirectPayment) => p.validationAttempts > 0 || p.constaStatus !== null;

  let cursor = payment.supersedesId;
  for (let hops = 0; cursor && hops < 20; hops++) {
    const [prior] = await db.select().from(payments).where(eq(payments.id, cursor));
    if (!prior) break;
    if (attempted(prior)) return true;
    cursor = prior.supersedesId;
  }

  const key = payment.trackingKey ?? cepTrackingKey;
  if (!key) return false;
  const siblings = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.paymentLinkId, payment.paymentLinkId),
        eq(payments.trackingKey, key),
        ne(payments.id, payment.id),
      ),
    );
  if (siblings.some(attempted)) return true;

  /* bug: valid-lost-on-later-failure — the first validation of this CEP
     was ours, whatever the link: a `valid` the provider called
     never-validated, asked for another payment of this same business.
     Found live on 2026-09-26: a transfer validated on one link and never
     applied was refused on another as "validated outside Devolada". Safe
     to forgive because it is not what stops a double payment — the
     unique clave index is (D8): a payment that holds the clave alive
     still refuses this one when the clave is claimed below. */
  const [ours] = await db
    .select({ id: validations.id })
    .from(validations)
    .innerJoin(payments, eq(payments.id, validations.paymentRef))
    .where(
      and(
        eq(validations.businessId, payment.businessId),
        eq(payments.businessId, payment.businessId),
        eq(validations.trackingKey, key),
        eq(validations.status, "valid"),
        eq(validations.alreadyValidated, false),
        ne(payments.id, payment.id),
      ),
    )
    .limit(1);
  if (ours != null) return true;

  /* cep-bundle-match D13 (FR-016): a search by reference that Banxico
     answered with this transfer marked it "validated" at the provider —
     measured for a single `valid` (F6), unmeasured for a bundle (R13) —
     and the matcher may have refused it for that payment. When its true
     owner later finds it, the flag is our own doing: the business's
     records say one of our searches returned it before this attempt. The
     unique clave index still refuses a second use inside Devolada. */
  return heldBefore(db, payment.businessId, key, startedAt);
}

/* automated-collections-api D7/D17 (FR-013): every status an API
   link's payment enters is announced to the business's endpoint —
   here, in the one write every terminal outcome of an attempt passes
   through, so `expired`, `invalid` and the API half's own verdicts all
   announce without a list of call sites to keep in step. Compared
   against the last status seen, so one attempt announces each state
   once; a write that keeps the status (a retry with a later slot)
   announces nothing. A panel payment's outcome is WispHub's and never
   reaches here. Shared by the validation and by test mode's advance
   (D12): a test verdict is written by the same hand as a real one. */
function announcingWriter(
  env: Bindings,
  db: DB,
  payment: DirectPayment,
  link: PaymentLink,
  now: Date,
  defer?: Defer,
): (values: Partial<typeof payments.$inferInsert>) => Promise<DirectPayment> {
  let announced = payment.status;
  return async (values) => {
    /* bug: one-open-attempt — a payer can replace an attempt while its
       own validation is in flight. A verdict that paid it still lands:
       Banxico says the money arrived, and by then WispHub may have heard
       it too. Anything else — a retry slot, `invalid`, `expired` — would
       bring a replaced attempt back to life, so it is dropped and the row
       stays `superseded`. */
    const paid = values.status === "confirmed" || values.status === "partial" || values.status === "unapplied";
    const [row] = await db
      .update(payments)
      .set(values)
      .where(paid ? eq(payments.id, payment.id) : and(eq(payments.id, payment.id), ne(payments.status, "superseded")))
      .returning();
    if (!row) {
      const [current] = await db.select().from(payments).where(eq(payments.id, payment.id));
      return current;
    }
    /* prepaid-credit D2: the fee keys on the terminal verdict, once per
       payment — idempotent in the book, so every path may call it */
    await debitValidationFee(env, db, row);
    /* payment-without-receipt D26: the previous holder's first confirmation
       with their new number ends the transition early */
    if (paid && row.referenceSource === "own") await endTransitionOnConfirm(db, row, now);
    /* receipt-triage D31: a held payment is announced by the ISP's
       decision, never before — `announced` stays where it was so the
       accept (or the reject) is what the endpoint hears */
    if (isApiLink(link) && row.status !== announced && row.actionOutcome !== "review") {
      announced = row.status;
      await enqueueAndDeliver(env, db, { payment: row, link, now }, defer);
    }
    return row;
  };
}

/* payment-without-receipt D14: the calendar days either side of the day
   the payer gave — never after today, and never the operation day Banxico
   files a night transfer under (it finds nothing by it, measured
   2026-09-26: bug reference-search-printed-day). The fix of that bug left
   the misremembered day to this round. */
export function neighbourDays(day: string, today: string): string[] {
  const shift = (n: number) => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return [shift(-1), shift(1)].filter((d) => d <= today);
}

/* payment-without-receipt D14/D23: `payments.confirmation`, read safely */
export type Confirmation = {
  preselectedBank: string | null;
  preselectedDay: string | null;
  days: string[];
  /* D24: the clave a row refused as already used was refused for */
  usedClave?: string | null;
};
export function confirmationOf(row: Pick<DirectPayment, "confirmation">): Confirmation {
  try {
    const parsed = row.confirmation ? (JSON.parse(row.confirmation) as Partial<Confirmation>) : {};
    return {
      preselectedBank: parsed.preselectedBank ?? null,
      preselectedDay: parsed.preselectedDay ?? null,
      days: Array.isArray(parsed.days) ? parsed.days : [],
      ...(parsed.usedClave ? { usedClave: parsed.usedClave } : {}),
    };
  } catch {
    return { preselectedBank: null, preselectedDay: null, days: [] };
  }
}

/* The searched data two rows of one chain share — what makes a tail
   typed on the newer one an answer to the older one's candidates */
const sameSearch = (a: DirectPayment, b: DirectPayment) =>
  a.referenceNumber === b.referenceNumber &&
  a.senderBank === b.senderBank &&
  a.transferDate === b.transferDate &&
  (a.claimedAmountCents ?? a.amountCents) === (b.claimedAmountCents ?? b.amountCents);

/* payment-without-receipt D10, D11, D26: what the matcher knows of the
   payer, for a row searched by a reference. `own` — the accounts learned
   for this service, and during a D26 transition the new owner's across
   their services, with the previous holder's to drop; `typed` — the
   accounts learned for this service at the bank the payer named. */
async function payerSide(
  db: DB,
  payment: DirectPayment,
  link: PaymentLink,
  now: Date,
): Promise<{ mode: MatchMode; side: Pick<ReceiptSide, "knownAccounts" | "excludedAccounts"> }> {
  const key = customerKeyOf(link);
  if (!payment.referenceSource || !key) return { mode: "receipt", side: {} };
  if (payment.referenceSource === "typed") {
    return { mode: "typed", side: { knownAccounts: await learnedAccounts(db, payment.businessId, [key], { bank: payment.senderBank }) } };
  }
  const reference = await referenceOfLink(db, link, now);
  const transition = reference ? await transitionOf(db, payment.businessId, reference, now) : null;
  if (!reference || !transition) {
    return { mode: "own", side: { knownAccounts: await learnedAccounts(db, payment.businessId, [key]) } };
  }
  const [mine, previous] = await Promise.all([
    holdersOf(db, payment.businessId, reference.id),
    holdersOf(db, payment.businessId, transition.previousReferenceId),
  ]);
  return {
    mode: "own",
    side: {
      knownAccounts: await learnedAccounts(db, payment.businessId, mine),
      excludedAccounts: await learnedAccounts(db, payment.businessId, previous),
    },
  };
}

export async function runValidation(
  env: Bindings,
  db: DB,
  payment: DirectPayment,
  link: PaymentLink,
  business: Isp,
  /* integrations-hub D2: key, threshold, floor and the provisional
     switch read from here; null = not connected */
  integration: Integration | null,
  now: Date,
  /* automated-collections-api D8: where the first webhook attempt may
     run past this call's return (`ctx.waitUntil`). The sweep passes
     none — its verdicts are picked up by the webhook sweep chained
     after it the same minute. */
  opts: { defer?: Defer } = {},
): Promise<DirectPayment> {
  const update = announcingWriter(env, db, payment, link, now, opts.defer);
  /* cep-bundle-match D13: the real clock at the start of this attempt —
     never `now`, which a sweep may carry from the past or the future */
  const startedAt = new Date();

  /* A retryable failure rides the D7 schedule like a pending CEP; when
     the schedule is exhausted the honest terminal state is `expired` —
     everything gathered so far stays on the row for the ISP. Only
     `not_found` passes `lateSlot` (validation-status-ux D4): the extra
     T+12h attempt exists for the transfer Banxico may still publish,
     never for our own outages. */
  const retryLater = async (
    error: string,
    base: Partial<typeof payments.$inferInsert> = {},
    opts: { lateSlot?: boolean; suggestedAt?: Date | null } = {},
  ) => {
    /* bug: valid-lost-on-later-failure — a row Banxico already confirmed
       is never `expired`: what it waits on is ours or the ISP's (WispHub),
       and its retries cost no provider call, so past the schedule it
       keeps being retried on the hour */
    const kept = payment.banxicoValidAt != null || base.banxicoValidAt != null;
    /* payment-without-receipt D14: a row searched by a reference rides the
       ladder of rounds that got an answer — this attempt's, when `base`
       carries it, else the row's (a `429` or an outage is not a round) */
    const slot =
      (payment.referenceSource != null
        ? ladderSlot(payment.createdAt, now, base.ladderRound ?? payment.ladderRound, opts)
        : nextValidationSlot(payment.createdAt, now, opts)) ??
      (kept ? new Date(now.getTime() + minutes(KEPT_RETRY_MINUTES)) : null);
    const row = await update(
      slot
        ? { ...base, lastError: error, nextValidationAt: slot }
        : { ...base, status: "expired", lastError: error, nextValidationAt: null },
    );
    /* provisional-release D8: a released ride that just expired is the
       one exception the ISP signed up to hear about — after a fresh debt
       check, and never blocking the sweep. */
    if (!slot && row.provisionalReleaseAt != null) {
      await notifyProvisionalExpiry(env, db, business, integration, link, now);
    }
    return row;
  };

  /* cep-bundle-match D10: an undecided payment waits on its payer alone.
     No slot brings it here — the undecided write clears
     `next_validation_at` and the sweep selects only rows that have one —
     so it never reaches `retryLater`'s expiry above: no call is made until
     the clave arrives as a superseding row (D11), and it does not expire
     meanwhile, however long the payer takes. Should a future path re-arm
     it, it is put back to wait, with no call. A row provisionally released
     before it went undecided keeps its WispHub promise until the promise
     lapses on its own; `notifyProvisionalExpiry` runs on an expiry only,
     so never for it. */
  if (payment.status === "validating" && payment.lastError === "CEP_UNDECIDED") {
    return update({ nextValidationAt: null });
  }

  /* bug: valid-lost-on-later-failure — Banxico already confirmed this
     transfer on an earlier attempt, and what failed after it was WispHub.
     Resume there: no provider call, no credential needed, the CEP's facts
     from the row. Only a panel link can hold one (the API half never
     waits on WispHub). */
  if (payment.banxicoValidAt != null && isPanelLink(link)) {
    const hold = payment.reviewReason ?? null;
    return settlePanelPayment(env, db, payment, link, business, integration, now, update, retryLater, {}, {
      amountCents: payment.receivedCents,
      senderName: payment.cepSenderName,
    }, hold);
  }

  /* consta-api-merge D6: the engine's own code on the row. A payment
     already in flight when the credential is absent rides the schedule,
     it never dies for it (FR-009). */
  if (!env.APICEP_TOKEN) {
    return retryLater("PROVIDER_NOT_CONFIGURED");
  }
  /* receipt-triage D25, D27, D30 — the account comes from the payment,
     never the business (FR-021). It used to be the business's CLABE read
     fresh on every attempt, so an ISP that edited Cuenta moved every
     payment in flight. Every row born since this feature carries the
     account it was submitted under and the accounts registered then; a
     row with neither was born before it, and keeps today's fallback —
     the business's cuenta de cobro, which for such a business is its
     CLABE — with `legacy`, so the engine finishes it under the flow it
     started in (FR-027). */
  const legacy = payment.beneficiary == null && payment.registeredAccounts == null;
  const snapshot = legacy ? null : parseAccount(payment.beneficiary);
  const beneficiary: RegisteredAccount | null = snapshot
    ? toBeneficiary(snapshot, business.speiBeneficiaryName)
    : collectAccount(business);
  if (!beneficiary) {
    /* The ISP un-configured SPEI between submission and this attempt.
       The beneficiary name is not part of this check (claimed-amount D5). */
    return retryLater("SPEI_NOT_CONFIGURED");
  }
  if (!KNOWN_BANKS.has(beneficiary.bank)) {
    /* BUG-008: retrying cannot fix the ISP's own configuration, and the
       engine's guard would refuse it with a REQUEST_REJECTED the schedule
       retries anyway. Stop here and name it, so the ISP sees a
       configuration problem rather than a customer seeing "Verificando"
       for six hours. */
    return retryLater("SPEI_BANK_UNKNOWN");
  }
  /* D30: what the receipt's destination is tied against — the snapshot,
     or the one account a legacy row knows */
  const accounts: RegisteredAccount[] = legacy
    ? [beneficiary]
    : parseAccounts(payment.registeredAccounts).map((a) => toBeneficiary(a, business.speiBeneficiaryName));
  if (!accounts.length) accounts.push(beneficiary);
  /* reading-check D1 — **legacy rows only since two-eyes-receipt D16.**

     The minute-two cross was how the two readings ever met: attempt 2
     sent the image so the provider's own OCR could be a second,
     independent opinion, in the paid call the slot was going to spend
     anyway. Rows born after the cut-over classify at the *first* call
     instead (D5), because the file now goes to the image door with our
     reading beside it — so for them this branch must never run, or the
     payment would pay twice for the same comparison.

     The shape is what tells them apart, with no column and no migration
     (research R10): `proof_mode = 'transfer'` with a `proof_key` and no
     `supersedes_id` is a payment whose page sent a machine reading as
     typed data, which is exactly what D13 stopped doing. A machine
     reading is born `receipt` now; a typed correction is born with a
     `supersedes_id`; the manual door has no `proof_key`. No new row can
     have this shape, so the branch dies with the last pre-cut-over row,
     within the 12-hour late slot. Its removal is registered as debt
     (`.specify/debt/legacy-minute-two-cross/`).

     `providerOcr` is what makes the cross independent (proof-extraction
     D11): without it Consta's reader runs again, and the same model
     checking itself is no second opinion. */
  const crossCheck =
    payment.proofMode === "transfer" &&
    payment.proofKey != null &&
    payment.supersedesId == null &&
    payment.validationAttempts === 1 &&
    payment.lastError === "TRANSFER_NOT_FOUND" &&
    payment.readingCheck === null;

  /* provisional-release D4: the refs travel on every call — cross,
     transfer and receipt doors alike — from day one, toggle state
     irrespective. History only accumulates forward, and the month it is
     not collected is evidence lost. The release rule reads none of it.
     consta-api-merge D5: unconditional now. The usuario used to travel
     as an HMAC under an optional secret because it crossed the network
     to another service, and the secret's absence once lost a month of
     history (BUG-010); the validation row sits in this same database
     now, three tables from the link, so the disguise protected nothing.
     `customerRef` is the link's own customer identity — its usuario for
     a panel link, the caller's own reference for an API link
     (automated-collections-api D3). */
  const customerRef = link.source === "api" ? link.customerRef : link.customerUsuario;
  const refs = { ...(customerRef ? { customerRef } : {}), paymentRef: payment.id };

  /* consta-api-merge D7: the receipt door names the proof's key in the
     product's own bucket; the engine reads the bytes itself and signs a
     short-lived link (D12) only for what the provider must read. */
  /* two-eyes-receipt D17 — the door of this attempt is read from the
     row, not from `proof_mode`.

     `proof_mode` keeps meaning what the payer submitted (a file or a
     form), which is what the admin feed shows and what the `human`
     release rule reads; flipping it after an agreement would lie to
     both. What decides the door is whether the row holds everything the
     provider's transfer door needs: a clave, a bank, an amount and a
     date. They get there three ways — the payer typed them, the CEP
     revealed them, or (since D6/D7) the two readings settled on them at
     minute zero. All three are the same code path from here.

     The date is part of the test on purpose (D20). Accepted data with no
     date never reaches the transfer door: `disputed_fields` carries
     `"date"`, the payer is asked for that one field, and their answer
     supersedes the row with it. Filling the hole with today — which this
     builder used to do for every row — quietly asks Banxico about the
     wrong day and gets a faceless `not_found` back for a real transfer.
     The manual door keeps the fallback below, because a row with no
     `proof_key` has nowhere else to go and its date came from a human. */
  /* receipt-triage D11: a key is a clave **or** a reference — a row that
     holds either, with the bank, the amount and the date, takes the
     transfer door. There is no account condition: every row has its
     account from submission (D25; the candidate list and D23 retired). */
  const accepted =
    (payment.trackingKey != null || payment.referenceNumber != null) &&
    payment.senderBank != null &&
    payment.claimedAmountCents != null &&
    payment.transferDate != null;
  /* `proof_mode` still decides one thing, and only this one: whether a
     *human* put the data there. A form the payer edited is the human's
     data and takes the transfer door on every attempt, with no contrast
     and no second-guessing (FR-015, D13) — even when it carries a file
     beside it, and even when it named no amount, because a typed row
     falls back to the debt's own for the search criterion. Everything
     else with a file rides the receipt door until the machines have
     settled on something. */
  const receiptDoor = payment.proofKey != null && payment.proofMode === "receipt" && !accepted;

  /* receipt-triage D1/D11: the transfer door carries exactly one key —
     the clave when the row has one, the reference only when it has none.
     When both exist the reference stays on the row and never travels,
     first attempt and every retry. */
  const byReference = !crossCheck && !receiptDoor && payment.trackingKey == null && payment.referenceNumber != null;

  /* receipt-triage D17/D7: a reference the provider said matches more than
     one transfer, or one another payment of the business already holds,
     buys nothing on a second call with the same data. The row waits on
     its schedule for the payer's clave — their correction supersedes it
     (two-eyes D18) — and ends `expired` if none comes. No counter moves:
     no call is made. (cep-bundle-match D1: the provider answers several
     matches with a bundle, never the 422 that `REFERENCE_AMBIGUOUS` was
     written for — measured 2026-09-26; the row it would mark is kept for
     the answer the provider documents.) payment-without-receipt D9: a row
     with a `reference_source` is never marked REFERENCE_SHARED — the
     stops below guard the rows without one. */
  if (
    payment.trackingKey == null &&
    (payment.lastError === "REFERENCE_AMBIGUOUS" || payment.lastError === "REFERENCE_SHARED")
  ) {
    return retryLater(payment.lastError);
  }

  /* payment-without-receipt D14: which round this attempt is, for a row
     searched by a reference */
  const sourced = payment.referenceSource != null;

  /* ---- cep-bundle-match: what is decided here with no provider call ----

     A transfer one of this business's searches already returned is kept as
     a record (D5), so three attempts need no call at all: a clave the
     payer typed that fits a candidate the undecided payment kept (D11), a
     clave any payment holds that is already a record (D14), and a bundle
     the last slot could not download (D16). Each ends in the ordinary
     `valid` branch below, or — the bundle — in the matcher. */
  let local: ConstaVerdict | null = null;
  let localTrail: MatchTrail | null = null;
  /* D16: what a retried download's search asked with (converge T054) */
  let asked: PendingBundle["asked"] | null = null;

  /* D11 (research R11): the row supersedes an undecided one, and its clave
     fits exactly one of that row's kept candidates — as typed, O read as
     0, I as 1, or one character short. Forgiveness only against what the
     bundle held, never against Banxico. The fitted clave replaces the
     typed one: it is Banxico's, and the unique index must hold the truth.
     It is still the payer's claim, so another live payment holding it is a
     real second use (D18). */
  if (payment.trackingKey && payment.supersedesId && !crossCheck && !receiptDoor) {
    const [prior] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.id, payment.supersedesId), eq(payments.businessId, business.id)));
    const priorTrail = prior?.lastError === "CEP_UNDECIDED" && prior.matchTrail ? (JSON.parse(prior.matchTrail) as MatchTrail) : null;
    if (priorTrail) {
      const kept = priorTrail.candidates.filter((c) => c.cepId && c.why !== "amount" && c.why !== "account");
      const fit = fitClave(payment.trackingKey, kept.map((c) => c.clave));
      const [record] = fit ? await recordsFor(db, business.id, [fit]) : [];
      if (record) {
        if (record.clave !== payment.trackingKey) {
          try {
            await db.update(payments).set({ trackingKey: record.clave }).where(eq(payments.id, payment.id));
          } catch (e) {
            if (!isUniqueViolation(e)) throw e;
            return update({ status: "invalid", nextValidationAt: null, lastError: "TRANSFER_ALREADY_USED" });
          }
        }
        local = promote(record, { validationId: prior!.constaValidationId ?? "" }, payment.senderBank);
        localTrail = {
          ...priorTrail,
          decided: "chosen",
          by: "clave",
          reason: null,
          candidates: priorTrail.candidates.map((c) =>
            c.clave === record.clave ? { ...c, fate: "chosen" as const, why: null } : c,
          ),
        };
      }
    }
  }

  /* payment-without-receipt D11, D17 (FR-033, FR-015): a tail the payer
     typed to answer an undecided row of their own chain — the sending
     account's four digits, or the clave's last four characters — is
     fitted against that row's kept transfers, with no call, exactly as
     cep-bundle-match D11 fits a whole clave. A tail is never searched at
     Banxico. One fit confirms from the record; none or several stays
     undecided, and the page asks the next thing (D15). Only when the
     searched data are the ones the older row searched: a correction of
     the bank, the day, the amount or the reference searches again. */
  if (!local && sourced && payment.supersedesId && !payment.trackingKey && (payment.claveTail || payment.senderTail) && !crossCheck && !receiptDoor) {
    const [prior] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.id, payment.supersedesId), eq(payments.businessId, business.id)));
    const priorTrail = prior?.lastError === "CEP_UNDECIDED" && prior.matchTrail ? (JSON.parse(prior.matchTrail) as MatchTrail) : null;
    if (prior && priorTrail && sameSearch(prior, payment)) {
      const keptClaves = priorTrail.candidates
        .filter((c) => c.cepId && !["amount", "account", "used", "excluded", "unreadable"].includes(c.why ?? ""))
        .map((c) => c.clave);
      const usedNow = await usedAmong(db, business.id, payment.id, keptClaves);
      const free = (await recordsFor(db, business.id, keptClaves)).filter((r) => !usedNow.has(r.clave.toUpperCase()));
      let fits: CepRecord[];
      let by: "clave_tail" | "sender_tail";
      if (payment.claveTail) {
        const fit = fitClaveTail(payment.claveTail, free.map((r) => r.clave));
        fits = fit ? free.filter((r) => r.clave === fit) : [];
        by = "clave_tail";
      } else {
        fits = free.filter((r) => tailFits(payment.senderTail!, r));
        by = "sender_tail";
      }
      const claimed = fits.length === 1 ? await chooseAndClaimOne(db, payment.id, fits[0].clave) : false;
      if (claimed) {
        local = promote(fits[0], { validationId: prior.constaValidationId ?? "" }, payment.senderBank);
        localTrail = {
          ...priorTrail,
          decided: "chosen",
          by,
          reason: null,
          receipt: { time: null, tail: payment.senderTail },
          candidates: priorTrail.candidates.map((c) =>
            c.clave === fits[0].clave ? { ...c, fate: "chosen" as const, why: null } : c,
          ),
        };
      } else {
        const left = new Set((fits.length > 1 ? fits : []).map((r) => r.clave));
        return update({
          lastError: "CEP_UNDECIDED",
          disputedFields: JSON.stringify(["trackingKey"]),
          nextValidationAt: null,
          matchTrail: JSON.stringify({
            ...priorTrail,
            decided: "undecided",
            by: null,
            reason: left.size ? "no_signal" : fits.length === 1 ? "all_used" : "none_fit",
            receipt: { time: null, tail: payment.senderTail },
            candidates: priorTrail.candidates.map((c) =>
              left.has(c.clave)
                ? { ...c, fate: "kept" as const, why: null }
                : c.fate === "kept"
                  ? { ...c, fate: "dropped" as const, why: "tail" as const }
                  : c,
            ),
          } satisfies MatchTrail),
        });
      }
    }
  }

  /* D14 (research R14): other customers' CEPs, by pull. A payment that
     holds a clave looks among the business's records before any paid
     search: a transfer one of our searches already returned — typically
     in another customer's bundle — confirms it with no call. Only the
     transfer door by clave: the receipt door's clave is read inside the
     engine, on the provider's first answer. */
  if (!local && payment.trackingKey && !crossCheck && !receiptDoor) {
    const [record] = await recordsFor(db, business.id, [payment.trackingKey]);
    if (record) {
      local = promote(record, null, payment.senderBank);
      localTrail = {
        source: record.bundleId ? "several" : "single",
        bundleId: record.bundleId,
        decided: "chosen",
        by: "clave",
        reason: null,
        receipt: { time: payment.transferTime, tail: payment.senderTail },
        candidates: [
          {
            cepId: record.id,
            clave: record.clave,
            creditTime: record.creditTime,
            tail: shownTail(record, payment.senderTail),
            fate: "chosen",
            why: null,
          },
        ],
      };
    }
  }

  /* D16: the bundle the last slot could not download. The download is not
     a provider call — no credit, no `validations` row — and the third
     failure gives up (`unreadable`); what it reads goes to the matcher
     below exactly as a fresh several answer would. */
  if (!local && payment.lastError === "CEP_BUNDLE_PENDING") {
    const pending = await pendingBundleOf(db, business.id, payment.id);
    const bundle = pending ? await readPendingBundle(env, db, { businessId: business.id }, pending.id) : null;
    if (bundle) {
      asked = pending!.asked;
      local = {
        validationId: payment.constaValidationId ?? "",
        status: "invalid",
        reason: "several",
        alreadyValidated: false,
        bundle,
      };
    }
  }

  /* receipt-triage D7 (FR-007): before any paid call that would search by
     a reference, another payment of the business with the same five data
     means the reference cannot find *this* transfer alone — the payer is
     asked for the clave instead of the provider being paid to say so.
     Finding none is not proof the reference is unique.
     cep-bundle-match D12 (FR-015) narrows it: with the receipt's time or
     its sender's digits on the row, the search runs — several matches come
     back as a bundle, and the matcher tells them apart. Only a receipt
     that shows neither is still asked with no call. */
  /* payment-without-receipt D9: a row searched by a payer's reference
     never meets this stop — an own reference is one person's, and a typed
     one never confirms without a second fact (D11) */
  if (!local && !sourced && byReference && payment.transferTime == null && payment.senderTail == null) {
    const shared = await sharedReference(db, business, link, {
      paymentId: payment.id,
      reference: payment.referenceNumber!,
      date: payment.transferDate ?? "",
      senderBank: payment.senderBank ?? "",
      amountCents: payment.claimedAmountCents ?? payment.amountCents,
      account: snapshot,
    });
    if (shared) {
      return retryLater("REFERENCE_SHARED", { disputedFields: JSON.stringify(["trackingKey"]) });
    }
  }
  /* payment-without-receipt D14: round 3 of a row searched by a reference
     asks each neighbouring day once; every other round, the day given */
  const givenDay = payment.transferDate ?? businessWallClock(business.timezone, now).date;
  const days =
    sourced && byReference && payment.ladderRound + 1 === 3
      ? neighbourDays(givenDay, businessWallClock(business.timezone, now).date)
      : [givenDay];
  const requestFor = (day: string): ConstaRequest => crossCheck
    ? {
        receipt: { proofKey: payment.proofKey ?? "" },
        beneficiary: asBeneficiary(beneficiary),
        providerOcr: true,
        ...refs,
      }
    : receiptDoor
      ? {
          receipt: { proofKey: payment.proofKey ?? "" },
          beneficiary: asBeneficiary(beneficiary),
          /* receipt-triage D30: the snapshot the destination is tied
             against; D27: a row born before this feature carries `legacy`
             instead, and the engine skips the ask and the tie for it */
          ...(legacy ? { legacy: true as const } : { receivingAccounts: accounts }),
          ...refs,
        }
      : {
          transfer: {
            /* D2/Consta D1: amount and beneficiary are server-supplied;
               only the customer's own transfer data travels from input.
               The fallback is the manual door's alone now (D20): every
               other row that reaches here has a date, because a row
               without one took the receipt door above. */
            /* bug: reference-search-printed-day — a clave and a reference
               alike ask the day the receipt printed or the payer typed, on
               every attempt. Banxico's CEP query answers that day (the
               CEP's *fecha de abono*) and never the operation day it
               files a transfer under (measured 2026-09-26, cep-scl batch
               A0E0097211: 16 of 16 by the printed day, 0 of 14 by the
               operation day), so the alternation spei-date-rollover
               added only spent calls. The fallback is the business's
               day: the UTC date is tomorrow from 18:00 in Mexico City. */
            date: day,
            /* partial-payment D5: the amount is a **search criterion**,
               not an assertion. Asking with what we expected finds
               nothing when the payer fell short, so what travels is what
               the receipt said — or, on the manual door, what the payer
               typed (claimed-amount D1/D3: the truth about the amount
               lives on the receipt or with the human, never in the
               debt). The fallback covers rows born before that field. */
            amountCents: payment.claimedAmountCents ?? payment.amountCents,
            senderBank: payment.senderBank ?? "",
            ...(payment.trackingKey != null
              ? { trackingKey: payment.trackingKey }
              : { referenceNumber: payment.referenceNumber ?? "" }),
            beneficiary: asBeneficiary(beneficiary),
          },
          ...refs,
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
  /* cep-bundle-match: a decision taken above made no call, so it counts
     no attempt */
  let attempts = payment.validationAttempts;
  /* bug: one-open-attempt — the claim is also the last look before a
     paid call: an attempt the payer replaced since it was read (the
     sweep's batch, the inline attempt's insert) is not asked about.
     payment-without-receipt D14: one claim per call, so a round that
     searches two days counts two */
  const claim = async (): Promise<DirectPayment | null> => {
    attempts += 1;
    const [claimed] = await db
      .update(payments)
      .set({ validationAttempts: attempts })
      .where(and(eq(payments.id, payment.id), ne(payments.status, "superseded")))
      .returning();
    if (claimed) return null;
    const [current] = await db.select().from(payments).where(eq(payments.id, payment.id));
    return current;
  };
  /* payment-without-receipt D14: the days this attempt's calls searched */
  const searched: string[] = [];

  let verdict: ConstaVerdict;
  /* consta-api-merge D3: the business is the identity — the refs above
     accumulate history in this tenant's chains because the engine
     writes the row under `business_id` (payments-and-classes D7's key
     per business existed only to reach the same attribution over a
     wire). D6/FR-011: every engine failure still rides the schedule,
     whether or not waiting can help; the row keeps the engine's own
     code so the ISP can see which it was. */
  if (local) {
    verdict = local;
  } else {
    let answer: ConstaVerdict | null = null;
    let failure: unknown = null;
    for (const day of days) {
      const replaced = await claim();
      if (replaced) return replaced;
      try {
        answer = await consta(env, db, { businessId: business.id }, {
          /* receipt-triage D7 (converge T060): the question only the lifecycle
             can answer, asked by the engine on the receipt door */
          referenceTaken: (r) =>
            sharedReference(db, business, link, {
              paymentId: payment.id,
              reference: r.referenceNumber,
              date: r.date,
              senderBank: r.senderBank,
              amountCents: r.amountCents,
              account: fromBeneficiary(r.account),
            }),
        }).validate(requestFor(day));
        searched.push(day);
      } catch (e) {
        /* payment-without-receipt D14: a neighbouring day that got no
           answer after one that did leaves the round to what came back */
        if (!answer) failure = e;
        break;
      }
      /* the next neighbouring day only after nothing was found on this one */
      if (!(answer.status === "invalid" && answer.reason === "not_found")) break;
    }
    try {
      if (!answer) throw failure;
      verdict = answer;
    } catch (e) {
      const code = e instanceof ConstaError ? e.code : "PROVIDER_UNAVAILABLE";
      console.error("consta validation failed:", code);
      /* receipt-triage D17 (FR-007): the provider's 422, as published —
         "the reference matches more than one transfer". The one remedy is
         the clave, so the payer is asked for it alone, and the slots stop
         calling (above) until it arrives. cep-bundle-match D1: measured
         2026-09-26, several matches never come back as this 422 (24
         calls, none) but as a bundle of their CEPs, which the matcher
         below decides; the branch stays for the answer the provider
         documents. */
      if (e instanceof ConstaError && e.hint === "provide_tracking_key" && byReference) {
        return retryLater("REFERENCE_AMBIGUOUS", { disputedFields: JSON.stringify(["trackingKey"]) });
      }
      /* receipt-triage D7 (FR-007): the receipt door's own stop — the row
         asks for the clave, and the slots after it make no call (above) */
      if (e instanceof ConstaError && e.code === "RECEIPT_REFERENCE_SHARED") {
        return retryLater("REFERENCE_SHARED", { disputedFields: JSON.stringify(["trackingKey"]) });
      }
      return retryLater(code);
    }
  }

  /* cep-bundle-match D15 (analyze I1): the receipt's side of a match, from
     the reading this attempt carried — `ourReading` rides every outcome of
     a provider-first call, so the first attempt on the receipt door stores
     it whatever the answer (a `valid` used to take the CEP's data and
     leave both empty). Never overwriting what the row holds; never on a
     typed row, whose form asks for neither. */
  const read = verdict.ourReading ?? null;
  const base: Partial<typeof payments.$inferInsert> = {
    /* Already written above; repeated so every terminal write carries a
       consistent row, and harmless because it is the same number. */
    validationAttempts: attempts,
    /* A decision taken with no call keeps the call that bought its data */
    constaValidationId: verdict.validationId || payment.constaValidationId,
    constaStatus: verdict.status,
    /* receipt-triage D22/D30: the account the engine named on the receipt
       door — the one the receipt's digits tied, retired ones included —
       is the account this payment is checked against from now on */
    ...(verdict.beneficiaryUsed && !legacy
      ? { beneficiary: JSON.stringify(fromBeneficiary(verdict.beneficiaryUsed)) }
      : {}),
    ...(read?.time && payment.transferTime == null ? { transferTime: read.time } : {}),
    ...(read?.senderTail && payment.senderTail == null ? { senderTail: read.senderTail } : {}),
    /* D11/D14: a clave fitted to a kept candidate, or pulled from a record */
    ...(localTrail ? { matchTrail: JSON.stringify(localTrail), matchDistanceS: null } : {}),
    /* payment-without-receipt D14: an attempt that got an answer is a round,
       and every day it searched joins the read-back */
    ...(sourced && !local
      ? {
          ladderRound: payment.ladderRound + 1,
          confirmation: JSON.stringify({
            ...confirmationOf(payment),
            days: [...new Set([...confirmationOf(payment).days, ...searched])],
          }),
        }
      : {}),
  };
  /* payment-without-receipt D24: the clave a row searched by a reference
     was refused for, so its status can say which payment used it */
  const refusedFor = (clave: string | null | undefined): Partial<typeof payments.$inferInsert> =>
    sourced && clave
      ? { confirmation: JSON.stringify({ ...confirmationOf({ confirmation: (base.confirmation as string | undefined) ?? payment.confirmation }), usedClave: clave }) }
      : {};

  /* ---- cep-bundle-match D8, D9, D10, D16, D18 — a search without a clave.

     Every CEP such a search found passes the matcher before it may confirm
     (FR-014): the several answer's bundle, and the single `valid` alike —
     the single one was confirmed unchecked until now, and a receipt
     printed 18:58 took its payer's own 07:19 transfer (bug:
     reference-finds-other-transfer). The engine read the documents; this
     decides, with what only the database knows: the claves live payments
     hold, and what the receipt said. One left is promoted to the ordinary
     `valid` below. None or several is undecided (D10): `validating` with
     `CEP_UNDECIDED`, the clave asked, and no slot — so no call and no
     expiry, however long the payer takes. ---- */
  if (
    (verdict.status === "invalid" && verdict.reason === "several" && verdict.bundle) ||
    (verdict.status === "valid" && verdict.record !== undefined && !localTrail)
  ) {
    const several = verdict.status === "invalid";
    const bundle = verdict.bundle ?? null;
    /* The search's own amount and bank: what travelled on the transfer
       door; what the provider read on the image door */
    const imageDoor = receiptDoor || crossCheck;
    const searchedCents = imageDoor
      ? (verdict.reading?.amountCents ?? read?.amountCents ?? payment.claimedAmountCents ?? asked?.amountCents ?? null)
      : (payment.claimedAmountCents ?? payment.amountCents);
    const searchedBank = imageDoor
      ? (verdict.reading?.senderBank ?? read?.senderBank ?? asked?.senderBank ?? null)
      : payment.senderBank;
    /* payment-without-receipt D10, D11, D26: a row searched by a payer's
       reference is judged in its own mode, with what was learned of them */
    const payer = await payerSide(db, payment, link, now);
    const receipt = { ...receiptSideOf(payment, read, searchedCents, accounts, asked?.day ?? null), ...payer.side };
    /* bug: single-cep-unreadable (D19): a single whose cadena did not read
       is still the one transfer Banxico named — it rides the trail,
       dropped, with the check the cadena failed */
    const unreadable = unreadableCandidates(
      several
        ? (bundle?.unreadable ?? [])
        : verdict.record === null
          ? [{ entry: verdict.cep?.trackingKey ?? "", reason: verdict.recordWhy ?? "" }]
          : [],
    );
    const source = several ? "several" : "single";
    const bundleId = bundle?.id ?? null;
    /* bug: single-cep-unreadable: the clave-only ask opens "with the other
       fields filled from the row" (contracts/payment-page.md), and a
       receipt-door row holds neither the bank nor the day. So the undecided
       row keeps the bank Banxico named for a single, or the one the search
       stood on — only a name of the vocabulary, the form's own — and the
       day the receipt printed; never over what the row already says. */
    const keptBank = [several ? null : verdict.cep?.senderBank, searchedBank].find(
      (b): b is string => b != null && (BANKS as readonly string[]).includes(b),
    );
    const undecided = (reason: UndecidedReason, candidates: MatchResult["trail"] = []) =>
      update({
        ...base,
        lastError: "CEP_UNDECIDED",
        disputedFields: JSON.stringify(["trackingKey"]),
        nextValidationAt: null,
        ...(payment.senderBank == null && keptBank ? { senderBank: keptBank } : {}),
        ...(payment.transferDate == null && receipt.day ? { transferDate: receipt.day } : {}),
        matchTrail: JSON.stringify(
          trailOf(source, bundleId, receipt, { decided: "undecided", reason, trail: candidates }, unreadable),
        ),
      });

    /* D16: not downloaded yet — the next slot downloads, never calls. A
       bundle is never a reason to expire, so past the schedule the retry
       still comes. */
    if (several && bundle!.status === "pending") {
      return update({
        ...base,
        lastError: "CEP_BUNDLE_PENDING",
        nextValidationAt: nextValidationSlot(payment.createdAt, now) ?? new Date(now.getTime() + minutes(2)),
      });
    }
    if (several && bundle!.status !== "read") return undecided(bundle!.status as "unreadable" | "too_large");
    if (several) await nudgeHolders(db, business.id, payment.id, bundle!.candidates.map((c) => c.clave), now);

    const candidates: CepRecord[] = several ? bundle!.candidates : verdict.record ? [verdict.record] : [];
    if (!several && !verdict.record) {
      /* D9: a single `valid` whose cadena could not be read (D4, D19).
         With a time or a tail on the receipt there is nothing to hold them
         against, so the clave is asked; with neither, nothing contradicts
         it and it confirms as it always did. */
      /* payment-without-receipt D11: a typed reference never confirms
         without a second fact, and an unread cadena holds no account to
         tie — so it is asked, like a receipt that shows a time */
      if (receipt.time || receipt.tail || payment.referenceSource === "typed") return undecided("unreadable");
    } else if (!candidates.length) {
      return undecided(unreadable.length ? "unreadable" : "none_fit");
    } else {
      const used = await usedAmong(db, business.id, payment.id, candidates.map((c) => c.clave));
      const result = await chooseAndClaim(db, payment.id, receipt, candidates, used, payer.mode);
      if (result.decided === "undecided") return undecided(result.reason, result.trail);
      Object.assign(base, {
        matchTrail: JSON.stringify(trailOf(source, bundleId, receipt, result, unreadable)),
        matchDistanceS: result.distanceS,
      });
      /* D8: the chosen transfer becomes the ordinary `valid` verdict */
      if (several) verdict = promote(result.chosen, verdict, searchedBank);
    }
  }

  /* receipt-triage D31 (FR-020a, converge T058): money paid to an account
     the business removed waits for the business's own decision, and a
     provisional release would reconnect the customer before it — so none
     fires for it, whatever the evidence. The account this attempt was
     checked against is the verdict's when it named one, else the row's. */
  const paidToRetired = Boolean(
    verdict.beneficiaryUsed ? verdict.beneficiaryUsed.retired : snapshot?.retired,
  );
  const releasable = <E,>(evidence: E | null): E | null => (paidToRetired ? null : evidence);

  /* provisional-release D12 — the shadow only writes. The trust block as
     received rides the same row update the release evaluation was going
     to write (null when the block is absent), and stops writing once a
     release fired, so the snapshot that bought the decision survives
     later attempts. The release rule reads none of it. */
  const shadow =
    payment.provisionalReleaseAt == null
      ? { trustSnapshot: verdict.trust ? JSON.stringify(verdict.trust) : null }
      : {};

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
      /* reading-check D2–D5: a call that still found nothing carries its
         classification — agreement is evidence the page can retire the
         clock on; a dispute asks the human now; blindness changes
         nothing. Written once, with the same retry the schedule keeps.

         two-eyes-receipt D5/D17: where the classification comes from is
         the whole difference between the two flows. A provider-first
         call brings it on the verdict — the engine compared both
         readings itself, with the shape rules it holds (D11) — and the
         row stores it plus whatever the two settled on, so the *next*
         attempt reads the transfer door out of the row (D17). A legacy
         row (D16) still computes it here at minute two, against the data
         its page sent as typed.

         `readingCheckAttempt` records when it was taken, never which
         flow ran: a new-flow row whose inline attempt died classifies at
         attempt 2 as well (FR-018). The D16 shape is what tells the
         flows apart. */
      const fresh = verdict.readingCheck
        ? {
            readingCheck: verdict.readingCheck,
            disputedFields: verdict.disputedFields?.length
              ? JSON.stringify(verdict.disputedFields)
              : null,
            blindSide: verdict.blindSide ?? null,
            acceptedFrom: verdict.acceptedFrom ?? null,
            readingCheckAttempt: attempts,
            /* D6/D7: what the machines agreed on, or what the bank's own
               clave shape vouched for. Written on the row so the next
               slot takes the transfer door with it — the same path a
               typed correction takes, which is the point of D17. */
            ...(verdict.accepted
              ? {
                  trackingKey: verdict.accepted.trackingKey,
                  /* receipt-triage D13: the reference both keys rode
                     with, or the one the fallback settled on */
                  referenceNumber: verdict.accepted.referenceNumber,
                  senderBank: verdict.accepted.senderBank,
                  transferDate: verdict.accepted.date,
                  claimedAmountCents: verdict.accepted.amountCents,
                }
              : {}),
          }
        : crossCheck
          ? { ...classifyReading(payment, verdict.reading ?? null), readingCheckAttempt: attempts }
          : /* receipt-triage D13 (clarified 2026-09-24): a disputed clave
               fell back to a reference both readings held, and Banxico
               found nothing with it. Now the payer is asked — for the
               clave or the reference, either one enough — while the
               slots keep searching with the reference meanwhile. */
            byReference && payment.readingCheck === "disputed" && payment.acceptedFrom !== "human"
            ? { readingCheck: payment.readingCheck, disputedFields: JSON.stringify(["trackingKey", "referenceNumber"]) }
            : {};

      /* two-eyes-receipt D20 + FR-010: a settled classification is taken
         once, and a later call may only improve it.

         Almost every settled row leaves through the transfer door and
         never meets a second comparison (D17). D20's is the exception:
         agreed, accepted, and no date on either reading, so it keeps the
         receipt door until the payer supplies that one field — and every
         slot it waits, the provider re-reads the same file. An OCR that
         came back one character apart used to rewrite `agreed` as
         `disputed`: it took back what the payer had already been told,
         dropped the release evidence `releaseEvidenceFor` grants only to
         an agreement, and swapped the one-field date question for a clave
         question. FR-010 says the opposite in as many words — "The
         agreement still stands" — and the spec's edge case for a shape
         rule graduating mid-flight says the classification is taken once,
         at the call that took it.

         So the only thing a later call adds to a settled row is the date
         nobody had read, which retires the last question and sends the
         next slot through the transfer door. A row that settled nothing
         keeps classifying on every attempt, which is what lets a rule
         that graduates later still decide an open dispute; so does the
         legacy cross, whose caller classifies for itself and leaves
         `verdict.readingCheck` unset (D16). Either way the reading record
         stores that call's own comparison (D19) — that is the
         measurement, and a row holding still must not quiet it. */
      const settled = payment.acceptedFrom != null;
      const classification =
        settled && verdict.readingCheck
          ? verdict.accepted?.date
            ? {
                /* The verdict is restated rather than left out: the row
                   keeps its own word, and `releaseEvidenceFor` below
                   reads this call's classification before the row's. */
                readingCheck: payment.readingCheck,
                transferDate: verdict.accepted.date,
                disputedFields: null,
              }
            : {}
          : fresh;
      /* provisional-release D1: an agreed cross or the human's own typed
         data is evidence enough to buy the promise while Banxico thinks */
      const release = await maybeProvisionalRelease(
        env,
        db,
        business,
        integration,
        link,
        payment,
        releasable(
          releaseEvidenceFor(payment, "not_found", classification) ??
            /* D12 graduation, first privilege: a rich, clean record vouches
               where the machines could not read. Inert until K exists. */
            (historyVouches(verdict.trust) ? "history" : null),
        ),
        now,
      );
      /* learned-retry D6: the verdict may carry the learned moment when
         asking again stops being waste — it governs the middle of the
         schedule (schedule.ts clamps it to skeleton and horizon). */
      return retryLater(
        "TRANSFER_NOT_FOUND",
        { ...base, ...classification, ...release, ...shadow },
        { lateSlot: true, suggestedAt: suggestedSlot(verdict.retryAfter) },
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
    /* Consta's D3: "not found yet" is never "fake". Ride the schedule.
       provisional-release D1: `pending` is the strongest evidence short
       of `valid` — the provider says the transfer EXISTS in process —
       so it buys the promise at minute zero. */
    const release = await maybeProvisionalRelease(
      env,
      db,
      business,
      integration,
      link,
      payment,
      releasable(releaseEvidenceFor(payment, "pending")),
      now,
    );
    /* learned-retry D6: same consumption as not_found — no late slot,
       per validation-status-ux D4. payment-without-receipt D14: a row
       searched by a reference counts this answer as a round. */
    const pendingOpts = { suggestedAt: suggestedSlot(verdict.retryAfter) };
    const slot = sourced
      ? ladderSlot(payment.createdAt, now, base.ladderRound ?? payment.ladderRound, pendingOpts)
      : nextValidationSlot(payment.createdAt, now, pendingOpts);
    const row = await update(
      slot
        ? { ...base, ...release, ...shadow, nextValidationAt: slot, lastError: null }
        : { ...base, ...release, ...shadow, status: "expired", nextValidationAt: null, lastError: null },
    );
    if (!slot && row.provisionalReleaseAt != null) {
      await notifyProvisionalExpiry(env, db, business, integration, link, now);
    }
    return row;
  }

  /* valid — necessary, not sufficient (D11): the CEP must match the debt */

  if (
    verdict.alreadyValidated &&
    !isRetry &&
    !(await tracesToOwnAttempt(db, payment, verdict.cep?.trackingKey ?? null, startedAt))
  ) {
    /* D8: the flag with no local record means the CEP was validated
       outside Devolada — rejected, but visible in the admin feed so
       the ISP can resolve it with the customer. (A local record would
       have stopped the submission at the unique index already.) */
    return update({
      ...base,
      ...refusedFor(verdict.cep?.trackingKey),
      status: "invalid",
      nextValidationAt: null,
      lastError: "TRANSFER_ALREADY_USED",
    });
  }

  const cep = verdict.cep;

  /* receipt-triage D22 (amended 2026-09-24): Banxico's own word on the
     receiving account outranks what the receipt's digits tied. Tied to
     the snapshot → that is the account; a whole account number that fits
     none of the ISP's accounts is a transfer to somebody else, however
     the CEP otherwise matched. A masked or absent one changes nothing. */
  let checkedAccount: RegisteredAccount = verdict.beneficiaryUsed ?? beneficiary;
  if (!legacy && cep?.beneficiaryAccount) {
    const tie = tieCepAccount(cep.beneficiaryAccount, accounts);
    if (tie === "contradicts") {
      return update({
        ...base,
        status: "invalid",
        nextValidationAt: null,
        lastError: "TRANSFER_CONTRADICTED",
      });
    }
    if (typeof tie === "object") {
      checkedAccount = tie.tied;
      if (!sameAccount(tie.tied, verdict.beneficiaryUsed ?? beneficiary)) {
        Object.assign(base, { beneficiary: JSON.stringify(fromBeneficiary(tie.tied)) });
      }
    }
  }
  /* receipt-triage D31 (FR-020a): paid to an account the ISP removed —
     Banxico confirmed it, and the ISP decides whether that money is its
     own. Held, never settled, until someone who operates payments
     accepts or rejects it. */
  let hold: "retired_account" | "no_clave" | null = checkedAccount.retired ? "retired_account" : null;

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

  /* provisional-release D7: a retry that reaches `valid` resolves the
     expired ride it re-claims — the vote of confidence was vindicated,
     so the ride must stop being `expired` (that is what lifts the D5
     revocation). `superseded` is the honest word: a later row of the
     same transfer took its place. */
  {
    const rideKey = payment.trackingKey ?? cep?.trackingKey;
    if (rideKey) {
      const expiredRides = and(
        eq(payments.paymentLinkId, payment.paymentLinkId),
        eq(payments.trackingKey, rideKey),
        eq(payments.status, "expired"),
        ne(payments.id, payment.id),
      );
      if (isApiLink(link)) {
        /* automated-collections-api D17: a caller that heard `expired`
           deserves to hear the row was superseded — one row at a time,
           so each gets its own event. */
        const rides = await db.select().from(payments).where(expiredRides);
        for (const ride of rides) {
          const [row] = await db
            .update(payments)
            .set({ status: "superseded", nextValidationAt: null })
            .where(eq(payments.id, ride.id))
            .returning();
          await enqueueAndDeliver(env, db, { payment: row, link, now }, opts.defer);
        }
      } else {
        await db.update(payments).set({ status: "superseded", nextValidationAt: null }).where(expiredRides);
      }
    }
  }

  /* Claim the tracking key the CEP revealed. The partial unique index is
     the D8 defense — losing this claim means another live payment
     already owns the transfer. Two rows earn it: a receipt-door row that
     never had a key, and (reading-check D7) a cross-validated row whose
     stored key was the misread the CEP just corrected — the index must
     end up holding the truth. */
  /* two-eyes-receipt D17: a third row earns it — one whose key came from
     the minute-zero comparison (`accepted_from` set) rather than from a
     human. The machines can agree on a misread, and the CEP is the only
     thing that ever outranks them, so the index must end up holding the
     truth exactly as it does after a legacy cross. A row whose key the
     payer typed is untouched: that is the human's data (FR-015). */
  const machineKey =
    payment.acceptedFrom === "agreed" ||
    payment.acceptedFrom === "reader" ||
    payment.acceptedFrom === "provider";
  /* receipt-triage D14: a row found by reference — typed or read — earns
     it too, whatever its `proof_mode`: without Banxico's clave on the row
     the unique index could not stop the same transfer paying twice, once
     by its reference and once by its clave (direct-payment D8). Written
     before the confirmation, so a clave already used refuses the row
     before it can confirm (FR-006). */
  const adoptKey =
    cep?.trackingKey &&
    (!payment.trackingKey
      ? true
      : (crossCheck || machineKey) && cep.trackingKey !== payment.trackingKey);
  if (adoptKey && cep?.trackingKey) {
    try {
      await db
        .update(payments)
        .set({
          trackingKey: cep.trackingKey,
          senderBank: cep.senderBank ?? null,
          transferDate: cep.date ?? null,
        })
        .where(eq(payments.id, payment.id));
    } catch (e) {
      if (isUniqueViolation(e)) {
        return update({
          ...base,
          ...refusedFor(cep.trackingKey),
          status: "invalid",
          nextValidationAt: null,
          lastError: "TRANSFER_ALREADY_USED",
        });
      }
      throw e;
    }
  }

  /* receipt-triage FR-006 — the guard for a case never observed: Banxico
     confirmed a transfer found by reference, and its CEP carries no
     clave. Nothing is invented; the clave stays empty, so the unique
     index cannot guard this row, and the two things that can stand in for
     it are asked instead. The provider saying the CEP was validated
     before, or another *confirmed* payment of the business holding the
     same reference, date, bank, amount and account — the payer's own
     earlier payment on this same link included (analyze 2026-09-24, I1) —
     refuses it as already used. The provider unable to say either way
     holds it for the ISP (D31). Only "never validated" and no twin
     confirms it. */
  if (!payment.trackingKey && !cep?.trackingKey) {
    console.error(`unexpected: CEP without clave on payment ${payment.id}`);
    const twin = payment.referenceNumber
      ? await sharedReference(
          db,
          business,
          link,
          {
            paymentId: payment.id,
            reference: payment.referenceNumber,
            date: cep?.date ?? payment.transferDate ?? "",
            senderBank: payment.senderBank ?? "",
            amountCents: payment.claimedAmountCents ?? payment.amountCents,
            account: fromBeneficiary(checkedAccount),
          },
          { confirmedOnly: true, includeSameLink: true },
        )
      : false;
    /* A `true` flag with no trace of our own attempt was refused above
       (D8); reaching here with it means our own lost attempt set it — and
       with no clave there is nothing to tell that apart from a stranger's
       use, so the ISP decides. */
    if (twin || (verdict.previouslyValidated === true && !isRetry)) {
      return update({
        ...base,
        status: "invalid",
        nextValidationAt: null,
        lastError: "TRANSFER_ALREADY_USED",
      });
    }
    if (verdict.previouslyValidated !== false) hold ??= "no_clave";
  }

  /* automated-collections-api D7: the seam. Read top to bottom this
     function is two halves — everything above (claim the row, ask the
     engine, reconcile the CEP, adopt the key) IS the SPEI validation and
     is identical for both link kinds; everything below is WispHub. An API
     link's verdict branches HERE, before the WispHub guard that follows:
     that guard is what narrows `integration` for the panel half, and an
     API link for a gym has no integration row at all, so `integration`
     is `null` on its path. The API half settles against `asked_cents`
     with the business's tolerance and constructs no WispHub client
     (FR-029 holds structurally). Its verdict is announced by `update`
     above (D8/D17), and `action_outcome` is written by that delivery —
     `queued` while it is retried, `done` when accepted, `failed` when
     the schedule is spent (FR-026); with no address registered nothing
     is sent and the outcome stays null. */
  if (isApiLink(link)) {
    return settleApiPayment(db, update, payment, link, business, cep ?? null, base, now, hold);
  }
  if (!isPanelLink(link)) {
    throw new Error(`payment ${payment.id} sits on a link that is neither panel nor API (${link.id})`);
  }

  /* bug: valid-lost-on-later-failure — the verdict is kept before the
     WispHub half runs: a read that fails there retries the read alone,
     and Banxico is never asked the same question twice (the retry cannot
     be told `not_found` for a transfer it confirmed). What the CEP said
     rides the row with it, so the resumed attempt settles on the same
     facts. */
  return settlePanelPayment(env, db, payment, link, business, integration, now, update, retryLater, {
    ...base,
    banxicoValidAt: payment.banxicoValidAt ?? now,
    receivedCents: cep?.amountCents ?? payment.amountCents,
    cepSenderName: cep?.senderName ?? null,
    reviewReason: hold,
  }, cep ?? null, hold);
}

/* cep-bundle-match D8, D18 (analyze U3) — decide, and take the clave the
   matcher chose onto the row before anything confirms (the unique index is
   what stops one transfer paying twice, direct-payment D8).

   `used` is read before the decision and the clave written after it, so
   two payments of one bundle decided at the same moment can both choose
   one transfer. The index refuses the second write; that payment only
   *chose* the clave, so it joins `used` and the matcher decides again —
   twice at most — and with nothing left it is undecided (`all_used`),
   never TRANSFER_ALREADY_USED: a payer who paid is never refused for a
   transfer the machine picked. A clave the payer typed or the receipt
   showed keeps today's refusal (`runValidation`). Exported so the race —
   which no single sweep can stage — is testable against the real index. */
export async function chooseAndClaim(
  db: DB,
  paymentId: string,
  receipt: Parameters<typeof matchCandidates>[0],
  candidates: CepRecord[],
  used: Set<string>,
  /* payment-without-receipt D10/D11: the payer's own reference or a typed one */
  mode: MatchMode = "receipt",
): Promise<MatchResult> {
  const claim = async (clave: string) => {
    try {
      await db.update(payments).set({ trackingKey: clave }).where(eq(payments.id, paymentId));
      return true;
    } catch (e) {
      if (isUniqueViolation(e)) return false;
      throw e;
    }
  };
  let result: MatchResult = matchCandidates(receipt, candidates, used, undefined, mode);
  for (let round = 0; result.decided === "chosen"; round++) {
    if (await claim(result.chosen.clave)) break;
    used.add(result.chosen.clave.toUpperCase());
    result = matchCandidates(receipt, candidates, used, undefined, mode);
    if (round === 1 && result.decided === "chosen") {
      result = {
        decided: "undecided",
        reason: "all_used",
        trail: result.trail.map((c) => (c.fate === "chosen" ? { ...c, fate: "kept" as const } : c)),
      };
    }
  }
  return result;
}

/* payment-without-receipt D11, D17: the one clave a typed tail chose, taken
   onto the row before anything confirms — the unique index refuses it
   when another live payment already holds it */
async function chooseAndClaimOne(db: DB, paymentId: string, clave: string): Promise<boolean> {
  try {
    await db.update(payments).set({ trackingKey: clave }).where(eq(payments.id, paymentId));
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

/* bug: valid-lost-on-later-failure — the panel half of a `valid`
   verdict, from the WispHub debt re-check (D14) to the dispatch. Reached
   two ways: straight after the verdict, and on a later slot of a row that
   kept one (`banxico_valid_at`), which calls no provider. */
async function settlePanelPayment(
  env: Bindings,
  db: DB,
  payment: DirectPayment,
  link: PanelLink,
  business: Isp,
  integration: Integration | null,
  now: Date,
  update: (values: Partial<typeof payments.$inferInsert>) => Promise<DirectPayment>,
  retryLater: (error: string, base?: Partial<typeof payments.$inferInsert>) => Promise<DirectPayment>,
  base: Partial<typeof payments.$inferInsert>,
  cep: { amountCents?: number | null; senderName?: string | null } | null,
  hold: "retired_account" | "no_clave" | null,
): Promise<DirectPayment> {
  /* D14: between submission and confirmation the debt can be settled
     elsewhere. Re-check before touching WispHub's money.
     automated-collections-api D5/D7 (research, "the null guard the seam
     must keep"): a HARD return, reachable only by a panel link. Never
     rewrite it as a condition on `link.source` — it is the narrowing
     that keeps every read of `integration` below (`thresholdPercent`,
     `actionForClass`, the `actionsEnabled` observation gate) non-null. */
  if (!integration?.apiKey) return retryLater("WISPHUB_NOT_CONFIGURED", base);
  const wisphub = wisphubFor(integration, env);
  let customer;
  let pending;
  try {
    /* provider-latency D2 together, D3 **fresh**: this decides whether a
       payment is registered in WispHub (D14), so it never takes the
       display cache. bug: pending-invoice-cap — a tenant no request can
       read whole is served the sweep's last finished pass; the customer
       record beside it is live, and the invoice is re-read below. */
    [customer, pending] = await Promise.all([
      wisphub.getCustomer(link.customerUsuario),
      readPendingInvoices(db, business.id, wisphub, now),
    ]);
  } catch (e) {
    const code = e instanceof WispHubError ? e.code : "WISPHUB_UNAVAILABLE";
    return retryLater(code, base);
  }
  /* debt-truth D7: the debt is the pending invoices plus what the
     customer carries. Read fresh — between submission and here the debt
     can have been settled elsewhere (D14) or grown. */
  const debt = customer ? debtFor(customer, pending) : NO_DEBT;
  if (debt.totalCents === 0) {
    /* Debt-truth D4/D14: a truncated list cannot prove "owes nothing",
       but `saldo` is never truncated and it said nothing either. */
    const provenSettled = !customer || nothingOwedIsProven(customer, pending);
    if (!provenSettled) {
      /* bug: pending-invoice-cap — the plan's price stood in for the
         debt here, and the verdict settled, classed and registered
         against a guess. The row waits on the schedule instead until the
         sweep's list can answer, as it would for a provider outage. */
      return retryLater("WISPHUB_READ_INCOMPLETE", base);
    }
    /* The money already moved to the ISP's account: never register a
       second WispHub payment, never drop the proof (D14). */
    return update({
      ...base,
      status: "unapplied",
      /* payments-and-classes D3: money arrived against a debt of zero —
         `over` by definition, a class and never a credit (D2 keeps its
         treatment at `flag`). What the CEP said arrived and who sent it
         land on the row too, so the proof view has its facts — and the
         customer identity just read rides along (design-review
         2026-09-01): the feed showed the usuario where every other row
         shows a name, for money the ISP must resolve with that person. */
      reconciliationClass: "over",
      receivedCents: cep?.amountCents ?? payment.amountCents,
      cepSenderName: cep?.senderName ?? null,
      wisphubCustomerId: link.wisphubCustomerId,
      customerUsuario: link.customerUsuario,
      customerName: customer?.name ?? link.customerUsuario,
      customerZone: customer?.zone ?? null,
      customerPhone: customer?.phone ?? null,
      nextValidationAt: null,
      lastError: null,
    });
  }
  const ispDebtCents = debt.totalCents;

  /* bug: pending-invoice-cap — an id the snapshot named is minutes old.
     Paid in the panel meanwhile, it would answer `registrar-pago` with
     the 422 that reconnection D8 reads as "already landed", and this
     payment would never reach WispHub's books. So it is re-read fresh,
     oldest first, and a closed one yields to the next; none left means
     debt-truth D15's empty vehicle, exactly as a customer with no
     pending invoice gets. A live list needs none of this: it is seconds
     old, and D8's reading of the 422 was measured against it. */
  let invoiceId = debt.invoiceId;
  if (pending.source === "snapshot" && invoiceId !== null && customer) {
    try {
      invoiceId = await stillPendingInvoiceId(wisphub, customer.usuario, pending);
    } catch (e) {
      const code = e instanceof WispHubError ? e.code : "WISPHUB_UNAVAILABLE";
      return retryLater(code, base);
    }
  }

  /* D5: what the CEP says arrived is what settles the debt, and the
     ISP's threshold decides whether it earns the service back. Both
     branches register the money — the ISP's books are right either way;
     only the router is left alone. */
  const receivedCents = cep?.amountCents ?? payment.amountCents;
  const settlement = settle({
    receivedCents,
    ispDebtCents,
    serviceFeeCents: payment.serviceFeeCents,
    thresholdPercent: integration.thresholdPercent,
    floorCents: integration.floorCents,
  });

  /* business-and-memberships D6: the payment row IS the confirmed record
     — folio, customer and the registered amount land on it, and the
     reconnection queue rides it. No twin row. */
  await update({
    folio: makeFolio(),
    wisphubCustomerId: link.wisphubCustomerId,
    customerUsuario: link.customerUsuario,
    customerName: customer?.name ?? link.customerUsuario,
    customerZone: customer?.zone ?? null,
    customerPhone: customer?.phone ?? null,
    /* partial-payment D9: what actually arrived is what gets registered
       against the debt — the number every retry registers again */
    registeredCents: settlement.ispRegisteredCents,
  });

  /* payments-and-classes D1/D3: the class, computed once at the verdict
     against the fresh ask — the debt read seconds ago plus the service
     fee, the same total the payer's page quoted. A later policy change
     never rewrites it (scenario 1). */
  const klass = classifyPayment({
    receivedCents,
    askedCents: ispDebtCents + payment.serviceFeeCents,
    toleranceCents: business.toleranceCents,
  });
  /* integrations-hub D3: the class picks its mapped action; the
     threshold only votes under register_and_reconnect. */
  const action = actionForClass(integration, klass);

  /* integrations-hub D4/D5: the observation gate, BEFORE any dispatch —
     zero writes to WispHub. The verdict still lands whole (folio,
     customer, class, the settled amount above), the credit is still
     debited by `update()`, and the row records what the mapping WOULD
     have executed — the ramp's instrument, and exactly what "Ejecutar
     ahora" later dispatches. The invoice id rides along so that
     dispatch reuses it (TD-009's guard). No ledger row: the gate sits
     before dispatch, and the observation outcome IS the record (D6). */
  /* receipt-triage D31: the hold, BEFORE any dispatch — the observation
     gate's own place and shape (integrations-hub D4/D5). The verdict
     lands whole — folio, customer, class, the settled amount, what the
     mapping would execute — and nothing reaches WispHub, the queue or a
     webhook until the ISP decides (`POST /payments/:id/review`). The
     status is the settlement's (`confirmed`, or `partial` when short):
     Banxico's verdict is not rewritten by holding it. */
  if (hold) {
    return update({
      ...base,
      receivedCents,
      status: settlement.status,
      reconciliationClass: klass,
      confirmedAt: now,
      cepSenderName: cep?.senderName ?? null,
      nextValidationAt: null,
      lastError: null,
      actionOutcome: "review",
      reviewReason: hold,
      observedAction: hypothesisOf(action, settlement.reconnect),
      wisphubInvoiceId: invoiceId,
      actionAttempts: 0,
      nextAttemptAt: null,
    });
  }

  if (!integration.actionsEnabled) {
    return update({
      ...base,
      receivedCents,
      status: settlement.status,
      reconciliationClass: klass,
      confirmedAt: now,
      cepSenderName: cep?.senderName ?? null,
      nextValidationAt: null,
      lastError: null,
      actionOutcome: "observation",
      observedAction: hypothesisOf(action, settlement.reconnect),
      wisphubInvoiceId: invoiceId,
      actionAttempts: 0,
      nextAttemptAt: null,
    });
  }

  /* provider-latency D4, as amended by presence-freshness D6: the
     display cache is keyed by the tenant's last registration, so the
     dispatch below — the moment WispHub learns about this payment — is
     what turns the cached list stale, in every colo at once. */

  /* integrations-hub D6: the dispatch decision opens its ledger row
     before the adapter runs; the terminal outcome acks it. */
  await recordDispatch(db, {
    businessId: business.id,
    integrationId: integration.id,
    paymentId: payment.id,
    class: klass,
    action,
  });
  const attempt = await attemptReconnection(
    wisphub,
    business,
    { usuario: link.customerUsuario, wisphubId: link.wisphubCustomerId },
    settlement.ispRegisteredCents,
    now,
    { invoiceId, paymentRegistered: false },
    /* D3: register_only never asks the router, whatever the threshold */
    action === "register_and_reconnect" && settlement.reconnect,
  );
  const schedule = firstAttemptSchedule(attempt, now);
  const outcome = outcomeOf(attempt.status, action);
  if (outcome !== "queued") {
    await settleDispatch(db, payment.id, "acked", null, now);
  }

  return update({
    ...base,
    receivedCents,
    status: settlement.status,
    reconciliationClass: klass,
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
    /* The queue's first attempt, on the same row (reconnection-queue D2).
       The adapter speaks its own vocabulary; the row speaks the generic
       one, and register_only's completed registration is `done` (D7). */
    actionOutcome: outcome,
    actionAttempts: schedule.attempts,
    wisphubInvoiceId: attempt.invoiceId,
    paymentRegisteredAt: attempt.paymentRegistered ? now : null,
    nextAttemptAt: schedule.nextAttemptAt,
    actionError: attempt.error,
    /* bug: queue-retry-forgets-action — what every retry runs again */
    decidedAction: hypothesisOf(action, settlement.reconnect),
    ...(outcome === "done" ? { actionDoneAt: now } : {}),
  });
}

/* automated-collections-api D7: the API half of the verdict. Everything
   the WispHub half does with a debt read, a threshold and a router, this
   does with one number: what the caller asked at submission. Reads
   nothing from `integration` — a gym has no integration row at all.

   The yardstick is `asked_cents + service_fee_cents`, the same total the
   payer's page quoted (payments-and-classes D1/D3), and the class is
   computed once here against the business's tolerance. `partial` is the
   row's word for `short` (D17): the money is real and the caller decides
   what to do about the difference (spec edge case "the payer sends the
   wrong amount"). `unapplied` when the link had closed meanwhile (D16) —
   a second transfer against a one-time link another transfer already
   paid. A deadline that passed after submission is NOT that case: it
   closes the link to new payers and never voids a transfer already on
   its way (spec edge case "seconds before it expires").

   Closing the link: a `confirmed` verdict closes a one-time link
   (FR-027 "closes when it is paid"). A `partial` leaves it open so the
   payer can complete it — the caller sees `partial` and closes it
   through PATCH if it would rather not.

   The verdict written through `update` is what enqueues the webhook
   (D8): this function never touches the queue itself. */
async function settleApiPayment(
  db: DB,
  update: (values: Partial<typeof payments.$inferInsert>) => Promise<DirectPayment>,
  payment: DirectPayment,
  link: ApiLink,
  business: Isp,
  cep: { amountCents?: number | null; senderName?: string | null } | null,
  base: Partial<typeof payments.$inferInsert>,
  now: Date,
  /* receipt-triage D31: why this verdict waits for the business */
  hold: "retired_account" | "no_clave" | null = null,
): Promise<DirectPayment> {
  const receivedCents = cep?.amountCents ?? payment.amountCents;
  /* Rows born before `asked_cents` existed fall back to the link's ask */
  const askedCents = payment.askedCents ?? link.askCents;
  const facts = {
    ...base,
    receivedCents,
    cepSenderName: cep?.senderName ?? null,
    confirmedAt: now,
    nextValidationAt: null,
    lastError: null,
  };

  /* Fresh read: the row given to this attempt may predate a paying
     transfer that closed the link meanwhile */
  const [fresh] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
  if (fresh?.closedAt !== null && fresh?.closedAt !== undefined) {
    return update({ ...facts, status: "unapplied", reconciliationClass: "over" });
  }

  const klass = classifyPayment({
    receivedCents,
    askedCents: askedCents + payment.serviceFeeCents,
    toleranceCents: business.toleranceCents,
  });
  const status = klass === "short" ? "partial" : "confirmed";
  /* receipt-triage D31: held — the link stays open and nothing is
     announced (the writer skips a `review` row); the business's accept
     closes and announces, its reject announces `invalid` */
  if (hold) {
    return update({
      ...facts,
      folio: makeFolio(),
      status,
      reconciliationClass: klass,
      actionOutcome: "review",
      reviewReason: hold,
    });
  }
  if (status === "confirmed" && link.mode === "one_time") {
    await db
      .update(paymentLinks)
      .set({ closedAt: now })
      .where(and(eq(paymentLinks.id, link.id), isNull(paymentLinks.closedAt)));
  }
  return update({ ...facts, folio: makeFolio(), status, reconciliationClass: klass });
}

/* automated-collections-api D12 (FR-034): the test verdict. There is
   no way to simulate a Banxico CEP, so a test payment never goes to
   the engine (the payer's door leaves it undue — no slot, no inline
   attempt) and moves only when the caller names the state. The write
   is the validation's own: the same fields `settleApiPayment` and the
   refusals set, through the same announcing writer, so the webhook the
   developer rehearses is the one production sends — the fee gate in
   credit/index.ts is what keeps it free. Which state may follow which,
   and whether the amount tells the same story, is decided by the
   handler (routes/v1/test-mode); this function trusts its plan. */
export type TestAdvance =
  | { status: "confirmed" | "partial" | "unapplied"; receivedCents: number; match: ReconciliationClass }
  | { status: "invalid" | "expired" | "superseded" | "validating" | "queued_for_credit" };

export async function advanceTestPayment(
  env: Bindings,
  db: DB,
  payment: DirectPayment,
  link: ApiLink,
  advance: TestAdvance,
  now: Date,
  opts: { defer?: Defer } = {},
): Promise<DirectPayment> {
  if (!payment.isTest || !link.isTest) {
    throw new Error(`payment ${payment.id} is real; only a test payment can be advanced`);
  }
  const update = announcingWriter(env, db, payment, link, now, opts.defer);
  /* never due again, whatever it enters: the sweep does not know it */
  const undue = { nextValidationAt: null, lastError: null };
  switch (advance.status) {
    case "confirmed":
    case "partial":
    case "unapplied": {
      /* FR-027: a paying verdict closes a one-time link, as the real one does */
      if (advance.status === "confirmed" && link.mode === "one_time") {
        await db
          .update(paymentLinks)
          .set({ closedAt: now })
          .where(and(eq(paymentLinks.id, link.id), isNull(paymentLinks.closedAt)));
      }
      return update({
        ...undue,
        status: advance.status,
        receivedCents: advance.receivedCents,
        reconciliationClass: advance.match,
        folio: makeFolio(),
        confirmedAt: now,
        cepSenderName: null,
      });
    }
    /* the two refusals wear the words the real path writes, so the
       payer's page reads the same (D17/BUG-003) */
    case "invalid":
      return update({ ...undue, status: "invalid", lastError: "TRANSFER_CONTRADICTED" });
    case "expired":
      return update({ ...undue, status: "expired", lastError: "TRANSFER_NOT_FOUND" });
    default:
      return update({ ...undue, status: advance.status });
  }
}

/* receipt-triage D7 (clarified 2026-09-24) — another payment of the same
   business that a reference search could not tell apart from this one:
   the same reference, transfer date, sending bank, amount and receiving
   account, not `superseded`. From another link by default — a payer
   re-uploading or correcting their own payment is the same link, never a
   match (spec Edge Cases). The account rules nothing out while either
   side's is unknown (a row born before this feature has none). The
   FR-006 guard asks with `confirmedOnly` and `includeSameLink`: "no
   other confirmed payment of the business" includes the payer's own
   earlier one (analyze 2026-09-24, I1). Never unique by design, so a
   match is a reason to ask for the clave — and finding none proves
   nothing. cep-bundle-match D12: the three stops before a paid search ask
   only when the receipt shows neither a time nor the sender's digits;
   with either, the search runs and the bundle's matcher decides. */
export async function sharedReference(
  db: DB,
  business: Pick<Isp, "id">,
  link: Pick<PaymentLink, "id">,
  data: {
    paymentId?: string | null;
    reference: string;
    date: string;
    senderBank: string;
    amountCents: number;
    account: import("./accounts").StoredAccount | null;
  },
  opts: { confirmedOnly?: boolean; includeSameLink?: boolean } = {},
): Promise<boolean> {
  const rows = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.businessId, business.id),
        eq(payments.referenceNumber, data.reference),
        eq(payments.transferDate, data.date),
        opts.confirmedOnly
          ? inArray(payments.status, ["confirmed", "partial", "unapplied"])
          : ne(payments.status, "superseded"),
        ...(opts.includeSameLink ? [] : [ne(payments.paymentLinkId, link.id)]),
        ...(data.paymentId ? [ne(payments.id, data.paymentId)] : []),
      ),
    );
  return rows.some((r) => {
    if (r.senderBank !== data.senderBank) return false;
    if ((r.claimedAmountCents ?? r.amountCents) !== data.amountCents) return false;
    const theirs = parseAccount(r.beneficiary);
    return !theirs || !data.account || (theirs.kind === data.account.kind && theirs.value === data.account.value);
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
/* The customer's pending invoices as the snapshot lists them, oldest
   first (the rule `debtOf` picks by), each confirmed with WispHub before
   it is trusted with money (bug: pending-invoice-cap). */
async function stillPendingInvoiceId(
  wisphub: WispHub,
  usuario: string,
  pending: PendingInvoices,
): Promise<number | null> {
  const candidates = pending.invoices
    .filter((f) => f.usuario === usuario)
    .map((f) => f.invoiceId)
    .sort((a, b) => a - b);
  for (const id of candidates) {
    if ((await wisphub.invoiceState(id)) !== "closed") return id;
  }
  return null;
}

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

  /* payments-and-classes D9: a suspended business validates nothing —
     its due rows are not even claimed, so their schedule freezes where
     it was (exactly as the credit pause does) and resumes the minute the
     business is reactivated. Nothing is expired for having been
     suspended; the resumed attempt is a real one. */
  const dueJoined = await db
    .select({ payment: payments })
    .from(payments)
    .innerJoin(businesses, eq(businesses.id, payments.businessId))
    .where(
      and(
        eq(payments.status, "validating"),
        isNotNull(payments.nextValidationAt),
        lte(payments.nextValidationAt, now),
        eq(businesses.status, "active"),
        /* automated-collections-api D12: a test row is born undue and
           stays so; spelled here too, so a test payment never reaches
           the engine whatever a future write sets on it */
        realOnly(payments),
      ),
    )
    .orderBy(payments.nextValidationAt)
    .limit(BATCH);
  const due = dueJoined.map((r) => r.payment);
  if (!due.length) return report;

  await db
    .update(payments)
    .set({ nextValidationAt: new Date(now.getTime() + minutes(LEASE_MINUTES)) })
    .where(
      inArray(
        payments.id,
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
  const businessIds = [...new Set(due.map((p) => p.businessId))];
  const ispRows = await db.select().from(businesses).where(inArray(businesses.id, businessIds));
  const ispById = new Map(ispRows.map((i) => [i.id, i]));
  const integrationByBusiness = await integrationsFor(db, businessIds);

  for (const payment of due) {
    const link = linkById.get(payment.paymentLinkId);
    const business = ispById.get(payment.businessId);
    if (!link || !business) continue; /* unreachable: FKs guarantee both */
    try {
      const row = await runValidation(env, db, payment, link, business, integrationByBusiness.get(payment.businessId) ?? null, now);
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
    .from(payments)
    .where(eq(payments.status, "validating"));
  return Number(row?.n ?? 0);
}

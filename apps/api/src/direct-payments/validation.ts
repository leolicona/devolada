import { and, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { payments, businesses, paymentLinks } from "../db/schema";
import { debitValidationFee } from "../credit";
import { BANKS } from "./banks";
import { consta, ConstaError, type ConstaRequest, type RegisteredAccount } from "../consta";
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
import { nextValidationSlot, suggestedSlot } from "./schedule";
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
import { isApiLink, isPanelLink, realOnly, type ApiLink } from "./links";
import { enqueueAndDeliver, type Defer } from "../webhooks/queue";

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
  return siblings.some(attempted);
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
    const [row] = await db
      .update(payments)
      .set(values)
      .where(eq(payments.id, payment.id))
      .returning();
    /* prepaid-credit D2: the fee keys on the terminal verdict, once per
       payment — idempotent in the book, so every path may call it */
    await debitValidationFee(env, db, row);
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
    const slot = nextValidationSlot(payment.createdAt, now, opts);
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
     no call is made. */
  if (
    payment.trackingKey == null &&
    (payment.lastError === "REFERENCE_AMBIGUOUS" || payment.lastError === "REFERENCE_SHARED")
  ) {
    return retryLater(payment.lastError);
  }
  /* receipt-triage D7 (FR-007): before any paid call that would search by
     a reference, another payment of the business with the same five data
     means the reference cannot find *this* transfer alone — the payer is
     asked for the clave instead of the provider being paid to say so.
     Finding none is not proof the reference is unique; the 422 above is
     the provider's answer for that. */
  if (byReference) {
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
  const request: ConstaRequest = crossCheck
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
  const attempts = payment.validationAttempts + 1;
  await db
    .update(payments)
    .set({ validationAttempts: attempts })
    .where(eq(payments.id, payment.id));

  let verdict;
  /* consta-api-merge D3: the business is the identity — the refs above
     accumulate history in this tenant's chains because the engine
     writes the row under `business_id` (payments-and-classes D7's key
     per business existed only to reach the same attribution over a
     wire). D6/FR-011: every engine failure still rides the schedule,
     whether or not waiting can help; the row keeps the engine's own
     code so the ISP can see which it was. */
  try {
    verdict = await consta(env, db, { businessId: business.id }, {
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
    }).validate(request);
  } catch (e) {
    const code = e instanceof ConstaError ? e.code : "PROVIDER_UNAVAILABLE";
    console.error("consta validation failed:", code);
    /* receipt-triage D17 (FR-007): the provider's 422 — the reference
       matches more than one transfer. The one remedy is the clave, so the
       payer is asked for it alone, and the slots stop calling (above)
       until it arrives. */
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

  const base = {
    /* Already written above; repeated so every terminal write carries a
       consistent row, and harmless because it is the same number. */
    validationAttempts: attempts,
    constaValidationId: verdict.validationId,
    constaStatus: verdict.status,
    /* receipt-triage D22/D30: the account the engine named on the receipt
       door — the one the receipt's digits tied, retired ones included —
       is the account this payment is checked against from now on */
    ...(verdict.beneficiaryUsed && !legacy
      ? { beneficiary: JSON.stringify(fromBeneficiary(verdict.beneficiaryUsed)) }
      : {}),
  };

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
    const slot = nextValidationSlot(payment.createdAt, now, {
      /* learned-retry D6: same consumption as not_found — no late slot,
         per validation-status-ux D4 */
      suggestedAt: suggestedSlot(verdict.retryAfter),
    });
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
   nothing. */
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

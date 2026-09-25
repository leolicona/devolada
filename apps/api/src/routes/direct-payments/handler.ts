import type { Context } from "hono";
import { and, asc, desc, eq, gt, gte, inArray, or, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { extractions, payments, businesses, paymentLinks, proofRejections } from "../../db/schema";
import { creditSummary } from "../../credit";
import {
  CUSTOMER_SEARCH_FIELDS,
  WispHubError,
  type CustomerSearchField,
  type WispHubCustomer,
} from "../../wisphub/client";
/* provider-address-per-isp D4: every provider client in this file is
   addressed to the actor business's own installation, through the one
   factory. The constructor is never called here. */
import { wisphubFor } from "../../wisphub/factory";
import { readPendingInvoices } from "../../wisphub/snapshot";
import { NO_DEBT, debtFor, nothingOwedIsProven } from "../../wisphub/debt";
import {
  askAvailable,
  businessConfigured,
  isUniqueViolation,
  runValidation,
  sharedReference,
  speiFeeCents,
  validationAvailable,
} from "../../direct-payments/validation";
import {
  collectStored,
  fromBeneficiary,
  registeredAccounts,
  toBeneficiary,
  type StoredAccount,
} from "../../direct-payments/accounts";
import { sha256Hex, tieDestination, visibleTail } from "../../consta/extraction";
import {
  ensureLink,
  isApiLink,
  isPanelLink,
  linkAcceptsPayments,
  linkState,
  makeLinkToken,
  realOnly,
  type ApiLink,
  type PaymentLink,
} from "../../direct-payments/links";
import {
  isAcceptedProofType,
  makeProofKey,
  PROOF_MAX_BYTES,
  proofBelongsToLink,
  UPLOAD_HOURLY_BUDGET,
  uploadsInLastHour,
  verifyProofUrl,
} from "../../direct-payments/proofs";
import { nextValidationSlot } from "../../direct-payments/schedule";
import { toWhatsAppPhone, whatsAppLink } from "../../receipt";
import { integrationOf } from "../../integrations/store";
import { dismissPruneNotice, pruneNoticeFor } from "../../links/prune";
import { consta, ConstaError } from "../../consta";
import { enqueueAndDeliver } from "../../webhooks/queue";
import { deferOf } from "../defer";
import type { DirectPayment } from "../../direct-payments/validation";
import {
  publicPaymentError,
  type CreateLinkRequest,
  type CreateLinkResponse,
  type CustomerRow,
  type CustomersQuery,
  type CustomersResponse,
  type PruneNoticeResponse,
  type LinkStatusResponse,
  type PayRequest,
} from "./schema";
import { decodeCursor, encodeCursor, FIRST_CURSOR, type BrowseCursor } from "./cursor";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* D13: every proof submission costs a paid provider call, on a public
   endpoint. Per link, per hour. */
const HOURLY_ATTEMPT_BUDGET = 5;

async function resolveLink(c: Ctx, token: string) {
  const db = drizzle(c.env.DB);
  const [link] = await db.select().from(paymentLinks).where(eq(paymentLinks.token, token));
  if (!link) {
    return { error: c.json({ success: false, error: { code: "NOT_FOUND" } }, 404) };
  }
  const [business] = await db.select().from(businesses).where(eq(businesses.id, link.businessId));
  /* integrations-hub D2: the key and the dials live on this row now */
  const integration = await integrationOf(db, link.businessId);
  return { db, link, business, integration };
}

async function attemptsInLastHour(
  db: ReturnType<typeof drizzle>,
  linkId: string,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(payments)
    .where(
      and(
        eq(payments.paymentLinkId, linkId),
        gte(payments.createdAt, new Date(now.getTime() - 3600 * 1000)),
      ),
    );
  return Number(row?.n ?? 0);
}

/* bug: one-open-attempt — the statuses of an attempt still in review:
   it has no verdict yet and will be polled (or released) again. */
const OPEN_STATUSES = ["validating", "queued_for_credit"] as const;

/* bug: one-open-attempt — the link's attempts still in review, newest
   first. One link keeps one in review; more than one exists only on rows
   born before this rule. */
async function openAttempts(db: ReturnType<typeof drizzle>, linkId: string) {
  return db
    .select()
    .from(payments)
    .where(and(eq(payments.paymentLinkId, linkId), inArray(payments.status, [...OPEN_STATUSES])))
    .orderBy(desc(payments.createdAt));
}

/* bug: one-open-attempt — the attempts an identical submission can be:
   still in review (it answers), or already paid (it refuses, D9). An
   `invalid` or `expired` one is left
   out on purpose — its transfer may validate now (Banxico publishes
   late), so sending it again must reach the provider. */
const LIVE_STATUSES = ["validating", "queued_for_credit", "confirmed", "partial", "unapplied"] as const;

/* bug: one-open-attempt — the attempt of this link a submission repeats,
   if any. Two ways to be the same:

   - **typed data**: D18's `unchanged` rule, applied to every live
     attempt rather than the one the page named — the clave (or, with no
     clave, the reference), the sending bank, the date and the amount.
     claimed-amount D4: an omitted amount matches; a changed one is a
     correction, because it changes what Banxico is asked. D9 amended:
     the same clave with other fields changed is a correction too.
   - **a receipt**: the same file — the sha256 its reading recorded
     (consta `extractions.proof_sha256`), or the object hashed when it was
     never read — and the same amount when the page confirmed one. */
async function identicalAttempt(
  env: Bindings,
  db: ReturnType<typeof drizzle>,
  business: { id: string },
  link: PaymentLink,
  body: PayRequest,
): Promise<DirectPayment | null> {
  const t = body.transfer;
  if (t) {
    const clave = t.trackingKey?.toUpperCase() ?? null;
    const rows = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.paymentLinkId, link.id),
          /* A reference is never unique — one bank printed 9784417 on three
             different $5 transfers the same night (dev, 2026-09-25) — so it
             can name the attempt still in review, but never refuse money
             as already paid: only a clave or the file can say that */
          inArray(payments.status, clave ? [...LIVE_STATUSES] : [...OPEN_STATUSES]),
          clave ? eq(payments.trackingKey, clave) : eq(payments.referenceNumber, t.referenceNumber!),
        ),
      )
      .orderBy(desc(payments.createdAt));
    return (
      rows.find(
        (r) =>
          (t.referenceNumber == null || !clave || r.referenceNumber === t.referenceNumber) &&
          r.senderBank === t.senderBank &&
          r.transferDate === t.date &&
          (t.amountCents == null || t.amountCents === (r.claimedAmountCents ?? r.amountCents)),
      ) ?? null
    );
  }
  if (!body.proofId) return null;
  const sha = await proofSha256(env, db, business.id, body.proofId);
  if (!sha) return null;
  const rows = await db
    .select({ payment: payments })
    .from(payments)
    .innerJoin(
      extractions,
      and(eq(extractions.proofKey, payments.proofKey), eq(extractions.businessId, business.id)),
    )
    .where(
      and(
        eq(payments.paymentLinkId, link.id),
        inArray(payments.status, [...LIVE_STATUSES]),
        eq(extractions.proofSha256, sha),
      ),
    )
    .orderBy(desc(payments.createdAt));
  return (
    rows
      .map((r) => r.payment)
      .find(
        (r) =>
          body.receiptAmountCents == null ||
          body.receiptAmountCents === (r.claimedAmountCents ?? r.amountCents),
      ) ?? null
  );
}

/* bug: one-open-attempt — a proof's fingerprint: the one its reading
   already recorded, or the object's own bytes hashed when the reader
   never saw it (an unavailable reader sends the page straight to the
   provider's door). Null when the object is gone. */
async function proofSha256(
  env: Bindings,
  db: ReturnType<typeof drizzle>,
  businessId: string,
  proofKey: string,
): Promise<string | null> {
  const [read] = await db
    .select({ sha: extractions.proofSha256 })
    .from(extractions)
    .where(
      and(
        eq(extractions.businessId, businessId),
        eq(extractions.proofKey, proofKey),
        sql`${extractions.proofSha256} IS NOT NULL`,
      ),
    )
    .limit(1);
  if (read?.sha) return read.sha;
  const object = await env.PROOFS.get(proofKey);
  if (!object) return null;
  /* the engine's own hash, so both fingerprints are the same recipe; read
     through a Response as the engine does, so the bucket's test double
     and a real R2ObjectBody read the same way */
  return sha256Hex(new Uint8Array(await new Response(object.body).arrayBuffer()));
}

/* bug: one-open-attempt — what the page needs to resume that attempt.
   Panel links only, with the rule it serves (see `submitPayment`). */
async function inReviewOf(
  db: ReturnType<typeof drizzle>,
  linkId: string,
): Promise<Pick<LinkStatusResponse, "inReview">> {
  const [open] = await openAttempts(db, linkId);
  return open
    ? { inReview: { directPaymentId: open.id, status: open.status as (typeof OPEN_STATUSES)[number] } }
    : {};
}

/* One helper, two audiences (bug links-refused-key). The panel hears
   the adapter's own code: WISPHUB_AUTH_FAILED is a setup problem with a
   door to Integraciones, WISPHUB_UNAVAILABLE is weather and a Reintentar
   — folding them was what let a good key on the wrong installation read
   as an outage (see cobros-installation-fallback). The payer keeps
   hearing one word: whose gap it is is not the customer's business, and
   the enumerated codes below are the whole of what travels to them. The
   default is the payer so an omitted argument can never leak an ISP's
   setup state to a customer. Never the key in the line (007 FR-013). */
function wisphubFailure(c: Ctx, e: unknown, audience: "payer" | "panel" = "payer") {
  if (e instanceof WispHubError) {
    console.error("wisphub failure:", e.code, e.message);
    const code = audience === "panel" ? e.code : "WISPHUB_UNAVAILABLE";
    return c.json({ success: false, error: { code } }, 503);
  }
  throw e;
}

/* automated-collections-api D5: the three gates, folded back into the one
   state the payer's page knows (D4). The split matters to /v1 — which
   refuses only on the business's own gap and turns the platform's into a
   notice — not to the payer, who must never see a CLABE nothing can
   validate, whoever's gap it is. A panel link without the WispHub key
   degrades exactly as before the split. */
function channelOpen(
  env: Bindings,
  business: typeof businesses.$inferSelect,
  link: Pick<PaymentLink, "source">,
  integration: { apiKey: string | null } | null,
): boolean {
  return businessConfigured(business) && validationAvailable(env) && askAvailable(link, integration);
}

/* Only the enumerated codes travel to the customer; internal ones
   (provider down, WispHub down) read as "still validating". */
function publicError(lastError: string | null) {
  const parsed = publicPaymentError.safeParse(lastError);
  return parsed.success ? parsed.data : null;
}

/* receipt-triage D29: the one account the payer sees — the cuenta de
   cobro, whatever its kind. `speiClabe`/`speiBank` ride beside it only
   when it is the CLABE, for a page built before this feature; a CLABE
   renders exactly as it always did (SC-008). The channel gate above
   guarantees the account exists. */
function transferAccount(business: typeof businesses.$inferSelect): Partial<LinkStatusResponse> {
  const account = collectStored(business)!;
  return {
    collectAccount: { kind: account.kind, value: account.value, bank: account.bank },
    ...(account.kind === "clabe" ? { speiClabe: account.value, speiBank: account.bank } : {}),
  };
}

/* receipt-triage D25: the account the draft reading of this proof tied
   to, when `/read` ran on it — so the payment is born checked against the
   account the receipt names. The engine ties again on the receipt door
   and its `beneficiaryUsed` has the last word; this only saves the row
   from being born with the wrong one. Owner-scoped like every read of
   `extractions` (constitution V). */
async function draftTiedAccount(
  db: DrizzleD1Database,
  business: typeof businesses.$inferSelect,
  proofId: string,
  accounts: StoredAccount[],
): Promise<StoredAccount | null> {
  const [draft] = await db
    .select({ kind: extractions.destinationKind, digits: extractions.destinationDigits })
    .from(extractions)
    .where(and(eq(extractions.businessId, business.id), eq(extractions.proofKey, proofId)))
    .orderBy(desc(extractions.createdAt))
    .limit(1);
  if (!draft?.digits) return null;
  const tie = tieDestination(
    { kind: draft.kind ?? null, digits: draft.digits },
    accounts.map((a) => toBeneficiary(a)),
  );
  return typeof tie === "object" ? fromBeneficiary(tie.tied) : null;
}

/* GET /direct-payments/links/:token (US-D01, D1, D4, D15) */
export async function getLinkStatus(c: Ctx, token: string) {
  const ctx = await resolveLink(c, token);
  if ("error" in ctx) return ctx.error;
  const { link, business, integration } = ctx;
  const now = new Date();

  /* payments-and-classes D9: a suspended business validates nothing —
     the page says so instead of collecting transfers into limbo. */
  if (business.status === "suspended") {
    return c.json({ success: false, error: { code: "BUSINESS_SUSPENDED" } }, 409);
  }

  if (!channelOpen(c.env, business, link, integration)) {
    /* D4: the GET already knows — the page degrades into the store
       network instead of showing a CLABE nothing can validate */
    const data: LinkStatusResponse = { ispName: business.name, status: "unavailable" };
    return c.json({ success: true, data });
  }
  if (isApiLink(link)) {
    /* automated-collections-api D6: an API link builds the SAME
       LinkStatusResponse from `ask_cents` — no WispHub client, no
       provider read. FR-032: the payer cannot tell the kinds apart.
       `label` is the display name the caller chose for the payer; the
       business name heads the page as it does for every link. */
    const state = linkState(link, now);
    if (state !== "open") {
      /* FR-031: a paid or expired one-time link explains itself and
         offers no CLABE — a transfer nobody would apply */
      const data: LinkStatusResponse = { ispName: business.name, status: "closed", closedReason: state };
      return c.json({ success: true, data });
    }
    const serviceFeeCents = speiFeeCents(business);
    const data: LinkStatusResponse = {
      ispName: business.name,
      ...(link.label ? { customerName: link.label } : {}),
      ...(link.concept ? { concept: link.concept } : {}),
      status: "debt",
      invoiceCents: link.askCents,
      carriedBalanceCents: 0,
      serviceFeeCents,
      totalCents: link.askCents + serviceFeeCents,
      ...transferAccount(business),
      ...(business.speiBeneficiaryName ? { speiBeneficiaryName: business.speiBeneficiaryName } : {}),
      /* The caller's own reference in the concepto, so the business
         recognises the payer in its statement exactly as an ISP does */
      reference: link.customerRef,
      cobros: [],
    };
    return c.json({ success: true, data });
  }
  if (!isPanelLink(link)) {
    /* One table, two shapes (D3): a row that is neither is a write-path
       bug, not a state to render */
    throw new Error(`link ${link.id} is neither a panel nor an API link`);
  }

  try {
    const wisphub = wisphubFor(integration!, c.env);
    /* provider-latency D2: independent reads, one wait. D3: the page
       renders here; the submission below re-reads before any amount is
       committed, so a 30s-old list cannot decide money. A large tenant
       reads the sweep's snapshot on both paths (bug: pending-invoice-cap). */
    const [customer, pending] = await Promise.all([
      wisphub.getCustomer(link.customerUsuario),
      readPendingInvoices(ctx.db, business.id, wisphub, now, { display: true }),
    ]);
    /* debt-truth D7: invoices plus the carried balance. A payer whose
       invoice closed on a short payment owes a remainder that the
       invoice list alone cannot see. */
    const debt = customer ? debtFor(customer, pending) : NO_DEBT;
    const customerName = customer?.name ?? link.customerUsuario;

    if (debt.totalCents === 0 && customer && !nothingOwedIsProven(customer, pending)) {
      /* bug: pending-invoice-cap — a zero from a cut-off list is not
         "al corriente". This page painted the green "no tienes pagos
         pendientes" to a customer whose invoice sat beyond the read
         (debt-truth D4 was never applied here). The honest answer is the
         one the page already has for a provider it could not read. */
      return c.json({ success: false, error: { code: "WISPHUB_READ_INCOMPLETE" } }, 503);
    }
    if (debt.totalCents === 0 || !customer) {
      const data: LinkStatusResponse = {
        ispName: business.name,
        customerName,
        status: "no_debt",
      };
      return c.json({ success: true, data });
    }

    /* D21 replaces D15: the page shows the whole debt, because WispHub
       applies a payment to the customer and not to one invoice. Asking
       for one invoice's total would ask for a number that reconnects
       nobody. */
    const serviceFeeCents = speiFeeCents(business);
    const data: LinkStatusResponse = {
      ispName: business.name,
      customerName,
      status: "debt",
      invoiceCents: debt.invoiceCents,
      carriedBalanceCents: debt.carriedBalanceCents,
      serviceFeeCents,
      totalCents: debt.totalCents + serviceFeeCents,
      ...transferAccount(business),
      /* claimed-amount D5: recommended, not required — omitted when the
         ISP has not configured it, and the page hides the row */
      ...(business.speiBeneficiaryName ? { speiBeneficiaryName: business.speiBeneficiaryName } : {}),
      reference: link.customerUsuario,
      /* cobros-live D8 (US-R04): oldest first, from the list already
         fetched — zero extra calls */
      cobros: pending.invoices
        .filter((f) => f.usuario === link.customerUsuario)
        .sort((a, b) => (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "") || a.invoiceId - b.invoiceId)
        .map((f) => ({ externalId: f.invoiceId, amountCents: f.totalCents, invoiceDate: f.invoiceDate })),
      ...(await inReviewOf(ctx.db, link.id)),
    };
    return c.json({ success: true, data });
  } catch (e) {
    return wisphubFailure(c, e);
  }
}

/* POST /direct-payments/links/:token/pay (US-D02) */
export async function submitPayment(c: Ctx, token: string, body: PayRequest) {
  const ctx = await resolveLink(c, token);
  if ("error" in ctx) return ctx.error;
  const { db, link, business, integration } = ctx;
  const now = new Date();

  /* payments-and-classes D9: same refusal as the GET — the POST is the
     one that would spend credit and start a validation. */
  if (business.status === "suspended") {
    return c.json({ success: false, error: { code: "BUSINESS_SUSPENDED" } }, 409);
  }

  if ((await attemptsInLastHour(db, link.id, now)) >= HOURLY_ATTEMPT_BUDGET) {
    return c.json({ success: false, error: { code: "TOO_MANY_ATTEMPTS" } }, 429);
  }
  if (!channelOpen(c.env, business, link, integration)) {
    return c.json({ success: false, error: { code: "SPEI_NOT_CONFIGURED" } }, 409);
  }
  if (!isApiLink(link) && !isPanelLink(link)) {
    throw new Error(`link ${link.id} is neither a panel nor an API link`);
  }
  /* FR-031: a closed or expired one-time link refuses new payments. The
     GET already showed no CLABE; this is the guard for a payer who kept
     the page open past the deadline. A reusable link is always open. */
  if (isApiLink(link) && !linkAcceptsPayments(link, now)) {
    return c.json({ success: false, error: { code: "LINK_CLOSED" } }, 409);
  }
  /* prepaid-credit D8: below the cap, what is new waits without spending
     — no provider call, no extraction. The payer did nothing wrong (D9).
     automated-collections-api D12: a test payment costs nothing, so an
     empty balance never queues it — a queued test row would be released
     by the top-up sweep into a real validation. */
  const paused = !link.isTest && (await creditSummary(db, business)).step === "paused";
  if (body.proofId) {
    /* No cross-link references: proofs are token-bound (D12) — and the
       object must actually exist before a paid provider call is spent */
    if (
      !proofBelongsToLink(body.proofId, link.id) ||
      !(await c.env.PROOFS.head(body.proofId))
    ) {
      return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
    }
  }

  /* bug: one-open-attempt — a submission identical to an attempt the
     link already holds is answered from that attempt, and nothing is
     created or spent. This is D18's "unchanged" (and D9's attach) widened
     from the one row the page named to every live attempt of the link,
     plus the file itself.

     Still in review: it answers, as D18 always did. Already paid: D9's
     refusal stands — the link is reusable, so last month's receipt shown
     back as "confirmado" would read as this month paid — but it is now
     given without a provider call. On 2026-09-25 a payer re-uploaded the
     very file of a payment confirmed on the link, and a paid call was
     spent to say `TRANSFER_ALREADY_USED`. */
  const same = await identicalAttempt(c.env, db, business, link, body);
  if (same && (OPEN_STATUSES as readonly string[]).includes(same.status)) {
    return c.json(
      {
        success: true,
        data: {
          directPaymentId: same.id,
          status: same.status as (typeof OPEN_STATUSES)[number],
          error: publicError(same.lastError),
        },
      },
      200,
    );
  }
  if (same) {
    /* provisional-release D6: the refusal keeps its memory, as the
       index's own refusal below does — the owner is the payer's own
       payment, which is confusion and never counts against them */
    if (same.trackingKey) {
      await db.insert(proofRejections).values({
        businessId: link.businessId,
        paymentLinkId: link.id,
        ownerPaymentId: same.id,
        trackingKey: same.trackingKey,
      });
    }
    return c.json({ success: false, error: { code: "TRANSFER_ALREADY_USED" } }, 409);
  }

  /* D18: the payer answered a `not_found` confirmation — or, since bug
     one-open-attempt, sent anything at all while the link has an attempt
     in review. Nothing identical came back (above), so this is a
     correction: the attempt in review is `superseded` and the new row
     takes its place. The page used to name it in `supersedes` only while
     it still held it in memory; a payer who reloaded, came back hours
     later or opened the link on another phone started a second attempt
     beside it, and the first kept polling the provider for up to twelve
     hours after the customer's money was confirmed (found live on dev,
     2026-09-25). One link keeps one attempt in review until paying in two
     transfers becomes its own choice. */
  let superseded: DirectPayment | null = null;
  if (body.supersedes) {
    const [prior] = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.id, body.supersedes),
          eq(payments.paymentLinkId, link.id),
        ),
      );
    if (!prior || prior.status !== "validating") {
      return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
    }
    superseded = prior;
  }
  /* Panel links only. An API link is the automated-collections contract,
     where two transfers on one link are both kept and the later one reads
     `unapplied`, never lost (automated-collections-api D16) — correcting
     there stays the explicit `supersedes` it always was. */
  const open = isPanelLink(link) ? await openAttempts(db, link.id) : [];
  superseded ??= open[0] ?? null;
  /* More than one open attempt exists only on rows born before this rule;
     the correction closes them all, and `supersedesId` names the one the
     payer was shown */
  const alsoClosed = open.filter((r) => r.id !== superseded?.id);

  const serviceFeeCents = speiFeeCents(business);

  /* receipt-triage D25/D30: the account this payment is checked against,
     and every account the business registered, current and retired —
     snapshotted now, so a later edit in Cuenta never moves this payment
     (FR-021). Typed data is checked against the cuenta de cobro (FR-018);
     a receipt whose draft reading tied another registered account is
     checked there (FR-020a). */
  const snapshotAccounts = registeredAccounts(business);
  let beneficiary: StoredAccount = collectStored(business)!;
  if (body.proofId && !body.transfer) {
    const tied = await draftTiedAccount(db, business, body.proofId, snapshotAccounts);
    if (tied) beneficiary = tied;
  }

  /* Where the ask comes from (automated-collections-api D5/D6). A panel
     link reads the debt live from WispHub; an API link carries it on the
     row. Everything after this block — the row, the claim, the inline
     attempt — is the same for both, which is the point: the money path
     never needed WispHub. */
  let ask: {
    ispDebtCents: number;
    invoiceCents: number;
    carriedBalanceCents: number;
    customer: {
      wisphubCustomerId: string | null;
      customerUsuario: string | null;
      customerRef: string | null;
      customerName: string;
      customerZone: string | null;
      customerPhone: string | null;
    };
    /* automated-collections-api D7: what the caller asked, frozen on the
       payment so a re-price meanwhile never moves the verdict's yardstick.
       Null on a panel payment, whose ask is read fresh at the verdict. */
    askedCents: number | null;
  };
  if (isApiLink(link)) {
    ask = {
      ispDebtCents: link.askCents,
      invoiceCents: link.askCents,
      carriedBalanceCents: 0,
      customer: {
        wisphubCustomerId: null,
        customerUsuario: null,
        customerRef: link.customerRef,
        /* The feed shows a name on every row; the caller's label, or its
           reference when it gave none */
        customerName: link.label ?? link.customerRef,
        customerZone: null,
        customerPhone: null,
      },
      askedCents: link.askCents,
    };
  } else {
    /* The debt at submission time decides the amount the CEP must match
       (D11, D15). A WispHub failure here is a pre-payment failure:
       nothing recorded, same posture as the store flow's guard. */
    let customer;
    let pending;
    try {
      const wisphub = wisphubFor(integration!, c.env);
      /* provider-latency D2 together, D3 **fresh**: this read decides the
         amount the CEP must match (D11/D15), so it never takes the
         30-second cache. bug: pending-invoice-cap — for a tenant no
         request can read whole, "fresh" is the sweep's last finished
         pass plus the live customer record. */
      [customer, pending] = await Promise.all([
        wisphub.getCustomer(link.customerUsuario),
        readPendingInvoices(db, business.id, wisphub, now),
      ]);
    } catch (e) {
      return wisphubFailure(c, e);
    }
    const debt = customer ? debtFor(customer, pending) : NO_DEBT;
    if (!customer || (debt.totalCents === 0 && nothingOwedIsProven(customer, pending))) {
      return c.json({ success: false, error: { code: "NOTHING_DUE" } }, 409);
    }
    if (debt.totalCents === 0) {
      /* bug: pending-invoice-cap — debt-truth D4's fallback to the plan's
         price stood here. It asked a customer beyond the read for a
         number that was not their debt, and the verdict then settled
         against it. Nothing is asked until the list can say. */
      return c.json({ success: false, error: { code: "WISPHUB_READ_INCOMPLETE" } }, 503);
    }

    /* A zero invoice line beside a carried balance is a real number, not
       a missing one — the ask is the debt, whole. */
    ask = {
      ispDebtCents: debt.totalCents,
      invoiceCents: debt.invoiceCents,
      carriedBalanceCents: debt.carriedBalanceCents,
      customer: {
        wisphubCustomerId: link.wisphubCustomerId,
        customerUsuario: link.customerUsuario,
        customerRef: null,
        /* pilot-UX review: the row is born with its person. The pre-check
           above already read the customer, so the in-flight row shows a
           name where every other row does; the confirmation overwrites
           with its own fresh read, as before. */
        customerName: customer.name ?? link.customerUsuario,
        customerZone: customer.zone ?? null,
        customerPhone: customer.phone ?? null,
      },
      askedCents: null,
    };
  }
  const amountCents = ask.ispDebtCents + serviceFeeCents;

  /* partial-payment D1 supersedes the refusal that stood here. It read
     the receipt's amount, compared it against the expected total and
     answered `AMOUNT_MISMATCH` with no row written — while the money was
     already in the ISP's account.

     The comparison itself was never the problem: Consta sends the amount
     **printed on the receipt** to Banxico (proof-extraction), so a short
     transfer comes back as a real CEP for the real amount. We had the
     answer and threw it away. Now the amount that came back decides how
     much was settled (D5), and the row records it either way.

     A misread still corrects itself without this guard: an amount that
     was never transferred finds no CEP, which is a `not_found` and rides
     D17's schedule while D18 asks the payer to check their data. */

  /* claimed-amount D1/D3: the payer's own number wins — a human who
     confirmed (or typed) the amount outranks the raw reading; the silent
     path still carries the reader's. Kept so the lookup asks Banxico
     about the transfer the payer actually made (partial-payment D5). */
  const claimedCents = body.transfer?.amountCents ?? body.receiptAmountCents ?? null;

  /* receipt-triage D7 (clarified 2026-09-24): typed data whose only key is
     a reference another payment of the business already holds — same
     date, bank, amount and account, from another link — cannot find this
     transfer alone. Refused before anything is created or billed; the
     page requires the clave (FR-005, FR-007). */
  if (body.transfer && !body.transfer.trackingKey && body.transfer.referenceNumber) {
    const shared = await sharedReference(db, business, link, {
      reference: body.transfer.referenceNumber,
      date: body.transfer.date,
      senderBank: body.transfer.senderBank,
      amountCents: claimedCents ?? amountCents,
      account: beneficiary,
    });
    if (shared) {
      return c.json({ success: false, error: { code: "REFERENCE_SHARED" } }, 409);
    }
  }

  /* Release the old claim *before* the insert: the corrected row may well
     be claiming a clave that only differs by a character, and D8's index
     does not care that the two rows belong to the same payer. */
  const closing = [...(superseded ? [superseded] : []), ...alsoClosed];
  if (closing.length > 0) {
    await db
      .update(payments)
      .set({ status: "superseded", nextValidationAt: null })
      .where(inArray(payments.id, closing.map((r) => r.id)));
  }

  const rowValues = {
    paymentLinkId: link.id,
    businessId: business.id,
    amountCents,
    invoiceCents: ask.invoiceCents,
    carriedBalanceCents: ask.carriedBalanceCents,
    claimedAmountCents: claimedCents,
    serviceFeeCents,
    proofMode: (body.transfer ? "transfer" : "receipt") as "transfer" | "receipt",
    trackingKey: body.transfer?.trackingKey?.toUpperCase() ?? null,
    /* receipt-triage D1/D12: as typed, leading zeros kept */
    referenceNumber: body.transfer?.referenceNumber ?? null,
    beneficiary: JSON.stringify(beneficiary),
    registeredAccounts: JSON.stringify(snapshotAccounts),
    senderBank: body.transfer?.senderBank ?? null,
    transferDate: body.transfer?.date ?? null,
    proofKey: body.proofId ?? null,
    /* D18 carries the prior's receipt status forward when the correction
       is of the same capture. bug: one-open-attempt — a new file is a new
       capture, so it carries its own (a correction now also comes from a
       payer who sent a different receipt). */
    receiptStatus:
      (superseded && (!body.proofId || body.proofId === superseded.proofKey) ? superseded.receiptStatus : null) ??
      body.receiptStatus ??
      null,
    supersedesId: superseded?.id ?? null,
    /* two-eyes-receipt D7 (data-model): a form the payer edited is the
       human's data, so the row records where its clave came from. That
       makes "the payer was asked and answered" a count rather than a
       guess — the number D10 wants, beside the machines' own agreement
       rate. `transfer` in a pay body means exactly this since D13: a
       machine reading travels as the file alone. */
    ...(body.transfer ? { acceptedFrom: "human" as const } : {}),
    ...ask.customer,
    askedCents: ask.askedCents,
    /* automated-collections-api D12: a payment on a test link is a test
       payment — the webhook says so, and the fee and the panel's reads
       key on it (T064, T065). A panel link is never a test link. */
    isTest: link.isTest,
    /* The row is born owned by the sweep (D7). The inline attempt
       below is an optimisation, not the mechanism: if it never
       finishes — a worker evicted, a provider that stalls past its
       deadline, a deploy mid-flight — the payment is still due at
       its first slot. Without this the row kept
       `next_validation_at = NULL`, which `sweepDirectPayments`
       cannot select, so it was never retried and never expired:
       the customer's money had moved and nothing would ever look
       at it again (found live, 2026-08-18).

       No race with the inline attempt: the first slot is +2 min and
       a validation answers in ~15 s.

       automated-collections-api D12: a test row is never due. The
       sweep cannot select it, no attempt ever runs, and it moves only
       when the caller advances it through /v1/test. */
    nextValidationAt: paused || link.isTest ? null : nextValidationSlot(now, now),
    ...(paused ? { status: "queued_for_credit" as const } : {}),
  };

  /* On any refusal after this point the prior's claim must come back:
     it was released for a submission that did not happen (D9 amendment,
     found live 2026-08-26 — a cross-link collision left the prior
     superseded with no successor, an orphan nothing would ever poll). */
  const restorePrior = async () => {
    /* bug: one-open-attempt — every attempt this submission closed, each
       to the status and slot it had (a queued one stays queued) */
    for (const prior of closing) {
      await db
        .update(payments)
        .set({ status: prior.status, nextValidationAt: prior.nextValidationAt })
        .where(eq(payments.id, prior.id));
    }
  };

  let payment;
  try {
    [payment] = await db.insert(payments).values(rowValues).returning();
  } catch (e) {
    /* D8: the partial unique index is what makes one transfer pay
       once — racing concurrent submissions included */
    if (!isUniqueViolation(e)) throw e;
    /* validation-status-ux D9: the reader's misreads are deterministic,
       so a re-uploaded capture reproduces the same wrong clave — and a
       payer whose "Verificando" context is gone collides with their own
       live row. Any owner that is not theirs — another link, or a
       terminal row that already consumed the transfer — still refuses. */
    const collidingKey = body.transfer?.trackingKey?.toUpperCase();
    const [own] = collidingKey
      ? await db
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.paymentLinkId, link.id),
              eq(payments.trackingKey, collidingKey),
              eq(payments.status, "validating"),
            ),
          )
      : [undefined];
    if (!own) {
      /* provisional-release D6: the rejection gets a memory. Which
         payment owns the clave decides everything downstream — another
         customer's is the shape of double-spending (revokes the fast
         lane 12 months), the payer's own terminal row is confusion and
         never counts. Recorded before answering; the 409 is unchanged. */
      if (collidingKey) {
        const [owner] = await db
          .select({ id: payments.id })
          .from(payments)
          .where(
            and(
              eq(payments.businessId, link.businessId),
              eq(payments.trackingKey, collidingKey),
              sql`${payments.status} NOT IN ('invalid', 'expired', 'superseded')`,
            ),
          );
        await db.insert(proofRejections).values({
          businessId: link.businessId,
          paymentLinkId: link.id,
          ownerPaymentId: owner?.id ?? null,
          trackingKey: collidingKey,
        });
      }
      await restorePrior();
      return c.json({ success: false, error: { code: "TRANSFER_ALREADY_USED" } }, 409);
    }

    /* D9 amended (found live 2026-08-26): attach only when the whole
       submission matches — the first D9 compared the clave alone, so a
       payer correcting *other* fields toward a clave they already owned
       had those edits silently discarded. */
    const sameSubmission =
      own.senderBank === (body.transfer?.senderBank ?? null) &&
      own.transferDate === (body.transfer?.date ?? null) &&
      (claimedCents == null || claimedCents === (own.claimedAmountCents ?? own.amountCents));
    if (sameSubmission) {
      return c.json(
        {
          success: true,
          data: {
            directPaymentId: own.id,
            status: "validating" as const,
            error: publicError(own.lastError),
          },
        },
        200,
      );
    }

    /* The same clave with different data is the payer correcting the
       owning row: supersede it and take its place, chain intact (D8). */
    await db
      .update(payments)
      .set({ status: "superseded", nextValidationAt: null })
      .where(eq(payments.id, own.id));
    try {
      [payment] = await db
        .insert(payments)
        .values({ ...rowValues, supersedesId: own.id })
        .returning();
    } catch (e2) {
      if (!isUniqueViolation(e2)) throw e2;
      /* A second owner in the same instant: give both claims back */
      await db
        .update(payments)
        .set({ status: "validating", nextValidationAt: own.nextValidationAt })
        .where(eq(payments.id, own.id));
      await restorePrior();
      return c.json({ success: false, error: { code: "TRANSFER_ALREADY_USED" } }, 409);
    }
  }

  /* automated-collections-api D17 (FR-013): the row is born, so the
     business's endpoint hears it — `validating` or `queued_for_credit`,
     the row's own word, through either door. Fired here and never at
     upload or at the reader's draft, because no payment exists before
     the customer submits. A row this submission closed is announced
     `superseded` first: a caller that heard it was validating deserves
     to hear it is not any more. The first attempt runs under
     `waitUntil`; the payer's answer never waits on it (FR-017). */
  const defer = deferOf(c);
  if (isApiLink(link)) {
    for (const id of [payment.supersedesId, ...alsoClosed.map((r) => r.id)]) {
      if (!id) continue;
      const [closed] = await db.select().from(payments).where(eq(payments.id, id));
      if (closed?.status === "superseded") await enqueueAndDeliver(c.env, db, { payment: closed, link, now }, defer);
    }
    await enqueueAndDeliver(c.env, db, { payment, link, now }, defer);
  }

  /* Inline attempt, then the sweep takes over (D7) — the same split as
     charge recording and reconnection. A queued row waits for the
     release (D8): nothing runs, nothing is spent. A test row waits for
     the caller (automated-collections-api D12): Consta is never asked.

     two-eyes-receipt D4: the attempt still runs first, but **the answer
     no longer waits for it.** The payer used to hold a spinner for the
     provider's 6–10 seconds — and up to its 25-second deadline — before
     the page could say anything at all, for an answer the page then
     polls for anyway. The row is already born owned by the sweep, so
     nothing here is load-bearing: `validation_attempts` is written
     before the provider call (the rule found live on 2026-08-18), which
     is what makes a lost verdict the payment's *own* attempt on retry
     and keeps the replay carve-out honest (FR-021). An attempt that
     never finishes runs again at +2 min, exactly as one that never
     started does.

     The platform bounds post-response work handed to `waitUntil`; the
     published limit is 30 s of CPU-plus-wait after the response, which
     covers the worst case here — the provider's 25 s deadline plus a
     reused reading (no model call, D14) plus the D1 writes — with the
     typical case at 6–10 s. **Read from the Workers docs, not measured
     against this Worker.** A verdict lost to that window is survived by
     the counter above.

     `executionCtx` throws outside a Worker request (Hono), so a caller
     that has none — a test calling the app directly — awaits inline and
     nothing is ever dropped. */
  let row = payment;
  if (!paused && !link.isTest) {
    const attempt = runValidation(c.env, db, payment, link, business, integration, now, { defer });
    try {
      c.executionCtx.waitUntil(
        attempt.catch((e) => console.error("deferred validation failed:", e)),
      );
    } catch {
      row = await attempt;
    }
  }
  return c.json(
    {
      success: true,
      data: {
        directPaymentId: row.id,
        /* The row's own status as the payer leaves: `validating`, or
           `queued_for_credit` when the business is paused (D8). The
           terminal values stay in the enum for compatibility and are no
           longer produced inline — the page reads the outcome on its
           first poll (two-eyes-receipt D4). */
        status: row.status as "validating" | "confirmed" | "partial" | "invalid" | "unapplied" | "queued_for_credit",
        error: publicError(row.lastError),
      },
    },
    201,
  );
}

/* POST /direct-payments/links/:token/proof (US-D02, D12, D13) */
export async function uploadProof(c: Ctx, token: string) {
  const ctx = await resolveLink(c, token);
  if ("error" in ctx) return ctx.error;
  const { db, link } = ctx;
  const now = new Date();

  /* Two budgets, because an upload can outrun a submission (D13). The
     pay budget closes the expensive door: no point storing a proof that
     has no provider call left to feed. The upload budget closes the
     cheap one — uploading never creates a `direct_payments` row, so
     without its own count a leaked link is free anonymous hosting under
     our domain for as long as the token lives. */
  if ((await attemptsInLastHour(db, link.id, now)) >= HOURLY_ATTEMPT_BUDGET) {
    return c.json({ success: false, error: { code: "TOO_MANY_ATTEMPTS" } }, 429);
  }
  if ((await uploadsInLastHour(c.env.PROOFS, link.id, now)) >= UPLOAD_HOURLY_BUDGET) {
    return c.json({ success: false, error: { code: "TOO_MANY_ATTEMPTS" } }, 429);
  }

  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }
  if (file.size > PROOF_MAX_BYTES) {
    return c.json({ success: false, error: { code: "PROOF_TOO_LARGE" } }, 413);
  }
  if (!isAcceptedProofType(file.type)) {
    return c.json({ success: false, error: { code: "PROOF_UNSUPPORTED_TYPE" } }, 415);
  }

  const proofId = makeProofKey(link.id, now);
  /* Buffered on purpose: R2 needs a known length, and the 1 MB cap
     makes the buffer bounded */
  await c.env.PROOFS.put(proofId, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  return c.json({ success: true, data: { proofId } });
}

/* POST /direct-payments/links/:token/read (US-D11, D18)

   The machine reads — and since two-eyes-receipt D3 the provider reads
   too, beside it, on the paid call this one precedes. This endpoint is
   the free half: it spends a Workers AI call in the engine and **no
   provider credit**, and everything it returns is a draft. The payer no
   longer confirms that draft as a matter of course (D13): it is shown to
   them when the amount is above the debt, and otherwise it exists so the
   page can refuse the two files that are not worth a credit (D2) and so
   the paid attempt can reuse the reading instead of making it twice
   (D14).

   Nothing here fails the payment. A reader that is down, a file nothing
   could read, a clave that did not survive the gate — each comes back as
   a draft with holes in it, and the payer fills them. A PDF is no longer
   one of those cases (two-eyes-receipt D1): it is turned into text at
   the edge and read by the same model, so it answers like a picture. The
   machine is help, not an authority: **this endpoint cannot reject
   anybody**, and that stays true of the legibility it now reports —
   `legibility: "none"` is a fact on the wire here, and it is the *page*
   that refuses on it, before a credit is spent (D2, FR-004).

   receipt-triage D15 keeps that sentence true while the reading learns to
   ask: a clear capture with no key, or one whose destination fits none of
   the business's accounts, comes back with an `ask` the page renders —
   reported here, enforced by the engine's receipt door, so a client that
   skips the page buys nothing either way. The business's registered
   accounts, current and retired, go to the engine so it can judge the
   destination (D24, D30); only whether one was seen comes back
   (`destinationSeen`), never the digits or the account they tied. */
export async function readProof(c: Ctx, token: string, proofId: string) {
  const ctx = await resolveLink(c, token);
  if ("error" in ctx) return ctx.error;
  const { db, link, business } = ctx;
  const now = new Date();

  if (!proofBelongsToLink(proofId, link.id)) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  /* Reading follows uploading, so the upload budget already bounds how
     often this can run per link (D13). Re-reading one proof is not
     separately capped: it costs a Workers AI call, not a provider
     credit, and the payer re-reading their own receipt is the flow
     working, not abuse. */
  if ((await uploadsInLastHour(c.env.PROOFS, link.id, now)) >= UPLOAD_HOURLY_BUDGET) {
    return c.json({ success: false, error: { code: "TOO_MANY_ATTEMPTS" } }, 429);
  }
  if (!(await c.env.PROOFS.head(proofId))) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  /* consta-api-merge D3/D7: the reading is this business's call, so the
     engine's log stays honest cost telemetry; the engine takes the file
     from the bucket by its key. No provider gate here — the reader needs
     no credential, and an absent AI binding degrades inside the engine.
     D6: the 503's code is the engine's; the page never reads it
     (PaymentPage falls through to the provider's door on any failure). */
  let reading;
  try {
    reading = await consta(c.env, db, { businessId: business.id }).extract({
      proofKey: proofId,
      receivingAccounts: registeredAccounts(business).map((a) => toBeneficiary(a)),
    });
  } catch (e) {
    const code = e instanceof ConstaError ? e.code : "READER_UNAVAILABLE";
    console.error("proof reading failed:", code);
    return c.json({ success: false, error: { code: "READER_UNAVAILABLE" } }, 503);
  }

  const ask = await sharedAsk(db, business, link, reading);
  /* receipt-triage D21 (FR-028): a shared reference is asked about as a
     capture with no key, so it is counted as one — the reading record
     says `key_missing`, as the receipt door's own stop does */
  if (ask?.reason === "no_key" && "shared" in ask && ask.shared && reading.extractionId) {
    await db
      .update(extractions)
      .set({ outcome: "key_missing", rawOutput: sql`coalesce(${extractions.rawOutput}, '') || ' [reference shared (D7)]'` })
      .where(and(eq(extractions.id, reading.extractionId), eq(extractions.businessId, business.id)));
  }

  return c.json({
    success: true,
    data: {
      source: reading.source,
      isReceipt: reading.isReceipt,
      /* two-eyes-receipt D2: what the reader said about the picture.
         Reported, never enforced here. */
      legibility: reading.legibility,
      /* Reported so the caller can refuse a lookup that cannot succeed —
         never to decide what anything is worth (D3) */
      amountCents: reading.gate.amount === "ok" ? reading.amountCents : null,
      /* Only what passed the gate reaches the payer as a suggestion. A
         malformed clave is worse than no clave: it looks confirmable. */
      trackingKey: reading.gate.trackingKey === "ok" ? reading.trackingKey : null,
      senderBank: reading.gate.senderBank === "ok" ? reading.senderBank : null,
      date: reading.date,
      receiptStatus: reading.receiptStatus,
      gate: reading.gate,
      /* receipt-triage D12 */
      referenceNumber: reading.referenceNumber,
      ask,
      destinationSeen: visibleTail(reading.destination.digits) !== null,
    },
  });
}

/* receipt-triage D7 (clarified 2026-09-24): a reading whose only key is a
   reference another payment of the business already holds that day —
   same bank, amount and account, from another link — is asked about as a
   capture with no key: the reference cannot find this transfer alone. The
   receipt door meets the same finding before its paid call (the
   lifecycle's `sharedReference`), so the page and the engine agree. */
async function sharedAsk(
  db: DrizzleD1Database,
  business: typeof businesses.$inferSelect,
  link: PaymentLink,
  reading: Awaited<ReturnType<ReturnType<typeof consta>["extract"]>>,
) {
  if (reading.ask || reading.trackingKey || !reading.referenceNumber) return reading.ask;
  if (!reading.date || !reading.senderBank || reading.amountCents == null) return reading.ask;
  const account = reading.tiedAccount ? fromBeneficiary(reading.tiedAccount) : collectStored(business);
  const shared = await sharedReference(db, business, link, {
    reference: reading.referenceNumber,
    date: reading.date,
    senderBank: reading.senderBank,
    amountCents: reading.amountCents,
    account,
  });
  if (!shared) return null;
  const fields: ("key" | "amount" | "date" | "senderBank")[] = ["key"];
  return { reason: "no_key" as const, fields, shared: true };
}

/* GET /direct-payments/proofs/:linkId/:file — how the engine's provider
   fetches the image (D12): only with a live HMAC signature. Everything
   else is 404, indistinguishable from a key that never existed. */
export async function serveProof(c: Ctx, linkId: string, file: string) {
  const key = `${linkId}/${file}`;
  const exp = c.req.query("exp") ?? "";
  const sig = c.req.query("sig") ?? "";
  if (!(await verifyProofUrl(c.env, key, exp, sig, new Date()))) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  const object = await c.env.PROOFS.get(key);
  if (!object) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}

/* GET /direct-payments/:id/status (US-D03, US-D04) */
export async function getDirectPaymentStatus(c: Ctx, id: string) {
  const db = drizzle(c.env.DB);
  const [payment] = await db.select().from(payments).where(eq(payments.id, id));
  if (!payment) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  /* business-and-memberships D6: the reconnection lives on the row.
     automated-collections-api D6/D7: an API payment has a folio and, until
     US2's webhook sets it, no action outcome — the folio travels on its
     own, the outcome only when there is one. */
  const charge = payment.folio
    ? { folio: payment.folio, ...(payment.actionOutcome ? { actionOutcome: payment.actionOutcome } : {}) }
    : null;
  /* provisional-release D7: the expired page offers exactly one manual
     retry per clave — self-selection: the payer who really paid claims
     it (six more hours published the late CEP), the fabricator has no
     reason to. Spent = another expired row already re-claimed this key. */
  let retryAvailable = false;
  if (payment.status === "expired" && payment.trackingKey) {
    const spent = await db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.paymentLinkId, payment.paymentLinkId),
          eq(payments.trackingKey, payment.trackingKey),
          eq(payments.status, "expired"),
          sql`${payments.id} != ${payment.id}`,
        ),
      );
    retryAvailable = spent.length === 0;
  }
  return c.json({
    success: true,
    data: {
      status: payment.status,
      ...(payment.status === "expired" ? { retryAvailable } : {}),
      ...(charge ?? {}),
      /* D7: what arrived, what was owed and what is missing — in money,
         computed here so the page never does arithmetic about a policy
         the payer did not agree to. */
      ...(payment.receivedCents !== null
        ? {
            receivedCents: payment.receivedCents,
            debtCents: payment.invoiceCents + payment.carriedBalanceCents,
            missingCents: Math.max(
              0,
              payment.invoiceCents + payment.carriedBalanceCents - payment.receivedCents,
            ),
          }
        : {}),
      validationAttempts: payment.validationAttempts,
      /* validation-status-ux D5: when the system will try again, so the
         page can promise an hour instead of "news" on a channel that
         does not exist. Null once terminal — every terminal write
         already clears the column. */
      nextValidationAt:
        payment.status === "validating"
          ? (payment.nextValidationAt?.getTime() ?? null)
          : null,
      error: publicError(payment.lastError),
      /* D18: enough for the confirmation screen to render from the row
         instead of from whatever the browser still holds. A reload must
         not lose the question — and all of this is the payer's own data,
         echoed back to the payer. */
      trackingKey: payment.trackingKey,
      senderBank: payment.senderBank,
      transferDate: payment.transferDate,
      /* claimed-amount D3: the amount this payment asked Banxico with,
         so the correction form pre-fills what actually travelled */
      claimedAmountCents: payment.claimedAmountCents,
      /* reading-check D3/D4: 'blind' travels as null — no evidence is
         the same as no cross, and the page must not know the difference */
      readingCheck:
        payment.readingCheck === "agreed" || payment.readingCheck === "disputed"
          ? payment.readingCheck
          : null,
      /* two-eyes-receipt D20: the fields travel whatever the check said,
         not only on a `disputed`. An agreement with no date on either
         reading is still an agreement — the clock retires and the
         release may fire — and still needs one field from the payer, so
         the page opens its form on a non-empty list rather than on the
         word "disputed" (contracts/payment-page.md). */
      ...(payment.disputedFields ? { disputedFields: JSON.parse(payment.disputedFields) } : {}),
      receiptStatus: payment.receiptStatus,
      /* receipt-triage D1: the reference this payment searches with */
      referenceNumber: payment.referenceNumber,
      /* receipt-triage D31: the business decides before anything settles;
         the page says so and shows no success state */
      ...(payment.actionOutcome === "review" ? { inReview: true } : {}),
      /* provisional-release D9: the page never speaks in conditionals,
         so it must know whether the service was actually given back —
         and which evidence bought it, because evidence and consequence
         are one sentence. Absent = never released. */
      ...(payment.provisionalReleaseAt
        ? {
            provisionalRelease: {
              evidence: payment.releaseEvidence,
              kind: payment.releaseKind,
            },
          }
        : {}),
    },
  });
}

/* GET /direct-payments/links — ISP session (US-D05, US-D06, D5).
   Generation is lazy, in batch, on ISP request: listing IS what creates
   the missing links, so every WispHub customer has one without anybody
   creating them by hand. */
/* What the customer reads when the ISP shares their link (US-D07 D3).
   Here, not in the admin, for the same reason the receipt's text lives
   in the API (receipt spec D2): the words reach the customer the same
   way whoever sends them. */
const shareText = (url: string) =>
  `Hola, aquí está tu link de pago de internet. Guárdalo: sirve cada mes.\n\n${url}`;

/* The share text for an API link names no service: the business may be
   a gym or a school, and the link may be one-time (FR-028) */
const apiShareText = (url: string) => `Hola, aquí está tu link de pago:\n\n${url}`;

/* ---- links-on-demand-search: the customers door and the act ---- */

/* Case- and accent-insensitive on OUR side too (FR-004): the provider's
   `__contains` already ignores both, and a search that found "María" in
   WispHub and missed "María" in an API link would be one promise kept
   twice differently. */
const foldText = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

/* An API link as a customer row: the caller's reference is the identity,
   and the ask is the one this channel stores (automated-collections-api
   D3). No provider is involved — these are Devolada's own rows, which is
   why a business with no WispHub still has something to show (FR-015). */
function apiCustomerRow(link: ApiLink, baseUrl: string, now: Date): CustomerRow {
  const url = `${baseUrl}/p/${link.token}`;
  return {
    channel: "api",
    usuario: null,
    wisphubId: null,
    customerRef: link.customerRef,
    label: link.label,
    askCents: link.askCents,
    linkState: linkState(link, now),
    name: link.label ?? link.customerRef,
    phone: null,
    /* An API link exists by construction — it was created by the call
       that made it, not by an operator's act */
    hasLink: true,
    url,
    /* No phone on an API link: the contact picker, and a message that
       names no service (receipt spec D3) */
    waLink: whatsAppLink(apiShareText(url), null),
  };
}

/* A WispHub customer as a customer row. `token` is the link they already
   have, or null — and null does NOT hide the buttons (D7, FR-026): it
   means the link is not born yet, and pressing Copiar or WhatsApp is
   what gives birth to it (FR-008, D8). */
function panelCustomerRow(customer: WispHubCustomer, token: string | null, baseUrl: string): CustomerRow {
  const url = token ? `${baseUrl}/p/${token}` : null;
  return {
    channel: "panel",
    usuario: customer.usuario,
    wisphubId: customer.wisphubId,
    customerRef: null,
    label: null,
    askCents: null,
    linkState: null,
    /* FR-007/FR-010: read live, every time. The link stores none of it. */
    name: customer.name,
    phone: customer.phone,
    hasLink: token !== null,
    url,
    waLink: url ? whatsAppLink(shareText(url), toWhatsAppPhone(customer.phone)) : null,
  };
}

/* usuario → token, for the customers of one block. One statement: a
   block is at most CUSTOMERS_LIMIT_MAX rows, well under D1's parameter
   cap, which is the whole point of reading a block instead of a base. */
async function linksForUsuarios(
  db: DrizzleD1Database,
  businessId: string,
  usuarios: string[],
): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  if (!usuarios.length) return tokens;
  const rows = await db
    .select({ customerUsuario: paymentLinks.customerUsuario, token: paymentLinks.token })
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.businessId, businessId),
        eq(paymentLinks.source, "panel"),
        inArray(paymentLinks.customerUsuario, usuarios),
      ),
    );
  for (const row of rows) {
    if (row.customerUsuario !== null) tokens.set(row.customerUsuario, row.token);
  }
  return tokens;
}

/* The business's own API links, real ones only.

   FR-017 is this one predicate: a test credential's links exist — the
   caller reads them through /v1 to test its own polling — and never
   reach a business-facing read. It is spelled here rather than
   remembered, exactly as `realOnly`'s comment asks.

   Read whole rather than filtered in SQL: FR-004 promises accent- and
   case-insensitive matching on BOTH sides, and SQLite's LIKE folds
   neither. These are Devolada's own rows for one business — the roster
   read them the same way — and the volume that would make this wrong is
   an API-only business with thousands of links, which is a different
   door's problem the day it exists. */
async function apiLinksOf(db: DrizzleD1Database, businessId: string): Promise<ApiLink[]> {
  const rows = await db
    .select()
    .from(paymentLinks)
    .where(and(eq(paymentLinks.businessId, businessId), eq(paymentLinks.source, "api"), realOnly(paymentLinks)));
  return rows.filter(isApiLink);
}

/* links-on-demand-search D10: the provider being down is an ANSWER, not
   a failure (FR-014). A rejected key is the one exception — it is a
   setup problem the ISP must fix, not an outage to ride out, and
   `bug: links-refused-key` asserts it keeps its own 503. Anything that
   is not the adapter's own error is a bug in ours and is rethrown. */
function providerIsAway(e: unknown): boolean {
  if (!(e instanceof WispHubError)) throw e;
  return e.code !== "WISPHUB_AUTH_FAILED";
}

/* What Devolada can still answer a search with when WispHub cannot
   (FR-003, FR-014): its own panel links, matched by the identity they
   carry. That identity is ALL they carry — FR-010 keeps the name, the
   phone and the service state out of the row — so these come back
   nameless, and the browser fills them in from the customers it saw
   minutes ago (FR-021). Between the two, the operator can still find
   and send to the customer whose link Devolada holds.

   Panel links are only searched when the provider did not answer: when
   it does, `usuario__contains` covers the same ground live, and merging
   the two would mean deduping one customer against themselves. */
async function panelLinksMatching(
  db: DrizzleD1Database,
  businessId: string,
  needle: string,
  baseUrl: string,
): Promise<CustomerRow[]> {
  const all = await db
    .select()
    .from(paymentLinks)
    .where(and(eq(paymentLinks.businessId, businessId), eq(paymentLinks.source, "panel")));
  /* FR-006: every match, not a capped handful. The caller pages this
     list by the cursor's offset, so a cap here would be a customer the
     operator can see counted and can never scroll to (D5, amended
     2026-09-23). */
  return all
    .filter(isPanelLink)
    .filter((link) => foldText(link.customerUsuario).includes(needle))
    .map((link) => {
      const url = `${baseUrl}/p/${link.token}`;
      return {
        channel: "panel" as const,
        usuario: link.customerUsuario,
        wisphubId: Number(link.wisphubCustomerId) || null,
        customerRef: null,
        label: null,
        askCents: null,
        linkState: null,
        /* Nothing about the person is stored, so nothing about the
           person is returned (FR-010) */
        name: null,
        phone: null,
        hasLink: true,
        url,
        /* No phone to dial without the provider: WhatsApp's own picker,
           with the message ready (receipt spec D3, FR-019) */
        waLink: whatsAppLink(shareText(url), null),
      };
    });
}

/* The cursor's `fields` bitmask, both ways (D5, amended 2026-09-23).
   `0` means "ask all four", which is where a walk starts and what a
   restarted one falls back to. */
const maskOf = (fields: readonly CustomerSearchField[]) =>
  fields.reduce((mask, field) => mask | (1 << CUSTOMER_SEARCH_FIELDS.indexOf(field)), 0);

const fieldsFromMask = (mask: number): readonly CustomerSearchField[] =>
  mask === 0 ? CUSTOMER_SEARCH_FIELDS : CUSTOMER_SEARCH_FIELDS.filter((_, i) => mask & (1 << i));

/* GET /direct-payments/customers — ISP session (links-on-demand-search
   D1, FR-001).

   The ISP's customers, with their link if one exists. Browsing and
   searching are one door because they answer the same question with the
   same rows and differ only in how the rows were found — a page with one
   search box should not hold two queries with two caches.

   What it never does is read the customer base. A browse is ONE provider
   call for ONE block (D3, FR-020); a search is four filters asked at once
   (D4). The roster this replaces read 6,513 customers and wrote a link
   for every one of them, on every return to the tab. */
export async function listCustomers(c: Ctx, query: CustomersQuery) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const integration = await integrationOf(db, actor.id);
  const base = c.env.PAGO_BASE_URL;
  const now = new Date();
  const limit = query.limit;

  /* constitution VIII: no key is a state of the world, not a failure.
     The business sees its API links and the page says where links come
     from (FR-015). */
  const connected = Boolean(integration?.apiKey);
  const wisphub = connected ? wisphubFor(integration!, c.env) : null;

  if (query.q !== undefined) {
    const needle = foldText(query.q);

    /* D5 (amended 2026-09-23): a search WALKS, exactly as a browse does.
       It used to answer one block and tell the operator to type more
       letters — which counted 39 matches for «Leo», showed 10, and left
       the other 29 reachable only by a luckier guess (FR-006).

       The cursor says where the four filters are and which of them are
       still worth asking. A BROWSE cursor arriving here is not an error
       and not a guess: the walk restarts, because the two shapes mean
       different positions and a search that silently resumed at a
       browse's offset would skip rows without saying so. */
    let offset = 0;
    let mask = 0;
    if (query.cursor !== undefined) {
      const decoded = decodeCursor(query.cursor);
      if (decoded === null) {
        return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
      }
      if (decoded.phase === "search") {
        offset = decoded.offset;
        mask = decoded.fields;
      }
    }
    const firstBlock = offset === 0;
    const onward = (fields: number): string =>
      encodeCursor({ phase: "search", offset: offset + limit, fields });

    let search;
    let away = false;
    if (wisphub) {
      try {
        search = await wisphub.searchCustomers(query.q, limit, {
          offset,
          fields: fieldsFromMask(mask),
        });
      } catch (e) {
        /* D10 / FR-014: the search still answers, with what Devolada
           has, under a quiet note. It never answers an error block —
           except for a refused key, which is setup, not weather. */
        if (!providerIsAway(e)) return wisphubFailure(c, e, "panel");
        away = true;
      }
    }

    /* D1's own rows: the provider cannot know about an API link. Read
       only where they are actually needed — the first block of a live
       search, or any block of one the provider is not answering. */
    const apiRows =
      firstBlock || away || !wisphub
        ? (await apiLinksOf(db, actor.id))
            .filter(
              (link) =>
                foldText(link.customerRef).includes(needle) ||
                foldText(link.label ?? "").includes(needle),
            )
            .map((link) => apiCustomerRow(link, base, now))
        : [];

    /* The provider did not answer — by outage or by never having been
       connected — so Devolada's own rows answer for it (FR-003).

       Both sources are in memory here, so the walk is one list sliced by
       the cursor: no filter offsets to keep in step, and `matched` is
       the exact size of what Devolada can see rather than a floor. What
       it cannot see is the provider's, and the note already says so. */
    if (!wisphub || away) {
      const all = [...apiRows, ...(await panelLinksMatching(db, actor.id, needle, base))];
      const page = all.slice(offset, offset + limit);
      return c.json({
        success: true,
        data: {
          results: page,
          nextCursor: offset + limit < all.length ? onward(0) : null,
          matched: all.length,
          total: null,
          wisphub: !connected ? "not_configured" : "unavailable",
        } satisfies CustomersResponse,
      });
    }

    const customers = search?.customers ?? [];
    const tokens = await linksForUsuarios(db, actor.id, customers.map((customer) => customer.usuario));
    /* D6: dedupe by identity. The two channels cannot collide — an API
       row has no usuario — and the provider's own rows arrive deduped,
       so the merge is a concatenation. The block is NOT cut to `limit`:
       the four filters advance together, so a row fetched and dropped
       here is a row the next block would skip (D5). */
    const results = [
      ...apiRows,
      ...customers.map((customer) => panelCustomerRow(customer, tokens.get(customer.usuario) ?? null, base)),
    ];

    /* D5: the largest of the counts asked for, and never smaller than
       what we are about to show. The union of four filters cannot be
       sized without walking it, so while the walk continues the page
       says "más de N" — and when it ends, what it found IS the answer
       (FR-006). */
    const counts = Object.values(search?.counts ?? {});
    const more = search?.more ?? [];
    return c.json({
      success: true,
      data: {
        results,
        nextCursor: more.length ? onward(maskOf(more)) : null,
        matched: Math.max(apiRows.length, results.length, ...counts),
        total: null,
        wisphub: "ok",
      } satisfies CustomersResponse,
    });
  }

  /* Browse (D2). The cursor says which source the walk is in: Devolada's
     own API links by keyset first — Devolada owns that order, so it is
     stable — then the provider's list by offset, which is all the
     provider offers and why no order is promised (D6). */
  const cursor = query.cursor === undefined ? FIRST_CURSOR : decodeCursor(query.cursor);
  if (cursor === null) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }

  const results: CustomerRow[] = [];
  let next: BrowseCursor | null = cursor;
  let total: number | null = null;

  if (next.phase === "api") {
    const after = next;
    const rows = (await db
      .select()
      .from(paymentLinks)
      .where(
        and(
          eq(paymentLinks.businessId, actor.id),
          eq(paymentLinks.source, "api"),
          realOnly(paymentLinks),
          or(
            gt(paymentLinks.createdAt, new Date(after.createdAt)),
            and(eq(paymentLinks.createdAt, new Date(after.createdAt)), gt(paymentLinks.id, after.id)),
          ),
        ),
      )
      .orderBy(asc(paymentLinks.createdAt), asc(paymentLinks.id))
      .limit(limit + 1)) as PaymentLink[];
    const page = rows.slice(0, limit).filter(isApiLink);
    results.push(...page.map((link) => apiCustomerRow(link, base, now)));
    if (rows.length > limit) {
      const last = rows[limit - 1];
      next = { phase: "api", createdAt: last.createdAt.getTime(), id: last.id };
    } else {
      /* The API links are drained. The walk crosses into the provider's
         list HERE, inside this request, rather than answering a block of
         three rows to a business that holds three API links and six
         thousand customers (FR-001 asks for a screenful). D2's rule that
         the phases never interleave is what keeps the cursor meaningful,
         and it still holds: nothing of phase one is left, so `wh:<offset>`
         says everything about where the walk is. */
      next = { phase: "wisphub", offset: 0 };
    }
  }

  let away = false;
  if (next.phase === "wisphub") {
    const room = limit - results.length;
    if (!wisphub || room <= 0) {
      /* No key: this business's own links are all there is to walk */
      if (!wisphub) next = null;
    } else {
      const offset = next.offset;
      let block: { customers: WispHubCustomer[]; total: number } | null = null;
      try {
        block = await wisphub.customersBlock(room, offset);
      } catch (e) {
        /* D10 / FR-014: the walk answers with whatever it already has,
           under a quiet note, and stops there. A refused key keeps its
           own 503 (bug: links-refused-key). */
        if (!providerIsAway(e)) return wisphubFailure(c, e, "panel");
        away = true;
        next = null;
      }
      if (block) {
        total = block.total;
        const tokens = await linksForUsuarios(db, actor.id, block.customers.map((customer) => customer.usuario));
        results.push(
          ...block.customers.map((customer) =>
            panelCustomerRow(customer, tokens.get(customer.usuario) ?? null, base),
          ),
        );
        const walked = offset + block.customers.length;
        /* FR-020: the page never walks the list to its end on its own —
           it asks for the next block when the operator scrolls toward
           it, and the walk ends when the provider's count is reached. */
        next = walked >= block.total || block.customers.length === 0 ? null : { phase: "wisphub", offset: walked };
      }
    }
  }

  return c.json({
    success: true,
    data: {
      results,
      nextCursor: next === null ? null : encodeCursor(next),
      matched: null,
      /* FR-018: no "la lista puede estar incompleta" — nothing is read
         whole, so nothing can be cut short. What the page MAY say is how
         many customers the ISP has, which the provider answers with
         every block. */
      total,
      wisphub: !connected ? "not_configured" : away ? "unavailable" : "ok",
    } satisfies CustomersResponse,
  });
}

/* POST /direct-payments/links — the act (links-on-demand-search D8,
   FR-008).

   This is the ONLY thing that creates a panel link. Not a list read, not
   a sweep, not a return to the tab: an operator pressing Copiar or
   WhatsApp, on Links or on Cobros (D14). SC-009 is the measurement of
   that sentence, and `ensureLink` is where it is enforced.

   The customer is read by exact `usuario=` because a panel link needs
   the provider's numeric id — and that same answer carries the PHONE,
   which is what makes `waLink` open the customer's own chat instead of
   WhatsApp's contact picker (D16, FR-028). No extra call, no stored
   copy, fresh by construction.

   Unlike the read door, this one DOES fail when the provider is silent:
   a link created from a stale identity would be a link to the wrong
   person. */
export async function createLink(c: Ctx, body: CreateLinkRequest) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const [business] = await db.select().from(businesses).where(eq(businesses.id, actor.id));
  if (!business) {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  /* FR-016: a link nobody can pay is not shared. The same gate the
     screen shows one storey above — the buttons wait for the CLABE. */
  if (!businessConfigured(business)) {
    return c.json({ success: false, error: { code: "SPEI_NOT_CONFIGURED" } }, 409);
  }
  const integration = await integrationOf(db, actor.id);
  if (!integration?.apiKey) {
    return c.json({ success: false, error: { code: "WISPHUB_NOT_CONFIGURED" } }, 503);
  }

  let customer;
  try {
    customer = await wisphubFor(integration, c.env).getCustomer(body.usuario);
  } catch (e) {
    return wisphubFailure(c, e, "panel");
  }
  if (!customer) {
    /* A NEW code, deliberately: the area's NOT_FOUND means "no such link
       or route", and the panel must tell that apart from "the provider
       has no such customer" — an integration problem an operator can act
       on (contract, POST /direct-payments/links). */
    return c.json({ success: false, error: { code: "CUSTOMER_NOT_FOUND" } }, 404);
  }

  const { token, created } = await ensureLink(db, actor.id, customer);
  const url = `${c.env.PAGO_BASE_URL}/p/${token}`;
  return c.json({
    success: true,
    data: {
      token,
      url,
      /* FR-019/FR-028: `toWhatsAppPhone` still owns the rules — Mexico's
         52 in front, a refusal for a number it cannot read, which falls
         back to the picker. That fallback is now the exception. */
      waLink: whatsAppLink(shareText(url), toWhatsAppPhone(customer.phone)),
      created,
    } satisfies CreateLinkResponse,
  });
}

/* GET /direct-payments/prune-notice — ISP session, `payments: read`.

   FR-023's second half: the one-time cleanup must TELL the business how
   many links went. Read once, dismissed once, and then silent forever —
   there is no second transition. */
export async function pruneNotice(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const notice = await pruneNoticeFor(drizzle(c.env.DB), actor.id);
  return c.json({ success: true, data: notice satisfies PruneNoticeResponse });
}

/* POST /direct-payments/prune-notice/dismiss — `payments: operate`,
   stricter than the read on purpose: a viewer should not be able to
   silence, for everyone, the record of links that were deleted. */
export async function dismissPrune(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  await dismissPruneNotice(drizzle(c.env.DB), actor.id);
  return c.json({ success: true, data: { dismissed: true } });
}

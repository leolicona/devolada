import type { Context } from "hono";
import { and, asc, eq, gt, gte, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { payments, businesses, paymentLinks, proofRejections } from "../../db/schema";
import { D1_MAX_PARAMS, chunks } from "../../db/params";
import { creditSummary } from "../../credit";
import { WispHub, WispHubError } from "../../wisphub/client";
import { pendingInvoicesForDisplay, pendingVersion, rosterForDisplay } from "../../wisphub/cache";
import { NO_DEBT, debtOf } from "../../wisphub/debt";
import {
  askAvailable,
  businessConfigured,
  isUniqueViolation,
  runValidation,
  speiFeeCents,
  validationAvailable,
} from "../../direct-payments/validation";
import {
  isApiLink,
  isPanelLink,
  linkAcceptsPayments,
  linkState,
  makeLinkToken,
  realOnly,
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
import { consta, ConstaError } from "../../consta";
import { enqueueAndDeliver } from "../../webhooks/queue";
import { deferOf } from "../defer";
import type { DirectPayment } from "../../direct-payments/validation";
import { publicPaymentError, type LinksRosterResponse, type LinkStatusResponse, type PayRequest } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* D13: every proof submission costs a paid provider call, on a public
   endpoint. Per link, per hour. */
const HOURLY_ATTEMPT_BUDGET = 5;

/* Every customer of the roster has a link (direct-payment D5,
   admin-links-view D5): the usuario is the identity, the numeric id a
   cache. Writes only what changed. The upsert this replaces rewrote one
   `payment_links` row per customer on every read, cache hit or not —
   and the roster is read on every return to the Links tab (BUG-020).
   Statements grow with the tenant, so each goes in chunks under D1's
   parameter cap (BUG-021). Returns usuario → token. */
async function ensureLinks(
  db: ReturnType<typeof drizzle>,
  businessId: string,
  customers: { usuario: string; wisphubId: number }[],
): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  if (!customers.length) return tokens;
  /* usuario → the numeric id the row holds today */
  const storedId = new Map<string, string>();
  const readTokens = async (usuarios: string[]) => {
    /* one parameter is the business id, one the source */
    for (const part of chunks(usuarios, D1_MAX_PARAMS - 2)) {
      const rows = await db
        .select({
          customerUsuario: paymentLinks.customerUsuario,
          token: paymentLinks.token,
          wisphubCustomerId: paymentLinks.wisphubCustomerId,
        })
        .from(paymentLinks)
        .where(
          and(
            eq(paymentLinks.businessId, businessId),
            /* automated-collections-api D3/D4: the usuario namespace is the
               panel's; an API link never holds one */
            eq(paymentLinks.source, "panel"),
            inArray(paymentLinks.customerUsuario, part),
          ),
        );
      for (const row of rows) {
        if (row.customerUsuario === null || row.wisphubCustomerId === null) continue;
        tokens.set(row.customerUsuario, row.token);
        storedId.set(row.customerUsuario, row.wisphubCustomerId);
      }
    }
  };
  await readTokens(customers.map((customer) => customer.usuario));

  const missing = customers.filter((customer) => !tokens.has(customer.usuario));
  /* nine values per row at most: id and created_at, the four written
     below, and `source`, `mode`, `is_test` — drizzle sends a column's
     literal default as a parameter too (automated-collections-api D3;
     measured 2026-09-17: 150 customers at six per row overran D1's cap) */
  for (const part of chunks(missing, Math.floor(D1_MAX_PARAMS / 9))) {
    const inserted = await db
      .insert(paymentLinks)
      .values(
        part.map((customer) => ({
          businessId,
          token: makeLinkToken(),
          wisphubCustomerId: String(customer.wisphubId),
          customerUsuario: customer.usuario,
        })),
      )
      /* Two members listing at once: the first insert wins the usuario,
         the second reads its token below. automated-collections-api D4:
         the usuario index is partial now, and SQLite matches a named
         conflict target to a partial index only when the target repeats
         its WHERE — which drizzle 0.40 cannot emit for DO NOTHING (it
         places `where` after `do nothing`, a syntax error; measured
         2026-09-17). An untargeted DO NOTHING covers every unique index
         on the table, which for a fresh token is the same one. */
      .onConflictDoNothing()
      .returning({ customerUsuario: paymentLinks.customerUsuario, token: paymentLinks.token });
    for (const row of inserted) {
      if (row.customerUsuario !== null) tokens.set(row.customerUsuario, row.token);
    }
  }
  const raced = missing.filter((customer) => !tokens.has(customer.usuario)).map((c) => c.usuario);
  if (raced.length) await readTokens(raced);

  /* D5: the numeric id refreshes on sight — one row each, only when it
     moved, which is a recycled id on the demo tenant and nothing on a
     real one. */
  for (const customer of customers) {
    const stored = storedId.get(customer.usuario);
    if (stored !== undefined && stored !== String(customer.wisphubId)) {
      await db
        .update(paymentLinks)
        .set({ wisphubCustomerId: String(customer.wisphubId) })
        .where(and(eq(paymentLinks.businessId, businessId), eq(paymentLinks.customerUsuario, customer.usuario)));
    }
  }
  return tokens;
}

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

function wisphubFailure(c: Ctx, e: unknown) {
  if (e instanceof WispHubError) {
    console.error("wisphub failure:", e.code, e.message);
    return c.json({ success: false, error: { code: "WISPHUB_UNAVAILABLE" } }, 503);
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
      speiClabe: business.speiClabe!,
      speiBank: business.speiBank!,
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
    const wisphub = new WispHub(integration!.apiKey!, c.env.WISPHUB_BASE_URL);
    /* provider-latency D2: independent reads, one wait. D3: the page
       renders here; the submission below re-reads fresh before any
       amount is committed, so a 30s-old list cannot decide money. */
    const version = await pendingVersion(ctx.db, business.id);
    const [customer, pending] = await Promise.all([
      wisphub.getCustomer(link.customerUsuario),
      pendingInvoicesForDisplay(business.id, wisphub, now, version),
    ]);
    /* debt-truth D7: invoices plus the carried balance. A payer whose
       invoice closed on a short payment owes a remainder that the
       invoice list alone cannot see. */
    const debt = customer ? debtOf(customer, pending) : NO_DEBT;
    const customerName = customer?.name ?? link.customerUsuario;

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
      speiClabe: business.speiClabe!,
      speiBank: business.speiBank!,
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

  /* D18: the payer answered a `not_found` confirmation. Two outcomes,
     and the first is the common one if CEP latency is what it looks
     like: they confirmed a reading that was already right. */
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
    /* A supersede without transfer data is the re-upload door
       (validation-status-ux D7): a fresh proof is a new attempt by
       definition, so only a typed correction can be "unchanged".
       claimed-amount D4: the amount joins the comparison — changing only
       the amount changes what Banxico is asked, so it is a real
       correction. An omitted field matches whatever the row holds (older
       clients and older rows never sent one). */
    const unchanged =
      body.transfer != null &&
      prior.trackingKey === body.transfer.trackingKey.toUpperCase() &&
      prior.senderBank === body.transfer.senderBank &&
      prior.transferDate === body.transfer.date &&
      (body.transfer.amountCents == null ||
        body.transfer.amountCents === (prior.claimedAmountCents ?? prior.amountCents));
    if (unchanged) {
      /* Nothing to correct. Keep the row, its schedule and its attempt
         count, and spend nothing — a second row would carry the same
         clave straight into D8's unique index and answer
         `TRANSFER_ALREADY_USED` to a payer racing only themselves. */
      return c.json(
        {
          success: true,
          data: {
            directPaymentId: prior.id,
            status: prior.status as "validating",
            error: publicError(prior.lastError),
          },
        },
        200,
      );
    }
    superseded = prior;
  }

  const serviceFeeCents = speiFeeCents(business);

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
      const wisphub = new WispHub(integration!.apiKey!, c.env.WISPHUB_BASE_URL);
      /* provider-latency D2 together, D3 **fresh**: this read decides the
         amount the CEP must match (D11/D15), so it never takes the cache. */
      [customer, pending] = await Promise.all([
        wisphub.getCustomer(link.customerUsuario),
        wisphub.pendingInvoices(now),
      ]);
    } catch (e) {
      return wisphubFailure(c, e);
    }
    const debt = customer ? debtOf(customer, pending) : NO_DEBT;
    if (
      !customer ||
      (debt.totalCents === 0 &&
        (pending.complete ||
          customer.carriedBalanceCents < 0 ||
          customer.billingStatus === "paid"))
    ) {
      return c.json({ success: false, error: { code: "NOTHING_DUE" } }, 409);
    }

    /* Same rule as the store path: only D4's truncation fallback falls back
       to the plan's price. A zero invoice line beside a carried balance is
       a real number, not a missing one. */
    const debtUnknown = debt.totalCents === 0;
    const ispDebtCents = debtUnknown ? customer.planPriceCents : debt.totalCents;
    ask = {
      ispDebtCents,
      invoiceCents: debtUnknown ? ispDebtCents : debt.invoiceCents,
      carriedBalanceCents: debtUnknown ? 0 : debt.carriedBalanceCents,
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

  /* Release the old claim *before* the insert: the corrected row may well
     be claiming a clave that only differs by a character, and D8's index
     does not care that the two rows belong to the same payer. */
  if (superseded) {
    await db
      .update(payments)
      .set({ status: "superseded", nextValidationAt: null })
      .where(eq(payments.id, superseded.id));
  }

  /* claimed-amount D1/D3: the payer's own number wins — a human who
     confirmed (or typed) the amount outranks the raw reading; the silent
     path still carries the reader's. Kept so the lookup asks Banxico
     about the transfer the payer actually made (partial-payment D5). */
  const claimedCents = body.transfer?.amountCents ?? body.receiptAmountCents ?? null;
  const rowValues = {
    paymentLinkId: link.id,
    businessId: business.id,
    amountCents,
    invoiceCents: ask.invoiceCents,
    carriedBalanceCents: ask.carriedBalanceCents,
    claimedAmountCents: claimedCents,
    serviceFeeCents,
    proofMode: (body.transfer ? "transfer" : "receipt") as "transfer" | "receipt",
    trackingKey: body.transfer?.trackingKey.toUpperCase() ?? null,
    senderBank: body.transfer?.senderBank ?? null,
    transferDate: body.transfer?.date ?? null,
    proofKey: body.proofId ?? null,
    receiptStatus: superseded?.receiptStatus ?? body.receiptStatus ?? null,
    supersedesId: superseded?.id ?? null,
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
    if (superseded) {
      await db
        .update(payments)
        .set({ status: "validating", nextValidationAt: superseded.nextValidationAt })
        .where(eq(payments.id, superseded.id));
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
    const collidingKey = body.transfer?.trackingKey.toUpperCase();
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
    if (payment.supersedesId) {
      const [closed] = await db.select().from(payments).where(eq(payments.id, payment.supersedesId));
      if (closed?.status === "superseded") await enqueueAndDeliver(c.env, db, { payment: closed, link, now }, defer);
    }
    await enqueueAndDeliver(c.env, db, { payment, link, now }, defer);
  }

  /* Inline attempt, then the sweep takes over (D7) — the same split as
     charge recording and reconnection. A queued row waits for the
     release (D8): nothing runs, nothing is spent. A test row waits for
     the caller (automated-collections-api D12): Consta is never asked. */
  const row = paused || link.isTest ? payment : await runValidation(c.env, db, payment, link, business, integration, now, { defer });
  return c.json(
    {
      success: true,
      data: {
        directPaymentId: row.id,
        /* `expired` cannot happen inline (the schedule starts now) */
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

   The machine reads, the human confirms, the direct door validates. This
   endpoint is the first half: it spends a Workers AI call in the engine
   and **no provider credit**, and everything it returns is a draft the
   payer is about to see and can overwrite.

   Nothing here fails the payment. A reader that is down, a file that is
   a PDF, a clave that did not survive the gate — each comes back as a
   draft with holes in it, and the payer fills them. The machine is help,
   not an authority: this endpoint cannot reject anybody. */
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
    reading = await consta(c.env, db, { businessId: business.id }).extract({ proofKey: proofId });
  } catch (e) {
    const code = e instanceof ConstaError ? e.code : "READER_UNAVAILABLE";
    console.error("proof reading failed:", code);
    return c.json({ success: false, error: { code: "READER_UNAVAILABLE" } }, 503);
  }

  return c.json({
    success: true,
    data: {
      source: reading.source,
      isReceipt: reading.isReceipt,
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
    },
  });
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
      ...(payment.readingCheck === "disputed" && payment.disputedFields
        ? { disputedFields: JSON.parse(payment.disputedFields) }
        : {}),
      receiptStatus: payment.receiptStatus,
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
export async function listLinks(c: Ctx, cursor?: string) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const integration = await integrationOf(db, actor.id);
  if (!integration?.apiKey) {
    return c.json({ success: false, error: { code: "WISPHUB_NOT_CONFIGURED" } }, 503);
  }

  try {
    const customers = await new WispHub(integration.apiKey, c.env.WISPHUB_BASE_URL).listCustomers();
    /* D5: the usuario is the identity — an existing usuario keeps its
       token (the link is permanent while its usuario exists) and only
       the numeric id, a cache WispHub may recycle, refreshes. */
    await ensureLinks(db, actor.id, customers);
  } catch (e) {
    return wisphubFailure(c, e);
  }

  const PAGE = 50;
  const rows = await db
    .select()
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.businessId, actor.id),
        /* automated-collections-api D3: this is the WispHub list, keyed and
           paged by usuario; API links join the panel through the roster
           (US1, T076) */
        eq(paymentLinks.source, "panel"),
        ...(cursor ? [gt(paymentLinks.customerUsuario, cursor)] : []),
      ),
    )
    .orderBy(asc(paymentLinks.customerUsuario))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE).filter(isPanelLink);
  return c.json({
    success: true,
    data: {
      links: page.map((link) => ({
        token: link.token,
        usuario: link.customerUsuario,
        url: `${c.env.PAGO_BASE_URL}/p/${link.token}`,
      })),
      nextCursor: rows.length > PAGE ? (page[page.length - 1]?.customerUsuario ?? null) : null,
    },
  });
}

/* What the customer reads when the ISP shares their link (US-D07 D3).
   Here, not in the admin, for the same reason the receipt's text lives
   in the API (receipt spec D2): the words reach the customer the same
   way whoever sends them. */
const shareText = (url: string) =>
  `Hola, aquí está tu link de pago de internet. Guárdalo: sirve cada mes.\n\n${url}`;

/* GET /direct-payments/links/roster — ISP session (US-D07, amended by
   the pilot-UX round). The WHOLE tenant with each customer's permanent
   link: WispHub's own filters are exact-match and the old search
   guessed one parameter from the text's shape, so finding "greyes" by
   half a name was impossible. Now the list travels once (30s display
   cache, Cobros' own pattern) and the browser searches it by contains.
   Listing IS what creates missing links, exactly like /links (D5). */
export async function linksRoster(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const integration = await integrationOf(db, actor.id);
  const now = new Date();
  type RosterRow = LinksRosterResponse["results"][number];

  /* automated-collections-api FR-011 (US1 scenario 11): the API's links
     join the same list, read from the row — no provider, no cache. Test
     rows never reach the panel (D12, FR-035): `realOnly` is the one rule. */
  const apiRows = await db
    .select()
    .from(paymentLinks)
    .where(and(eq(paymentLinks.businessId, actor.id), eq(paymentLinks.source, "api"), realOnly(paymentLinks)));
  const apiResults: RosterRow[] = apiRows.filter(isApiLink).map((link) => {
    const url = `${c.env.PAGO_BASE_URL}/p/${link.token}`;
    return {
      channel: "api",
      wisphubId: null,
      usuario: null,
      customerRef: link.customerRef,
      label: link.label,
      askCents: link.askCents,
      linkState: linkState(link, now),
      name: link.label ?? link.customerRef,
      phone: null,
      url,
      /* No phone on an API link — the contact picker, and a message that
         names no service (FR-028 reaches the share text too) */
      waLink: whatsAppLink(apiShareText(url), null),
    };
  });

  /* A business without WispHub still sees its links (FR-011, research
     D5): the API rows alone, no refusal. A provider that fails keeps its
     503 — the screen shows the last reading with a quiet note. */
  if (!integration?.apiKey) {
    return c.json({
      success: true,
      data: { results: sortRoster(apiResults), complete: true, readAt: now.getTime() },
    });
  }

  let roster;
  try {
    roster = await rosterForDisplay(actor.id, new WispHub(integration.apiKey, c.env.WISPHUB_BASE_URL), now);
  } catch (e) {
    return wisphubFailure(c, e);
  }
  const customers = roster.customers.filter((customer) => customer.usuario !== "");
  /* D5: the usuario keeps its token, the recycled numeric id only
     refreshes the cache — and only the missing links are written. */
  const linkMap = await ensureLinks(db, actor.id, customers);

  const panelResults: RosterRow[] = customers.flatMap((customer) => {
    const token = linkMap.get(customer.usuario);
    /* No token means the insert above skipped this customer; a link to
       `/p/undefined` is worse than one row missing from the results. */
    if (!token) return [];
    const url = `${c.env.PAGO_BASE_URL}/p/${token}`;
    return [
      {
        channel: "panel" as const,
        wisphubId: customer.wisphubId,
        usuario: customer.usuario,
        name: customer.name,
        phone: customer.phone,
        url,
        /* The API owns the message and the number (receipt spec D2, D3):
           `toWhatsAppPhone` puts Mexico's 52 in front and refuses a
           number it cannot read — wa.me/55… is Brazil. */
        waLink: whatsAppLink(shareText(url), toWhatsAppPhone(customer.phone)),
      },
    ];
  });

  return c.json({
    success: true,
    /* presence-freshness D7 (BUG-018): the provider read's time */
    data: { results: sortRoster([...panelResults, ...apiResults]), complete: roster.complete, readAt: roster.readAt },
  });
}

/* One order for both channels: by the name the row shows */
function sortRoster<T extends { name: string; usuario: string | null; customerRef?: string }>(rows: T[]): T[] {
  const key = (row: T) => row.name || row.usuario || row.customerRef || "";
  return rows.sort((a, b) => key(a).localeCompare(key(b), "es"));
}

/* The share text for an API link names no service: the business may be
   a gym or a school, and the link may be one-time (FR-028) */
const apiShareText = (url: string) => `Hola, aquí está tu link de pago:\n\n${url}`;

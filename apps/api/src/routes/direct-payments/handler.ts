import type { Context } from "hono";
import { and, asc, eq, gt, gte, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { charges, directPayments, isps, paymentLinks } from "../../db/schema";
import { WispHub, WispHubError } from "../../wisphub/client";
import { pendingInvoicesForDisplay } from "../../wisphub/cache";
import { NO_DEBT, debtOf } from "../../wisphub/debt";
import {
  isUniqueViolation,
  runValidation,
  speiAvailable,
  speiFeeCents,
} from "../../direct-payments/validation";
import {
  isAcceptedProofType,
  makeProofKey,
  PROOF_MAX_BYTES,
  proofBelongsToLink,
  signedProofUrl,
  UPLOAD_HOURLY_BUDGET,
  uploadsInLastHour,
  verifyProofUrl,
} from "../../direct-payments/proofs";
import { nextValidationSlot } from "../../direct-payments/schedule";
import { toWhatsAppPhone, whatsAppLink } from "../../receipt";
import { Consta, ConstaError } from "../../consta/client";
import type { DirectPayment } from "../../direct-payments/validation";
import { publicPaymentError, type LinkStatusResponse, type PayRequest } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* D13: every proof submission costs a paid provider call, on a public
   endpoint. Per link, per hour. */
const HOURLY_ATTEMPT_BUDGET = 5;

/* Opaque, permanent, non-guessable (D1). 32-char alphabet without
   confusables; 256 % 32 === 0, so the modulo is unbiased. 16 chars ≈
   80 bits. */
function makeLinkToken(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const b of bytes) out += alphabet[b % 32];
  return out;
}

async function resolveLink(c: Ctx, token: string) {
  const db = drizzle(c.env.DB);
  const [link] = await db.select().from(paymentLinks).where(eq(paymentLinks.token, token));
  if (!link) {
    return { error: c.json({ success: false, error: { code: "NOT_FOUND" } }, 404) };
  }
  const [isp] = await db.select().from(isps).where(eq(isps.id, link.ispId));
  return { db, link, isp };
}

async function attemptsInLastHour(
  db: ReturnType<typeof drizzle>,
  linkId: string,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(directPayments)
    .where(
      and(
        eq(directPayments.paymentLinkId, linkId),
        gte(directPayments.createdAt, new Date(now.getTime() - 3600 * 1000)),
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
  const { link, isp } = ctx;
  const now = new Date();

  if (!speiAvailable(c.env, isp)) {
    /* D4: the GET already knows — the page degrades into the store
       network instead of showing a CLABE nothing can validate */
    const data: LinkStatusResponse = { ispName: isp.name, status: "unavailable" };
    return c.json({ success: true, data });
  }

  try {
    const wisphub = new WispHub(isp.wisphubApiKey!, c.env.WISPHUB_BASE_URL);
    /* provider-latency D2: independent reads, one wait. D3: the page
       renders here; the submission below re-reads fresh before any
       amount is committed, so a 30s-old list cannot decide money. */
    const [customer, pending] = await Promise.all([
      wisphub.getCustomer(link.customerUsuario),
      pendingInvoicesForDisplay(isp.id, wisphub, now),
    ]);
    /* debt-truth D7: invoices plus the carried balance. A payer whose
       invoice closed on a short payment owes a remainder that the
       invoice list alone cannot see. */
    const debt = customer ? debtOf(customer, pending) : NO_DEBT;
    const customerName = customer?.name ?? link.customerUsuario;

    if (debt.totalCents === 0 || !customer) {
      const data: LinkStatusResponse = {
        ispName: isp.name,
        customerName,
        status: "no_debt",
      };
      return c.json({ success: true, data });
    }

    /* D21 replaces D15: the page shows the whole debt, because WispHub
       applies a payment to the customer and not to one invoice. Asking
       for one invoice's total would ask for a number that reconnects
       nobody. */
    const serviceFeeCents = speiFeeCents(isp);
    const data: LinkStatusResponse = {
      ispName: isp.name,
      customerName,
      status: "debt",
      invoiceCents: debt.invoiceCents,
      carriedBalanceCents: debt.carriedBalanceCents,
      serviceFeeCents,
      totalCents: debt.totalCents + serviceFeeCents,
      speiClabe: isp.speiClabe!,
      speiBank: isp.speiBank!,
      speiBeneficiaryName: isp.speiBeneficiaryName!,
      reference: link.customerUsuario,
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
  const { db, link, isp } = ctx;
  const now = new Date();

  if ((await attemptsInLastHour(db, link.id, now)) >= HOURLY_ATTEMPT_BUDGET) {
    return c.json({ success: false, error: { code: "TOO_MANY_ATTEMPTS" } }, 429);
  }
  if (!speiAvailable(c.env, isp)) {
    return c.json({ success: false, error: { code: "SPEI_NOT_CONFIGURED" } }, 409);
  }
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
      .from(directPayments)
      .where(
        and(
          eq(directPayments.id, body.supersedes),
          eq(directPayments.paymentLinkId, link.id),
        ),
      );
    if (!prior || prior.status !== "validating") {
      return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
    }
    const unchanged =
      prior.trackingKey === body.transfer!.trackingKey.toUpperCase() &&
      prior.senderBank === body.transfer!.senderBank &&
      prior.transferDate === body.transfer!.date;
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

  /* The debt at submission time decides the amount the CEP must match
     (D11, D15). A WispHub failure here is a pre-payment failure:
     nothing recorded, same posture as the store flow's guard. */
  let customer;
  let pending;
  try {
    const wisphub = new WispHub(isp.wisphubApiKey!, c.env.WISPHUB_BASE_URL);
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

  const serviceFeeCents = speiFeeCents(isp);
  /* Same rule as the store path: only D4's truncation fallback falls back
     to the plan's price. A zero invoice line beside a carried balance is
     a real number, not a missing one. */
  const debtUnknown = debt.totalCents === 0;
  const ispDebtCents = debtUnknown ? customer.planPriceCents : debt.totalCents;
  const amountCents = ispDebtCents + serviceFeeCents;

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
      .update(directPayments)
      .set({ status: "superseded", nextValidationAt: null })
      .where(eq(directPayments.id, superseded.id));
  }

  let payment;
  try {
    [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents,
        invoiceCents: debtUnknown ? ispDebtCents : debt.invoiceCents,
        carriedBalanceCents: debtUnknown ? 0 : debt.carriedBalanceCents,
        /* The reader's amount, kept so the lookup asks Banxico about the
           transfer the payer actually made (partial-payment D5) */
        claimedAmountCents: body.receiptAmountCents ?? null,
        serviceFeeCents,
        proofMode: body.transfer ? "transfer" : "receipt",
        trackingKey: body.transfer?.trackingKey.toUpperCase() ?? null,
        senderBank: body.transfer?.senderBank ?? null,
        transferDate: body.transfer?.date ?? null,
        proofKey: body.proofId ?? null,
        receiptStatus: superseded?.receiptStatus ?? body.receiptStatus ?? null,
        supersedesId: superseded?.id ?? null,
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
           a validation answers in ~15 s. */
        nextValidationAt: nextValidationSlot(now, now),
      })
      .returning();
  } catch (e) {
    /* D8: the partial unique index is what makes one transfer pay
       once — racing concurrent submissions included */
    if (isUniqueViolation(e)) {
      return c.json({ success: false, error: { code: "TRANSFER_ALREADY_USED" } }, 409);
    }
    throw e;
  }

  /* Inline attempt, then the sweep takes over (D7) — the same split as
     charge recording and reconnection */
  const row = await runValidation(c.env, db, payment, link, isp, now);
  return c.json(
    {
      success: true,
      data: {
        directPaymentId: row.id,
        /* `expired` cannot happen inline (the schedule starts now) */
        status: row.status as "validating" | "confirmed" | "invalid" | "unapplied",
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
   endpoint is the first half: it spends a Workers AI call at Consta and
   **no provider credit**, and everything it returns is a draft the payer
   is about to see and can overwrite.

   Nothing here fails the payment. A reader that is down, a file that is
   a PDF, a clave that did not survive the gate — each comes back as a
   draft with holes in it, and the payer fills them. The machine is help,
   not an authority: this endpoint cannot reject anybody. */
export async function readProof(c: Ctx, token: string, proofId: string) {
  const ctx = await resolveLink(c, token);
  if ("error" in ctx) return ctx.error;
  const { db, link } = ctx;
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
  if (!c.env.CONSTA_BASE_URL || !c.env.CONSTA_API_KEY) {
    return c.json({ success: false, error: { code: "CONSTA_UNAVAILABLE" } }, 503);
  }

  const consta = new Consta(c.env.CONSTA_BASE_URL, c.env.CONSTA_API_KEY);
  let reading;
  try {
    reading = await consta.extract(await signedProofUrl(c.env, proofId, now));
  } catch (e) {
    const code = e instanceof ConstaError ? e.code : "CONSTA_UNAVAILABLE";
    console.error("proof reading failed:", code);
    return c.json({ success: false, error: { code: "CONSTA_UNAVAILABLE" } }, 503);
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

/* GET /direct-payments/proofs/:linkId/:file — how Consta's provider
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
  const [payment] = await db.select().from(directPayments).where(eq(directPayments.id, id));
  if (!payment) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  let charge = null;
  if (payment.chargeId) {
    [charge] = await db.select().from(charges).where(eq(charges.id, payment.chargeId));
  }
  return c.json({
    success: true,
    data: {
      status: payment.status,
      ...(charge
        ? { reconnectionStatus: charge.reconnectionStatus, folio: charge.folio }
        : {}),
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
      error: publicError(payment.lastError),
      /* D18: enough for the confirmation screen to render from the row
         instead of from whatever the browser still holds. A reload must
         not lose the question — and all of this is the payer's own data,
         echoed back to the payer. */
      trackingKey: payment.trackingKey,
      senderBank: payment.senderBank,
      transferDate: payment.transferDate,
      receiptStatus: payment.receiptStatus,
    },
  });
}

/* GET /direct-payments/links — ISP session (US-D05, US-D06, D5).
   Generation is lazy, in batch, on ISP request: listing IS what creates
   the missing links, so every WispHub customer has one without anybody
   creating them by hand. */
export async function listLinks(c: Ctx, cursor?: string) {
  const actor = c.get("actor");
  if (actor.type !== "isp") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const [isp] = await db.select().from(isps).where(eq(isps.id, actor.id));
  if (!isp?.wisphubApiKey) {
    return c.json({ success: false, error: { code: "WISPHUB_NOT_CONFIGURED" } }, 503);
  }

  try {
    const customers = await new WispHub(isp.wisphubApiKey, c.env.WISPHUB_BASE_URL).listCustomers();
    if (customers.length) {
      await db
        .insert(paymentLinks)
        .values(
          customers.map((customer) => ({
            ispId: isp.id,
            token: makeLinkToken(),
            wisphubCustomerId: String(customer.wisphubId),
            customerUsuario: customer.usuario,
          })),
        )
        /* Existing links keep their token: the link is permanent (D1) */
        .onConflictDoNothing();
    }
  } catch (e) {
    return wisphubFailure(c, e);
  }

  const PAGE = 50;
  const rows = await db
    .select()
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.ispId, isp.id),
        ...(cursor ? [gt(paymentLinks.customerUsuario, cursor)] : []),
      ),
    )
    .orderBy(asc(paymentLinks.customerUsuario))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  return c.json({
    success: true,
    data: {
      links: page.map((link) => ({
        token: link.token,
        usuario: link.customerUsuario,
        url: `${c.env.PAGO_BASE_URL}/p/${link.token}`,
      })),
      nextCursor: rows.length > PAGE ? page[page.length - 1].customerUsuario : null,
    },
  });
}

/* What the customer reads when the ISP shares their link (US-D07 D3).
   Here, not in the admin, for the same reason the receipt's text lives
   in the API (receipt spec D2): the words reach the customer the same
   way whoever sends them. */
const shareText = (url: string) =>
  `Hola, aquí está tu link de pago de internet. Guárdalo: sirve cada mes.\n\n${url}`;

/* GET /direct-payments/links/search?q=XYZ — ISP session (US-D07).
   Searches WispHub and ensures links exist for the results. */
export async function searchLinks(c: Ctx, q: string) {
  const actor = c.get("actor");
  if (actor.type !== "isp") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const [isp] = await db.select().from(isps).where(eq(isps.id, actor.id));
  if (!isp?.wisphubApiKey) {
    return c.json({ success: false, error: { code: "WISPHUB_NOT_CONFIGURED" } }, 503);
  }

  let customers;
  try {
    customers = await new WispHub(isp.wisphubApiKey, c.env.WISPHUB_BASE_URL).searchCustomers(q);
  } catch (e) {
    return wisphubFailure(c, e);
  }

  if (customers.length) {
    await db
      .insert(paymentLinks)
      .values(
        customers.map((customer) => ({
          ispId: isp.id,
          token: makeLinkToken(),
          wisphubCustomerId: String(customer.wisphubId),
          customerUsuario: customer.usuario,
        })),
      )
      /* Existing links keep their token: the link is permanent (D1) */
      .onConflictDoNothing();
  }

  const customerIds = customers.map((c) => String(c.wisphubId));
  let links: { wisphubCustomerId: string; token: string }[] = [];
  if (customerIds.length) {
    links = await db
      .select({ wisphubCustomerId: paymentLinks.wisphubCustomerId, token: paymentLinks.token })
      .from(paymentLinks)
      .where(and(eq(paymentLinks.ispId, isp.id), inArray(paymentLinks.wisphubCustomerId, customerIds)));
  }
  
  const linkMap = new Map(links.map((l) => [l.wisphubCustomerId, l.token]));

  const results = customers.flatMap((customer) => {
    const token = linkMap.get(String(customer.wisphubId));
    /* No token means the insert above skipped this customer; a link to
       `/p/undefined` is worse than one row missing from the results. */
    if (!token) return [];
    const url = `${c.env.PAGO_BASE_URL}/p/${token}`;
    return [
      {
        wisphubId: customer.wisphubId,
        usuario: customer.usuario,
        name: customer.name,
        phone: customer.phone,
        url,
        /* The API owns the message and the number (receipt spec D2, D3).
           `toWhatsAppPhone` is what puts Mexico's 52 in front and refuses
           a number it cannot read — without it a plain 10-digit phone
           becomes wa.me/55…, which is Brazil, not the customer. */
        waLink: whatsAppLink(shareText(url), toWhatsAppPhone(customer.phone)),
      },
    ];
  });

  return c.json({ success: true, data: { results } });
}


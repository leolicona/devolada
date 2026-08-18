import type { Context } from "hono";
import { and, asc, eq, gt, gte, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { charges, directPayments, isps, paymentLinks } from "../../db/schema";
import { WispHub, WispHubError } from "../../wisphub/client";
import {
  isUniqueViolation,
  runValidation,
  speiAvailable,
  speiFeeCents,
} from "../../direct-payments/validation";
import {
  makeProofKey,
  PROOF_MAX_BYTES,
  proofBelongsToLink,
  verifyProofUrl,
} from "../../direct-payments/proofs";
import { toWhatsAppPhone, whatsAppLink } from "../../receipt";
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
    const customer = await wisphub.getCustomer(link.customerUsuario);
    const pending = await wisphub.pendingInvoices(now);
    const owes = pending.invoices.some((f) => f.usuario === link.customerUsuario);
    const customerName = customer?.name ?? link.customerUsuario;

    if (!owes || !customer) {
      const data: LinkStatusResponse = {
        ispName: isp.name,
        customerName,
        status: "no_debt",
      };
      return c.json({ success: true, data });
    }

    /* D15: one invoice at a time, oldest first — the amount is the
       plan's mensualidad plus the SPEI fee, same computation as the
       store flow */
    const serviceFeeCents = speiFeeCents(isp);
    const data: LinkStatusResponse = {
      ispName: isp.name,
      customerName,
      status: "debt",
      monthlyFeeCents: customer.monthlyFeeCents,
      serviceFeeCents,
      totalCents: customer.monthlyFeeCents + serviceFeeCents,
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

  /* The debt at submission time decides the amount the CEP must match
     (D11, D15). A WispHub failure here is a pre-payment failure:
     nothing recorded, same posture as the store flow's guard. */
  let customer;
  let pending;
  try {
    const wisphub = new WispHub(isp.wisphubApiKey!, c.env.WISPHUB_BASE_URL);
    customer = await wisphub.getCustomer(link.customerUsuario);
    pending = await wisphub.pendingInvoices(now);
  } catch (e) {
    return wisphubFailure(c, e);
  }
  const owes = pending.invoices.some((f) => f.usuario === link.customerUsuario);
  if (!customer || (!owes && (pending.complete || customer.billingStatus === "paid"))) {
    return c.json({ success: false, error: { code: "NOTHING_DUE" } }, 409);
  }

  const serviceFeeCents = speiFeeCents(isp);
  const amountCents = customer.monthlyFeeCents + serviceFeeCents;

  let payment;
  try {
    [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents,
        monthlyFeeCents: customer.monthlyFeeCents,
        serviceFeeCents,
        proofMode: body.transfer ? "transfer" : "receipt",
        trackingKey: body.transfer?.trackingKey.toUpperCase() ?? null,
        senderBank: body.transfer?.senderBank ?? null,
        transferDate: body.transfer?.date ?? null,
        proofKey: body.proofId ?? null,
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

  /* The upload shares the pay budget: an upload only exists to feed a
     submission, and R2 must not become free anonymous hosting */
  if ((await attemptsInLastHour(db, link.id, now)) >= HOURLY_ATTEMPT_BUDGET) {
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
  if (!file.type.startsWith("image/")) {
    return c.json({ success: false, error: { code: "PROOF_NOT_IMAGE" } }, 415);
  }

  const proofId = makeProofKey(link.id);
  /* Buffered on purpose: R2 needs a known length, and the 1 MB cap
     makes the buffer bounded */
  await c.env.PROOFS.put(proofId, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  return c.json({ success: true, data: { proofId } });
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
      validationAttempts: payment.validationAttempts,
      error: publicError(payment.lastError),
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


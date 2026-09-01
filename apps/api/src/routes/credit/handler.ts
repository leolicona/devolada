import type { Context } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { businesses, topUps } from "../../db/schema";
import { BANKS } from "../../direct-payments/banks";
import { nextValidationSlot } from "../../direct-payments/schedule";
import { isUniqueViolation } from "../../direct-payments/validation";
import { getNumberSetting, getSetting } from "../../platform/settings";
import { validateTopUp, type TopUp } from "../../credit/topups";
import type { TopUpItem, TopUpRequest } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

const PROOF_MAX_BYTES = 1_000_000;
const PROOF_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const proofPrefix = (businessId: string) => `topup-${businessId}/`;

function toItem(t: TopUp): TopUpItem {
  return {
    id: t.id,
    status: t.status,
    claimedCents: t.claimedCents,
    creditedCents: t.creditedCents,
    proofMode: t.proofMode,
    trackingKey: t.trackingKey,
    validationAttempts: t.validationAttempts,
    nextValidationAt: t.nextValidationAt?.getTime() ?? null,
    error: t.lastError,
    createdAt: t.createdAt.getTime(),
    confirmedAt: t.confirmedAt?.getTime() ?? null,
  };
}

/* The receipt door's upload — business-bound by the session, the same
   limits as the payer's (direct-payment D12). The key prefix names the
   business so the signed-URL route can serve it and nothing else can
   claim it. */
export async function uploadTopUpProof(c: Ctx) {
  const actor = c.get("actor");
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const file = form.file;
  if (!(file instanceof File) || file.size === 0 || file.size > PROOF_MAX_BYTES || !PROOF_TYPES.has(file.type)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }
  const proofId = `${proofPrefix(actor.id)}${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await c.env.PROOFS.put(proofId, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return c.json({ success: true, data: { proofId } }, 201);
}

export async function submitTopUp(c: Ctx, body: TopUpRequest) {
  const actor = c.get("actor");
  const db = drizzle(c.env.DB);
  const now = new Date();
  const [clabe, bank] = await Promise.all([getSetting(db, "topup_clabe"), getSetting(db, "topup_bank")]);
  if (!clabe || !bank) return c.json({ success: false, error: { code: "TOPUP_NOT_CONFIGURED" } }, 409);

  if (body.transfer) {
    /* direct-payment D16: the bank is a pick from the catalog */
    if (!(BANKS as readonly string[]).includes(body.transfer.senderBank)) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
    }
    /* D6: the minimum is a form rule — a CEP for less still credits */
    const min = await getNumberSetting(db, "topup_min_cents");
    if (body.transfer.amountCents < min) {
      return c.json({ success: false, error: { code: "BELOW_MINIMUM" } }, 400);
    }
  }
  if (body.proofId) {
    if (!body.proofId.startsWith(proofPrefix(actor.id)) || !(await c.env.PROOFS.head(body.proofId))) {
      return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
    }
  }

  let topUp: TopUp;
  try {
    [topUp] = await db
      .insert(topUps)
      .values({
        businessId: actor.id,
        submittedByUserId: actor.userId,
        claimedCents: body.transfer?.amountCents ?? 0,
        proofMode: body.transfer ? "transfer" : "receipt",
        trackingKey: body.transfer?.trackingKey.toUpperCase() ?? null,
        senderBank: body.transfer?.senderBank ?? null,
        transferDate: body.transfer?.date ?? null,
        proofKey: body.proofId ?? null,
        /* Born owned by the sweep (direct-payment D7's lesson) */
        nextValidationAt: nextValidationSlot(now, now),
      })
      .returning();
  } catch (e) {
    /* One transfer credits once */
    if (!isUniqueViolation(e)) throw e;
    return c.json({ success: false, error: { code: "TRANSFER_ALREADY_USED" } }, 409);
  }

  const row = await validateTopUp(c.env, db, topUp, now);
  return c.json({ success: true, data: toItem(row) }, 201);
}

export async function listTopUps(c: Ctx) {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(topUps)
    .where(eq(topUps.businessId, c.get("actor").id))
    .orderBy(desc(topUps.createdAt))
    .limit(20);
  return c.json({ success: true, data: { topUps: rows.map(toItem) } });
}

export async function getTopUp(c: Ctx, id: string) {
  const db = drizzle(c.env.DB);
  const [row] = await db
    .select()
    .from(topUps)
    .where(and(eq(topUps.id, id), eq(topUps.businessId, c.get("actor").id)));
  if (!row) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  /* Keep `businesses` referenced for the type of the join-free read above */
  void businesses;
  return c.json({ success: true, data: toItem(row) });
}

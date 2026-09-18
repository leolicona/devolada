import { and, desc, eq, inArray, lt, ne, sum } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { businesses, creditEntries, member, payments, user as userTable } from "../db/schema";
import { sendCreditCrossing } from "../email/sender";
import { getNumberSetting } from "../platform/settings";

/* prepaid-credit spec: the platform's book. Balance = SUM of append-only
   entries (D3); the fee keys on the terminal verdict once per payment
   (D2); the steps and their emails (D7). Money never leaves this module
   except as a number the callers display. */

type DB = DrizzleD1Database<Record<string, unknown>>;

export type CreditStep = "ok" | "low" | "empty" | "paused";

/* D2: the terminal verdicts with a CEP behind them. `invalid` is this
   codebase's `contradicted` (direct-payment D17); `expired` never charges. */
export const FEE_STATUSES = new Set(["confirmed", "partial", "unapplied", "invalid"]);

/* D7: "Saldo bajo" at five validations' worth */
const LOW_VALIDATIONS = 5;

export async function balanceCents(db: DB, businessId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(creditEntries.cents) })
    .from(creditEntries)
    .where(eq(creditEntries.businessId, businessId));
  return Number(row?.total ?? 0);
}

export async function effectiveFeeCents(db: DB, business: { feeOverrideCents: number | null }) {
  return business.feeOverrideCents ?? (await getNumberSetting(db, "validation_fee_cents"));
}

export function stepFor(balance: number, feeCents: number, capCents: number): CreditStep {
  if (balance < -capCents) return "paused";
  if (balance <= 0) return "empty";
  if (balance <= LOW_VALIDATIONS * feeCents) return "low";
  return "ok";
}

export async function creditSummary(db: DB, business: { id: string; feeOverrideCents: number | null }) {
  const [balance, feeCents, capCents, minTopUpCents] = await Promise.all([
    balanceCents(db, business.id),
    effectiveFeeCents(db, business),
    getNumberSetting(db, "negative_cap_cents"),
    getNumberSetting(db, "topup_min_cents"),
  ]);
  return { balanceCents: balance, feeCents, capCents, minTopUpCents, step: stepFor(balance, feeCents, capCents) };
}

async function ownerEmails(db: DB, orgId: string): Promise<string[]> {
  const rows = await db
    .select({ email: userTable.email })
    .from(member)
    .innerJoin(userTable, eq(userTable.id, member.userId))
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")));
  return rows.map((r) => r.email);
}

/* D7: one email per crossing — 0 and the cap — never one per validation.
   Computed from the balance before and after the entry that moved it. */
async function notifyCrossings(
  env: Bindings,
  db: DB,
  business: { id: string; name: string; orgId: string },
  before: number,
  after: number,
) {
  const capCents = await getNumberSetting(db, "negative_cap_cents");
  const crossedZero = before > 0 && after <= 0;
  const crossedCap = before >= -capCents && after < -capCents;
  if (!crossedZero && !crossedCap) return;
  const to = await ownerEmails(db, business.orgId);
  try {
    if (crossedZero) await sendCreditCrossing(env, to, "empty", business.name);
    if (crossedCap) await sendCreditCrossing(env, to, "paused", business.name);
  } catch (e) {
    /* Never let the email provider decide whether a fee is booked */
    console.error("credit crossing email failed", e);
  }
}

/* D2: debit once per payment at its terminal verdict. Idempotent by the
   partial unique index on payment_id: a second call is a no-op. */
export async function debitValidationFee(
  env: Bindings,
  db: DB,
  payment: { id: string; businessId: string; status: string; paymentLinkId: string; isTest: boolean },
): Promise<boolean> {
  /* automated-collections-api D12 (FR-035): a test payment is never
     debited — one gate, here, in the one place a payment costs money.
     Nothing else in this module needs to know test mode exists. */
  if (payment.isTest) return false;
  if (!FEE_STATUSES.has(payment.status)) return false;
  const [business] = await db.select().from(businesses).where(eq(businesses.id, payment.businessId));
  if (!business) return false;
  const feeCents = await effectiveFeeCents(db, business);
  const before = await balanceCents(db, business.id);
  try {
    await db.insert(creditEntries).values({
      businessId: business.id,
      kind: "validation_fee",
      cents: -feeCents,
      paymentId: payment.id,
    });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return false;
    throw e;
  }
  await notifyCrossings(env, db, business, before, before - feeCents);
  if (payment.status !== "invalid") await reverseContradictedFees(db, payment);
  return true;
}

/* D2 amendment (owner, 2026-09-01): one transfer pays once. When a fresh
   submission on the same link confirms a valid CEP, every earlier row of
   that link that ended `invalid` (contradicted) and was charged gets its
   fee back — a `fee_reversal` keyed on the reversed row, so the unique
   index makes it idempotent and a second confirmation reverses nothing
   twice. The payer's typo is not the business's cost. */
async function reverseContradictedFees(db: DB, payment: { id: string; paymentLinkId: string }) {
  const contradicted = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(eq(payments.paymentLinkId, payment.paymentLinkId), eq(payments.status, "invalid"), ne(payments.id, payment.id)),
    );
  if (contradicted.length === 0) return;
  const ids = contradicted.map((r) => r.id);
  const entries = await db
    .select()
    .from(creditEntries)
    .where(and(inArray(creditEntries.paymentId, ids), inArray(creditEntries.kind, ["validation_fee", "fee_reversal"])));
  const reversed = new Set(entries.filter((e) => e.kind === "fee_reversal").map((e) => e.paymentId));
  for (const fee of entries.filter((e) => e.kind === "validation_fee" && !reversed.has(e.paymentId))) {
    try {
      await db.insert(creditEntries).values({
        businessId: fee.businessId,
        kind: "fee_reversal",
        cents: -fee.cents,
        paymentId: fee.paymentId,
        reason: `contradicho corregido: ${payment.id}`,
      });
    } catch (e) {
      if (!String(e).includes("UNIQUE")) throw e;
    }
  }
}

/* D5: once per user, for their first business */
export async function grantWelcomeBonus(
  db: DB,
  business: { id: string },
  userId: string,
): Promise<number> {
  const [feeCents, validations] = await Promise.all([
    getNumberSetting(db, "validation_fee_cents"),
    getNumberSetting(db, "welcome_bonus_validations"),
  ]);
  const cents = feeCents * validations;
  if (cents <= 0) return 0;
  try {
    await db.insert(creditEntries).values({
      businessId: business.id,
      kind: "welcome_bonus",
      cents,
      grantedToUserId: userId,
    });
    return cents;
  } catch (e) {
    if (String(e).includes("UNIQUE")) return 0;
    throw e;
  }
}

/* operator-panel D5 */
export async function adjustCredit(
  env: Bindings,
  db: DB,
  business: { id: string; name: string; orgId: string },
  cents: number,
  reason: string,
  authorUserId: string,
) {
  const before = await balanceCents(db, business.id);
  const [row] = await db
    .insert(creditEntries)
    .values({ businessId: business.id, kind: "adjustment", cents, reason, authorUserId })
    .returning();
  await notifyCrossings(env, db, business, before, before + cents);
  return row;
}

export async function listEntries(db: DB, businessId: string, cursor?: number) {
  const PAGE = 50;
  const rows = await db
    .select()
    .from(creditEntries)
    .where(
      and(
        eq(creditEntries.businessId, businessId),
        ...(cursor ? [lt(creditEntries.createdAt, new Date(cursor))] : []),
      ),
    )
    .orderBy(desc(creditEntries.createdAt), desc(creditEntries.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  return {
    entries: page.map((r) => ({
      id: r.id,
      kind: r.kind,
      cents: r.cents,
      reason: r.reason,
      createdAt: r.createdAt.getTime(),
    })),
    nextCursor: rows.length > PAGE ? page[page.length - 1].createdAt.getTime() : null,
  };
}

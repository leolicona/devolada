import { and, eq, inArray, isNotNull, isNull, lt, ne, notInArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { cepBundles, cepRecords, payments } from "../db/schema";
import { chunks, D1_MAX_PARAMS } from "../db/params";
import type { ConstaVerdict, RegisteredAccount } from "../consta";
import { claveOfEntry } from "../consta/bundle/zip";
import type {
  CepRecord,
  MatchResult,
  MatchTrail,
  ReceiptSide,
  TrailCandidate,
  UndecidedReason,
} from "../consta/bundle/types";

/* cep-bundle-match D8 — the lifecycle's side of a search without a clave:
   what only the database knows (which claves live payments hold, what the
   receipt said), and the one shape every decided match takes afterwards:
   an ordinary `valid`. `validation.ts` decides with these; the engine read
   the documents (`consta/bundle/`). */

type DB = DrizzleD1Database;
type Payment = typeof payments.$inferSelect;

/* The statuses that release a clave — the unique index's own predicate
   (direct-payment D8): a payment in any other status holds its clave */
const RELEASED = ["invalid", "expired", "superseded"] as const;

/* D8, R6: "used" is a query, never a stored fate — the claves among these
   that another live payment of the business holds. Chunked under D1's
   parameter cap (BUG-021): a due date's bundle can list a hundred. */
export async function usedAmong(db: DB, businessId: string, paymentId: string, claves: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunks([...new Set(claves)], D1_MAX_PARAMS - 6)) {
    const rows = await db
      .select({ key: payments.trackingKey })
      .from(payments)
      .where(
        and(
          eq(payments.businessId, businessId),
          inArray(payments.trackingKey, part),
          notInArray(payments.status, [...RELEASED]),
          ne(payments.id, paymentId),
        ),
      );
    for (const r of rows) if (r.key) out.add(r.key.toUpperCase());
  }
  return out;
}

/* D8 (analyze I1): the receipt's side, from the attempt's own reading when
   the verdict carries one and from the row otherwise — the first attempt
   on the receipt door meets a row whose time and tail are still empty.
   `searchedCents` is the amount the search itself used: what travelled on
   the transfer door, what the provider read on the image door. */
export function receiptSideOf(
  payment: Pick<Payment, "transferTime" | "senderTail" | "transferDate">,
  reading: ConstaVerdict["ourReading"] | null | undefined,
  searchedCents: number | null,
  accounts: RegisteredAccount[],
): ReceiptSide {
  return {
    time: reading?.time ?? payment.transferTime ?? null,
    day: reading?.date ?? payment.transferDate ?? null,
    tail: reading?.senderTail ?? payment.senderTail ?? null,
    amountCents: searchedCents,
    accounts,
  };
}

/* D8: a decided match becomes the ordinary `valid` verdict, so every check
   that confirms a payment today — the account tie, the stale check, the
   amount and partial rules, the retired-account hold, the adoption of the
   clave — runs unchanged on it. The provider's replay flag belongs to a
   single `valid`; a bundle carries none, so the promoted verdict says
   "never validated" (`alreadyValidated: false`) and "unknown" (null).
   No name travels: the record never had one (FR-006). */
export function promote(
  record: CepRecord,
  from: Pick<ConstaVerdict, "validationId" | "beneficiaryUsed" | "ourReading"> | null,
  senderBank: string | null,
): ConstaVerdict {
  return {
    validationId: from?.validationId ?? "",
    status: "valid",
    alreadyValidated: false,
    previouslyValidated: null,
    ...(from?.beneficiaryUsed ? { beneficiaryUsed: from.beneficiaryUsed } : {}),
    ...(from?.ourReading ? { ourReading: from.ourReading } : {}),
    cep: {
      trackingKey: record.clave,
      amountCents: record.amountCents,
      /* the operation day, as a `valid`'s `operationDate` is (the row adopts
         it, bug: reference-search-printed-day) */
      date: record.operationDate,
      /* the searched bank is in the vocabulary; the cadena prints its own */
      senderBank: senderBank ?? record.senderBank,
      senderName: null,
      receiverBank: null,
      beneficiaryName: null,
      beneficiaryAccount: record.receiverAccount,
      beneficiaryAccountType: record.receiverAccountType,
      creditTime: record.creditTime,
      senderAccountType: record.senderAccountType,
      senderAccount: record.senderAccount,
      certificateNumber: record.certificateNumber,
    },
  };
}

/* FR-002: entries that could not be read, as trail candidates — flagged,
   never chosen */
export function unreadableCandidates(unreadable: { entry: string; reason: string }[]): TrailCandidate[] {
  return unreadable.map((u) => ({
    cepId: null,
    clave: claveOfEntry(u.entry) ?? u.entry,
    creditTime: null,
    tail: null,
    fate: "dropped" as const,
    why: "unreadable" as const,
  }));
}

/* data-model.md `match_trail`, from a matcher result or a bundle that
   could not be read at all */
export function trailOf(
  source: MatchTrail["source"],
  bundleId: string | null,
  receipt: Pick<ReceiptSide, "time" | "tail">,
  outcome:
    | MatchResult
    | { decided: "undecided"; reason: UndecidedReason; trail: TrailCandidate[] },
  unreadable: TrailCandidate[] = [],
  by?: MatchTrail["by"],
): MatchTrail {
  return {
    source,
    bundleId,
    decided: outcome.decided,
    by: outcome.decided === "chosen" ? (by ?? outcome.by) : null,
    reason: outcome.decided === "undecided" ? outcome.reason : null,
    receipt: { time: receipt.time, tail: receipt.tail },
    candidates: [...outcome.trail, ...unreadable],
  };
}

/* D10, D17: why an undecided payment did not decide, from the trail the
   same write left — read by the payer's status (`CEP_ALL_USED`), the feed
   and the public read. Null for every row that is not validating with
   `CEP_UNDECIDED`. */
export function undecidedReasonOf(row: Pick<Payment, "status" | "lastError" | "matchTrail">): UndecidedReason | null {
  if (row.status !== "validating" || row.lastError !== "CEP_UNDECIDED" || !row.matchTrail) return null;
  try {
    const trail = JSON.parse(row.matchTrail) as MatchTrail;
    return trail.decided === "undecided" ? trail.reason : null;
  } catch {
    return null;
  }
}

/* The bundle a payment is still waiting to read (D16): the latest pending
   one its own search received */
export async function pendingBundleOf(db: DB, businessId: string, paymentId: string): Promise<string | null> {
  const rows = await db
    .select({ id: cepBundles.id, createdAt: cepBundles.createdAt })
    .from(cepBundles)
    .where(and(eq(cepBundles.businessId, businessId), eq(cepBundles.paymentRef, paymentId), eq(cepBundles.status, "pending")));
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return rows[0]?.id ?? null;
}

/* D13 (research R13): a transfer one of our own searches for this business
   returned before this attempt began. `before` is a real clock, never the
   sweep's `now`: the record this attempt's own search just wrote must not
   vouch for itself. */
export async function heldBefore(db: DB, businessId: string, clave: string, before: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: cepRecords.id })
    .from(cepRecords)
    .where(and(eq(cepRecords.businessId, businessId), eq(cepRecords.clave, clave), lt(cepRecords.createdAt, before)))
    .limit(1);
  return row != null;
}

/* D14 (research R14): a stored bundle holds proof for other customers too.
   The business's other payments still validating with a clave among its
   records are made due now, so the next sweep confirms them from the
   record with no call (the pull in `runValidation`). Never a test row,
   never a row Banxico already confirmed, never this payment. */
export async function nudgeHolders(db: DB, businessId: string, paymentId: string, claves: string[], now: Date): Promise<void> {
  for (const part of chunks([...new Set(claves)], D1_MAX_PARAMS - 6)) {
    await db
      .update(payments)
      .set({ nextValidationAt: now })
      .where(
        and(
          eq(payments.businessId, businessId),
          eq(payments.status, "validating"),
          inArray(payments.trackingKey, part),
          ne(payments.id, paymentId),
          isNotNull(payments.nextValidationAt),
          isNull(payments.banxicoValidAt),
          eq(payments.isTest, false),
        ),
      );
  }
}

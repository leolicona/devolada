import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import {
  businesses,
  cepRecords,
  payerReferenceCustomers,
  payerReferences,
  paymentLinks,
  payments,
} from "../db/schema";
import { nationalPhone } from "../phone";
import { capabilitiesOf, type RegistryEnv } from "../integrations/registry";
import { IntegrationError } from "../integrations/capabilities";
import { integrationOf, type Integration } from "../integrations/store";
import { isGenericReference } from "../routes/direct-payments/schema";
import { BANKS } from "./banks";
import { registeredAccounts } from "./accounts";
import { realOnly, type PaymentLink } from "./links";

/* payment-without-receipt — a payer's reference inside one business, and
   what Devolada learns about how each customer pays.

   A reference is a person's: the customers of the business whose records
   hold the same phone and the same name share it, and no two persons share
   one (FR-001, D4). It is the last seven digits of that phone when they
   are safe, an assigned number otherwise (FR-002, D3, D6). The system
   decides every case alone — the panel only reads (clarified 2026-09-30)
   — and this module is the only writer of `payer_reference_customers`.

   Names and phones are read live through the integration's
   `customersWithPhone`, compared and forgotten: no phone and no name is
   ever written anywhere (D1). */

type DB = DrizzleD1Database;
type Business = typeof businesses.$inferSelect;
type ReferenceRow = typeof payerReferences.$inferSelect;

/* The identity a link carries (links-on-demand-search FR-010): the
   usuario for a panel link, the caller's customerRef for an API link */
export type CustomerKey = { source: "panel" | "api"; key: string };

export type PayerReference = {
  id: string;
  digits: string;
  origin: "phone" | "assigned";
  /* D26/FR-040: this person's previous digits while their transition
     runs — a phone's owner took them and they have not yet confirmed with
     the new number. Null otherwise. */
  previousDigits: string | null;
};

/* D26: how long the two people are kept apart by who sent the money */
export const TRANSITION_DAYS = 60;
const DAY_MS = 24 * 3600 * 1000;

/* D4: a person is one phone and one name. The name is compared as the
   business typed it, forgiving only what a keyboard varies: case, accents
   and spaces. "José  Pérez" and "JOSE PEREZ" are one person; a name
   written two ways is two, until the phone's future check by message
   (clarified 2026-09-30). */
export function personName(first: string | null | undefined, last: string | null | undefined): string {
  return `${first ?? ""} ${last ?? ""}`
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function customerKeyOf(link: Pick<PaymentLink, "source" | "customerUsuario" | "customerRef">): CustomerKey | null {
  if (link.source === "api") return link.customerRef ? { source: "api", key: link.customerRef } : null;
  return link.customerUsuario ? { source: "panel", key: link.customerUsuario } : null;
}

const keyId = (k: CustomerKey) => `${k.source}:${k.key}`;

/* The links of a set of customers, as a condition on `payment_links` —
   one panel link per usuario, and every API link of a customerRef (a
   reusable one and its one-time siblings are one customer, D1) */
function linksOf(keys: CustomerKey[]): SQL {
  const panel = keys.filter((k) => k.source === "panel").map((k) => k.key);
  const api = keys.filter((k) => k.source === "api").map((k) => k.key);
  const parts: SQL[] = [];
  if (panel.length) parts.push(and(eq(paymentLinks.source, "panel"), inArray(paymentLinks.customerUsuario, panel))!);
  if (api.length) parts.push(and(eq(paymentLinks.source, "api"), inArray(paymentLinks.customerRef, api))!);
  return parts.length ? or(...parts)! : sql`0`;
}

/* ---- Reads ---- */

async function previousDigitsOf(db: DB, businessId: string, referenceId: string, now: Date): Promise<string | null> {
  const [passed] = await db
    .select({ digits: payerReferences.digits })
    .from(payerReferences)
    .where(
      and(
        eq(payerReferences.businessId, businessId),
        eq(payerReferences.previousReferenceId, referenceId),
        gt(payerReferences.transitionEndsAt, now),
      ),
    )
    .limit(1);
  return passed?.digits ?? null;
}

async function view(db: DB, row: ReferenceRow, now: Date): Promise<PayerReference> {
  return {
    id: row.id,
    digits: row.digits,
    origin: row.origin,
    previousDigits: await previousDigitsOf(db, row.businessId, row.id, now),
  };
}

/* The reference a customer holds, or null (none yet) */
export async function referenceOf(db: DB, businessId: string, customer: CustomerKey, now = new Date()): Promise<PayerReference | null> {
  const [row] = await db
    .select({ reference: payerReferences })
    .from(payerReferenceCustomers)
    .innerJoin(payerReferences, eq(payerReferences.id, payerReferenceCustomers.referenceId))
    .where(
      and(
        eq(payerReferenceCustomers.businessId, businessId),
        eq(payerReferenceCustomers.source, customer.source),
        eq(payerReferenceCustomers.customerKey, customer.key),
      ),
    );
  return row ? view(db, row.reference, now) : null;
}

export async function referenceOfLink(
  db: DB,
  link: Pick<PaymentLink, "businessId" | "source" | "customerUsuario" | "customerRef">,
  now = new Date(),
): Promise<PayerReference | null> {
  const key = customerKeyOf(link);
  return key ? referenceOf(db, link.businessId, key, now) : null;
}

/* Many customers at once, for a block of the panel's rows or a /v1 list:
   `source:key` → the digits and their origin. One statement per 50 keys. */
export async function referencesFor(
  db: DB,
  businessId: string,
  keys: CustomerKey[],
): Promise<Map<string, { digits: string; origin: "phone" | "assigned" }>> {
  const out = new Map<string, { digits: string; origin: "phone" | "assigned" }>();
  const unique = [...new Map(keys.map((k) => [keyId(k), k])).values()];
  for (let i = 0; i < unique.length; i += 40) {
    const part = unique.slice(i, i + 40);
    const rows = await db
      .select({
        source: payerReferenceCustomers.source,
        key: payerReferenceCustomers.customerKey,
        digits: payerReferences.digits,
        origin: payerReferences.origin,
      })
      .from(payerReferenceCustomers)
      .innerJoin(payerReferences, eq(payerReferences.id, payerReferenceCustomers.referenceId))
      .where(
        and(
          eq(payerReferenceCustomers.businessId, businessId),
          or(
            ...part.map((k) =>
              and(eq(payerReferenceCustomers.source, k.source), eq(payerReferenceCustomers.customerKey, k.key)),
            ),
          ),
        ),
      );
    for (const r of rows) out.set(`${r.source}:${r.key}`, { digits: r.digits, origin: r.origin });
  }
  return out;
}

/* The customers who hold a reference: one person's services */
export async function holdersOf(db: DB, businessId: string, referenceId: string): Promise<CustomerKey[]> {
  const rows = await db
    .select({ source: payerReferenceCustomers.source, key: payerReferenceCustomers.customerKey })
    .from(payerReferenceCustomers)
    .where(and(eq(payerReferenceCustomers.businessId, businessId), eq(payerReferenceCustomers.referenceId, referenceId)));
  return rows.map((r) => ({ source: r.source, key: r.key }));
}

const PAID = ["confirmed", "partial"] as const;

/* FR-010: "proven" — a confirmation with these very digits, by the
   payer's own reference, on any of the person's services. Derived, never
   stored (data-model.md). */
export async function isProven(db: DB, businessId: string, reference: Pick<PayerReference, "id" | "digits">): Promise<boolean> {
  const holders = await holdersOf(db, businessId, reference.id);
  if (!holders.length) return false;
  const [row] = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(paymentLinks, eq(paymentLinks.id, payments.paymentLinkId))
    .where(
      and(
        eq(payments.businessId, businessId),
        eq(paymentLinks.businessId, businessId),
        eq(payments.referenceSource, "own"),
        eq(payments.referenceNumber, reference.digits),
        inArray(payments.status, [...PAID]),
        linksOf(holders),
      ),
    )
    .limit(1);
  return row != null;
}

/* ---- D3: seven digits that are never a reference ---- */

/* Generic (a bank app's default), starting with 0 (a leading zero no
   bank app is measured to keep — provisional until the pilot, D3), or the
   last seven digits of any account the business registered to receive,
   retired ones included (Azteca's default reference is the receiving
   CLABE's tail, measurement item 9). Digits already held are the unique
   index's to refuse. */
export function unsafeDigits(digits: string, business: Business): boolean {
  if (!/^\d{7}$/.test(digits)) return true;
  if (digits.startsWith("0")) return true;
  if (isGenericReference(digits)) return true;
  return registeredAccounts(business).some((a) => a.value.replace(/\D/g, "").slice(-7) === digits);
}

/* D6: seven digits at random, the first 1–9. No pattern: a number built
   from the phone would invite its holder to type the phone, which is
   someone else's reference (clarified 2026-09-30). */
export function randomDigits(): string {
  const [a, b] = crypto.getRandomValues(new Uint32Array(2));
  return `${1 + (a % 9)}${String(b % 1_000_000).padStart(6, "0")}`;
}

export type EnsureOptions = {
  /* Tests force a clash with this; production draws `randomDigits` */
  draw?: () => string;
};

const clashOnDigits = (e: unknown) =>
  /UNIQUE constraint failed: payer_references\./i.test(String(e instanceof Error ? e.message : e));
const clashOnHolder = (e: unknown) =>
  /UNIQUE constraint failed: payer_reference_customers\./i.test(String(e instanceof Error ? e.message : e));

/* Draws until digits outside D3 and never held in the business insert
   under the unique index (D6), in one batch with their holders — so a
   number is never born without its person. `phone`, when the customer
   has one, is only avoided: a draw that ends like the phone would read as
   a pattern of it. Returns null when a holder already had a reference (a
   racing ensure won; the caller re-reads it). */
async function insertAssigned(
  db: DB,
  business: Business,
  holders: CustomerKey[],
  now: Date,
  opts: EnsureOptions & { phone?: string | null },
): Promise<ReferenceRow | null> {
  const draw = opts.draw ?? randomDigits;
  for (let tries = 0; tries < 64; tries++) {
    const digits = draw();
    if (unsafeDigits(digits, business)) continue;
    if (opts.phone && digits.slice(-4) === opts.phone.slice(-4)) continue;
    const row = { id: crypto.randomUUID(), businessId: business.id, digits, origin: "assigned" as const, createdAt: now };
    try {
      await db.batch([
        db.insert(payerReferences).values(row),
        ...holders.map((h) =>
          db.insert(payerReferenceCustomers).values({
            businessId: business.id,
            referenceId: row.id,
            source: h.source,
            customerKey: h.key,
            createdAt: now,
          }),
        ),
      ]);
      const [inserted] = await db.select().from(payerReferences).where(eq(payerReferences.id, row.id));
      return inserted;
    } catch (e) {
      if (clashOnDigits(e)) continue;
      if (clashOnHolder(e)) return null;
      throw e;
    }
  }
  throw new Error(`payer reference: no free number after 64 draws for business ${business.id}`);
}

async function addHolder(db: DB, businessId: string, referenceId: string, customer: CustomerKey, now: Date): Promise<void> {
  await db
    .insert(payerReferenceCustomers)
    .values({ businessId, referenceId, source: customer.source, customerKey: customer.key, createdAt: now })
    .onConflictDoNothing();
}

/* D26 (FR-040): a phone beats an assigned number. The row passes, digits
   and all, to the phone's owner: its holders move to a new assigned row,
   its origin becomes `phone`, and it records whom it passed from and until
   when the two are kept apart (FR-041). One batch, so nobody is ever left
   without a number. */
async function passToPhoneOwner(
  db: DB,
  business: Business,
  held: ReferenceRow,
  owner: CustomerKey,
  now: Date,
  opts: EnsureOptions,
): Promise<ReferenceRow | null> {
  const draw = opts.draw ?? randomDigits;
  for (let tries = 0; tries < 64; tries++) {
    const digits = draw();
    if (unsafeDigits(digits, business)) continue;
    const moved = { id: crypto.randomUUID(), businessId: business.id, digits, origin: "assigned" as const, createdAt: now };
    try {
      await db.batch([
        db.insert(payerReferences).values(moved),
        db
          .update(payerReferenceCustomers)
          .set({ referenceId: moved.id })
          .where(and(eq(payerReferenceCustomers.businessId, business.id), eq(payerReferenceCustomers.referenceId, held.id))),
        db
          .update(payerReferences)
          .set({
            origin: "phone",
            previousReferenceId: moved.id,
            transitionEndsAt: new Date(now.getTime() + TRANSITION_DAYS * DAY_MS),
            changedAt: now,
          })
          .where(and(eq(payerReferences.id, held.id), eq(payerReferences.origin, "assigned"))),
        db.insert(payerReferenceCustomers).values({
          businessId: business.id,
          referenceId: held.id,
          source: owner.source,
          customerKey: owner.key,
          createdAt: now,
        }),
      ]);
      const [row] = await db.select().from(payerReferences).where(eq(payerReferences.id, held.id));
      return row;
    } catch (e) {
      if (clashOnDigits(e)) continue;
      if (clashOnHolder(e)) return null;
      throw e;
    }
  }
  throw new Error(`payer reference: no free number after 64 draws for business ${business.id}`);
}

/* The reference some customer of a group already holds — the person's.
   A phone's reference before an assigned one, then the oldest: a person
   who somehow holds two (their services counted before the grouping
   existed) settles on the one that is their phone's. */
async function heldByAny(db: DB, businessId: string, keys: CustomerKey[]): Promise<ReferenceRow | null> {
  if (!keys.length) return null;
  const rows = await db
    .select({ reference: payerReferences })
    .from(payerReferenceCustomers)
    .innerJoin(payerReferences, eq(payerReferences.id, payerReferenceCustomers.referenceId))
    .where(
      and(
        eq(payerReferenceCustomers.businessId, businessId),
        or(...keys.map((k) => and(eq(payerReferenceCustomers.source, k.source), eq(payerReferenceCustomers.customerKey, k.key)))),
      ),
    );
  const refs = rows.map((r) => r.reference);
  refs.sort((a, b) => (a.origin === b.origin ? a.createdAt.getTime() - b.createdAt.getTime() : a.origin === "phone" ? -1 : 1));
  return refs[0] ?? null;
}

/* D1, D3–D6, D26 (contracts/engine.md) — the customer's reference, born
   if it has none. Null when the business has the feature off, or when the
   phone could not be counted (the integration away, a refused key): never
   a guess, because a reference born without its count could be a shared
   one (D5). Called when a link is made, when the payer reads a link that
   has none, and by the backfill.

   Once held, a reference is returned as it is, whatever the business
   edits meanwhile in its records (FR-003). A person is grouped before the
   digits are judged: a phone whose tail is unsafe still gives its person
   ONE assigned number, shared by their services (FR-001). */
export async function ensurePayerReference(
  db: DB,
  env: RegistryEnv,
  business: Business,
  integration: Integration | null,
  customer: CustomerKey & { phone: string | null },
  now: Date = new Date(),
  opts: EnsureOptions = {},
): Promise<PayerReference | null> {
  if (!business.payByReference) return null;
  const key: CustomerKey = { source: customer.source, key: customer.key };

  /* 1. already held */
  const mine = await referenceOf(db, business.id, key, now);
  if (mine) return mine;

  const assigned = async (phone: string | null = null) => {
    const row = await insertAssigned(db, business, [key], now, { ...opts, phone });
    return row ? view(db, row, now) : referenceOf(db, business.id, key, now);
  };

  /* 2. no phone — an API customer never has one (D2, D4) */
  const phone = customer.source === "panel" ? nationalPhone(customer.phone) : null;
  if (!phone) return assigned();
  const lookup = capabilitiesOf(integration, env).customersWithPhone;
  /* An integration that cannot say who shares a phone has no phone to
     compare: an assigned number (D4) */
  if (!lookup) return assigned(phone);

  /* 3. the phone's customers, grouped into people by name */
  let sharing;
  try {
    sharing = await lookup.of(phone);
  } catch (e) {
    if (e instanceof IntegrationError) {
      console.error("payer reference: the phone could not be counted:", e.code);
      return null;
    }
    throw e;
  }
  const me = sharing.find((c) => c.usuario === customer.key);
  const myName = me ? personName(me.firstName, me.lastName) : null;
  const myPerson =
    myName === null
      ? []
      : sharing
          .filter((c) => c.usuario !== customer.key && personName(c.firstName, c.lastName) === myName)
          .map((c): CustomerKey => ({ source: "panel", key: c.usuario }));

  /* 4. the person already holds one: join it (FR-003) */
  const persons = await heldByAny(db, business.id, myPerson);
  if (persons) {
    await addHolder(db, business.id, persons.id, key, now);
    return referenceOf(db, business.id, key, now);
  }

  /* D3: unsafe digits are never anybody's reference */
  const digits = phone.slice(-7);
  if (unsafeDigits(digits, business)) return assigned(phone);

  /* 5. the digits exist in the business */
  const [held] = await db
    .select()
    .from(payerReferences)
    .where(and(eq(payerReferences.businessId, business.id), eq(payerReferences.digits, digits)));
  if (held) {
    /* Another person's phone reference — another name got them first, or
       another phone ends the same (D4): a number of their own */
    if (held.origin === "phone") return assigned(phone);
    /* D26: an assigned number passes to the phone's owner */
    const passed = await passToPhoneOwner(db, business, held, key, now, opts);
    return passed ? view(db, passed, now) : referenceOf(db, business.id, key, now);
  }

  /* 6. new digits: the first to receive them keeps them */
  const row = { id: crypto.randomUUID(), businessId: business.id, digits, origin: "phone" as const, createdAt: now };
  try {
    await db.batch([
      db.insert(payerReferences).values(row),
      db.insert(payerReferenceCustomers).values({
        businessId: business.id,
        referenceId: row.id,
        source: key.source,
        customerKey: key.key,
        createdAt: now,
      }),
    ]);
  } catch (e) {
    /* A racing ensure took the digits or this customer first: whatever it
       left is the answer, or — for the digits — a number of their own */
    if (clashOnHolder(e)) return referenceOf(db, business.id, key, now);
    if (clashOnDigits(e)) return (await referenceOf(db, business.id, key, now)) ?? assigned(phone);
    throw e;
  }
  return view(db, { ...row, previousReferenceId: null, transitionEndsAt: null, changedAt: null }, now);
}

/* D26: the previous holder's first confirmation with their new number
   ends the transition early — they have their new number, and the guards
   that kept the two people apart stop. Called on every paid write of an
   `own` row; a no-op unless a row passed from this one. */
export async function endTransitionOnConfirm(
  db: DB,
  row: Pick<typeof payments.$inferSelect, "businessId" | "paymentLinkId" | "referenceSource" | "referenceNumber" | "status">,
  now: Date,
): Promise<void> {
  if (row.referenceSource !== "own" || !row.referenceNumber) return;
  if (row.status !== "confirmed" && row.status !== "partial") return;
  const [mine] = await db
    .select({ id: payerReferences.id })
    .from(payerReferences)
    .where(and(eq(payerReferences.businessId, row.businessId), eq(payerReferences.digits, row.referenceNumber)));
  if (!mine) return;
  await db
    .update(payerReferences)
    .set({ transitionEndsAt: now })
    .where(
      and(
        eq(payerReferences.businessId, row.businessId),
        eq(payerReferences.previousReferenceId, mine.id),
        gt(payerReferences.transitionEndsAt, now),
      ),
    );
}

/* D26 (FR-041): the transition a reference is in, from either side —
   the new owner's row that passed (with the previous holder's row), or
   nothing. */
export async function transitionOf(
  db: DB,
  businessId: string,
  reference: Pick<PayerReference, "id">,
  now: Date,
): Promise<{ previousReferenceId: string } | null> {
  const [row] = await db
    .select({ previous: payerReferences.previousReferenceId, ends: payerReferences.transitionEndsAt })
    .from(payerReferences)
    .where(and(eq(payerReferences.businessId, businessId), eq(payerReferences.id, reference.id)));
  if (!row?.previous || !row.ends || row.ends.getTime() <= now.getTime()) return null;
  return { previousReferenceId: row.previous };
}

/* ---- What Devolada learns (D7, D12, D13) — queries, never stored ---- */

const KNOWN_BANKS: ReadonlySet<string> = new Set(BANKS);

/* D12 (FR-016, FR-017): the person's banks — the distinct sending bank of
   the confirmed or partial payments of every service sharing the
   reference, whatever path confirmed them and whenever, most recent
   first, three at most. Banks only: never an account (FR-019). */
export async function learnedBanks(db: DB, businessId: string, referenceId: string): Promise<(typeof BANKS)[number][]> {
  const holders = await holdersOf(db, businessId, referenceId);
  if (!holders.length) return [];
  const rows = await db
    .select({ bank: payments.senderBank, at: payments.confirmedAt })
    .from(payments)
    .innerJoin(paymentLinks, eq(paymentLinks.id, payments.paymentLinkId))
    .where(
      and(
        eq(payments.businessId, businessId),
        eq(paymentLinks.businessId, businessId),
        inArray(payments.status, [...PAID]),
        isNotNull(payments.senderBank),
        linksOf(holders),
      ),
    )
    .orderBy(desc(payments.confirmedAt), desc(payments.createdAt));
  const out: (typeof BANKS)[number][] = [];
  for (const r of rows) {
    if (!r.bank || !KNOWN_BANKS.has(r.bank) || out.includes(r.bank as (typeof BANKS)[number])) continue;
    out.push(r.bank as (typeof BANKS)[number]);
    if (out.length === 3) break;
  }
  return out;
}

/* D12 (FR-021): the accounts a service was paid from — the CEP records
   whose clave a confirmed or partial payment of that customer adopted.
   Per service, because an account decides money between services. Whole,
   under the business only: never in a payer's schema (FR-019). `bank`
   narrows to the transfers that customer confirmed from that bank (D11). */
export async function learnedAccounts(
  db: DB,
  businessId: string,
  customers: CustomerKey[],
  opts: { bank?: string | null } = {},
): Promise<string[]> {
  if (!customers.length) return [];
  const rows = await db
    .selectDistinct({ account: cepRecords.senderAccount })
    .from(cepRecords)
    .innerJoin(payments, and(eq(payments.businessId, cepRecords.businessId), eq(payments.trackingKey, cepRecords.clave)))
    .innerJoin(paymentLinks, eq(paymentLinks.id, payments.paymentLinkId))
    .where(
      and(
        eq(cepRecords.businessId, businessId),
        eq(paymentLinks.businessId, businessId),
        inArray(payments.status, [...PAID]),
        linksOf(customers),
        ...(opts.bank ? [eq(payments.senderBank, opts.bank)] : []),
      ),
    );
  return rows.map((r) => r.account.replace(/\D/g, "")).filter(Boolean);
}

/* D7 (FR-018): what "Otro banco" lists first — this business's confirmed
   payments of the last 90 days, most used banks first, five at most. One
   business's rows; it names no customer. */
export async function bankOrder(db: DB, businessId: string, now: Date): Promise<(typeof BANKS)[number][]> {
  const since = new Date(now.getTime() - 90 * DAY_MS);
  const rows = await db
    .select({ bank: payments.senderBank, n: sql<number>`count(*)` })
    .from(payments)
    .where(
      and(
        eq(payments.businessId, businessId),
        inArray(payments.status, [...PAID]),
        isNotNull(payments.senderBank),
        sql`${payments.confirmedAt} >= ${since.getTime()}`,
        realOnly(payments),
      ),
    )
    .groupBy(payments.senderBank)
    .orderBy(desc(sql`count(*)`), asc(payments.senderBank));
  return rows
    .map((r) => r.bank)
    .filter((b): b is (typeof BANKS)[number] => b != null && KNOWN_BANKS.has(b))
    .slice(0, 5);
}

/* ---- D5: the backfill ---- */

/* Twenty links per business per minute: a panel link costs one read for
   its customer's phone and one or two for who shares it (0.4–0.6 s each,
   measured), and the minute's other sweeps share the budget */
export const BACKFILL_PER_BUSINESS = 20;

export type BackfillReport = { businesses: number; assigned: number };

/* D5: the references of the links that existed when the feature was
   turned on, oldest first — so "the first to receive a reference keeps
   the phone's digits" means the oldest customer (D4). Joins the
   every-minute trigger after the direct-payment sweep; skips businesses
   with the switch off and test links; speaks only when it assigned
   something (the caller logs). A link whose phone cannot be read now is
   left for the next minute. */
export async function backfillPayerReferences(env: Bindings, now: Date = new Date()): Promise<BackfillReport> {
  const db = drizzle(env.DB);
  const report: BackfillReport = { businesses: 0, assigned: 0 };
  const on = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.payByReference, true), eq(businesses.status, "active")));
  for (const business of on) {
    const pending = await db
      .select({ link: paymentLinks })
      .from(paymentLinks)
      .leftJoin(
        payerReferenceCustomers,
        and(
          eq(payerReferenceCustomers.businessId, paymentLinks.businessId),
          eq(payerReferenceCustomers.source, paymentLinks.source),
          eq(payerReferenceCustomers.customerKey, sql`coalesce(${paymentLinks.customerUsuario}, ${paymentLinks.customerRef})`),
        ),
      )
      .where(and(eq(paymentLinks.businessId, business.id), isNull(payerReferenceCustomers.customerKey), realOnly(paymentLinks)))
      .orderBy(asc(paymentLinks.createdAt), asc(paymentLinks.id))
      .limit(BACKFILL_PER_BUSINESS);
    if (!pending.length) continue;
    report.businesses++;
    const integration = await integrationOf(db, business.id);
    const contact = capabilitiesOf(integration, env).customersWithPhone;
    for (const { link } of pending) {
      const key = customerKeyOf(link);
      if (!key) continue;
      try {
        let phone: string | null = null;
        if (key.source === "panel") {
          /* No integration to read the phone from: nothing to count yet */
          if (!contact) continue;
          phone = await contact.phoneOf(key.key);
        }
        const made = await ensurePayerReference(db, env, business, integration, { ...key, phone }, now);
        if (made) report.assigned++;
      } catch (e) {
        if (e instanceof IntegrationError) {
          console.error("payer reference backfill: integration away:", e.code, e.message);
          continue;
        }
        throw e;
      }
    }
  }
  return report;
}

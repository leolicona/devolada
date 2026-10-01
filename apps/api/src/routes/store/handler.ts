import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { businesses, paymentLinks, payments, stores } from "../../db/schema";
import { channelBusiness } from "../../store-channel";
import { integrationOf } from "../../integrations/store";
import { capabilitiesOf } from "../../integrations/registry";
import { IntegrationError, type IntegrationCapabilities } from "../../integrations/capabilities";
import { parseHypothesis } from "../../integrations/dispatch";
import { getNumberSetting, getSetting } from "../../platform/settings";
import { ensureLink } from "../../direct-payments/links";
import { announcingWriter, isUniqueViolation, settleConfirmed } from "../../direct-payments/validation";
import { recordCollection } from "../../store-ledger";
import { makeFolio } from "../../folio";
import { renderReceipt, toWhatsAppPhone, whatsAppLink } from "../../receipt";
import { DEFAULT_RECEIPT_TEMPLATE } from "../../receipt/template";
import { deferOf } from "../defer";
import {
  STORE_SEARCH_LIMIT,
  STORE_SEARCH_MIN,
  type CollectionOutcome,
  type CollectionReceiptResponse,
  type CollectionStatusResponse,
  type RecordCollectionRequest,
  type RecordCollectionResponse,
  type StoreQuoteResponse,
  type StoreSearchResponse,
} from "./schema";

/* cash-at-stores — the shopkeeper's counter (contracts/store-api.md). The
   core asks the business's integration by capability and imports nothing
   from an adapter (constitution IX):

       grep -rn "wisphub/" apps/api/src/routes/store

   prints nothing, and that is the audit. */

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;
type DB = DrizzleD1Database;
type Payment = typeof payments.$inferSelect;

const refuse = (c: Ctx, code: string, status: 400 | 404 | 409 | 503) =>
  c.json({ success: false, error: { code } }, status);

/* The business at the counter (D7, FR-006, FR-015) and the three
   capabilities the channel needs (D8, D9, FR-007). The operator's switch
   checks the same three; this re-checks, because an integration can lose
   its key after the switch went on. Neither refusal should happen while
   the guard holds: both are answers, not crashes (contract). */
async function counterOf(c: Ctx, db: DB) {
  const business = await channelBusiness(db);
  if (!business) return { refusal: refuse(c, "CHANNEL_OFF", 409) };
  const integration = await integrationOf(db, business.id);
  const caps = capabilitiesOf(integration, c.env);
  if (!integration || !caps.customerSearch || !caps.customerDebt || !caps.paymentActions) {
    return { refusal: refuse(c, "NOT_CAPABLE", 409) };
  }
  return {
    business,
    integration,
    search: caps.customerSearch,
    debt: caps.customerDebt,
  };
}

/* D8, D24 (FR-016, FR-017, FR-028): a typed search, live, at most ten;
   name, usuario and zone, nothing else. An outage is "unavailable" with
   no rows, never "sin resultados" — and never a fallback to Devolada's
   own links. */
export async function searchCustomers(c: Ctx, q: string) {
  const text = q.trim();
  if (text.length < STORE_SEARCH_MIN) return refuse(c, "QUERY_TOO_SHORT", 400);
  const db = drizzle(c.env.DB);
  const counter = await counterOf(c, db);
  if ("refusal" in counter) return counter.refusal;
  let data: StoreSearchResponse;
  try {
    const found = await counter.search.find(text, STORE_SEARCH_LIMIT);
    data = {
      rows: found.rows.map((r) => ({ usuario: r.usuario, name: r.name, zone: r.zone })),
      more: found.more,
      integration: "ok",
    };
  } catch (e) {
    /* A refused key is the business's to fix, not the store's: to the
       counter both are "the system is not answering" (FR-028) */
    if (!(e instanceof IntegrationError)) throw e;
    console.error("store search failed:", e.code, e.message);
    data = { rows: [], more: false, integration: "unavailable" };
  }
  return c.json({ success: true, data });
}

/* D14: the debt, read live through the capability — never the snapshot
   the SPEI validation may read. An unproven zero is not zero
   (`debt-truth`): it comes back `unavailable`. */
async function freshDebt(counter: { debt: NonNullable<IntegrationCapabilities["customerDebt"]> }, usuario: string) {
  try {
    const answer = await counter.debt.of(usuario);
    return answer.state === "unconfirmed" ? null : answer;
  } catch (e) {
    if (!(e instanceof IntegrationError)) throw e;
    console.error("store debt read failed:", e.code, e.message);
    return null;
  }
}

/* D14, D22 (FR-018, FR-020): the quote — the debt, the network fee and
   the total, all read now */
export async function quoteCustomer(c: Ctx, usuario: string) {
  const db = drizzle(c.env.DB);
  const counter = await counterOf(c, db);
  if ("refusal" in counter) return counter.refusal;
  const [debt, feeCents] = await Promise.all([freshDebt(counter, usuario), getNumberSetting(db, "store_fee_cents")]);
  let data: StoreQuoteResponse;
  if (!debt) {
    data = { usuario, state: "unavailable" };
  } else {
    const amounts = {
      usuario,
      name: debt.customer.name,
      zone: debt.customer.zone,
      invoiceCents: debt.invoiceCents,
      carriedBalanceCents: debt.carriedBalanceCents,
      feeCents,
      totalCents: debt.totalCents + feeCents,
    };
    data =
      debt.state === "owes"
        ? { state: "owes", ...amounts, debtCents: debt.totalCents }
        : { state: "none", ...amounts, debtCents: 0 };
  }
  return c.json({ success: true, data });
}

/* D15 (FR-023): the row a collection key already made, for this store */
async function collectionByKey(db: DB, storeId: string, key: string): Promise<Payment | null> {
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.storeId, storeId), eq(payments.collectionKey, key)));
  return row ?? null;
}

/* POST /store/collections — record first, answer at once, act in the
   background (D25). In this order:
     0. the same key twice answers the first row, 200 (D15) — before any
        read, so a retry after a lost signal never meets a debt its own
        first try already paid (scenario 1.13);
     1. a fresh debt and the current fee, checked against what the payer
        was shown (D14, FR-021) — nothing is written when either moved;
     2. the customer's panel link, ensured (D11);
     3. the payment row, with its key (the unique index is the race guard);
     4. `settleConfirmed`, with no SPEI fee in the arithmetic (D13);
     5. the `collection` movement (D19);
     6. the first action attempt, past the response (D25).
   The phone is never written (D18). */
export async function recordStoreCollection(c: Ctx, body: RecordCollectionRequest) {
  const store = c.get("store");
  const db = drizzle(c.env.DB);

  const replay = await collectionByKey(db, store.storeId, body.collectionKey);
  if (replay) {
    const data: RecordCollectionResponse = { id: replay.id, folio: replay.folio ?? "" };
    return c.json({ success: true, data }, 200);
  }

  const counter = await counterOf(c, db);
  if ("refusal" in counter) return counter.refusal;
  const { business, integration } = counter;

  const [debt, feeCents] = await Promise.all([freshDebt(counter, body.usuario), getNumberSetting(db, "store_fee_cents")]);
  /* D14: an unproven zero is never "nothing owed" */
  if (!debt) return refuse(c, "INTEGRATION_UNAVAILABLE", 503);
  if (debt.state === "none") return refuse(c, "NOTHING_DUE", 409);
  /* FR-021, the spec's edge case on a changed fee: the payer pays what
     they were shown, or nothing is written and the app asks again */
  if (debt.totalCents !== body.expectedDebtCents || feeCents !== body.expectedFeeCents) {
    return refuse(c, "AMOUNT_CHANGED", 409);
  }
  /* FR-019: nothing more than the debt — no advance, no overpayment */
  if (body.amountCents > debt.totalCents) return refuse(c, "AMOUNT_ABOVE_DEBT", 400);

  /* D11: a cash payment is a payment of this customer, so it hangs off
     the customer's own panel link — born here if the operator never made
     one (links-on-demand-search FR-008, amended by this decision) */
  const { token } = await ensureLink(db, business.id, {
    usuario: body.usuario,
    wisphubId: Number(debt.customer.providerCustomerId),
  });
  const [link] = await db.select().from(paymentLinks).where(eq(paymentLinks.token, token));

  const now = new Date();
  let inserted: Payment;
  try {
    [inserted] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        channel: "store",
        /* D11: a cash row carries no proof */
        proofMode: "none",
        storeId: store.storeId,
        storeUserId: store.userId,
        /* D22: the fee the payer was shown, and paid — the store's money */
        storeFeeCents: feeCents,
        collectionKey: body.collectionKey,
        amountCents: body.amountCents,
        /* D14: the fresh debt's two halves */
        invoiceCents: debt.invoiceCents,
        carriedBalanceCents: debt.carriedBalanceCents,
        /* D13: no SPEI fee on a cash row */
        serviceFeeCents: 0,
        /* D17: the house folio, at once — the shopkeeper's answer */
        folio: makeFolio(),
        createdAt: now,
      })
      .returning();
  } catch (e) {
    /* D15: two taps raced; the first one's row is the answer */
    if (!isUniqueViolation(e)) throw e;
    const raced = await collectionByKey(db, store.storeId, body.collectionKey);
    if (!raced) throw e;
    return c.json({ success: true, data: { id: raced.id, folio: raced.folio ?? "" } satisfies RecordCollectionResponse }, 200);
  }

  const defer = deferOf(c);
  const settled = await settleConfirmed(c.env, db, {
    payment: inserted,
    business,
    integration,
    customer: {
      usuario: body.usuario,
      providerCustomerId: debt.customer.providerCustomerId,
      name: debt.customer.name,
      zone: debt.customer.zone,
      /* D18: never kept — the receipt reads it live */
      phone: null,
    },
    receivedCents: body.amountCents,
    debtCents: debt.totalCents,
    /* D13: the store's fee stays outside settle() and classifyPayment() —
       fed in, a $15 fee would quietly turn a $490 payment of a $500 debt
       into a registered $500 */
    serviceFeeCents: 0,
    /* debt-truth D15: the oldest open invoice carries the payment, or none
       (the adapter then makes the empty vehicle). Read live, seconds ago. */
    invoiceId: debt.invoices.length ? Math.min(...debt.invoices.map((f) => f.invoiceId)) : null,
    now,
    update: announcingWriter(c.env, db, inserted, link, now, defer),
    verdictFields: {},
    hold: null,
    firstAttempt: { mode: "deferred", defer },
  });

  /* D19: + the amount applied, once per payment */
  await recordCollection(db, settled, now);

  const data: RecordCollectionResponse = { id: settled.id, folio: settled.folio ?? "" };
  return c.json({ success: true, data }, 201);
}

/* This store's own cash payment, or nothing (contract: any other id is
   404). Served whether or not the business's channel is still on. */
async function ownCollection(db: DB, storeId: string, id: string) {
  const [row] = await db
    .select({ payment: payments, businessName: businesses.name, timezone: businesses.timezone, timeFormat: businesses.timeFormat })
    .from(payments)
    .innerJoin(businesses, eq(businesses.id, payments.businessId))
    .where(and(eq(payments.id, id), eq(payments.storeId, storeId), eq(payments.channel, "store")));
  return row ?? null;
}

/* FR-025, contract table (/speckit-analyze H2): the row's outcome and the
   action its class decided. `done` under register_only is "registered",
   never "reconnected" — the router was deliberately never asked. */
function outcomeOfRow(row: Payment): CollectionOutcome {
  switch (row.actionOutcome) {
    case "done": {
      const decided = parseHypothesis(row.decidedAction ?? row.observedAction ?? "register_and_reconnect:reconnect");
      return decided.action === "register_only" ? "registered" : "reconnected";
    }
    case "withheld":
      return "not_reconnected_short";
    case "observation":
      return "observation";
    case "failed":
      return "failed";
    default:
      /* `queued`, or the instant between the insert and the verdict */
      return "queued";
  }
}

const remainingOf = (row: Payment) =>
  Math.max(0, row.invoiceCents + row.carriedBalanceCents - (row.receivedCents ?? row.amountCents));

/* GET /store/collections/:id — polled every 3 s while queued (D25) */
export async function collectionStatus(c: Ctx, id: string) {
  const db = drizzle(c.env.DB);
  const found = await ownCollection(db, c.get("store").storeId, id);
  if (!found) return refuse(c, "NOT_FOUND", 404);
  const { payment } = found;
  const data: CollectionStatusResponse = {
    id: payment.id,
    folio: payment.folio ?? "",
    createdAt: payment.createdAt.getTime(),
    businessName: found.businessName,
    customerName: payment.customerName ?? payment.customerUsuario ?? "",
    amountCents: payment.receivedCents ?? payment.amountCents,
    feeCents: payment.storeFeeCents ?? 0,
    class: payment.reconciliationClass === "short" ? "short" : "exact",
    remainingCents: remainingOf(payment),
    outcome: outcomeOfRow(payment),
  };
  return c.json({ success: true, data });
}

/* D18 rule 5: the status line tells the truth about the action, in the
   payer's words (*pago*, never *cobro*, D27). Product copy, in code — not
   settings in this feature (D31). */
function outcomeSentence(outcome: CollectionOutcome, business: string): string {
  switch (outcome) {
    case "reconnected":
      return "Tu servicio ya está activo.";
    case "registered":
      return `Tu pago quedó registrado con ${business}.`;
    case "queued":
      return "Tu servicio se reactivará en unos minutos.";
    case "not_reconnected_short":
      return "Tu pago quedó registrado. Como no cubre todo tu adeudo, tu servicio sigue sin reactivarse.";
    case "observation":
      return `Tu pago quedó registrado. ${business} reactivará tu servicio.`;
    case "failed":
      return `Tu pago quedó registrado. Si tu servicio no vuelve, comunícate con ${business}.`;
  }
}

/* GET /store/collections/:id/receipt (D18, D31; constitution V v1.9.0).
   Asked for only when WhatsApp is tapped. The text is the operator's
   template, filled now. The phone is read live through the business's
   integration, addresses this one link, and is never written — not on the
   row (`customer_phone` stays null), not anywhere. No capability, no phone
   on file, an unreadable number, or no answer: `hasPhone: false` and the
   contact picker, and the app asks the shopkeeper (FR-027). */
export async function collectionReceipt(c: Ctx, id: string) {
  const db = drizzle(c.env.DB);
  const store = c.get("store");
  const found = await ownCollection(db, store.storeId, id);
  if (!found) return refuse(c, "NOT_FOUND", 404);
  const { payment } = found;

  const [storeRow] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, store.storeId));
  const template = (await getSetting(db, "store_receipt_template")) ?? DEFAULT_RECEIPT_TEMPLATE;
  const outcome = outcomeOfRow(payment);
  const text = renderReceipt(template, {
    negocio: found.businessName,
    tienda: storeRow?.name ?? store.name,
    folio: payment.folio ?? "",
    cliente: payment.customerName ?? payment.customerUsuario ?? "",
    montoCents: payment.receivedCents ?? payment.amountCents,
    cargoCents: payment.storeFeeCents ?? 0,
    pendienteCents: remainingOf(payment),
    at: (payment.confirmedAt ?? payment.createdAt).getTime(),
    timezone: found.timezone,
    timeFormat: found.timeFormat,
    estado: outcomeSentence(outcome, found.businessName),
  });

  let phone: string | null = null;
  const lookup = capabilitiesOf(await integrationOf(db, payment.businessId), c.env).customersWithPhone;
  if (lookup && payment.customerUsuario) {
    try {
      phone = toWhatsAppPhone(await lookup.phoneOf(payment.customerUsuario));
    } catch (e) {
      /* The edge case "the business's system is down when WhatsApp is
         tapped": the receipt still goes out, to a number typed in the app */
      if (!(e instanceof IntegrationError)) throw e;
      console.error("receipt phone read failed:", e.code);
    }
  }
  const data: CollectionReceiptResponse = { text, waLink: whatsAppLink(text, phone), hasPhone: phone !== null };
  return c.json({ success: true, data });
}

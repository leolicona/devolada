import type { Context } from "hono";
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import {
  account as accountTable,
  businesses,
  paymentLinks,
  payments,
  session as sessionTable,
  storeInvitations,
  stores,
  user as userTable,
} from "../../db/schema";
import { makeAuth } from "../../auth/better";
import { isPlatformOperator } from "../../platform/settings";
import { channelBusiness } from "../../store-channel";
import { integrationOf } from "../../integrations/store";
import { capabilitiesOf } from "../../integrations/registry";
import { IntegrationError, type IntegrationCapabilities } from "../../integrations/capabilities";
import { actionForClass, parseHypothesis } from "../../integrations/dispatch";
import type { Integration } from "../../integrations/store";
import { classifyPayment } from "../../direct-payments/classes";
import { settle } from "../../direct-payments/partial";
import { getNumberSetting, getSetting } from "../../platform/settings";
import { ensureLink } from "../../direct-payments/links";
import { isUniqueViolation } from "../../direct-payments/validation";
import { finishCollection, settleLeaseFrom, settleStoreRow } from "../../store-collections";
import {
  decodeLedgerCursor,
  encodeLedgerCursor,
  feesSinceHandoverCents,
  heldCents,
  lastHandoverAt,
  ledgerRowsOf,
  movementsOf,
} from "../../store-ledger";
import { storeHandovers, storeLedger } from "../../db/schema";
import { makeFolio } from "../../folio";
import { renderReceipt, toWhatsAppPhone, whatsAppLink } from "../../receipt";
import { DEFAULT_RECEIPT_TEMPLATE } from "../../receipt/template";
import { deferOf } from "../defer";
import {
  STORE_SEARCH_LIMIT,
  STORE_SEARCH_MIN,
  STORE_LEDGER_PAGE,
  STORE_HANDOVERS_PAGE,
  type AcceptStoreInvitationRequest,
  type CashboxResponse,
  type DeclareHandoverRequest,
  type DeclareHandoverResponse,
  type StoreLedgerQuery,
  type StoreLedgerResponse,
  type StoreHandoversQuery,
  type StoreHandoversResponse,
  type CollectionOutcome,
  type InvitationPreviewResponse,
  type CollectionReceiptResponse,
  type CollectionStatusResponse,
  type RecordCollectionRequest,
  type RecordCollectionResponse,
  type StoreQuoteResponse,
  type StoreSearchResponse,
} from "./schema";

/* cash-at-stores — the shopkeeper's counter (contracts/store-api.md). The
   core asks the business's integration by capability and imports nothing
   from an adapter (constitution IX). The audit is T061's grep for the
   adapter's directory over this folder: it prints nothing — so this
   comment does not spell the path out either. */

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

/* The spec's edge case "a short payment below the business's threshold":
   the smallest amount that gives the service back, asked of the same three
   rules `settleConfirmed` applies — the class picks the mapped action, and
   under register_and_reconnect the threshold and the floor vote (D13: with
   no fee in the arithmetic). Null when not even the whole debt does. The
   rules only loosen as the amount grows, so a binary search over cents
   finds the edge in ~24 pure steps. */
function reconnectsFromCents(
  debtCents: number,
  business: { toleranceCents: number },
  integration: Integration,
): number | null {
  if (!integration.actionsEnabled) return null;
  const reconnects = (cents: number) => {
    const klass = classifyPayment({ receivedCents: cents, askedCents: debtCents, toleranceCents: business.toleranceCents });
    const settlement = settle({
      receivedCents: cents,
      ispDebtCents: debtCents,
      serviceFeeCents: 0,
      thresholdPercent: integration.thresholdPercent,
      floorCents: integration.floorCents,
    });
    return actionForClass(integration, klass) === "register_and_reconnect" && settlement.reconnect;
  };
  if (!reconnects(debtCents)) return null;
  let low = 1;
  let high = debtCents;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (reconnects(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
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
        ? {
            state: "owes",
            ...amounts,
            debtCents: debt.totalCents,
            reconnectsFromCents: reconnectsFromCents(debt.totalCents, counter.business, counter.integration),
          }
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
        first try already paid (scenario 1.13). A first try that died
        between its writes is finished here (T072);
     1. a fresh debt and the current fee, checked against what the payer
        was shown (D14, FR-021) — nothing is written when either moved;
     2. the customer's panel link, ensured (D11);
     3. the payment row, with its key (the unique index is the race guard),
        born leased and carrying what its settlement needs (T072);
     4. `settleConfirmed`, with no SPEI fee in the arithmetic (D13);
     5. the `collection` movement (D19);
     6. the first action attempt, past the response (D25).
   The phone is never written (D18). */
export async function recordStoreCollection(c: Ctx, body: RecordCollectionRequest) {
  const store = c.get("store");
  const db = drizzle(c.env.DB);

  const replay = await collectionByKey(db, store.storeId, body.collectionKey);
  if (replay) {
    /* T072: the first try may have died between its writes — finish it */
    const finished = await finishCollection(c.env, db, replay, deferOf(c));
    const data: RecordCollectionResponse = { id: finished.id, folio: finished.folio ?? "" };
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
    /* T070, constitution IX: the integration's id, untouched — never
       read as a number, which holds for one provider only */
    providerCustomerId: debt.customer.providerCustomerId,
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
        /* T072: everything the settlement needs rides the row, so a retry
           or the sweep can finish it if this request dies */
        customerUsuario: body.usuario,
        wisphubCustomerId: debt.customer.providerCustomerId,
        customerName: debt.customer.name,
        customerZone: debt.customer.zone,
        /* debt-truth D15: the oldest open invoice carries the payment, or
           none (the adapter then makes the empty vehicle). Read live,
           seconds ago. */
        wisphubInvoiceId: debt.invoices.length ? Math.min(...debt.invoices.map((f) => f.invoiceId)) : null,
        /* T072: born leased — this request settles it, nobody else */
        nextAttemptAt: settleLeaseFrom(now),
        createdAt: now,
      })
      .returning();
  } catch (e) {
    /* D15: two taps raced; the first one's row is the answer */
    if (!isUniqueViolation(e)) throw e;
    const raced = await collectionByKey(db, store.storeId, body.collectionKey);
    if (!raced) throw e;
    const finished = await finishCollection(c.env, db, raced, deferOf(c));
    return c.json({ success: true, data: { id: finished.id, folio: finished.folio ?? "" } satisfies RecordCollectionResponse }, 200);
  }

  /* steps 4 and 5, and 6 past the response — shared with the retry and
     the sweep that finish a row this request may not (T072) */
  const settled = await settleStoreRow(c.env, db, inserted, { business, integration, defer: deferOf(c), now });

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

/* T071: what the verdict decided, read back from the row (D10's
   `decided_action`) — a reconnection only under register_and_reconnect at
   or above the threshold. Every cash row is born with it; a row without
   one (none today) says nothing it cannot prove. */
const reconnectsOf = (row: Payment) => {
  const decided = row.decidedAction ?? row.observedAction;
  return decided ? parseHypothesis(decided).reconnect : false;
};

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
    reconnects: reconnectsOf(payment),
  };
  return c.json({ success: true, data });
}

/* D18 rule 5: the status line tells the truth about the action, in the
   payer's words (*pago*, never *cobro*, D27). Product copy, in code — not
   settings in this feature (D31). */
function outcomeSentence(outcome: CollectionOutcome, business: string, reconnects: boolean, short: boolean): string {
  switch (outcome) {
    case "reconnected":
      return "Tu servicio ya está activo.";
    case "registered":
      return `Tu pago quedó registrado con ${business}.`;
    case "queued":
      /* T071: a queued row promises only what its verdict decided — a
         receipt sent before the action lands keeps that sentence for good */
      if (reconnects) return "Tu servicio se reactivará en unos minutos.";
      return short
        ? "Tu pago quedó registrado. Como no cubre todo tu adeudo, tu servicio sigue sin reactivarse."
        : `Tu pago quedó registrado. ${business} lo aplicará en su sistema.`;
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
    estado: outcomeSentence(outcome, found.businessName, reconnectsOf(payment), payment.reconciliationClass === "short"),
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

/* ---- The invitation, session-less (D4, D5) ---- */

const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/* D4: the store and its invitation, when the token opens one. Every bad
   token gets the same answer; the log records which it was. A suspended
   store's invitation is not accepted (data-model). */
async function openInvitation(db: DB, token: string, now: Date) {
  const [found] = await db
    .select({ invitation: storeInvitations, store: stores })
    .from(storeInvitations)
    .innerJoin(stores, eq(stores.id, storeInvitations.storeId))
    .where(eq(storeInvitations.tokenHash, await sha256Hex(token)));
  const why = !found
    ? "unknown"
    : found.invitation.status !== "sent"
      ? found.invitation.status
      : found.invitation.expiresAt.getTime() <= now.getTime()
        ? "expired"
        : found.store.status !== "invited" || found.store.userId
          ? `store ${found.store.status}`
          : null;
  if (why) {
    console.log(`store invitation refused: ${why}`);
    return null;
  }
  return found!;
}

/* GET /store/invitations/:token */
export async function previewInvitation(c: Ctx, token: string) {
  const db = drizzle(c.env.DB);
  const open = await openInvitation(db, token, new Date());
  const data: InvitationPreviewResponse = open
    ? { state: "open", storeName: open.store.name, phoneTail: open.store.phone.slice(-4) }
    : { state: "invalid" };
  return c.json({ success: true, data });
}

/* D5's rollback: the user the acceptance made, and nothing else of it */
async function removeUser(db: DB, userId: string) {
  await db.batch([
    db.delete(sessionTable).where(eq(sessionTable.userId, userId)),
    db.delete(accountTable).where(eq(accountTable.userId, userId)),
    db.delete(userTable).where(eq(userTable.id, userId)),
  ]);
}

/* POST /store/invitations/:token/accept (D5, FR-009), in this order:
     1. the token opens an invitation (D4);
     2. an email with a user, or an operator's, is EMAIL_TAKEN — the same
        word, so an operator's address is not revealed (D2);
     3. the user is born through Better Auth, with no username;
     4. in one batch: the username (the store's phone, as `nationalPhone`
        reads it — L5), the store's user and `active`, the invitation
        `accepted`. A store another request took meanwhile writes no row,
        and is the same refusal;
     5. the código goes out (best-effort: the app's "Reenviar" retries).
   Steps 3–4 failing remove the user, and the invitation stays `sent`. */
export async function acceptInvitation(c: Ctx, token: string, body: AcceptStoreInvitationRequest) {
  const db = drizzle(c.env.DB);
  const now = new Date();
  const open = await openInvitation(db, token, now);
  if (!open) return refuse(c, "INVALID_INVITATION", 400);
  const { store, invitation } = open;

  const email = body.email;
  const [existing] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email));
  if (existing || isPlatformOperator(c.env, email)) return refuse(c, "EMAIL_TAKEN", 409);

  const auth = makeAuth(c.env);
  const { response } = await auth.api.signUpEmail({
    body: { name: store.shopkeeperName, email, password: body.password },
    returnHeaders: true,
  });
  const userId = response.user.id;
  /* T089 (D5's rollback): the store is linked FIRST, and the phone and the
     invitation are written only if that link is this user's — so a
     request that lost the race writes nothing, never meets the phone's
     unique index, and leaves the invitation as the winner left it */
  const linkedHere = sql`exists (select 1 from ${stores} where ${stores.id} = ${store.id} and ${stores.userId} = ${userId})`;
  try {
    const [linked] = await db.batch([
      db
        .update(stores)
        .set({ userId, status: "active", updatedAt: now })
        .where(and(eq(stores.id, store.id), eq(stores.status, "invited"), isNull(stores.userId)))
        .returning({ id: stores.id }),
      db
        .update(userTable)
        .set({ username: store.phone, displayUsername: store.phone })
        .where(and(eq(userTable.id, userId), linkedHere)),
      db
        .update(storeInvitations)
        .set({ status: "accepted" })
        .where(and(eq(storeInvitations.id, invitation.id), eq(storeInvitations.status, "sent"), linkedHere)),
    ]);
    if (linked.length === 0) {
      await removeUser(db, userId);
      return refuse(c, "INVALID_INVITATION", 400);
    }
  } catch (e) {
    await removeUser(db, userId);
    /* the phone taken in between, by a path D3 does not foresee: the
       same answer as the race, never a 500 */
    if (isUniqueViolation(e)) return refuse(c, "INVALID_INVITATION", 400);
    throw e;
  }

  try {
    await auth.api.sendVerificationOTP({ body: { email, type: "email-verification" } });
  } catch (e) {
    console.error("store acceptance code failed", e);
  }
  return c.json({ success: true, data: { email } }, 201);
}

/* ---- The cash book (D19, D20) ---- */

/* Contract, "The business, in the cash book" (/speckit-analyze H1;
   constitution V v1.9.1): every business this store has movements with,
   whether or not its channel is still on — that is what lets a store hand
   over cash after the switch goes off — plus the one it collects for now.
   Never CHANNEL_OFF here. */
async function bookBusinessesOf(db: DB, storeId: string) {
  const [moved, channel] = await Promise.all([
    db.selectDistinct({ businessId: storeLedger.businessId }).from(storeLedger).where(eq(storeLedger.storeId, storeId)),
    channelBusiness(db),
  ]);
  const ids = new Set(moved.map((m) => m.businessId));
  if (channel) ids.add(channel.id);
  if (!ids.size) return [];
  return db
    .select({ id: businesses.id, name: businesses.name })
    .from(businesses)
    .where(inArray(businesses.id, [...ids]));
}

/* GET /store/cashbox — FR-037: held and fees per business, the last
   resolved hand-over (with a dispute's note) and the pending one */
export async function getCashbox(c: Ctx) {
  const db = drizzle(c.env.DB);
  const { storeId } = c.get("store");
  const list = await bookBusinessesOf(db, storeId);
  const data: CashboxResponse = {
    businesses: await Promise.all(
      list.map(async (b) => {
        const [held, fees, since, [last], [pending]] = await Promise.all([
          heldCents(db, storeId, b.id),
          feesSinceHandoverCents(db, storeId, b.id),
          lastHandoverAt(db, storeId, b.id),
          db
            .select()
            .from(storeHandovers)
            .where(and(eq(storeHandovers.storeId, storeId), eq(storeHandovers.businessId, b.id), ne(storeHandovers.status, "pending")))
            .orderBy(desc(storeHandovers.resolvedAt))
            .limit(1),
          db
            .select()
            .from(storeHandovers)
            .where(and(eq(storeHandovers.storeId, storeId), eq(storeHandovers.businessId, b.id), eq(storeHandovers.status, "pending"))),
        ]);
        return {
          businessId: b.id,
          businessName: b.name,
          heldCents: held,
          feesSinceHandoverCents: fees,
          feesSince: since ? since.getTime() : null,
          lastHandover: last
            ? {
                cents: last.cents,
                status: last.status as "confirmed" | "disputed",
                at: (last.resolvedAt ?? last.declaredAt).getTime(),
                note: last.note,
              }
            : null,
          pendingHandover: pending ? { id: pending.id, cents: pending.cents, declaredAt: pending.declaredAt.getTime() } : null,
        };
      }),
    ),
  };
  return c.json({ success: true, data });
}

/* GET /store/ledger — newest first, twenty a page; `businessId` and
   `kind` narrow it to what a number in *Mi caja* stands for (FR-037) */
export async function getStoreLedger(c: Ctx, q: StoreLedgerQuery) {
  const db = drizzle(c.env.DB);
  const { storeId } = c.get("store");
  const cursor = decodeLedgerCursor(q.cursor);
  if (cursor === "bad") return refuse(c, "VALIDATION_ERROR", 400);
  const list = await bookBusinessesOf(db, storeId);
  const ids = list.map((b) => b.id);
  if (q.businessId && !ids.includes(q.businessId)) return refuse(c, "NOT_FOUND", 404);
  const page = await movementsOf(
    db,
    { storeId, businessIds: q.businessId ? [q.businessId] : ids, kind: q.kind, since: q.since !== undefined ? new Date(q.since) : undefined },
    cursor,
    STORE_LEDGER_PAGE,
  );
  const rows = await ledgerRowsOf(db, page.rows);
  const data: StoreLedgerResponse = {
    /* the store's view: no payment ids, no authors (D21's detail is the
       operator's and the business's) */
    rows: rows.map(({ paymentId: _p, authorEmail: _a, ...row }) => row),
    nextCursor: page.next ? encodeLedgerCursor(page.next) : null,
  };
  return c.json({ success: true, data });
}

/* GET /store/handovers — T080 (US5/AC6, "both sides see the same
   history"): this store's hand-overs to one business it holds or held
   cash for, newest first, a dispute's note included. Served whether or
   not the channel is still on, like the rest of the cash book (H1). */
export async function getStoreHandovers(c: Ctx, q: StoreHandoversQuery) {
  const db = drizzle(c.env.DB);
  const { storeId } = c.get("store");
  const cursor = decodeLedgerCursor(q.cursor);
  if (cursor === "bad") return refuse(c, "VALIDATION_ERROR", 400);
  const business = (await bookBusinessesOf(db, storeId)).find((b) => b.id === q.businessId);
  if (!business) return refuse(c, "NOT_FOUND", 404);
  const rows = await db
    .select()
    .from(storeHandovers)
    .where(
      and(
        eq(storeHandovers.storeId, storeId),
        eq(storeHandovers.businessId, business.id),
        ...(cursor
          ? [
              or(
                lt(storeHandovers.declaredAt, new Date(cursor.at)),
                and(eq(storeHandovers.declaredAt, new Date(cursor.at)), lt(storeHandovers.id, cursor.id)),
              ),
            ]
          : []),
      ),
    )
    .orderBy(desc(storeHandovers.declaredAt), desc(storeHandovers.id))
    .limit(STORE_HANDOVERS_PAGE + 1);
  const page = rows.slice(0, STORE_HANDOVERS_PAGE);
  const last = page.at(-1);
  const data: StoreHandoversResponse = {
    businessName: business.name,
    handovers: page.map((h) => ({
      id: h.id,
      cents: h.cents,
      status: h.status,
      declaredAt: h.declaredAt.getTime(),
      resolvedAt: h.resolvedAt ? h.resolvedAt.getTime() : null,
      note: h.note,
    })),
    nextCursor: rows.length > STORE_HANDOVERS_PAGE && last ? encodeLedgerCursor({ at: last.declaredAt.getTime(), id: last.id }) : null,
  };
  return c.json({ success: true, data });
}

/* POST /store/handovers — D20: above zero and at most what is held; one
   pending per store and business (the partial unique index is the guard,
   races included). Declaring writes no movement. */
export async function declareHandover(c: Ctx, body: DeclareHandoverRequest) {
  const db = drizzle(c.env.DB);
  const store = c.get("store");
  const list = await bookBusinessesOf(db, store.storeId);
  if (!list.some((b) => b.id === body.businessId)) return refuse(c, "NOT_FOUND", 404);
  const held = await heldCents(db, store.storeId, body.businessId);
  if (body.cents > held) return refuse(c, "AMOUNT_EXCEEDS_HELD", 400);
  let row: typeof storeHandovers.$inferSelect;
  try {
    [row] = await db
      .insert(storeHandovers)
      .values({ storeId: store.storeId, businessId: body.businessId, cents: body.cents, declaredByUserId: store.userId })
      .returning();
  } catch (e) {
    if (isUniqueViolation(e)) return refuse(c, "HANDOVER_PENDING", 409);
    throw e;
  }
  const data: DeclareHandoverResponse = { id: row.id, status: "pending" };
  return c.json({ success: true, data }, 201);
}

import type { Context } from "hono";
import { and, count, desc, eq, gte, inArray, isNull, like, lt, lte, ne, or, sum } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { businesses, integrationEvents, paymentLinks, payments } from "../../db/schema";
import { nextIsoDate, startOfBusinessDayMs, startOfIsoDateMs } from "../../time/business-day";
import { effectiveOverTreatment } from "../../direct-payments/classes";
import { realOnly, type ApiLink } from "../../direct-payments/links";
import { integrationOf } from "../../integrations/store";
import {
  outcomeOf,
  parseHypothesis,
  recordDispatch,
  settleDispatch,
} from "../../integrations/dispatch";
/* provider-address-per-isp D4 */
import { wisphubFor } from "../../wisphub/factory";
import { attemptReconnection } from "../../wisphub/reconnection";
import { pendingVersion } from "../../wisphub/cache";
import { firstAttemptSchedule } from "../../reconnection/queue";
import { webhookDeliveries } from "../../db/schema";
import { attemptDelivery, requeueDelivery } from "../../webhooks/queue";
import { isVerdictEvent } from "../../webhooks/events";
import type { WebhookEventType } from "../v1/webhook/schema";
import { deferOf } from "../defer";
import { signedProofUrl } from "../../direct-payments/proofs";
import { enqueueAndDeliver } from "../../webhooks/queue";
import { parseAccount } from "../../direct-payments/accounts";
import type { Integration } from "../../integrations/store";
import type { ProofMatch, ProofResponse, PulseResponse, ReviewDecisionRequest, ReviewDecisionResponse } from "./schema";
import { recordsFor } from "../../consta/bundle/store";
import { shownTail } from "../../consta/bundle/match";
import type { MatchTrail } from "../../consta/bundle/types";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* Shared with the direct SPEI channel: one folio format, one guard */
export function makeFolio(): string {
  /* DV- + 6 uppercase base36 chars; the unique index is the real guard */
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of bytes) out += chars[b % 36];
  return `DV-${out}`;
}

function businessGuard(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return { error: c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403) };
  }
  return { actor, db: drizzle(c.env.DB) };
}

/* The day after a calendar date, still as a calendar date — the `to`
   filter is inclusive, so the boundary is the NEXT midnight. */
/* The ISP's live feed (payments-and-classes D4). Tenant isolation by
   businessId (charge-feed D6, unchanged in spirit). */
export async function listPaymentFeed(
  c: Ctx,
  q: {
    cursor?: number;
    status?: (typeof payments.$inferSelect)["status"];
    action?: "queued" | "done" | "withheld" | "failed" | "observation" | "review";
    class?: "exact" | "short" | "over";
    q?: string;
    from?: string;
    to?: string;
  },
) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const { actor, db } = ctx;
  const PAGE = 20;

  /* D2: what a surplus means today, said once per response */
  const [business] = await db.select().from(businesses).where(eq(businesses.id, actor.id));
  const integration = await integrationOf(db, actor.id);

  const filters = [
    eq(payments.businessId, actor.id),
    /* automated-collections-api D12 (FR-035): a test payment is never
       in the business's real history — one shared rule, not a filter
       to remember */
    realOnly(payments),
    /* D4, amended by the pilot-UX round: the default answers money that
       arrived PLUS money in flight — the owner staring at "¿ya me
       pagó?" must see the payment being verified without touching a
       filter. Today's totals still count only confirmed + partial. */
    q.status
      ? eq(payments.status, q.status)
      : inArray(payments.status, ["validating", "confirmed", "partial", "unapplied"]),
    ...(q.cursor ? [lt(payments.createdAt, new Date(q.cursor))] : []),
    ...(q.action ? [eq(payments.actionOutcome, q.action)] : []),
    ...(q.class ? [eq(payments.reconciliationClass, q.class)] : []),
    /* D4: calendar dates on the BUSINESS's wall clock (settings D5) */
    ...(q.from
      ? [gte(payments.createdAt, new Date(startOfIsoDateMs(actor.timezone, q.from)))]
      : []),
    ...(q.to
      ? [lt(payments.createdAt, new Date(startOfIsoDateMs(actor.timezone, nextIsoDate(q.to))))]
      : []),
    /* D4: customer by usuario and by name. The link's usuario covers the
       rows that never denormalized one (validating, unapplied). */
    ...(q.q
      ? [
          or(
            like(payments.customerName, `%${q.q}%`),
            like(payments.customerUsuario, `%${q.q}%`),
            like(paymentLinks.customerUsuario, `%${q.q}%`),
          ),
        ]
      : []),
  ];

  /* `storeName` stays in the response shape until the payments merge
     revises charge-feed.spec.md (business-and-memberships D6); with the
     store network gone it is always null. */
  const rows = await db
    .select({ charge: payments, linkUsuario: paymentLinks.customerUsuario, linkSource: paymentLinks.source })
    .from(payments)
    .innerJoin(paymentLinks, eq(paymentLinks.id, payments.paymentLinkId))
    .where(and(...filters))
    .orderBy(desc(payments.createdAt))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);

  /* integrations-hub D7: `done` wears its action's word ("Reconectado" /
     "Registrado"), and the row's truth is the LAST dispatch decision in
     the ledger — never the mapping of today, which may have moved. */
  const pageIds = page.map((r) => r.charge.id);
  const eventRows = pageIds.length
    ? await db
        .select({
          paymentId: integrationEvents.paymentId,
          action: integrationEvents.action,
          createdAt: integrationEvents.createdAt,
        })
        .from(integrationEvents)
        .where(inArray(integrationEvents.paymentId, pageIds))
    : [];
  const lastAction = new Map<string, "register_and_reconnect" | "register_only">();
  for (const e of eventRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    lastAction.set(e.paymentId, e.action);
  }

  /* Settings D5: the ISP's timezone decides where its day starts.
     "Today" keeps counting the money that landed: confirmed + partial. */
  const todayStartMs = startOfBusinessDayMs(actor.timezone);
  const [t] = await db
    .select({ count: count(), total: sum(payments.receivedCents) })
    .from(payments)
    .where(
      and(
        eq(payments.businessId, actor.id),
        /* FR-035: nor in its real totals */
        realOnly(payments),
        inArray(payments.status, ["confirmed", "partial"]),
        /* receipt-triage D31: a held payment is not paid until the
           business accepts it */
        or(isNull(payments.actionOutcome), ne(payments.actionOutcome, "review")),
        gte(payments.createdAt, new Date(todayStartMs)),
      ),
    );
  const today = {
    count: Number(t?.count ?? 0),
    total: Number(t?.total ?? 0),
    startedAtMs: todayStartMs,
  };

  return c.json({
    success: true,
    data: {
      /* payments-and-classes D6: the feed answers `payments` */
      payments: page.map(({ charge, linkUsuario, linkSource }) => {
        const receivedCents = charge.receivedCents ?? charge.amountCents;
        const askedCents =
          charge.invoiceCents + charge.carriedBalanceCents + charge.serviceFeeCents;
        return {
          id: charge.id,
          folio: charge.folio ?? "",
          channel: charge.channel,
          source: linkSource,
          status: charge.status,
          actionOutcome: charge.actionOutcome,
          reconciliationClass: charge.reconciliationClass,
          receivedCents,
          invoiceCents: charge.invoiceCents,
          carriedBalanceCents: charge.carriedBalanceCents,
          serviceFeeCents: charge.serviceFeeCents,
          askedCents,
          /* Below the debt no fee is covered (partial D3): the ISP and
             the payer quote the same missing figure. */
          missingCents: Math.max(
            0,
            charge.invoiceCents + charge.carriedBalanceCents - receivedCents,
          ),
          /* D3: for `unapplied` the debt at the verdict was zero, so the
             whole payment is the surplus. */
          surplusCents:
            charge.status === "unapplied"
              ? receivedCents
              : Math.max(0, receivedCents - askedCents),
          observedAction: charge.observedAction,
          /* receipt-triage D31: why it waits, and which removed account
             received it — masked to the last four, as every role reads
             an account in the panel */
          reviewReason: charge.actionOutcome === "review" ? charge.reviewReason : null,
          reviewAccount: (() => {
            if (charge.actionOutcome !== "review") return null;
            const account = parseAccount(charge.beneficiary);
            return account ? { kind: account.kind, last4: account.value.slice(-4) } : null;
          })(),
          dispatchedAction: lastAction.get(charge.id) ?? null,
          /* automated-collections-api D3: the link's usuario is null on an
             API link, whose payment carries the caller's reference
             instead; the feed's own API rows arrive with US1 (T076). */
          customerName: charge.customerName ?? linkUsuario ?? charge.customerRef ?? "",
          storeName: null,
          createdAt: charge.createdAt.getTime(),
          actionDoneAt: charge.actionDoneAt?.getTime() ?? null,
          actionAttempts: charge.actionAttempts,
          actionError: charge.actionError,
          /* bug: valid-lost-on-later-failure */
          ...(charge.status === "validating" && charge.banxicoValidAt
            ? { banxicoConfirmedAt: charge.banxicoValidAt.getTime(), waitingOn: charge.lastError }
            : { banxicoConfirmedAt: null, waitingOn: null }),
        };
      }),
      nextCursor: rows.length > PAGE ? page[page.length - 1].charge.createdAt.getTime() : null,
      effectiveOverTreatment: effectiveOverTreatment(business, integration),
      today: { count: today.count, totalCents: today.total, startedAtMs: today.startedAtMs },
    },
  });
}

/* payments-and-classes D4: the proof, whole — the CEP as Banxico
   answered it plus the payer's capture through a short-lived signed URL
   (direct-payment D12's own mechanism). Read for every role: a dispute
   is answered by whoever picks up the phone. */
export async function getPaymentProof(c: Ctx, id: string) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const { actor, db } = ctx;

  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, id), eq(payments.businessId, actor.id), realOnly(payments)));
  if (!row) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  const [business] = await db.select().from(businesses).where(eq(businesses.id, actor.id));

  /* The CEP block exists once money was confirmed against the row —
     confirmed, partial or unapplied. The CEP Consta returns carries no
     account, so the masked-CLABE rule never meets this door. */
  const validated = ["confirmed", "partial", "unapplied"].includes(row.status);
  const data: ProofResponse = {
    folio: row.folio,
    proofMode: row.proofMode,
    cep: validated
      ? {
          trackingKey: row.trackingKey,
          amountCents: row.receivedCents ?? row.claimedAmountCents ?? row.amountCents,
          date: row.transferDate,
          senderBank: row.senderBank,
          senderName: row.cepSenderName,
          beneficiaryName: business.speiBeneficiaryName,
        }
      : null,
    imageUrl: row.proofKey ? await signedProofUrl(c.env, row.proofKey, new Date()) : null,
    match: await proofMatchOf(db, actor.id, row),
  };
  return c.json({ success: true, data });
}

/* cep-bundle-match D8, FR-013: the trail the lifecycle wrote, joined to the
   business's own records for the facts the panel shows — the credit day
   and time, the amount, the bank and the last four digits of the sender's
   account. Tenant-scoped like every read here: records are looked up
   under the actor's business only (constitution V). */
async function proofMatchOf(
  db: DrizzleD1Database,
  businessId: string,
  row: typeof payments.$inferSelect,
): Promise<ProofMatch | null> {
  if (!row.matchTrail) return null;
  const trail = JSON.parse(row.matchTrail) as MatchTrail;
  const records = await recordsFor(
    db,
    businessId,
    trail.candidates.filter((c) => c.cepId).map((c) => c.clave),
  );
  const byClave = new Map(records.map((r) => [r.clave, r]));
  return {
    source: trail.source,
    decided: trail.decided,
    by: trail.by ?? null,
    reason: trail.reason ?? null,
    distanceS: row.matchDistanceS,
    receipt: { time: trail.receipt?.time ?? null, tail: trail.receipt?.tail ?? null },
    candidates: trail.candidates.map((c) => {
      const record = c.cepId ? byClave.get(c.clave) : undefined;
      return {
        clave: c.clave,
        creditDate: record?.creditDate ?? null,
        creditTime: record?.creditTime ?? c.creditTime ?? null,
        amountCents: record?.amountCents ?? null,
        senderBank: record?.senderBank ?? null,
        senderTail: record ? shownTail(record, trail.receipt?.tail) : (c.tail ?? null),
        fate: c.fate,
        why: c.why ?? null,
      };
    }),
  };
}

/* payments-and-classes D5: an operator puts a failed reconnection back
   in the queue — next attempt now — touching neither the payment nor the
   credit. The sweep does the rest with the idempotency it already has
   (TD-009's invoice guard); the attempt counter is spent, so one click
   buys exactly one fresh attempt. */
/* integrations-hub D5: "Ejecutar ahora" — dispatch exactly what the
   gate recorded, one row, one human look. The registered amount and the
   invoice are the verdict's own (TD-009's guard); the outcome leaves
   `observation` through the real queue. Only observation rows qualify:
   a `withheld` row's threshold is the owner's law (no bypass). */
export async function executeAction(c: Ctx, id: string) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const { actor, db } = ctx;

  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, id), eq(payments.businessId, actor.id), realOnly(payments)));
  if (!row) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  if (row.actionOutcome !== "observation") {
    return c.json({ success: false, error: { code: "NOT_OBSERVED" } }, 409);
  }
  const integration = await integrationOf(db, actor.id);
  if (!integration?.apiKey) {
    return c.json({ success: false, error: { code: "NOT_CONFIGURED" } }, 409);
  }

  const updated = await dispatchObserved(c, db, actor, row, integration, new Date());
  /* the registration just changed what WispHub owes this tenant's
     screen — and `paymentRegisteredAt` above is the display cache's own
     key (presence-freshness D6), so nothing else has to be told */
  return c.json({
    success: true,
    data: {
      actionOutcome: updated.actionOutcome ?? "queued",
      nextAttemptAt: updated.nextAttemptAt?.getTime() ?? null,
    },
  });
}

/* integrations-hub D5: dispatch exactly what the gate recorded — the
   hypothesis, the registered amount and the invoice are the verdict's
   own. Shared by "Ejecutar ahora" and, since receipt-triage D31, by the
   accept of a held payment, which the gate held in the same shape. */
async function dispatchObserved(
  c: Ctx,
  db: DrizzleD1Database,
  /* The actor's business — its timezone rides along for WispHub's
     dates (bug: wisphub-payment-utc-time) */
  business: { id: string; timezone: string },
  row: typeof payments.$inferSelect,
  integration: Integration,
  now: Date,
  extra: Partial<typeof payments.$inferInsert> = {},
) {
  const actorId = business.id;
  const { action, reconnect } = parseHypothesis(
    row.observedAction ?? "register_and_reconnect:reconnect",
  );
  await recordDispatch(db, {
    businessId: actorId,
    integrationId: integration.id,
    paymentId: row.id,
    class: row.reconciliationClass ?? "exact",
    action,
  });
  const attempt = await attemptReconnection(
    wisphubFor(integration, c.env),
    business,
    { usuario: row.customerUsuario ?? "", wisphubId: row.wisphubCustomerId ?? "" },
    row.registeredCents ?? 0,
    now,
    { invoiceId: row.wisphubInvoiceId, paymentRegistered: row.paymentRegisteredAt !== null },
    reconnect,
  );
  const schedule = firstAttemptSchedule(attempt, now);
  const outcome = outcomeOf(attempt.status, action);
  if (outcome !== "queued") {
    await settleDispatch(db, row.id, "acked", null, now);
  }
  const [updated] = await db
    .update(payments)
    .set({
      actionOutcome: outcome,
      actionAttempts: schedule.attempts,
      wisphubInvoiceId: attempt.invoiceId,
      paymentRegisteredAt: attempt.paymentRegistered ? (row.paymentRegisteredAt ?? now) : null,
      nextAttemptAt: schedule.nextAttemptAt,
      actionError: attempt.error,
      ...(outcome === "done" ? { actionDoneAt: now } : {}),
      ...extra,
    })
    .where(eq(payments.id, row.id))
    .returning();
  return updated;
}

/* receipt-triage D31 (contracts/review.md) — the business decides on a
   payment the lifecycle held: Banxico confirmed a transfer paid to an
   account the business had removed (FR-020a), or one found by reference
   whose CEP carried no clave while the provider could not say whether it
   was validated before (FR-006). Only a `review` row qualifies.

   `accept` settles it exactly as an accepted observation does: a panel
   payment dispatches what the gate recorded, now ("Ejecutar ahora"'s own
   path) — or, when the business keeps its actions in observation, joins
   the observation rows it already reviews by hand; with no WispHub key it
   waits in the queue as any queued action does. An API payment closes its
   one-time link and announces its verdict now, which is the webhook the
   hold kept back.

   `reject` says the money is not this business's: `invalid`,
   `REJECTED_BY_BUSINESS`, no action — and an API link hears `invalid`.
   Both record who decided and when. */
export async function reviewDecision(c: Ctx, id: string, body: ReviewDecisionRequest) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const { actor, db } = ctx;

  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, id), eq(payments.businessId, actor.id), realOnly(payments)));
  if (!row) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  if (row.actionOutcome !== "review") {
    return c.json({ success: false, error: { code: "NOT_REVIEWABLE" } }, 409);
  }
  const [link] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, row.paymentLinkId));
  const now = new Date();
  const decided = { reviewedBy: actor.userId, reviewedAt: now };
  const announce = async (payment: typeof payments.$inferSelect) => {
    if (link?.source === "api") {
      await enqueueAndDeliver(c.env, db, { payment, link: link as ApiLink, now }, deferOf(c));
    }
  };

  let updated: typeof payments.$inferSelect;
  if (body.decision === "reject") {
    [updated] = await db
      .update(payments)
      .set({ ...decided, status: "invalid", lastError: "REJECTED_BY_BUSINESS", actionOutcome: null, nextAttemptAt: null })
      .where(eq(payments.id, row.id))
      .returning();
    await announce(updated);
  } else if (link?.source === "api") {
    /* automated-collections-api FR-027: a confirmed verdict closes a
       one-time link — held until now, closed now */
    if (row.status === "confirmed" && link.mode === "one_time") {
      await db
        .update(paymentLinks)
        .set({ closedAt: now })
        .where(and(eq(paymentLinks.id, link.id), isNull(paymentLinks.closedAt)));
    }
    [updated] = await db
      .update(payments)
      .set({ ...decided, actionOutcome: null })
      .where(eq(payments.id, row.id))
      .returning();
    await announce(updated);
    /* The delivery writes the outcome it reached (D8); re-read it */
    [updated] = await db.select().from(payments).where(eq(payments.id, row.id));
  } else {
    const integration = await integrationOf(db, actor.id);
    if (integration?.apiKey && integration.actionsEnabled) {
      updated = await dispatchObserved(c, db, actor, row, integration, now, decided);
    } else {
      [updated] = await db
        .update(payments)
        .set({
          ...decided,
          ...(integration?.apiKey
            ? /* integrations-hub D4: the business's own gate still
                 holds — accepted money joins the rows it executes by hand */
              { actionOutcome: "observation" as const }
            : /* no key: queued, and the queue waits for Configuración */
              { actionOutcome: "queued" as const, nextAttemptAt: now }),
        })
        .where(eq(payments.id, row.id))
        .returning();
    }
  }

  const data: ReviewDecisionResponse = { status: updated.status, actionOutcome: updated.actionOutcome };
  return c.json({ success: true, data });
}

export async function retryAction(c: Ctx, id: string) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const { actor, db } = ctx;

  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, id), eq(payments.businessId, actor.id), realOnly(payments)));
  if (!row) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  if (row.actionOutcome !== "failed") {
    return c.json({ success: false, error: { code: "NOT_RETRYABLE" } }, 409);
  }
  const now = new Date();

  /* automated-collections-api D8/FR-029: an API payment's mapped action
     IS its verdict's webhook, so "Reintentar" on one re-sends that
     delivery (FR-041 from the panel) — same event id, same body — and
     never queues it for WispHub, whatever the business has connected.
     The row says which kind it is: an API payment carries the caller's
     reference and no WispHub customer. */
  if (row.customerRef !== null && row.wisphubCustomerId === null) {
    const [delivery] = await db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.paymentId, row.id), eq(webhookDeliveries.status, "failed")))
      .orderBy(desc(webhookDeliveries.createdAt));
    if (!delivery || !isVerdictEvent(delivery.eventType as WebhookEventType)) {
      return c.json({ success: false, error: { code: "NOT_RETRYABLE" } }, 409);
    }
    const requeued = await requeueDelivery(db, delivery, now);
    const defer = deferOf(c);
    if (defer) {
      defer(
        attemptDelivery(c.env, db, requeued, now).catch((e) => {
          console.error(`webhook re-send ${requeued.id} failed:`, e);
        }),
      );
    }
    return c.json({ success: true, data: { actionOutcome: "queued" as const, nextAttemptAt: now.getTime() } });
  }

  /* integrations-hub D6: the operator's retry is a NEW dispatch
     decision — its own ledger row, acked by the sweep's terminal. */
  const integration = await integrationOf(db, actor.id);
  if (integration) {
    await recordDispatch(db, {
      businessId: actor.id,
      integrationId: integration.id,
      paymentId: row.id,
      class: row.reconciliationClass ?? "exact",
      action: "register_and_reconnect",
    });
  }
  const [updated] = await db
    .update(payments)
    .set({ actionOutcome: "queued", nextAttemptAt: now })
    .where(eq(payments.id, row.id))
    .returning();
  return c.json({
    success: true,
    data: {
      actionOutcome: updated.actionOutcome ?? "queued",
      nextAttemptAt: updated.nextAttemptAt?.getTime() ?? null,
    },
  });
}

/* GET /payments/pulse (presence-freshness D5): when WispHub last learned
   about a payment of this tenant. Cobros polls it — one D1 read, never
   the provider — and re-reads its list when the number moves. */
export async function paymentsPulse(c: Ctx) {
  const guard = businessGuard(c);
  if ("error" in guard) return guard.error;
  const version = await pendingVersion(guard.db, guard.actor.id);
  const data: PulseResponse = { registeredAt: version || null };
  return c.json({ success: true, data });
}

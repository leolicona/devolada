import type { Context } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../../env";
import { paymentLinks } from "../../../db/schema";
import { channelGap, isUniqueViolation, validationAvailable } from "../../../direct-payments/validation";
import { isApiLink, linkState, makeLinkToken, type ApiLink } from "../../../direct-payments/links";
import { fail, ok, type V1Notice } from "../envelope";
import type { CreatePaymentLinkRequest, PatchPaymentLinkRequest, PaymentLink } from "./schema";

/* POST/PATCH/GET /v1/payment-links (automated-collections-api US1, FR-006
   – FR-011, FR-027, FR-030 – FR-033). The caller is the business's own
   software (`apiClient`, set by requireApiCredential); every query below
   filters by its business (constitution V), and a link of another
   business answers NOT_FOUND exactly like one that never existed. */

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* Public ids carry a prefix so a caller reading a log can tell a link
   from a payment at a glance (contracts/public-api.md: `lnk_`, `pay_`).
   The row's default id is a bare UUID; this one is minted here. */
function makeLinkId(): string {
  return `lnk_${crypto.randomUUID().replace(/-/g, "")}`;
}

/* FR-009: the platform's own gap rides the answer as a notice, never as
   a refusal — the business did nothing wrong and the link is theirs. */
function notices(env: Bindings): V1Notice[] {
  return validationAvailable(env) ? [] : [{ code: "VALIDATION_UNAVAILABLE" }];
}

function toPublic(c: Ctx, link: ApiLink, now: Date): PaymentLink {
  return {
    id: link.id,
    url: `${c.env.PAGO_BASE_URL}/p/${link.token}`,
    customerRef: link.customerRef,
    askCents: link.askCents,
    mode: link.mode,
    expiresAt: link.expiresAt?.getTime() ?? null,
    state: linkState(link, now),
    closedAt: link.closedAt?.getTime() ?? null,
    label: link.label,
    concept: link.concept,
    isTest: link.isTest,
    createdAt: link.createdAt.getTime(),
    notices: notices(c.env),
  };
}

/* One link of this business, in this credential's mode (research D12: a
   test credential reads test links and a real one reads real links —
   the same string under the other mode does not exist for this caller). */
async function ownLink(c: Ctx, id: string): Promise<ApiLink | null> {
  const { businessId, isTest } = c.get("apiClient");
  const [link] = await drizzle(c.env.DB)
    .select()
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.id, id),
        eq(paymentLinks.businessId, businessId),
        eq(paymentLinks.source, "api"),
        eq(paymentLinks.isTest, isTest),
      ),
    );
  return link && isApiLink(link) ? link : null;
}

export async function createPaymentLink(c: Ctx, body: CreatePaymentLinkRequest) {
  const { businessId, isTest, business } = c.get("apiClient");
  const db = drizzle(c.env.DB);
  const now = new Date();

  /* FR-009 / research D5: only what the business itself can fix is a
     refusal, and it names the piece. A link that would show an empty
     CLABE is never created. */
  const gap = channelGap(business);
  if (gap) return fail(c, "CHANNEL_UNAVAILABLE", gap);

  const values = {
    id: makeLinkId(),
    businessId,
    token: makeLinkToken(),
    source: "api" as const,
    mode: body.mode,
    customerRef: body.customerRef,
    askCents: body.askCents,
    label: body.label ?? null,
    concept: body.concept ?? null,
    expiresAt: body.expiresAt !== undefined ? new Date(body.expiresAt) : null,
    isTest,
  };

  let link;
  try {
    [link] = await db.insert(paymentLinks).values(values).returning();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    /* FR-033 / research D4: a reusable link is unique per business and
       customer reference, and the partial unique index is what makes two
       racing creates yield one row. Asking again returns the one that
       exists — never an error, never a second link. The index spans both
       credential modes (one namespace per business), so the row it
       protects may belong to the other mode; that is the one case named
       back to the caller, because "not found" would send it in circles. */
    const [existing] = await db
      .select()
      .from(paymentLinks)
      .where(
        and(
          eq(paymentLinks.businessId, businessId),
          eq(paymentLinks.source, "api"),
          eq(paymentLinks.mode, "reusable"),
          eq(paymentLinks.customerRef, body.customerRef),
        ),
      );
    if (!existing || !isApiLink(existing)) throw e;
    if (existing.isTest !== isTest) {
      return fail(
        c,
        "VALIDATION_ERROR",
        `customerRef already holds a reusable link under a ${existing.isTest ? "test" : "real"} credential`,
      );
    }
    return ok(c, toPublic(c, existing, now), 200);
  }
  if (!isApiLink(link)) throw new Error(`link ${link.id} was written without its API columns`);
  return ok(c, toPublic(c, link, now), 201);
}

export async function patchPaymentLink(c: Ctx, id: string, body: PatchPaymentLinkRequest) {
  const db = drizzle(c.env.DB);
  const now = new Date();
  const link = await ownLink(c, id);
  if (!link) return fail(c, "NOT_FOUND");

  const patch: Partial<typeof paymentLinks.$inferInsert> = {};
  if (body.askCents !== undefined) {
    /* FR-030 is about reusable links: a one-time link's amount is the
       thing it is, and a paid or expired one has nothing left to price. */
    if (link.mode !== "reusable") return fail(c, "VALIDATION_ERROR", "askCents can only change on a reusable link");
    if (linkState(link, now) !== "open") return fail(c, "LINK_CLOSED");
    patch.askCents = body.askCents;
  }
  if (body.close) {
    /* The data model's invariant (schema.ts): a reusable link is always
       open — its `closed_at` stays null, so the state vocabulary has no
       word for a closed one. Closing one is refused rather than written
       as a state the readers would then misname. Idempotent on a
       one-time link: closing a paid or expired link changes nothing —
       an expired link keeps reading `expired`, which is what happened. */
    if (link.mode !== "one_time") return fail(c, "VALIDATION_ERROR", "close applies to a one_time link; a reusable link stays open");
    if (linkState(link, now) === "open") patch.closedAt = now;
  }

  if (Object.keys(patch).length === 0) return ok(c, toPublic(c, link, now));
  const [updated] = await db
    .update(paymentLinks)
    .set(patch)
    .where(eq(paymentLinks.id, link.id))
    .returning();
  if (!isApiLink(updated)) throw new Error(`link ${link.id} lost its API columns on update`);
  return ok(c, toPublic(c, updated, now));
}

export async function getPaymentLink(c: Ctx, id: string) {
  const link = await ownLink(c, id);
  if (!link) return fail(c, "NOT_FOUND");
  return ok(c, toPublic(c, link, new Date()));
}

/* A reference with no link answers an empty list, never NOT_FOUND — the
   same rule US3 sets for payments (FR-019). */
export async function listPaymentLinks(c: Ctx, customerRef: string) {
  const { businessId, isTest } = c.get("apiClient");
  const now = new Date();
  const rows = await drizzle(c.env.DB)
    .select()
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.businessId, businessId),
        eq(paymentLinks.source, "api"),
        eq(paymentLinks.isTest, isTest),
        eq(paymentLinks.customerRef, customerRef),
      ),
    )
    .orderBy(desc(paymentLinks.createdAt));
  return ok(c, { links: rows.filter(isApiLink).map((link) => toPublic(c, link, now)) });
}

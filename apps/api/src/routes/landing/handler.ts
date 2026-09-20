import type { Context } from "hono";
import { and, desc, eq, lt, or, sql, gte, lte, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";
import type { Bindings, Variables } from "../../env";
import { accessRequests, landingCounts } from "../../db/schema";
import { sendAccessRequestNotice } from "../../email/sender";
import { deferOf } from "../defer";
import {
  CHANNEL_PATTERN,
  type AccessRequestBody,
  type AccessRequestList,
  type AccessRequestListQuery,
  type LandingCounts,
  type LandingCountsQuery,
  type LandingEventBody,
  type Step,
} from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;
type Db = ReturnType<typeof drizzle>;

/* landing-page D8: the platform's own "today". The business's timezone owns
   the business's counts (constitution II); the platform's counts take the
   platform's — Mexico City's calendar day, as YYYY-MM-DD. en-CA is the one
   locale whose short date is already that shape. */
const PLATFORM_TIMEZONE = "America/Mexico_City";
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: PLATFORM_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dayInMexicoCity(now: Date = new Date()): string {
  return dayFormat.format(now);
}

/* The calendar day `days` before an ISO date — pure arithmetic on the
   date, no zone: the zone entered when the day was named. */
function daysBefore(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/* landing-page D4: the tag as typed when it matches the charset, `direct`
   otherwise — absent, empty (the form's hidden input before the Worker
   fills it) or anything a stranger put in the address. Never a reason to
   refuse. */
export function channelOrDirect(value: unknown): string {
  return typeof value === "string" && CHANNEL_PATTERN.test(value) ? value : "direct";
}

/* One statement per event: INSERT … ON CONFLICT DO UPDATE SET count + 1 on
   the (day, channel, step) key — no read-modify-write (D8). */
async function countStep(db: Db, day: string, channel: string, step: Step): Promise<void> {
  await db
    .insert(landingCounts)
    .values({ day, channel, step, count: 1 })
    .onConflictDoUpdate({
      target: [landingCounts.day, landingCounts.channel, landingCounts.step],
      set: { count: sql`${landingCounts.count} + 1` },
    });
}

/* landing-page D6: which of the two answers this request wants. The page's
   script sends JSON and reads the envelope; the HTML form, when no script
   runs, posts urlencoded and needs a page to land on. */
const wantsPage = (c: Ctx) => !(c.req.header("content-type") ?? "").toLowerCase().includes("application/json");

/* The refusal, in whichever shape the caller can read (D6, D9): the
   envelope with a bare code for a program (constitution III), a 303 to the
   landing's outcome page for a browser — when LANDING_BASE_URL says where
   that is; unset, the envelope again (constitution VIII). The router's
   validator and the limiter call this too, so every refusal of a form post
   lands on a page. */
export function refuseAccessRequest(
  c: Ctx,
  code: "VALIDATION_ERROR" | "REQUEST_REFUSED" | "TOO_MANY_REQUESTS",
  status: 400 | 429 = 400,
): Response {
  const base = c.env.LANDING_BASE_URL;
  if (base && wantsPage(c)) return c.redirect(`${base}/no-enviada?motivo=${code}`, 303);
  return c.json({ success: false, error: { code } }, status);
}

/* POST /landing/requests (landing-page D4, D6, D8, D9, D10, D23) */
export async function postAccessRequest(c: Ctx, body: AccessRequestBody): Promise<Response> {
  /* D9: a person never sees the `website` field; a value in it is a machine */
  if (body.website) return refuseAccessRequest(c, "REQUEST_REFUSED");

  const channel = channelOrDirect(body.channel);
  const db = drizzle(c.env.DB);
  const [row] = await db
    .insert(accessRequests)
    .values({
      whatsapp: body.whatsapp,
      /* "" is the closing form's field left blank — stored as nothing */
      name: body.name || null,
      billingSystem: body.billingSystem || null,
      form: body.form,
      channel,
    })
    .returning({ id: accessRequests.id, createdAt: accessRequests.createdAt });

  /* D8: `sent` is exact by construction — the API counts it, never the page */
  await countStep(db, dayInMexicoCity(row.createdAt), channel, "sent");

  /* D10: one attempt at the notice, past the answer when a Worker context
     exists, inline when none does (a test calling app.request without one
     — the same arrangement the webhook path uses). The outcome is written
     on the row either way; nothing retries. */
  const notice = sendAccessRequestNotice(c.env, {
    whatsapp: body.whatsapp,
    name: body.name || null,
    billingSystem: body.billingSystem || null,
    form: body.form,
    channel,
  }).then((outcome) =>
    db
      .update(accessRequests)
      .set("notifiedAt" in outcome ? { notifiedAt: new Date(outcome.notifiedAt) } : { notifyError: outcome.error })
      .where(eq(accessRequests.id, row.id)),
  );
  const defer = deferOf(c);
  if (defer) defer(notice);
  else await notice;

  const base = c.env.LANDING_BASE_URL;
  if (base && wantsPage(c)) return c.redirect(`${base}/gracias`, 303);
  return c.json({ success: true, data: { id: row.id, receivedAt: row.createdAt.getTime() } });
}

/* POST /landing/events (D8): one counter, no person */
export async function postLandingEvent(c: Ctx, body: LandingEventBody): Promise<Response> {
  await countStep(drizzle(c.env.DB), dayInMexicoCity(), channelOrDirect(body.channel), body.step);
  return c.json({ success: true, data: { counted: true } });
}

/* The list's cursor: the last row's (created_at, id), base64 so the panel
   treats it as opaque. */
const encodeCursor = (createdAt: number, id: string) => btoa(`${createdAt}|${id}`);
function decodeCursor(cursor: string): { createdAt: number; id: string } | null {
  try {
    const [ms, id] = atob(cursor).split("|");
    const createdAt = Number(ms);
    return Number.isFinite(createdAt) && id ? { createdAt, id } : null;
  } catch {
    return null;
  }
}

/* GET /platform/landing/requests (FR-017, D23): newest first, every answer
   as typed, and `repeated` for a row whose WhatsApp another row carries —
   computed in the query, so a page of 200 binds no list of numbers (D1's
   100-parameter cap, db/params.ts). */
export async function listAccessRequests(c: Ctx, query: AccessRequestListQuery): Promise<Response> {
  const db = drizzle(c.env.DB);
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !after) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);

  /* Written out by hand, both sides aliased: in a one-table select drizzle
     renders a column as a bare "whatsapp", which inside the correlated
     subquery binds to the inner row — every row was its own twin
     (measured 2026-09-20). The outer table carries the alias too. */
  const a = alias(accessRequests, "a");
  const repeated = sql<number>`exists(select 1 from access_requests as o where o.whatsapp = a.whatsapp and o.id <> a.id)`;
  const rows = await db
    .select({
      id: a.id,
      whatsapp: a.whatsapp,
      name: a.name,
      billingSystem: a.billingSystem,
      form: a.form,
      channel: a.channel,
      createdAt: a.createdAt,
      notifiedAt: a.notifiedAt,
      notifyError: a.notifyError,
      repeated,
    })
    .from(a)
    .where(
      after
        ? or(lt(a.createdAt, new Date(after.createdAt)), and(eq(a.createdAt, new Date(after.createdAt)), lt(a.id, after.id)))
        : undefined,
    )
    .orderBy(desc(a.createdAt), desc(a.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const data: AccessRequestList = {
    items: page.map((r) => ({
      id: r.id,
      whatsapp: r.whatsapp,
      name: r.name,
      billingSystem: r.billingSystem,
      form: r.form,
      repeated: Boolean(r.repeated),
      channel: r.channel,
      createdAt: r.createdAt.getTime(),
      notifiedAt: r.notifiedAt ? r.notifiedAt.getTime() : null,
      notifyError: r.notifyError,
    })),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt.getTime(), last.id) : null,
  };
  return c.json({ success: true, data });
}

/* GET /platform/landing/counts (FR-023, FR-024, D8): the rows for an
   inclusive range of Mexico City days, default the last 30. The admin
   computes the shares. */
export async function getLandingCounts(c: Ctx, query: LandingCountsQuery): Promise<Response> {
  const to = query.to ?? dayInMexicoCity();
  const from = query.from ?? daysBefore(to, 29);
  if (from > to) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  const rows = await drizzle(c.env.DB)
    .select({
      day: landingCounts.day,
      channel: landingCounts.channel,
      step: landingCounts.step,
      count: landingCounts.count,
    })
    .from(landingCounts)
    .where(and(gte(landingCounts.day, from), lte(landingCounts.day, to)))
    .orderBy(asc(landingCounts.day), asc(landingCounts.channel), asc(landingCounts.step));
  const data: LandingCounts = { from, to, rows };
  return c.json({ success: true, data });
}

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { app, seedBusiness, sessionCookieHeader } from "./helpers";
import { integrations, paymentLinks, wisphubPages, wisphubSweeps } from "../src/db/schema";
import { resetProviderCaches } from "../src/wisphub/cache";
import { ROSTER_LIVE_PAGES } from "../src/wisphub/client";
import { REST_MS, SWEEP_PAGES, sweepWispHubLists, wakeSweep } from "../src/wisphub/snapshot";
import type { Bindings } from "../src/env";

/* bug: links-roster-cap — the Links roster read ten pages of 100 and
   stopped, so a 6,509-customer ISP saw 1,000 customers with a link and
   5,509 without one. The fix reads such a tenant in the background, on
   the sweep the invoice cap built, and creates each page's links as it
   lands. WispHub is fetch-mocked at its origin; the sweep is driven by
   hand. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const WISPHUB_IO = "https://api.wisphub.io";
const testEnv = env as typeof env & Bindings;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(() => resetProviderCaches());
afterEach(() => fetchMock.assertNoPendingInterceptors());

const json = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

/* One hundred customers, ids and usuarios climbing with the page */
const customers = (page: number) =>
  Array.from({ length: 100 }, (_, k) => {
    const n = page * 100 + k + 1;
    return {
      id_servicio: n,
      usuario: `cliente${n}@wifiplus`,
      nombre: `Cliente ${n}`,
      telefono: "5512345678",
      estado: "Activo",
      estado_facturas: "Pagadas",
      precio_plan: "499.00",
      saldo: "0.00",
      zona: { nombre: "Centro" },
    };
  });

/* The tenant's customer list as WispHub pages it: page k answers at
   `offset=k*100` and points at the next; the last says `next: null`.
   `to` stops the mocks short so a walk that reads that far is cut off. */
function mockPages(
  pages: unknown[][],
  opts: { from?: number; to?: number; last?: boolean; origin?: string } = {},
) {
  const origin = opts.origin ?? WISPHUB_ORIGIN;
  const from = opts.from ?? 0;
  const to = opts.to ?? pages.length;
  for (let i = from; i < to; i++) {
    const isLast = i === pages.length - 1 && (opts.last ?? true);
    fetchMock
      .get(origin)
      .intercept({
        method: "GET",
        path: (p) =>
          p.startsWith("/api/clientes/?") &&
          p.includes("limit=100") &&
          (i === 0 ? !p.includes("offset=") : new RegExp(`[?&]offset=${i * 100}(&|$)`).test(p)),
      })
      .reply(
        ...json({
          next: isLast ? null : `http://${new URL(origin).host}/api/clientes/?limit=100&offset=${(i + 1) * 100}`,
          count: pages.length * 100,
          results: pages[i],
        }),
      );
  }
}

const pagesOf = (n: number) => Array.from({ length: n }, (_, p) => customers(p));
/* One more page than the live budget: the read is cut off at 1,000 */
const ELEVEN = ROSTER_LIVE_PAGES + 1;

const asBusiness = async () => ({ headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } });
const roster = async () => (await app()).request("/direct-payments/links/roster", await asBusiness(), testEnv);
const pagedLinks = async () => (await app()).request("/direct-payments/links", await asBusiness(), testEnv);

const sweepRow = async (businessId: string, kind: "pending" | "roster") =>
  (
    await drizzle(env.DB)
      .select()
      .from(wisphubSweeps)
      .where(and(eq(wisphubSweeps.businessId, businessId), eq(wisphubSweeps.kind, kind)))
  )[0];
const linkCount = async (businessId: string) =>
  (await drizzle(env.DB).select().from(paymentLinks).where(eq(paymentLinks.businessId, businessId))).length;

describe("bug: links-roster-cap — a cut-off roster read starts the background read", () => {
  it("eleven pages: the roster says incomplete with 1,000 rows, and wakes the roster sweep alone", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockPages(pagesOf(ELEVEN), { to: ROSTER_LIVE_PAGES, last: false });

    const res = await roster();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.complete).toBe(false);
    expect(data.results).toHaveLength(1000);

    const row = await sweepRow(business.id, "roster");
    expect(row).toBeDefined();
    expect(row.restUntil).toBeNull();
    expect(row.servedPassId).toBeNull();
    expect(await sweepRow(business.id, "pending")).toBeUndefined();
  });

  it("a tenant that fits stays live and cached: one page, complete, no sweep row", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockPages([customers(0)]);

    const { data } = await (await roster()).json();
    expect(data.complete).toBe(true);
    expect(data.results).toHaveLength(100);
    expect(await sweepRow(business.id, "roster")).toBeUndefined();
    expect(await linkCount(business.id)).toBe(100);
  });
});

describe("bug: links-roster-cap — the sweep reads the tenant whole and the roster serves it", () => {
  it("two ticks read eleven pages; the roster answers complete with 1,100 rows, each with its link", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const now = new Date();
    await wakeSweep(drizzle(env.DB), business.id, "roster", `${WISPHUB_ORIGIN}/api`, now);
    const pages = pagesOf(ELEVEN);

    mockPages(pages, { to: SWEEP_PAGES, last: false });
    expect(await sweepWispHubLists(testEnv, now)).toMatchObject({ lists: 1, pages: SWEEP_PAGES, finished: 0, failed: 0 });
    /* links are created as pages land — a thousand exist before anybody
       opens the Links tab */
    expect(await linkCount(business.id)).toBe(1000);

    const later = new Date(now.getTime() + 60_000);
    mockPages(pages, { from: SWEEP_PAGES });
    expect(await sweepWispHubLists(testEnv, later)).toMatchObject({ lists: 1, pages: 1, finished: 1, failed: 0 });
    const row = await sweepRow(business.id, "roster");
    expect(row.servedPages).toBe(ELEVEN);
    /* past the live budget: read again at once, never rests */
    expect(row.restUntil).toBeNull();

    /* the roster reads the snapshot: no /clientes/ mock is registered,
       so a live read here would fail the request */
    const res = await roster();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.complete).toBe(true);
    expect(data.results).toHaveLength(ELEVEN * 100);
    expect(data.results.every((r: { url: string }) => /\/p\/[A-Za-z0-9]+$/.test(r.url))).toBe(true);
    expect(data.readAt).toBe(row.servedFinishedAt!.getTime());
    expect(await linkCount(business.id)).toBe(ELEVEN * 100);

    /* a second read creates nothing and keeps every token */
    const first = new Map((data.results as { usuario: string; url: string }[]).map((r) => [r.usuario, r.url]));
    const again = (await (await roster()).json()).data.results as { usuario: string; url: string }[];
    expect(again).toHaveLength(ELEVEN * 100);
    expect(again.every((r) => first.get(r.usuario) === r.url)).toBe(true);
    expect(await linkCount(business.id)).toBe(ELEVEN * 100);
  });

  it("the paged links door lists the whole tenant too, not the first 1,000", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const now = new Date();
    await wakeSweep(drizzle(env.DB), business.id, "roster", `${WISPHUB_ORIGIN}/api`, now);
    const pages = pagesOf(ELEVEN);
    mockPages(pages, { to: SWEEP_PAGES, last: false });
    await sweepWispHubLists(testEnv, now);
    mockPages(pages, { from: SWEEP_PAGES });
    await sweepWispHubLists(testEnv, new Date(now.getTime() + 60_000));

    const res = await pagedLinks();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.links).toHaveLength(50);
    expect(data.nextCursor).not.toBeNull();
    expect(await linkCount(business.id)).toBe(ELEVEN * 100);
  });

  it("both lists on one tenant keep their own cursors and swap on their own", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const now = new Date();
    const db = drizzle(env.DB);
    await wakeSweep(db, business.id, "pending", `${WISPHUB_ORIGIN}/api`, now);
    await wakeSweep(db, business.id, "roster", `${WISPHUB_ORIGIN}/api`, now);

    /* one page of invoices, eleven of customers */
    fetchMock
      .get(WISPHUB_ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
      .reply(...json({ next: null, count: 0, results: [] }));
    const pages = pagesOf(ELEVEN);
    mockPages(pages, { to: SWEEP_PAGES, last: false });

    expect(await sweepWispHubLists(testEnv, now)).toMatchObject({ lists: 2, pages: SWEEP_PAGES + 1, finished: 1, failed: 0 });
    expect((await sweepRow(business.id, "pending")).servedPages).toBe(1);
    expect((await sweepRow(business.id, "roster")).livePages).toBe(SWEEP_PAGES);

    /* the invoice list fit the live budget and rests; the roster carries on */
    mockPages(pages, { from: SWEEP_PAGES });
    expect(await sweepWispHubLists(testEnv, new Date(now.getTime() + 60_000))).toMatchObject({ lists: 1, pages: 1, finished: 1 });
    expect((await sweepRow(business.id, "roster")).servedPages).toBe(ELEVEN);
    const stored = await db.select({ kind: wisphubPages.kind }).from(wisphubPages);
    expect(stored.filter((p) => p.kind === "roster")).toHaveLength(ELEVEN);
    expect(stored.filter((p) => p.kind === "pending")).toHaveLength(1);
  });

  it("a moved installation resets the snapshot and the next tick starts over on the new address", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const now = new Date();
    const db = drizzle(env.DB);
    await wakeSweep(db, business.id, "roster", `${WISPHUB_ORIGIN}/api`, now);
    const pages = pagesOf(ELEVEN);
    mockPages(pages, { to: SWEEP_PAGES, last: false });
    await sweepWispHubLists(testEnv, now);
    mockPages(pages, { from: SWEEP_PAGES });
    await sweepWispHubLists(testEnv, new Date(now.getTime() + 60_000));
    expect((await sweepRow(business.id, "roster")).servedPages).toBe(ELEVEN);

    /* provider-address-per-isp: the ISP picks wisphub.io */
    await db.update(integrations).set({ installation: "wisphub_io" }).where(eq(integrations.businessId, business.id));

    /* the roster no longer trusts pages read from wisphub.net: a live
       read on the new address, cut off, wakes the sweep there */
    mockPages(pagesOf(ELEVEN), { to: ROSTER_LIVE_PAGES, last: false, origin: WISPHUB_IO });
    expect((await (await roster()).json()).data.complete).toBe(false);

    /* the next tick drops the old pass and reads the new installation */
    mockPages(pagesOf(ELEVEN), { to: SWEEP_PAGES, last: false, origin: WISPHUB_IO });
    const later = new Date(now.getTime() + 120_000);
    expect(await sweepWispHubLists(testEnv, later)).toMatchObject({ lists: 1, pages: SWEEP_PAGES, finished: 0, failed: 0 });
    const row = await sweepRow(business.id, "roster");
    expect(row.baseUrl).toBe(`${WISPHUB_IO}/api`);
    expect(row.servedPassId).toBeNull();
    expect(row.livePages).toBe(SWEEP_PAGES);
  });

  it("a tenant that fits rests after its pass; a cut-off read wakes it", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const now = new Date();
    await wakeSweep(drizzle(env.DB), business.id, "roster", `${WISPHUB_ORIGIN}/api`, now);
    mockPages([customers(0)]);
    expect(await sweepWispHubLists(testEnv, now)).toMatchObject({ lists: 1, pages: 1, finished: 1 });
    let row = await sweepRow(business.id, "roster");
    expect(row.restUntil!.getTime()).toBe(now.getTime() + REST_MS);
    expect(await sweepWispHubLists(testEnv, new Date(now.getTime() + 60_000))).toMatchObject({ lists: 0 });

    /* the tenant grew past the budget: the live read is cut off and the
       rest is cleared */
    mockPages(pagesOf(ELEVEN), { to: ROSTER_LIVE_PAGES, last: false });
    expect((await (await roster()).json()).data.complete).toBe(false);
    row = await sweepRow(business.id, "roster");
    expect(row.restUntil).toBeNull();
  });
});

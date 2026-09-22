import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  linkPrunes,
  paymentLinks,
  proofRejections,
  wisphubPages,
  wisphubSweeps,
} from "../src/db/schema";
import * as prune from "../src/links/prune";
import { app, seedBusiness, seedConfirmedPayment, seedMember, sessionCookieHeader } from "./helpers";
import type { Bindings } from "../src/env";

/* links-on-demand-search US1 (FR-023, FR-024, D13): the one-time
   cleanup.

   The retired roster created a panel link for every customer of every
   tenant, on every read. This deletes the ones made before the feature
   shipped that no payment and no clave attempt ever referenced, once
   per business, and tells the business how many went.

   The boundary is a CONSTANT, never "when the pass ran": a deploy
   leaves the previous Worker serving, and that Worker still runs the
   roster, so a migration would have what it deleted recreated within
   the minute — and a boundary of "now" would delete the links FR-008
   has just created. A fixed past timestamp makes a second run a no-op
   by construction. `PRUNE_CUTOVER_MS` is 0 until the release commit
   (T057), so these tests move it themselves. */

const testEnv = env as typeof env & Bindings;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const db = () => drizzle(env.DB);
const DAY = 86_400_000;
const cutover = () => Date.now() - 7 * DAY;

/* The boundary this file tests, stated rather than reached for: the
   constant is 0 until the release commit (T057), and an ESM export
   cannot be replaced from outside anyway. */
const run = () => prune.prunePanelLinks(testEnv, { cutoverMs: cutover() });

const panelLink = async (businessId: string, over: Record<string, unknown> = {}) => {
  const [row] = await db()
    .insert(paymentLinks)
    .values({
      businessId,
      token: `tok${crypto.randomUUID().replace(/-/g, "").slice(0, 13)}`,
      wisphubCustomerId: "6",
      customerUsuario: `c${crypto.randomUUID().slice(0, 8)}@wifiplus`,
      /* Born well before the cutover unless a case says otherwise */
      createdAt: new Date(cutover() - 30 * DAY),
      ...over,
    })
    .returning();
  return row;
};

const links = (businessId: string) =>
  db().select().from(paymentLinks).where(eq(paymentLinks.businessId, businessId));

describe("US1 (FR-023): what the prune takes, and what it leaves", () => {
  it("deletes a pre-cutover panel link nobody ever used, and writes the count once", async () => {
    const business = await seedBusiness();
    await panelLink(business.id);
    await panelLink(business.id);

    const report = await run();
    expect(report).toMatchObject({ businesses: 1, links: 2 });
    expect(await links(business.id)).toHaveLength(0);

    const [row] = await db().select().from(linkPrunes).where(eq(linkPrunes.businessId, business.id));
    expect(row.deletedCount).toBe(2);
    expect(row.noticeSeen).toBe(false);
    expect(row.ranAt.getTime()).toBeGreaterThan(0);
  });

  it("keeps a link a payment references — the only durable evidence it was used", async () => {
    const business = await seedBusiness();
    const doomed = await panelLink(business.id);
    /* seedConfirmedPayment makes its own link and points a payment at it */
    await seedConfirmedPayment(business);
    await db()
      .update(paymentLinks)
      .set({ createdAt: new Date(cutover() - 30 * DAY) })
      .where(eq(paymentLinks.businessId, business.id));

    await run();
    const kept = await links(business.id);
    expect(kept.map((l) => l.id)).not.toContain(doomed.id);
    expect(kept).toHaveLength(1);
  });

  it("keeps a link a clave attempt references", async () => {
    const business = await seedBusiness();
    const attempted = await panelLink(business.id);
    await panelLink(business.id);
    await db().insert(proofRejections).values({
      businessId: business.id,
      paymentLinkId: attempted.id,
      trackingKey: "ABC123456789",
    });

    await run();
    const kept = await links(business.id);
    expect(kept.map((l) => l.id)).toEqual([attempted.id]);
  });

  it("never touches an API link, whatever its age (Edge Cases)", async () => {
    const business = await seedBusiness();
    await panelLink(business.id);
    const [api] = await db()
      .insert(paymentLinks)
      .values({
        businessId: business.id,
        token: "tokapi00000000001",
        source: "api",
        customerRef: "CLI-4471",
        askCents: 49900,
        createdAt: new Date(cutover() - 90 * DAY),
      })
      .returning();

    await run();
    expect((await links(business.id)).map((l) => l.id)).toEqual([api.id]);
  });

  it("never touches a link born after the cutover — which is every link FR-008 creates", async () => {
    const business = await seedBusiness();
    const fresh = await panelLink(business.id, { createdAt: new Date(cutover() + DAY) });

    const report = await run();
    expect(report.links).toBe(0);
    expect((await links(business.id)).map((l) => l.id)).toEqual([fresh.id]);
  });

  it("a second run deletes nothing and writes no second row (D13)", async () => {
    const business = await seedBusiness();
    await panelLink(business.id);
    await run();

    /* A link made after the pass — as the act makes them — survives it */
    const after = await panelLink(business.id, { createdAt: new Date() });
    const second = await run();
    expect(second).toMatchObject({ businesses: 0, links: 0 });
    expect((await links(business.id)).map((l) => l.id)).toEqual([after.id]);
    expect(await db().select().from(linkPrunes)).toHaveLength(1);
  });

  it("FR-024: a deleted link's token is never reissued — the next act is a NEW address", async () => {
    const business = await seedBusiness();
    const gone = await panelLink(business.id, { customerUsuario: "greyes@wifiplus" });
    await run();

    /* The customer acts again: a new row, a new token */
    const [reborn] = await db()
      .insert(paymentLinks)
      .values({
        businessId: business.id,
        token: `tok${crypto.randomUUID().replace(/-/g, "").slice(0, 13)}`,
        wisphubCustomerId: "6",
        customerUsuario: "greyes@wifiplus",
      })
      .returning();
    expect(reborn.token).not.toBe(gone.token);
    /* And the old address resolves to nothing, as any unknown token does */
    const res = await (await app()).request(`/direct-payments/links/${gone.token}`, {}, env);
    expect(res.status).toBe(404);
  });

  it("deletes the orphaned roster sweep rows D12 left behind, and leaves the pending pass alone", async () => {
    const business = await seedBusiness();
    for (const kind of ["roster", "pending"] as const) {
      const [sweep] = await db()
        .insert(wisphubSweeps)
        .values({
          businessId: business.id,
          kind,
          baseUrl: "https://api.wisphub.net/api",
          updatedAt: new Date(),
        })
        .returning();
      await db().insert(wisphubPages).values({
        businessId: business.id,
        kind,
        passId: sweep.id,
        page: 0,
        rows: "[]",
        fetchedAt: new Date(),
      });
    }

    const report = await run();
    expect(report.sweeps).toBe(1);
    expect((await db().select().from(wisphubSweeps)).map((r) => r.kind)).toEqual(["pending"]);
    expect((await db().select().from(wisphubPages)).map((r) => r.kind)).toEqual(["pending"]);
  });
});

describe("US1 (FR-023): the count reaches the business, once", () => {
  const asOwner = async () => ({ headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } });

  it("the door answers the count, then null after it is dismissed", async () => {
    const business = await seedBusiness();
    await panelLink(business.id);
    await run();

    const first = await (await app()).request("/direct-payments/prune-notice", await asOwner(), env);
    expect(first.status).toBe(200);
    expect((await first.json()).data).toMatchObject({ deletedCount: 1 });

    const dismissed = await (await app()).request(
      "/direct-payments/prune-notice/dismiss",
      { ...(await asOwner()), method: "POST", headers: { ...(await asOwner()).headers, Origin: "http://localhost:5174" } },
      env,
    );
    expect(dismissed.status).toBe(200);

    const second = await (await app()).request("/direct-payments/prune-notice", await asOwner(), env);
    expect((await second.json()).data).toBeNull();
  });

  it("a business the prune emptied nothing from is told nothing", async () => {
    await seedBusiness();
    await run();

    const res = await (await app()).request("/direct-payments/prune-notice", await asOwner(), env);
    expect((await res.json()).data).toBeNull();
  });

  it("a viewer cannot silence the record for everyone", async () => {
    const business = await seedBusiness();
    await panelLink(business.id);
    await run();
    await seedMember(business, "mirona@devolada.app", "viewer");

    const cookie = await sessionCookieHeader("mirona@devolada.app");
    /* They may READ it — it is their business's record too */
    const read = await (await app()).request("/direct-payments/prune-notice", { headers: { Cookie: cookie } }, env);
    expect(read.status).toBe(200);
    expect((await read.json()).data).toMatchObject({ deletedCount: 1 });

    const res = await (await app()).request(
      "/direct-payments/prune-notice/dismiss",
      { method: "POST", headers: { Cookie: cookie, Origin: "http://localhost:5174" } },
      env,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_FOR_ROLE");

    /* And it is still there for the owner */
    const still = await (await app()).request("/direct-payments/prune-notice", await asOwner(), env);
    expect((await still.json()).data).toMatchObject({ deletedCount: 1 });
  });
});

/* The sequence the release actually takes (links-on-demand-search D13,
   tasks T057).

   Every case above states its own boundary, which proves the pass is
   right ONCE the constant is right. This one asks the question those
   cannot: what does the pass do between the deploy and the release
   commit, while `PRUNE_CUTOVER_MS` is still unset?

   That window is not hypothetical — it is every deploy of this feature
   before its own release, dev included. The pass runs on the
   every-minute cron from the moment the code lands, and the row it
   writes is the ONLY thing that stops it running again. So a row
   written in this window would spend the business's one and only pass
   on a cutover that deletes nothing, and T057 would set the real
   timestamp to find no business left to prune. FR-023 would be
   unreachable, silently, and the count the business is owed would be
   zero forever.

   Hence the rule this file now pins: while the cutover is unset, the
   pass writes NOTHING. It has not run. */
describe("US1 (FR-023): the pass keeps its one shot until the cutover is set", () => {
  it("deletes nothing and writes NO row while PRUNE_CUTOVER_MS is unset", async () => {
    const business = await seedBusiness();
    const old = await panelLink(business.id);

    /* No `cutoverMs`: the constant as it actually ships */
    const report = await prune.prunePanelLinks(testEnv);
    expect(prune.PRUNE_CUTOVER_MS).toBe(0);
    expect(report).toMatchObject({ businesses: 0, links: 0, sweeps: 0 });

    expect((await links(business.id)).map((l) => l.id)).toEqual([old.id]);
    /* The one that matters: no ledger row, so the pass is still owed */
    expect(await db().select().from(linkPrunes)).toHaveLength(0);
  });

  it("still prunes at the release commit, after ticking unset for a while", async () => {
    const business = await seedBusiness();
    await panelLink(business.id);
    await panelLink(business.id);

    /* The cron ticking between the deploy and the release */
    for (let tick = 0; tick < 3; tick++) await prune.prunePanelLinks(testEnv);
    expect(await db().select().from(linkPrunes)).toHaveLength(0);

    /* T057 sets the real ship timestamp and the pass finds its work */
    const report = await run();
    expect(report).toMatchObject({ businesses: 1, links: 2 });
    expect(await links(business.id)).toHaveLength(0);

    const [row] = await db().select().from(linkPrunes).where(eq(linkPrunes.businessId, business.id));
    expect(row.deletedCount).toBe(2);
  });

  it("an orphaned roster sweep row survives the unset window too", async () => {
    const business = await seedBusiness();
    const [sweep] = await db()
      .insert(wisphubSweeps)
      .values({
        businessId: business.id,
        kind: "roster",
        baseUrl: "https://api.wisphub.net/api",
        updatedAt: new Date(),
      })
      .returning();
    await db().insert(wisphubPages).values({
      businessId: business.id,
      kind: "roster",
      passId: sweep.id,
      page: 0,
      rows: "[]",
      fetchedAt: new Date(),
    });

    await prune.prunePanelLinks(testEnv);
    expect(await db().select().from(wisphubSweeps)).toHaveLength(1);

    /* and goes with the rest once the cutover is set */
    expect((await run()).sweeps).toBe(1);
    expect(await db().select().from(wisphubSweeps)).toHaveLength(0);
  });
});

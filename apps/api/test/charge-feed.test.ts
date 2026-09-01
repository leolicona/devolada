import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { app, seedBusiness, seedConfirmedPayment, sessionCookieHeader } from "./helpers";

/* docs/admin/charge-feed.spec.md scenarios 1–3. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

const asBusiness = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };

async function seedFeed() {
  const business = await seedBusiness();
  const db = drizzle(env.DB);
  const base = Date.now() - 60_000;
  const rows: [number, "queued" | "reconnected" | "failed"][] = [
    [1, "reconnected"],
    [2, "failed"],
    [3, "queued"],
    [4, "reconnected"],
  ];
  for (const [i, status] of rows) {
    await seedConfirmedPayment(business, {
      folio: `DV-FEED${String(i).padStart(2, "0")}`,
      customerName: `Cliente ${i}`,
      invoiceCents: 39900,
      serviceFeeCents: 1500,
      receivedCents: 41400,
      registeredCents: 39900,
      reconnectionStatus: status,
      createdAt: new Date(base + i * 1000),
    });
  }
  return { business, db, base };
}

describe("US-A01: the ISP sees its charges newest first", () => {
  it("lists newest first and pages by cursor", async () => {
    await seedFeed();

    const res = await (await app()).request("/payments/feed", asBusiness, env);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.charges).toHaveLength(4);
    expect(data.charges[0]).toMatchObject({
      customerName: "Cliente 4",
      storeName: null,
      reconnectionStatus: "reconnected",
      totalCents: 41400,
    });
    expect(data.nextCursor).toBeNull();
  });

  it("filters by status", async () => {
    await seedFeed();

    const failed = await (await app()).request("/payments/feed?status=failed", asBusiness, env);
    const failedData = (await failed.json()).data;
    expect(failedData.charges).toHaveLength(1);
    expect(failedData.charges[0].reconnectionStatus).toBe("failed");
  });
});

/* docs/admin/settings.spec.md scenario 4. */
describe("US-A04: today's totals follow the ISP timezone", () => {
  /* The server reports the boundary it used, so this test never has to
     guess it — it holds at any hour, in any runner timezone. */
  const todayOf = async (client: Awaited<ReturnType<typeof app>>) =>
    (await (await client.request("/payments/feed", asBusiness, env)).json()).data.today;

  it("reports the boundary it counted from, and it moves with the zone", async () => {
    const business = await seedBusiness({ timezone: "America/Mexico_City" });
    const db = drizzle(env.DB);
    const client = await app();

    const centre = await todayOf(client);
    expect(centre).toEqual({ count: 0, totalCents: 0, startedAtMs: expect.any(Number) });

    /* One payment on each side of the boundary the server just reported */
    const charge = (folio: string, at: number) =>
      seedConfirmedPayment(business, {
        folio,
        customerName: "Cliente TZ",
        invoiceCents: 39900,
        serviceFeeCents: 1500,
        receivedCents: 41400,
        createdAt: new Date(at),
      });
    await charge("DV-TZ01", centre.startedAtMs - 1);
    await charge("DV-TZ02", centre.startedAtMs + 1);

    /* Counting follows the reported boundary exactly: the charge one ms
       before it is yesterday's, the one after it is today's. */
    const countedFrom = (boundary: number) =>
      [centre.startedAtMs - 1, centre.startedAtMs + 1].filter((at) => at >= boundary).length;

    expect(await todayOf(client)).toMatchObject({
      count: countedFrom(centre.startedAtMs),
      totalCents: 41400,
    });

    /* Same data, same instant: the ISP's own zone decides (D5). Baja
       California's day never starts at the same moment as the centre's,
       so the window moves and the count moves with it. */
    const { businesses } = await import("../src/db/schema");
    await db.update(businesses).set({ timezone: "America/Tijuana" });

    const baja = await todayOf(client);
    expect(baja.startedAtMs).not.toBe(centre.startedAtMs);
    expect(baja.count).toBe(countedFrom(baja.startedAtMs));
  });
});

describe("D6: tenant isolation is tested, not assumed", () => {
  it("another ISP sees nothing", async () => {
    await seedFeed();

    await seedBusiness({ email: "otro@business.mx" });
    const otherBusiness = await (await app()).request(
      "/payments/feed",
      { headers: { Cookie: await sessionCookieHeader("otro@business.mx") } },
      env,
    );
    expect((await otherBusiness.json()).data.charges).toHaveLength(0);
  });
});

/* docs/direct-payment/direct-payment.spec.md scenario 14. */
describe("US-D06: direct SPEI charges ride the same feed, distinguished", () => {
  it("returns spei charges with channel and no store name", async () => {
    const { business } = await seedFeed();
    await seedConfirmedPayment(business, {
      folio: "DV-SPEI01",
      customerName: "Janely",
      invoiceCents: 49900,
      serviceFeeCents: 1500,
      receivedCents: 51400,
      reconnectionStatus: "reconnected",
      createdAt: new Date(),
    });

    const res = await (await app()).request("/payments/feed", asBusiness, env);
    const { data } = await res.json();
    expect(data.charges).toHaveLength(5);
    expect(data.charges[0]).toMatchObject({
      folio: "DV-SPEI01",
      channel: "spei",
      storeName: null,
    });
    /* every row is a direct payment now (business-and-memberships D6) */
    expect(data.charges[1]).toMatchObject({
      channel: "spei",
      storeName: null,
    });
  });
});

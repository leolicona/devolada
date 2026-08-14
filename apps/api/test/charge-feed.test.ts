import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { charges } from "../src/db/schema";
import { startOfBusinessDayMs } from "../src/time/business-day";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/admin/charge-feed.spec.md scenarios 1–3. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

const asIsp = { headers: { Cookie: sessionCookieHeader("demo@devolada.app") } };

async function seedFeed() {
  const isp = await seedIsp();
  const store = await seedStore(isp.id);
  const db = drizzle(env.DB);
  const base = Date.now() - 60_000;
  const mk = (i: number, status: "queued" | "reconnected" | "failed") => ({
    ispId: isp.id,
    storeId: store.id,
    folio: `DV-FEED${String(i).padStart(2, "0")}`,
    wisphubCustomerId: "1",
    customerName: `Cliente ${i}`,
    monthlyFeeCents: 39900,
    serviceFeeCents: 1500,
    totalCents: 41400,
    reconnectionStatus: status,
    createdAt: new Date(base + i * 1000),
  });
  const rows = [
    mk(1, "reconnected"),
    mk(2, "failed"),
    mk(3, "queued"),
    mk(4, "reconnected"),
  ];
  for (const row of rows) await db.insert(charges).values(row);
  return { isp, store, db, base };
}

describe("US-A01: the ISP sees its charges newest first", () => {
  it("lists with store names and pages by cursor", async () => {
    await seedFeed();

    const res = await (await app()).request("/charges/feed", asIsp, env);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.charges).toHaveLength(4);
    expect(data.charges[0]).toMatchObject({
      customerName: "Cliente 4",
      storeName: "Abarrotes La Esquina",
      reconnectionStatus: "reconnected",
      totalCents: 41400,
    });
    expect(data.nextCursor).toBeNull();
  });

  it("filters by status", async () => {
    await seedFeed();

    const failed = await (await app()).request("/charges/feed?status=failed", asIsp, env);
    const failedData = (await failed.json()).data;
    expect(failedData.charges).toHaveLength(1);
    expect(failedData.charges[0].reconnectionStatus).toBe("failed");
  });
});

/* docs/admin/settings.spec.md scenario 4. */
describe("US-A04: today's totals follow the ISP timezone", () => {
  it("the same charge counts for one zone and not for the other", async () => {
    /* The two zones start their day 1–2 hours apart. A charge placed in
       that gap belongs to today for the zone that started earlier and to
       yesterday for the other one — whatever time this test runs at. */
    const now = new Date();
    const starts = [
      { zone: "America/Mexico_City" as const, ms: startOfBusinessDayMs("America/Mexico_City", now) },
      { zone: "America/Tijuana" as const, ms: startOfBusinessDayMs("America/Tijuana", now) },
    ].sort((a, b) => a.ms - b.ms);
    const [earlier, later] = starts;
    expect(later.ms).toBeGreaterThan(earlier.ms);

    const isp = await seedIsp({ timezone: earlier.zone });
    const store = await seedStore(isp.id);
    const db = drizzle(env.DB);
    await db.insert(charges).values({
      ispId: isp.id,
      storeId: store.id,
      folio: "DV-TZ01",
      wisphubCustomerId: "1",
      customerName: "Cliente TZ",
      monthlyFeeCents: 39900,
      serviceFeeCents: 1500,
      totalCents: 41400,
      createdAt: new Date(later.ms - 1),
    });

    const client = await app();
    const counted = await client.request("/charges/feed", asIsp, env);
    expect((await counted.json()).data.today).toEqual({ count: 1, totalCents: 41400 });

    /* Same data, same instant, the ISP's own zone decides (D5) */
    const { isps } = await import("../src/db/schema");
    await db.update(isps).set({ timezone: later.zone });
    const notCounted = await client.request("/charges/feed", asIsp, env);
    expect((await notCounted.json()).data.today).toEqual({ count: 0, totalCents: 0 });
  });
});

describe("D6: tenant isolation is tested, not assumed", () => {
  it("a store session gets 403 and another ISP sees nothing", async () => {
    await seedFeed();

    const asStore = await (await app()).request(
      "/charges/feed",
      { headers: { Cookie: sessionCookieHeader("5512345678") } },
      env,
    );
    expect(asStore.status).toBe(403);

    await seedIsp({ email: "otro@isp.mx" });
    const otherIsp = await (await app()).request(
      "/charges/feed",
      { headers: { Cookie: sessionCookieHeader("otro@isp.mx") } },
      env,
    );
    expect((await otherIsp.json()).data.charges).toHaveLength(0);
  });
});

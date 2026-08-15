import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { charges } from "../src/db/schema";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/admin/charge-feed.spec.md scenarios 1–3. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

const asIsp = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };

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
  /* The server reports the boundary it used, so this test never has to
     guess it — it holds at any hour, in any runner timezone. */
  const todayOf = async (client: Awaited<ReturnType<typeof app>>) =>
    (await (await client.request("/charges/feed", asIsp, env)).json()).data.today;

  it("reports the boundary it counted from, and it moves with the zone", async () => {
    const isp = await seedIsp({ timezone: "America/Mexico_City" });
    const store = await seedStore(isp.id);
    const db = drizzle(env.DB);
    const client = await app();

    const centre = await todayOf(client);
    expect(centre).toEqual({ count: 0, totalCents: 0, startedAtMs: expect.any(Number) });

    /* One charge on each side of the boundary the server just reported */
    const charge = (folio: string, at: number) => ({
      ispId: isp.id,
      storeId: store.id,
      folio,
      wisphubCustomerId: "1",
      customerName: "Cliente TZ",
      monthlyFeeCents: 39900,
      serviceFeeCents: 1500,
      totalCents: 41400,
      createdAt: new Date(at),
    });
    await db.insert(charges).values(charge("DV-TZ01", centre.startedAtMs - 1));
    await db.insert(charges).values(charge("DV-TZ02", centre.startedAtMs + 1));

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
    const { isps } = await import("../src/db/schema");
    await db.update(isps).set({ timezone: "America/Tijuana" });

    const baja = await todayOf(client);
    expect(baja.startedAtMs).not.toBe(centre.startedAtMs);
    expect(baja.count).toBe(countedFrom(baja.startedAtMs));
  });
});

describe("D6: tenant isolation is tested, not assumed", () => {
  it("a store session gets 403 and another ISP sees nothing", async () => {
    await seedFeed();

    const asStore = await (await app()).request(
      "/charges/feed",
      { headers: { Cookie: await sessionCookieHeader("5512345678") } },
      env,
    );
    expect(asStore.status).toBe(403);

    await seedIsp({ email: "otro@isp.mx" });
    const otherIsp = await (await app()).request(
      "/charges/feed",
      { headers: { Cookie: await sessionCookieHeader("otro@isp.mx") } },
      env,
    );
    expect((await otherIsp.json()).data.charges).toHaveLength(0);
  });
});

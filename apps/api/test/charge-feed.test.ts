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

  it("filters by status and computes today totals from the client boundary", async () => {
    const { base } = await seedFeed();

    const failed = await (await app()).request("/charges/feed?status=failed", asIsp, env);
    const failedData = (await failed.json()).data;
    expect(failedData.charges).toHaveLength(1);
    expect(failedData.charges[0].reconnectionStatus).toBe("failed");

    /* today boundary excludes the first two rows */
    const boundary = base + 2500;
    const res = await (await app()).request(
      `/charges/feed?todayStartMs=${boundary}`,
      asIsp,
      env,
    );
    expect((await res.json()).data.today).toEqual({ count: 2, totalCents: 82800 });
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

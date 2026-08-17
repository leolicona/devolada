import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { ledgerEntries } from "../src/db/schema";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/cashbox/cashbox.spec.md scenarios 1–3. No WispHub here. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

const asStore = { headers: { Cookie: await sessionCookieHeader("5512345678") } };

async function seedWithEntries(capCents: number, cents: number[]) {
  const isp = await seedIsp();
  const store = await seedStore(isp.id, { balanceCapCents: capCents });
  const db = drizzle(env.DB);
  if (cents.length) {
    await db.insert(ledgerEntries).values(
      cents.map((c) => ({
        storeId: store.id,
        type: (c < 0 ? "commission" : "charge") as "commission" | "charge",
        cents: c,
      })),
    );
  }
  return store;
}

describe("US-K01: balance and commission come from the ledger", () => {
  it("computes both sums from entries", async () => {
    await seedWithEntries(500000, [41400, -900, 51400, -900]);

    const res = await (await app()).request("/cashbox", asStore, env);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.storeName).toBe("Abarrotes La Esquina");
    expect(data.balanceCents).toBe(41400 - 900 + 51400 - 900);
    expect(data.commissionEarnedCents).toBe(1800);
    expect(data.cap).toEqual({ capCents: 500000, approaching: false, blocked: false });
    expect(data.lastCashDrop).toBeNull();
  });

  it("an empty ledger means zeros, not errors", async () => {
    await seedWithEntries(500000, []);
    const res = await (await app()).request("/cashbox", asStore, env);
    const { data } = await res.json();
    expect(data.balanceCents).toBe(0);
    expect(data.commissionEarnedCents).toBe(0);
  });
});

describe("US-K04: approaching at 80%, blocked at the cap", () => {
  it("flags approaching from 80% and blocked from 100%", async () => {
    const store = await seedWithEntries(100000, [80000]);
    const near = await (await app()).request("/cashbox", asStore, env);
    expect((await near.json()).data.cap).toMatchObject({ approaching: true, blocked: false });

    const db = drizzle(env.DB);
    await db.insert(ledgerEntries).values({ storeId: store.id, type: "charge", cents: 20000 });
    const at = await (await app()).request("/cashbox", asStore, env);
    expect((await at.json()).data.cap).toMatchObject({ approaching: true, blocked: true });
  });
});

describe("guard: store sessions only", () => {
  it("401 without a session; 403 for an ISP", async () => {
    await seedIsp();
    const anonymous = await (await app()).request("/cashbox", {}, env);
    expect(anonymous.status).toBe(401);

    const asIsp = await (await app()).request(
      "/cashbox",
      { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } },
      env,
    );
    expect(asIsp.status).toBe(403);
  });
});

describe("US-K01: the commission counts the current drop cycle (D5)", () => {
  it("excludes commissions before the last confirmed drop and reports the boundary", async () => {
    const isp = await seedIsp();
    const store = await seedStore(isp.id);
    const db = drizzle(env.DB);
    const before = new Date("2026-08-10T12:00:00Z");
    const dropAt = new Date("2026-08-12T12:00:00Z");
    const after = new Date("2026-08-15T12:00:00Z");
    await db.insert(ledgerEntries).values([
      { storeId: store.id, type: "charge", cents: 41400, createdAt: before },
      { storeId: store.id, type: "commission", cents: -900, createdAt: before },
      { storeId: store.id, type: "cash_drop", cents: -40500, createdAt: dropAt },
      { storeId: store.id, type: "charge", cents: 51400, createdAt: after },
      { storeId: store.id, type: "commission", cents: -700, createdAt: after },
    ]);

    const res = await (await app()).request("/cashbox", asStore, env);
    const { data } = await res.json();
    /* Only the cycle after the drop counts; the balance stays all-time */
    expect(data.commissionEarnedCents).toBe(700);
    expect(data.commissionSince).toBe(dropAt.getTime());
    expect(data.balanceCents).toBe(41400 - 900 - 40500 + 51400 - 700);
  });

  it("a pending drop resets nothing: no ledger entry, no boundary", async () => {
    /* The cash_drop LEDGER entry only exists once the ISP confirms
       (cash-drops D1). A registered-but-pending drop lives only in the
       cash_drops table, so the cycle keeps running. */
    await seedWithEntries(500000, [41400, -900]);
    const res = await (await app()).request("/cashbox", asStore, env);
    const { data } = await res.json();
    expect(data.commissionEarnedCents).toBe(900);
    expect(data.commissionSince).toBeNull();
  });
});

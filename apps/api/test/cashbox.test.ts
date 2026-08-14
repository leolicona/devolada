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

const asStore = { headers: { Cookie: sessionCookieHeader("5512345678") } };

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
      { headers: { Cookie: sessionCookieHeader("demo@devolada.app") } },
      env,
    );
    expect(asIsp.status).toBe(403);
  });
});

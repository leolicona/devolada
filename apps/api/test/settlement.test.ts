import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { charges, ledgerEntries } from "../src/db/schema";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/platform/settlement.spec.md scenarios 1–3. */

const asIsp = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };
const asStore = { headers: { Cookie: await sessionCookieHeader("5512345678") } };

async function seedCharge(
  ispId: string,
  storeId: string,
  createdAt: Date,
  serviceFeeCents: number,
  commissionCents: number,
) {
  const db = drizzle(env.DB);
  const [charge] = await db
    .insert(charges)
    .values({
      ispId,
      storeId,
      folio: `DV-L${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      wisphubCustomerId: "6",
      customerUsuario: "greyes@wifiplus",
      customerName: "Janely",
      invoiceCents: 49900,
      serviceFeeCents,
      totalCents: 49900 + serviceFeeCents,
      createdAt,
    })
    .returning();
  await db.insert(ledgerEntries).values([
    { storeId, type: "charge", cents: charge.totalCents, chargeId: charge.id, createdAt },
    { storeId, type: "commission", cents: -commissionCents, chargeId: charge.id, createdAt },
  ]);
  return charge;
}

describe("US-L01: the platform's share accrues per ISP month", () => {
  it("groups by month with per-charge math, store overrides included", async () => {
    /* spec scenario 1: two months; one store keeps the ISP default
       commission ($9 of a $15 fee → $6 share), another has an override
       ($12 → $3 share). The stored rows carry the truth (D1). */
    const isp = await seedIsp({ serviceFeeCents: 1500, storeCommissionCents: 900 });
    const store = await seedStore(isp.id);
    const augustA = new Date("2026-08-05T18:00:00Z");
    const augustB = new Date("2026-08-20T18:00:00Z");
    const july = new Date("2026-07-10T18:00:00Z");
    await seedCharge(isp.id, store.id, augustA, 1500, 900); /* share 600 */
    await seedCharge(isp.id, store.id, augustB, 1500, 1200); /* override: share 300 */
    await seedCharge(isp.id, store.id, july, 1500, 900); /* share 600 */

    const res = await (await app()).request("/settlement", asIsp, env);
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.months).toEqual([
      {
        period: "2026-08",
        chargeCount: 2,
        shareCents: 900,
        reference: `DV-202608-${isp.id.slice(-4)}`,
        current: expect.any(Boolean),
      },
      {
        period: "2026-07",
        chargeCount: 1,
        shareCents: 600,
        reference: `DV-202607-${isp.id.slice(-4)}`,
        current: false,
      },
    ]);
  });

  it("a charge near the UTC boundary lands in the ISP-timezone month", async () => {
    /* spec scenario 2: 2026-09-01 03:00 UTC is still August 31, 21:00 in
       America/Mexico_City. UTC grouping would call it September. */
    const isp = await seedIsp({ timezone: "America/Mexico_City" });
    const store = await seedStore(isp.id);
    await seedCharge(isp.id, store.id, new Date("2026-09-01T03:00:00Z"), 1500, 900);

    const res = await (await app()).request("/settlement", asIsp, env);
    const { data } = await res.json();
    expect(data.months).toHaveLength(1);
    expect(data.months[0].period).toBe("2026-08");
  });

  it("a store session gets 403: the statement is the ISP's debt", async () => {
    /* spec scenario 3 */
    const isp = await seedIsp();
    await seedStore(isp.id);
    const res = await (await app()).request("/settlement", asStore, env);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("AUTHENTICATION_ERROR");
  });
});

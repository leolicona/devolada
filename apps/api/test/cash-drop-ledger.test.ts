import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { charges, ledgerEntries } from "../src/db/schema";
import { storeBalanceCents } from "../src/ledger";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/cashbox/cash-drop-and-ledger.spec.md scenarios 1–3. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

const asStore = { headers: { Cookie: sessionCookieHeader("5512345678") } };
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...asStore.headers },
  body: JSON.stringify(body),
});

async function seedWithBalance(cents: number) {
  const isp = await seedIsp();
  const store = await seedStore(isp.id);
  const db = drizzle(env.DB);
  if (cents > 0) {
    await db.insert(ledgerEntries).values({ storeId: store.id, type: "charge", cents });
  }
  return { isp, store, db };
}

describe("US-K02: recording a drop commits nothing in the ledger", () => {
  it("creates a pending row and the balance does not move (D1)", async () => {
    const { store, db } = await seedWithBalance(50000);

    const res = await (await app()).request("/cash-drops", post({ cents: 40000 }), env);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("pending");
    expect(data.cents).toBe(40000);

    /* D1: no ledger entry until the ISP confirms */
    expect(await storeBalanceCents(db, store.id)).toBe(50000);
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it("rejects an amount above the balance and a second pending drop", async () => {
    await seedWithBalance(50000);

    const tooMuch = await (await app()).request("/cash-drops", post({ cents: 50001 }), env);
    expect(tooMuch.status).toBe(400);
    expect((await tooMuch.json()).error.code).toBe("AMOUNT_EXCEEDS_BALANCE");

    const first = await (await app()).request("/cash-drops", post({ cents: 30000 }), env);
    expect(first.status).toBe(201);

    const second = await (await app()).request("/cash-drops", post({ cents: 10000 }), env);
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("DROP_ALREADY_PENDING");
  });
});

describe("US-K03: the ledger lists entries with their context", () => {
  it("returns newest-first rows with charge references and pages by cursor", async () => {
    const { store, db } = await seedWithBalance(0);
    const [charge] = await db
      .insert(charges)
      .values({
        ispId: store.ispId,
        storeId: store.id,
        folio: "DV-TEST01",
        wisphubCustomerId: "1",
        customerName: "Janely",
        monthlyFeeCents: 39900,
        serviceFeeCents: 1500,
        totalCents: 41400,
      })
      .returning();

    /* 22 entries with distinct timestamps: 2 charge-linked + 20 fillers.
       Inserted in chunks: D1 limits bound SQL variables per statement. */
    const base = Date.now() - 60_000;
    const rows = [
      { storeId: store.id, type: "charge" as const, cents: 41400, chargeId: charge.id, createdAt: new Date(base + 21_000) },
      { storeId: store.id, type: "commission" as const, cents: -900, chargeId: charge.id, createdAt: new Date(base + 20_000) },
      ...Array.from({ length: 20 }, (_, k) => ({
        storeId: store.id,
        type: "charge" as const,
        cents: 100 + k,
        createdAt: new Date(base + k * 500),
      })),
    ];
    for (let i = 0; i < rows.length; i += 8) {
      await db.insert(ledgerEntries).values(rows.slice(i, i + 8));
    }

    const first = await (await app()).request("/ledger", asStore, env);
    const page1 = (await first.json()).data;
    expect(page1.entries).toHaveLength(20);
    expect(page1.entries[0]).toMatchObject({
      type: "charge",
      cents: 41400,
      reference: { folio: "DV-TEST01", customerName: "Janely" },
    });
    expect(page1.entries[1].reference).toEqual({ folio: "DV-TEST01", customerName: "Janely" });
    expect(page1.nextCursor).not.toBeNull();

    const second = await (await app()).request(`/ledger?cursor=${page1.nextCursor}`, asStore, env);
    const page2 = (await second.json()).data;
    expect(page2.entries).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
  });
});

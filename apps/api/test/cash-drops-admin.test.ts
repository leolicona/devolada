import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { cashDrops, ledgerEntries } from "../src/db/schema";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/cash-drops/confirm-cash-drop.spec.md scenarios 1–4. */

const asIsp = { Cookie: await sessionCookieHeader("demo@devolada.app") };
const asStore = { Cookie: await sessionCookieHeader("5512345678") };

const post = (path: string, headers: Record<string, string>, body?: unknown): [string, RequestInit] => [
  path,
  {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  },
];

const get = (path: string, headers: Record<string, string> = asIsp): [string, RequestInit] => [
  path,
  { headers },
];

/* A store with cash in hand: one charge of $500 in, $9 commission out. */
async function seedStoreWithBalance(ispId: string, over: Record<string, unknown> = {}) {
  const db = drizzle(env.DB);
  const store = await seedStore(ispId, over);
  await db.insert(ledgerEntries).values([
    { storeId: store.id, type: "charge", cents: 51500 },
    { storeId: store.id, type: "commission", cents: -900 },
  ]);
  return store;
}

async function seedDrop(storeId: string, cents: number, over: Record<string, unknown> = {}) {
  const db = drizzle(env.DB);
  const [drop] = await db.insert(cashDrops).values({ storeId, cents, ...over }).returning();
  return drop;
}

describe("US-E01: confirming a cash drop moves the money out of the balance", () => {
  it("writes the cash_drop ledger entry and lowers the balance", async () => {
    const isp = await seedIsp();
    const store = await seedStoreWithBalance(isp.id);
    const drop = await seedDrop(store.id, 50600);

    const res = await (await app()).request(...post(`/cash-drops/${drop.id}/confirm`, asIsp), env);
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.drop.status).toBe("confirmed");
    expect(data.drop.confirmedAt).toBeGreaterThan(0);
    /* 51500 − 900 − 50600 = 0: the drawer is empty and the ledger says so */
    expect(data.storeBalanceCents).toBe(0);

    const db = drizzle(env.DB);
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, "cash_drop"));
    expect(entries).toHaveLength(1);
    expect(entries[0].cents).toBe(-50600);
    expect(entries[0].cashDropId).toBe(drop.id);
  });

  it("rejects a second confirmation, a foreign drop and a store session", async () => {
    const isp = await seedIsp();
    const store = await seedStoreWithBalance(isp.id);
    const drop = await seedDrop(store.id, 10000);
    const client = await app();

    await client.request(...post(`/cash-drops/${drop.id}/confirm`, asIsp), env);
    const again = await client.request(...post(`/cash-drops/${drop.id}/confirm`, asIsp), env);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("DROP_NOT_PENDING");

    /* Another ISP's drop is invisible, not forbidden: 404 (D3) */
    const other = await seedIsp({ email: "otro@isp.mx" });
    const otherStore = await seedStore(other.id, { phone: "5599998888" });
    const otherDrop = await seedDrop(otherStore.id, 5000);
    const foreign = await client.request(...post(`/cash-drops/${otherDrop.id}/confirm`, asIsp), env);
    expect(foreign.status).toBe(404);

    const asStoreRes = await client.request(...post(`/cash-drops/${drop.id}/confirm`, asStore), env);
    expect(asStoreRes.status).toBe(403);

    /* Only the first confirmation ever reached the ledger */
    const db = drizzle(env.DB);
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, "cash_drop"));
    expect(entries).toHaveLength(1);
  });
});

describe("US-E02: a disputed drop leaves the ledger untouched", () => {
  it("saves the note, writes no entry, and frees the store to record again", async () => {
    const isp = await seedIsp();
    const store = await seedStoreWithBalance(isp.id);
    const drop = await seedDrop(store.id, 50600);
    const client = await app();

    const res = await client.request(
      ...post(`/cash-drops/${drop.id}/dispute`, asIsp, { note: "Faltaron $200 en el sobre." }),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.drop.status).toBe("disputed");
    expect(data.drop.note).toBe("Faltaron $200 en el sobre.");

    const db = drizzle(env.DB);
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, "cash_drop"));
    expect(entries).toHaveLength(0);

    /* Terminal (D2): it cannot be confirmed afterwards… */
    const late = await client.request(...post(`/cash-drops/${drop.id}/confirm`, asIsp), env);
    expect(late.status).toBe(409);

    /* …but the store is no longer blocked by a pending drop */
    const again = await client.request(...post("/cash-drops", asStore, { cents: 50600 }), env);
    expect(again.status).toBe(201);

    const emptyNote = await client.request(
      ...post(`/cash-drops/${drop.id}/dispute`, asIsp, { note: "" }),
      env,
    );
    expect(emptyNote.status).toBe(400);
  });
});

describe("US-E01: the two lists answer different questions", () => {
  it("pending carries the store and its balance; resolved pages newest-first", async () => {
    const isp = await seedIsp();
    const store = await seedStoreWithBalance(isp.id, { name: "Abarrotes La Esquina", zone: "Centro" });
    const pending = await seedDrop(store.id, 20000);
    await seedDrop(store.id, 10000, {
      status: "confirmed",
      confirmedAt: new Date(1_700_000_000_000),
      createdAt: new Date(1_700_000_000_000),
    });
    await seedDrop(store.id, 30000, {
      status: "disputed",
      note: "No coincide",
      createdAt: new Date(1_800_000_000_000),
    });
    const client = await app();

    const pendingRes = await client.request(...get("/cash-drops"), env);
    const pendingData = (await pendingRes.json()).data;
    expect(pendingData.drops).toHaveLength(1);
    expect(pendingData.drops[0]).toMatchObject({
      id: pending.id,
      storeName: "Abarrotes La Esquina",
      storeZone: "Centro",
      /* D5: what the store still holds, so the ISP can count against it */
      storeBalanceCents: 50600,
      status: "pending",
    });

    const resolvedRes = await client.request(...get("/cash-drops?scope=resolved"), env);
    const resolved = (await resolvedRes.json()).data;
    expect(resolved.drops.map((d: { status: string }) => d.status)).toEqual([
      "disputed",
      "confirmed",
    ]);
    expect(resolved.drops[0].note).toBe("No coincide");
    expect(resolved.drops[0].storeBalanceCents).toBeNull();
    expect(resolved.nextCursor).toBeNull();

    /* Tenant isolation: another ISP sees none of this (D3) */
    await seedIsp({ email: "otro@isp.mx" });
    const otherRes = await client.request(
      ...get("/cash-drops", { Cookie: await sessionCookieHeader("otro@isp.mx") }),
      env,
    );
    expect((await otherRes.json()).data.drops).toEqual([]);
  });
});

import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, storeHandovers, storeLedger } from "../src/db/schema";
import { recordCollection } from "../src/store-ledger";
import { cashboxResponse, storeHandoversResponse, storeLedgerResponse } from "../src/routes/store/schema";
import { cashPointsResponse, handoverHistoryResponse } from "../src/routes/cash-points/schema";
import { app, seedBusiness, seedMember, sessionCookieHeader } from "./helpers";
import { seedActiveStore, seedStorePayment, seedStoreChannel } from "./store-helpers";

/* cash-at-stores US5 (T052) — the cash book in both directions: the store
   declares, the business confirms or disputes, and both sides read the same
   SUM to the cent (SC-005). Two businesses at one store never see each
   other's cash (FR-042), and a business whose channel was switched off can
   still settle what the store holds (H1, L4). */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const db = () => drizzle(env.DB);
const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const as = async (cookie: string, path: string, init: RequestInit = {}) =>
  (await app()).request(path, { ...init, headers: { "Content-Type": "application/json", Cookie: cookie } }, env);

/* A business with the channel on, an active store, and `amounts` collected */
async function world(amounts: number[] = [49900, 30000], email = "demo@devolada.app", name = "WiFi Plus") {
  const business = await seedBusiness({ email, name, wisphubApiKey: "wh-key-1" });
  await seedStoreChannel(business);
  const shop = await seedActiveStore();
  for (const cents of amounts) {
    const payment = await seedStorePayment(business, shop.store, {
      amountCents: cents,
      receivedCents: cents,
      customerUsuario: `c${cents}@wifiplus`,
    });
    await recordCollection(db(), payment);
  }
  return { business, shop, owner: await sessionCookieHeader(email) };
}

describe("cash-at-stores US5 — the store's side: *Mi caja*, *Movimientos*, declaring (D19, D20)", () => {
  it("the cash held and the fees since the last confirmed hand-over", async () => {
    const { shop } = await world();
    const data = cashboxResponse.parse((await (await as(shop.cookie, "/store/cashbox")).json()).data);
    expect(data.businesses).toEqual([
      expect.objectContaining({
        businessName: "WiFi Plus",
        heldCents: 79900,
        feesSinceHandoverCents: 3000,
        lastHandover: null,
        pendingHandover: null,
      }),
    ]);
  });

  it("the movements come twenty a page, newest first, and narrow to a business and a kind", async () => {
    const { business, shop } = await world(Array.from({ length: 21 }, (_, i) => 1000 + i));
    const first = storeLedgerResponse.parse((await (await as(shop.cookie, "/store/ledger")).json()).data);
    expect(first.rows).toHaveLength(20);
    expect(first.rows[0]).toMatchObject({ kind: "collection", businessName: "WiFi Plus", feeCents: 1500 });
    expect(first.rows[0]).not.toHaveProperty("paymentId");
    const second = storeLedgerResponse.parse(
      (await (await as(shop.cookie, `/store/ledger?cursor=${first.nextCursor}`)).json()).data,
    );
    expect(second.rows).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.rows, ...second.rows].map((r) => r.id));
    expect(ids.size).toBe(21);

    const narrowed = await as(shop.cookie, `/store/ledger?businessId=${business.id}&kind=handover`);
    expect((await narrowed.json()).data.rows).toHaveLength(0);
    const stranger = await as(shop.cookie, "/store/ledger?businessId=nobody");
    expect(stranger.status).toBe(404);
  });

  it("declares a hand-over as pending, moves nothing, and refuses a second one and one above what is held", async () => {
    const { business, shop } = await world();
    const above = await as(shop.cookie, "/store/handovers", json({ businessId: business.id, cents: 79901 }));
    expect(above.status).toBe(400);
    expect((await above.json()).error.code).toBe("AMOUNT_EXCEEDS_HELD");

    const res = await as(shop.cookie, "/store/handovers", json({ businessId: business.id, cents: 79900 }));
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ status: "pending" });
    expect(await db().select().from(storeLedger).where(eq(storeLedger.kind, "handover"))).toHaveLength(0);

    const second = await as(shop.cookie, "/store/handovers", json({ businessId: business.id, cents: 100 }));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("HANDOVER_PENDING");

    const cashbox = (await (await as(shop.cookie, "/store/cashbox")).json()).data;
    expect(cashbox.businesses[0]).toMatchObject({ heldCents: 79900, pendingHandover: { cents: 79900 } });
  });
});

describe("cash-at-stores US5 — the business's side: *Puntos de pago* (D20, D23)", () => {
  it("confirming writes one movement, and both sides read the same balance to the cent (SC-005)", async () => {
    const { business, shop, owner } = await world();
    const { data: declared } = await (await as(shop.cookie, "/store/handovers", json({ businessId: business.id, cents: 50000 }))).json();

    const points = cashPointsResponse.parse((await (await as(owner, "/cash-points")).json()).data);
    expect(points).toMatchObject({ channelOn: true, stores: [{ storeName: "Abarrotes Lupita", heldCents: 79900, pending: { id: declared.id, cents: 50000 } }] });

    const res = await as(owner, `/cash-points/handovers/${declared.id}/confirm`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ status: "confirmed", resolvedBy: "demo@devolada.app", resolvedAt: expect.any(Number) });
    expect(await db().select().from(storeLedger).where(eq(storeLedger.kind, "handover"))).toEqual([
      expect.objectContaining({ cents: -50000, handoverId: declared.id }),
    ]);

    const after = cashPointsResponse.parse((await (await as(owner, "/cash-points")).json()).data);
    const store = cashboxResponse.parse((await (await as(shop.cookie, "/store/cashbox")).json()).data);
    expect(after.stores[0]).toMatchObject({ heldCents: 29900, pending: null, lastConfirmed: { cents: 50000 } });
    expect(store.businesses[0].heldCents).toBe(after.stores[0].heldCents);
    /* the fees restart at the confirmed hand-over */
    expect(store.businesses[0]).toMatchObject({ feesSinceHandoverCents: 0, lastHandover: { status: "confirmed", cents: 50000 } });

    const again = await as(owner, `/cash-points/handovers/${declared.id}/confirm`, { method: "POST" });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("HANDOVER_NOT_PENDING");
    expect(await db().select().from(storeLedger).where(eq(storeLedger.kind, "handover"))).toHaveLength(1);
  });

  it("disputing needs a note, is terminal, writes nothing, and the store sees the note", async () => {
    const { business, shop, owner } = await world();
    const { data: declared } = await (await as(shop.cookie, "/store/handovers", json({ businessId: business.id, cents: 79900 }))).json();

    const bare = await as(owner, `/cash-points/handovers/${declared.id}/dispute`, json({ note: "no" }));
    expect(bare.status).toBe(400);

    const res = await as(owner, `/cash-points/handovers/${declared.id}/dispute`, json({ note: "Faltaron $200 en el sobre" }));
    expect((await res.json()).data).toMatchObject({ status: "disputed", note: "Faltaron $200 en el sobre" });
    expect(await db().select().from(storeLedger).where(eq(storeLedger.kind, "handover"))).toHaveLength(0);
    expect((await as(owner, `/cash-points/handovers/${declared.id}/confirm`, { method: "POST" })).status).toBe(409);

    const store = cashboxResponse.parse((await (await as(shop.cookie, "/store/cashbox")).json()).data);
    expect(store.businesses[0]).toMatchObject({
      heldCents: 79900,
      pendingHandover: null,
      lastHandover: { status: "disputed", note: "Faltaron $200 en el sobre" },
    });
    /* and a new one can be declared */
    expect((await as(shop.cookie, "/store/handovers", json({ businessId: business.id, cents: 100 }))).status).toBe(201);

    const history = handoverHistoryResponse.parse(
      (await (await as(owner, `/cash-points/stores/${shop.store.id}/history`)).json()).data,
    );
    expect(history.handovers.map((h) => h.status)).toEqual(["pending", "disputed"]);
  });

  it("a viewer reads *Puntos de pago* and can confirm or dispute nothing (FR-035)", async () => {
    const { business, shop } = await world();
    const { data: declared } = await (await as(shop.cookie, "/store/handovers", json({ businessId: business.id, cents: 100 }))).json();
    await seedMember(business, "lector@wifiplus.mx", "viewer");
    const viewer = await sessionCookieHeader("lector@wifiplus.mx");
    expect((await as(viewer, "/cash-points")).status).toBe(200);
    for (const path of [`/cash-points/handovers/${declared.id}/confirm`, `/cash-points/handovers/${declared.id}/dispute`]) {
      const res = await as(viewer, path, json({ note: "No llegó completo" }));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN_FOR_ROLE");
    }
  });
});

describe("cash-at-stores US5 — the numbers open what they count, and the store keeps its hand-overs (T079, T080)", () => {
  it("after a confirmed hand-over, the fees start there, and `since` narrows the movements to them (T079, FR-037)", async () => {
    const { business, shop, owner } = await world([49900]);
    const { data: declared } = await (await as(shop.cookie, "/store/handovers", json({ businessId: business.id, cents: 49900 }))).json();
    await as(owner, `/cash-points/handovers/${declared.id}/confirm`, { method: "POST" });
    const after = await seedStorePayment(business, shop.store, { amountCents: 20000, receivedCents: 20000, customerUsuario: "nuevo@wifiplus" });
    await recordCollection(db(), after);

    const box = cashboxResponse.parse((await (await as(shop.cookie, "/store/cashbox")).json()).data).businesses[0];
    expect(box.feesSinceHandoverCents).toBe(1500);
    expect(box.feesSince).toEqual(expect.any(Number));

    const all = storeLedgerResponse.parse((await (await as(shop.cookie, `/store/ledger?businessId=${business.id}&kind=collection`)).json()).data);
    expect(all.rows).toHaveLength(2);
    const since = storeLedgerResponse.parse(
      (await (await as(shop.cookie, `/store/ledger?businessId=${business.id}&kind=collection&since=${box.feesSince}`)).json()).data,
    );
    expect(since.rows.map((r) => r.cents)).toEqual([20000]);
    expect(since.rows.reduce((sum, r) => sum + (r.feeCents ?? 0), 0)).toBe(box.feesSinceHandoverCents);
  });

  it("the store reads its own hand-overs, a dispute's note included, after the next one is resolved (T080, US5/AC6)", async () => {
    const { business, shop, owner } = await world([79900]);
    const { data: first } = await (await as(shop.cookie, "/store/handovers", json({ businessId: business.id, cents: 79900 }))).json();
    await as(owner, `/cash-points/handovers/${first.id}/dispute`, json({ note: "Faltaron $200 en el sobre" }));
    const { data: second } = await (await as(shop.cookie, "/store/handovers", json({ businessId: business.id, cents: 59900 }))).json();
    await as(owner, `/cash-points/handovers/${second.id}/confirm`, { method: "POST" });

    const res = await as(shop.cookie, `/store/handovers?businessId=${business.id}`);
    const data = storeHandoversResponse.parse((await res.json()).data);
    expect(data.businessName).toBe("WiFi Plus");
    expect(data.handovers.map((h) => [h.status, h.note])).toEqual([
      ["confirmed", null],
      ["disputed", "Faltaron $200 en el sobre"],
    ]);
    expect(data.handovers[1].resolvedAt).toEqual(expect.any(Number));

    /* another business's id is not this store's book */
    expect((await as(shop.cookie, "/store/handovers?businessId=nobody")).status).toBe(404);
  });
});

describe("cash-at-stores US5 — isolation and the channel switched off (FR-042, H1, L4)", () => {
  it("two businesses holding cash at one store each see only their own", async () => {
    const { business: first, shop, owner } = await world([49900]);
    /* the channel moves to a second business while the first still has cash */
    await db().update(businesses).set({ storeChannelOn: false }).where(eq(businesses.id, first.id));
    const second = await seedBusiness({ email: "otro@isp.mx", name: "Cable Norte", wisphubApiKey: "wh-key-2" });
    await seedStoreChannel(second);
    const payment = await seedStorePayment(second, shop.store, { amountCents: 25000, receivedCents: 25000, customerUsuario: "x@cable" });
    await recordCollection(db(), payment);

    const mine = cashPointsResponse.parse((await (await as(owner, "/cash-points")).json()).data);
    const theirs = cashPointsResponse.parse((await (await as(await sessionCookieHeader("otro@isp.mx"), "/cash-points")).json()).data);
    expect(mine.stores).toEqual([expect.objectContaining({ heldCents: 49900 })]);
    expect(theirs.stores).toEqual([expect.objectContaining({ heldCents: 25000 })]);

    /* the store holds both, apart */
    const store = cashboxResponse.parse((await (await as(shop.cookie, "/store/cashbox")).json()).data);
    expect(store.businesses.map((b) => [b.businessName, b.heldCents]).sort()).toEqual([
      ["Cable Norte", 25000],
      ["WiFi Plus", 49900],
    ]);

    /* a hand-over of one business is NOT_FOUND to the other */
    const { data: declared } = await (await as(shop.cookie, "/store/handovers", json({ businessId: second.id, cents: 25000 }))).json();
    const crossed = await as(owner, `/cash-points/handovers/${declared.id}/confirm`, { method: "POST" });
    expect(crossed.status).toBe(404);
    const history = (await (await as(owner, `/cash-points/stores/${shop.store.id}/history`)).json()).data;
    expect(history.handovers).toHaveLength(0);
  });

  it("with the channel switched off, the cash book still answers — no CHANNEL_OFF — and a hand-over is declared and confirmed", async () => {
    const { business, shop, owner } = await world([49900]);
    await db().update(businesses).set({ storeChannelOn: false }).where(eq(businesses.id, business.id));

    expect((await as(shop.cookie, "/store/customers?q=gua")).status).toBe(409);
    const cashbox = await as(shop.cookie, "/store/cashbox");
    expect(cashbox.status).toBe(200);
    expect((await cashbox.json()).data.businesses).toEqual([expect.objectContaining({ businessId: business.id, heldCents: 49900 })]);
    expect((await as(shop.cookie, `/store/ledger?businessId=${business.id}`)).status).toBe(200);

    const { data: declared } = await (await as(shop.cookie, "/store/handovers", json({ businessId: business.id, cents: 49900 }))).json();
    const points = cashPointsResponse.parse((await (await as(owner, "/cash-points")).json()).data);
    expect(points.channelOn).toBe(false);
    expect((await as(owner, `/cash-points/handovers/${declared.id}/confirm`, { method: "POST" })).status).toBe(200);
    const [h] = await db().select().from(storeHandovers);
    expect(h.status).toBe("confirmed");

    /* and Puntos de pago stays in the menu: `since` survives (FR-034) */
    const me = (await (await as(owner, "/auth/me")).json()).data;
    expect(me.storeChannel).toEqual({ on: false, since: expect.any(Number) });
  });
});

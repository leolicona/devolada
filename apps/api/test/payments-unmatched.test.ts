import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { cepBundles, cepRecords, payments } from "../src/db/schema";
import { parseCadena } from "../src/consta/bundle/cadena";
import { matchCandidates } from "../src/consta/bundle/match";
import { recordsFor } from "../src/consta/bundle/store";
import { trailOf } from "../src/direct-payments/cep-match";
import { app, seedBusiness, seedConfirmedPayment, seedMember, sessionCookieHeader } from "./helpers";
import { SENDER_4417, SENDER_8301, SYNTHETIC, transferCadena, type SyntheticTransfer } from "./consta/bundle-fixtures";

/* cep-bundle-match — the operator's side of a search without a clave:
   how the proof says a payment was decided (US1, FR-013) and the transfers
   received that no payment holds (US4, FR-009). The records are written
   from synthetic cadenas the way the engine writes them, and the trail by
   the lifecycle's own `matchCandidates` + `trailOf` — so what is asserted
   here is the shape a real decision leaves, not a hand-typed one. */

const db = () => drizzle(env.DB);
const BUSINESS_CLABE = "012180000089784417";

const transfer = (clave: string, creditTime: string, senderAccount: string): SyntheticTransfer => ({
  clave,
  operationDay: "2026-09-26",
  creditDay: "2026-09-26",
  creditTime,
  senderAccount,
  beneficiaryAccount: BUSINESS_CLABE,
  amount: "3.00",
});
const MINE = transfer("260926071199000021I", "07:11:20", SENDER_8301);
const THEIRS = transfer("260926114099000022I", "11:40:47", SENDER_4417);

async function seedBundle(businessId: string, ts: SyntheticTransfer[], over: Partial<SyntheticTransfer> = {}) {
  const [bundle] = await db()
    .insert(cepBundles)
    .values({
      businessId,
      paymentRef: crypto.randomUUID(),
      source: "apicep",
      referenceNumber: "9784417",
      transferDate: "2026-09-26",
      senderBank: "AZTECA",
      amountCents: 300,
      beneficiary: BUSINESS_CLABE,
      status: "read",
      claves: JSON.stringify(ts.map((t) => t.clave)),
      unreadable: "[]",
    })
    .returning();
  for (const t of ts) {
    const facts = parseCadena(transferCadena({ ...t, ...over }))!;
    await db()
      .insert(cepRecords)
      .values({ businessId, clave: t.clave, bundleId: bundle.id, ...facts, creditedAt: new Date(facts.creditedAt), seal: "c2VsbG8=" });
  }
  return bundle;
}

/* A payment confirmed from a bundle the way the lifecycle leaves it: the
   matcher's own result, the trail `trailOf` writes, the distance beside */
async function seedDecided(business: { id: string }, receipt: { time: string | null; tail: string | null }) {
  const bundle = await seedBundle(business.id, [MINE, THEIRS]);
  const candidates = await recordsFor(db(), business.id, [MINE.clave, THEIRS.clave]);
  const side = { ...receipt, day: "2026-09-26", amountCents: 300, accounts: [{ bank: "BBVA MEXICO", clabe: BUSINESS_CLABE }] };
  const result = matchCandidates(side, candidates, new Set());
  if (result.decided !== "chosen") throw new Error("the fixture must decide");
  return seedConfirmedPayment(business, {
    trackingKey: result.chosen.clave,
    senderBank: "AZTECA",
    transferDate: "2026-09-26",
    receivedCents: 300,
    amountCents: 300,
    transferTime: receipt.time,
    senderTail: receipt.tail,
    matchTrail: JSON.stringify(trailOf("several", bundle.id, side, result)),
    matchDistanceS: result.distanceS,
  });
}

describe("cep-bundle-match US1: the proof says how a search without a clave was decided (FR-013)", () => {
  it("a bundle-confirmed row answers the decision, the distance and every candidate by four digits — to a viewer", async () => {
    const business = await seedBusiness({ speiClabe: BUSINESS_CLABE, speiBank: "BBVA MEXICO" });
    const payment = await seedDecided(business, { time: "07:10:58", tail: "8301" });
    await seedMember(business, "lector@wifiplus.mx", "viewer");
    const asViewer = { headers: { Cookie: await sessionCookieHeader("lector@wifiplus.mx") } };

    const res = await (await app()).request(`/payments/${payment.id}/proof`, asViewer, env);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.match).toEqual({
      source: "several",
      decided: "chosen",
      by: "tail",
      reason: null,
      distanceS: 22,
      receipt: { time: "07:10:58", tail: "8301" },
      candidates: [
        {
          clave: MINE.clave,
          creditDate: "2026-09-26",
          creditTime: "07:11:20",
          amountCents: 300,
          senderBank: "AZTECA",
          /* the four the receipt printed (research R8), not the CLABE's end */
          senderTail: "8301",
          fate: "chosen",
          why: null,
        },
        {
          clave: THEIRS.clave,
          creditDate: "2026-09-26",
          creditTime: "11:40:47",
          amountCents: 300,
          senderBank: "AZTECA",
          senderTail: "4171",
          fate: "dropped",
          why: "tail",
        },
      ],
    });
    /* FR-010: no name, no RFC and no whole account ever leaves */
    const body = JSON.stringify(data);
    for (const secret of [SENDER_8301, SENDER_4417, SYNTHETIC.senderName, SYNTHETIC.senderRfc, SYNTHETIC.beneficiaryRfc]) {
      expect(body).not.toContain(secret);
    }
  });

  it("a row that never matched answers match: null", async () => {
    const business = await seedBusiness();
    const payment = await seedConfirmedPayment(business, { trackingKey: "TRACK001XYZ" });
    const res = await (await app()).request(
      `/payments/${payment.id}/proof`,
      { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } },
      env,
    );
    expect((await res.json()).data.match).toBeNull();
  });

  it("the candidates are the business's own records — another business's record of the same clave never fills them (constitution V)", async () => {
    const business = await seedBusiness({ speiClabe: BUSINESS_CLABE, speiBank: "BBVA MEXICO" });
    const payment = await seedDecided(business, { time: "07:10:58", tail: "8301" });
    /* the same claves, recorded by another business at another time */
    const other = await seedBusiness({ email: "otro@business.mx" });
    await seedBundle(other.id, [MINE, THEIRS], { creditTime: "09:00:00" });
    /* this business loses its records (a cleanup, say): the trail stands,
       and nothing of the other business's is borrowed to fill it */
    await db().delete(cepRecords).where(eq(cepRecords.businessId, business.id));

    const res = await (await app()).request(
      `/payments/${payment.id}/proof`,
      { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } },
      env,
    );
    const { data } = await res.json();
    expect(data.match.candidates).toEqual([
      expect.objectContaining({ clave: MINE.clave, creditTime: "07:11:20", amountCents: null, senderBank: null, senderTail: "8301" }),
      expect.objectContaining({ clave: THEIRS.clave, creditTime: "11:40:47", amountCents: null, senderBank: null, senderTail: "4171" }),
    ]);
    const [row] = await db().select().from(payments).where(eq(payments.id, payment.id));
    expect(row.matchDistanceS).toBe(22);
  });
});

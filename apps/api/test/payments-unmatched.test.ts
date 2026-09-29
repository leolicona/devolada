import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { cepBundles, cepRecords, payments } from "../src/db/schema";
import { parseCadena } from "../src/consta/bundle/cadena";
import { matchCandidates } from "../src/consta/bundle/match";
import { recordsFor } from "../src/consta/bundle/store";
import { trailOf } from "../src/direct-payments/cep-match";
import { feedResponse, unmatchedTransfersResponse } from "../src/routes/payments/schema";
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

describe("cep-bundle-match US4: the transfers received that no payment holds (FR-009)", () => {
  const asOwner = async (email = "demo@devolada.app") => ({ headers: { Cookie: await sessionCookieHeader(email) } });
  const unmatched = async (query = "?from=2026-09-01", init?: RequestInit) => {
    const res = await (await app()).request(`/payments/unmatched-transfers${query}`, init ?? (await asOwner()), env);
    return { status: res.status, body: await res.json() };
  };
  const EVENING = transfer("260926190099000023I", "19:00:05", "127180555555512344");

  it("lists the records no live payment holds — amount, credit time, bank and four digits — newest credit first", async () => {
    const business = await seedBusiness({ speiClabe: BUSINESS_CLABE, speiBank: "BBVA MEXICO" });
    await seedBundle(business.id, [MINE, THEIRS, EVENING]);
    /* MINE paid a payment: held */
    await seedConfirmedPayment(business, { trackingKey: MINE.clave });

    const { status, body } = await unmatched();
    expect(status).toBe(200);
    expect(unmatchedTransfersResponse.parse(body.data)).toEqual({
      transfers: [
        { clave: EVENING.clave, creditDate: "2026-09-26", creditTime: "19:00:05", amountCents: 300, senderBank: "AZTECA", senderTail: "2344" },
        { clave: THEIRS.clave, creditDate: "2026-09-26", creditTime: "11:40:47", amountCents: 300, senderBank: "AZTECA", senderTail: "4171" },
      ],
    });
    /* FR-010: four digits, never the account, never a name */
    const text = JSON.stringify(body);
    for (const secret of [SENDER_4417, "127180555555512344", SYNTHETIC.senderName, SYNTHETIC.senderRfc]) expect(text).not.toContain(secret);
  });

  it("a clave released by its payment — invalid, expired or superseded — is unmatched again", async () => {
    const business = await seedBusiness({ speiClabe: BUSINESS_CLABE, speiBank: "BBVA MEXICO" });
    await seedBundle(business.id, [MINE, THEIRS]);
    await seedConfirmedPayment(business, { trackingKey: MINE.clave, status: "expired" });
    await seedConfirmedPayment(business, { trackingKey: THEIRS.clave, status: "validating" });
    const { body } = await unmatched();
    expect(body.data.transfers.map((t: { clave: string }) => t.clave)).toEqual([MINE.clave]);
  });

  it("never shows another business's records, and a viewer may read its own", async () => {
    const business = await seedBusiness({ speiClabe: BUSINESS_CLABE, speiBank: "BBVA MEXICO" });
    await seedBundle(business.id, [THEIRS]);
    const other = await seedBusiness({ email: "otro@business.mx" });
    await seedBundle(other.id, [MINE, EVENING]);
    await seedMember(business, "lector@wifiplus.mx", "viewer");

    const { status, body } = await unmatched("?from=2026-09-01", await asOwner("lector@wifiplus.mx"));
    expect(status).toBe(200);
    expect(body.data.transfers.map((t: { clave: string }) => t.clave)).toEqual([THEIRS.clave]);
  });

  it("`from` filters by credit day; absent, it is the last 30 days; malformed, a 400", async () => {
    const business = await seedBusiness({ speiClabe: BUSINESS_CLABE, speiBank: "BBVA MEXICO" });
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const recent = { ...transfer("260926190099000024I", "10:00:00", SENDER_4417), operationDay: daysAgo(2), creditDay: daysAgo(2) };
    const old = { ...transfer("260926190099000025I", "10:00:00", SENDER_4417), operationDay: daysAgo(40), creditDay: daysAgo(40) };
    await seedBundle(business.id, [recent, old]);

    expect((await unmatched("")).body.data.transfers.map((t: { clave: string }) => t.clave)).toEqual([recent.clave]);
    expect((await unmatched(`?from=${daysAgo(45)}`)).body.data.transfers.map((t: { clave: string }) => t.clave)).toEqual([
      recent.clave,
      old.clave,
    ]);
    expect((await unmatched("?from=septiembre")).status).toBe(400);
  });

  it("the payer's status never carries another sender's transfer", async () => {
    const business = await seedBusiness({ speiClabe: BUSINESS_CLABE, speiBank: "BBVA MEXICO" });
    const payment = await seedDecided(business, { time: "07:10:58", tail: "8301" });
    const res = await (await app()).request(`/direct-payments/${payment.id}/status`, {}, env);
    const text = JSON.stringify(await res.json());
    for (const other of [THEIRS.clave, SENDER_4417, "4171", "11:40:47"]) expect(text).not.toContain(other);
  });
});

/* converge T055 (SC-004): the feed carries why an undecided payment waits —
   the reason the panel shows in words, proven here at the layer that
   computes it rather than through a fixture */
describe("cep-bundle-match US3: the feed carries the undecided reason", () => {
  it("each undecided row reads its trail's reason; a pending download, an ordinary wait and a confirmed row read null", async () => {
    const business = await seedBusiness();
    const reasons = ["all_used", "no_signal", "too_close", "none_fit", "unreadable", "too_large"] as const;
    const waiting = { status: "validating" as const, actionOutcome: null, confirmedAt: null, receivedCents: null, registeredCents: null };
    for (const reason of reasons) {
      await seedConfirmedPayment(business, {
        ...waiting,
        customerName: `Indeciso ${reason}`,
        lastError: "CEP_UNDECIDED",
        disputedFields: JSON.stringify(["trackingKey"]),
        nextValidationAt: null,
        matchTrail: JSON.stringify(
          trailOf("several", null, { time: null, tail: null }, { decided: "undecided", reason, trail: [] }),
        ),
      });
    }
    await seedConfirmedPayment(business, {
      ...waiting,
      customerName: "Descargando",
      lastError: "CEP_BUNDLE_PENDING",
      nextValidationAt: new Date(Date.now() + 120_000),
    });
    await seedConfirmedPayment(business, {
      ...waiting,
      customerName: "Esperando a Banxico",
      lastError: "TRANSFER_NOT_FOUND",
      nextValidationAt: new Date(Date.now() + 120_000),
    });
    await seedConfirmedPayment(business, { customerName: "Pagado" });

    const res = await (await app()).request(
      "/payments/feed",
      { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } },
      env,
    );
    expect(res.status).toBe(200);
    const { payments: rows } = feedResponse.parse((await res.json()).data);
    const byName = Object.fromEntries(rows.map((r) => [r.customerName, r.undecided ?? null]));
    expect(byName).toEqual({
      ...Object.fromEntries(reasons.map((reason) => [`Indeciso ${reason}`, reason])),
      Descargando: null,
      "Esperando a Banxico": null,
      Pagado: null,
    });
  });

  /* bug: single-cep-unreadable — "varias coincidencias" was false for a
     search that found one transfer; the panel words it by the source */
  it("bug: single-cep-unreadable — each undecided row says whether one transfer or several were found; every other row reads null", async () => {
    const business = await seedBusiness();
    const waiting = { status: "validating" as const, actionOutcome: null, confirmedAt: null, receivedCents: null, registeredCents: null };
    for (const source of ["single", "several"] as const) {
      await seedConfirmedPayment(business, {
        ...waiting,
        customerName: `Indeciso ${source}`,
        lastError: "CEP_UNDECIDED",
        disputedFields: JSON.stringify(["trackingKey"]),
        nextValidationAt: null,
        matchTrail: JSON.stringify(
          trailOf(source, null, { time: "09:14", tail: null }, { decided: "undecided", reason: "unreadable", trail: [] }),
        ),
      });
    }
    await seedConfirmedPayment(business, { customerName: "Pagado" });

    const res = await (await app()).request(
      "/payments/feed",
      { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } },
      env,
    );
    const { payments: rows } = feedResponse.parse((await res.json()).data);
    const byName = Object.fromEntries(rows.map((r) => [r.customerName, [r.undecided ?? null, r.undecidedSource]]));
    expect(byName).toEqual({
      "Indeciso single": ["unreadable", "single"],
      "Indeciso several": ["unreadable", "several"],
      Pagado: [null, null],
    });
  });
});

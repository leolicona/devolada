import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchMock } from "cloudflare:test";
import { eq, inArray } from "drizzle-orm";
import { businesses, payerReferenceCustomers, payerReferences, paymentLinks, payments } from "../src/db/schema";
import { directPaymentStatusResponse, payResponse } from "../src/routes/direct-payments/schema";
import { accountsOfOthers, customerKeyOf, referenceOfLink } from "../src/direct-payments/payer-reference";
import { SENDER_4417, SENDER_8301, type SyntheticTransfer } from "./consta/bundle-fixtures";
import {
  BUSINESS_CLABE,
  businessToday,
  db,
  linkRead,
  mockNotFound,
  mockSeveral,
  mockTieBreakSearch,
  pay,
  providerCalls,
  rowById,
  seedApiLink,
  seedPaidBy,
  seedReferenceBusiness,
  shiftDay,
  status,
  stepTo,
  tieBreakTransfers,
} from "./payer-helpers";

/* confirmation-hierarchy — a typed reference tied to the payer by
   history or by one short answer (US2), and the accounts that pay for
   several people, which never decide alone (US3). The lifecycle runs in
   workerd against a real D1; apiCEP answers at its pinned origin, and an
   answer is proven to spend no call by the provider's own log. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const TODAY = businessToday();
type Business = typeof businesses.$inferSelect;
type Link = typeof paymentLinks.$inferSelect;

/* An API customer and the reference its first read gives it (API links
   keep these suites off WispHub, as payment-without-receipt's do) */
async function apiPayer(business: Business, customerRef: string, askCents = 35000) {
  const link = await seedApiLink(business, customerRef, { askCents });
  const read = await linkRead(link.token);
  return { link, digits: read.body.data!.payerReference.digits as string };
}

/* One person, two services (012 D4): a second customer joins the first's
   reference */
async function samePerson(business: Business, first: Link, customerRef: string) {
  const reference = await referenceOfLink(db(), first);
  const link = await seedApiLink(business, customerRef);
  await db().insert(payerReferenceCustomers).values({
    businessId: business.id,
    referenceId: reference!.id,
    source: "api",
    customerKey: customerRef,
  });
  return link;
}

const digits = (account: string) => account.replace(/\D/g, "");

/* `accountsOfOthers` as the matcher reads it: for the payer of `link`,
   which of `accounts` have paid another person */
async function othersFor(business: Business, link: Link, accounts: string[]) {
  const reference = await referenceOfLink(db(), link);
  return accountsOfOthers(db(), business.id, reference?.id ?? null, customerKeyOf(link), accounts);
}

describe("confirmation-hierarchy US3: which accounts have paid another person (T005, D4)", () => {
  it("an account that paid only customer A is not another person's for A", async () => {
    const business = await seedReferenceBusiness();
    const { link: a } = await apiPayer(business, "ana");
    await seedPaidBy(db(), { businessId: business.id, link: a, account: SENDER_8301 });
    expect([...(await othersFor(business, a, [SENDER_8301]))]).toEqual([]);
  });

  it("an account that paid A and B, two people, is another person's for A and for B", async () => {
    const business = await seedReferenceBusiness();
    const { link: a } = await apiPayer(business, "ana");
    const { link: b } = await apiPayer(business, "beto");
    await seedPaidBy(db(), { businessId: business.id, link: a, account: SENDER_8301 });
    await seedPaidBy(db(), { businessId: business.id, link: b, account: SENDER_8301 });
    await seedPaidBy(db(), { businessId: business.id, link: b, account: SENDER_4417 });
    expect([...(await othersFor(business, a, [SENDER_8301, SENDER_4417]))].sort()).toEqual(
      [digits(SENDER_8301), digits(SENDER_4417)].sort(),
    );
    expect([...(await othersFor(business, b, [SENDER_8301, SENDER_4417]))]).toEqual([digits(SENDER_8301)]);
  });

  it("an account that paid two services of one person stays that person's", async () => {
    const business = await seedReferenceBusiness();
    const { link: home } = await apiPayer(business, "casa");
    const office = await samePerson(business, home, "oficina");
    await seedPaidBy(db(), { businessId: business.id, link: home, account: SENDER_8301 });
    await seedPaidBy(db(), { businessId: business.id, link: office, account: SENDER_8301 });
    expect([...(await othersFor(business, home, [SENDER_8301]))]).toEqual([]);
    expect([...(await othersFor(business, office, [SENDER_8301]))]).toEqual([]);
  });

  it("a paid customer with no reference is another person — unless it is the customer being confirmed", async () => {
    const business = await seedReferenceBusiness();
    const { link: a } = await apiPayer(business, "ana");
    /* never read: no reference was ever born for it */
    const bare = await seedApiLink(business, "sin-referencia");
    await seedPaidBy(db(), { businessId: business.id, link: bare, account: SENDER_4417 });
    expect([...(await othersFor(business, a, [SENDER_4417]))]).toEqual([digits(SENDER_4417)]);
    expect([...(await othersFor(business, bare, [SENDER_4417]))]).toEqual([]);
  });

  it("another business's payment from the same account is never read", async () => {
    const business = await seedReferenceBusiness();
    const elsewhere = await seedReferenceBusiness();
    const { link: a } = await apiPayer(business, "ana");
    const { link: theirs } = await apiPayer(elsewhere, "otro");
    await seedPaidBy(db(), { businessId: elsewhere.id, link: theirs, account: SENDER_8301 });
    expect([...(await othersFor(business, a, [SENDER_8301]))]).toEqual([]);
    expect([...(await othersFor(elsewhere, theirs, [SENDER_8301]))]).toEqual([]);
  });
});

/* ---- US2: the typed reference and its tie-break ---- */

/* Azteca's default reference: the business's own CLABE tail, which no
   person may hold (012 D3) — the shared reference strangers type */
const SHARED = BUSINESS_CLABE.slice(-7);

/* "Usé otra referencia": a reference the payer typed */
const typed = (link: Link, referenceNumber = SHARED, over: Record<string, unknown> = {}) =>
  pay(link.token, { transfer: { referenceSource: "typed", referenceNumber, senderBank: "AZTECA", date: TODAY, ...over } });

/* An answer to the tie-break, as the page sends it: the waiting row's
   search, the tails typed, `supersedes` the waiting row */
const answer = (link: Link, waitingId: string, tails: { senderTail?: string; claveTail?: string }, referenceNumber = SHARED) =>
  pay(link.token, {
    transfer: { referenceSource: "typed", referenceNumber, senderBank: "AZTECA", date: TODAY, amountCents: 35150, ...tails },
    supersedes: waitingId,
  });

const own = (link: Link, over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  pay(link.token, { transfer: { referenceSource: "own", senderBank: "AZTECA", date: TODAY, ...over }, ...extra });

const read = async (id: string) => directPaymentStatusResponse.parse((await status(id)).data);
const idOf = (res: Awaited<ReturnType<typeof pay>>) => payResponse.parse(res.body.data).directPaymentId;

/* A typed …44 on `link`, waiting on its tie-break */
async function waitingOn44(link: Link) {
  const transfers = mockTieBreakSearch("44", TODAY);
  const res = await typed(link);
  expect(res.status).toBe(201);
  const [from8301, from4417] = transfers;
  return { id: idOf(res), from8301, from4417 };
}

describe("confirmation-hierarchy US2: a typed reference searches at once and asks the tie-break (T014, D5, D9)", () => {
  it("…44: one search, never SENDER_TAIL_NEEDED — validating, undecided, asking tie_break with both ways and several", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const { id } = await waitingOn44(link);
    expect(await providerCalls()).toBe(1);
    expect(await rowById(id)).toMatchObject({ status: "validating", lastError: "CEP_UNDECIDED", nextValidationAt: null, tieBreak: null });
    const s = await read(id);
    expect(s).toMatchObject({
      status: "validating",
      error: "CEP_UNDECIDED",
      referenceSource: "typed",
      ask: "tie_break",
      tieBreak: { ways: ["sender_tail", "clave_tail"], missed: false, several: true },
    });
  });

  it("…66, one transfer: asked too — one match on a shared reference is not proof (FR-009)", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    mockTieBreakSearch("66", TODAY);
    const id = idOf(await typed(link));
    expect(await read(id)).toMatchObject({ ask: "tie_break", tieBreak: { ways: ["sender_tail", "clave_tail"], missed: false, several: false } });
  });

  it("an exclusive learned account tying one transfer confirms it, nothing asked, by learned_account (FR-010)", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    await seedPaidBy(db(), { businessId: business.id, link, account: SENDER_4417 });
    const { id, from4417 } = await waitingOn44(link);
    const row = await rowById(id);
    expect(row).toMatchObject({ status: "confirmed", trackingKey: from4417.clave, tieBreak: null });
    expect(JSON.parse(row.matchTrail!)).toMatchObject({ by: "learned_account" });
  });

  it("the characters 0412 confirm from the kept record with no call: by clave_tail, tie_break one, no misses", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const { id, from4417 } = await waitingOn44(link);
    const calls = await providerCalls();
    const res = await answer(link, id, { claveTail: "0412" });
    expect(res.status).toBe(201);
    const row = await rowById(idOf(res));
    expect(row).toMatchObject({ status: "confirmed", trackingKey: from4417.clave, tieBreak: "one", claveTail: "0412", supersedesId: id });
    expect(JSON.parse(row.matchTrail!)).toMatchObject({ decided: "chosen", by: "clave_tail" });
    expect(JSON.parse(row.confirmation!)).toMatchObject({ tieBreakMisses: 0 });
    expect(await providerCalls()).toBe(calls);
    expect((await rowById(id)).status).toBe("superseded");
  });

  it("the digits 4417 confirm by sender_tail; 9771 in the characters fits …977I", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const first = await waitingOn44(link);
    const byDigits = await rowById(idOf(await answer(link, first.id, { senderTail: "4417" })));
    expect(byDigits).toMatchObject({ status: "confirmed", trackingKey: first.from4417.clave });
    expect(JSON.parse(byDigits.matchTrail!)).toMatchObject({ by: "sender_tail" });

    const { link: other } = await apiPayer(business, "beto");
    const second = await waitingOn44(other);
    const byLetters = await rowById(idOf(await answer(other, second.id, { claveTail: "9771" })));
    expect(byLetters).toMatchObject({ status: "confirmed", trackingKey: second.from8301.clave });
  });

  it("8301 with 0412 — two transfers — confirms nothing: tie_break none, the trail carried, missed", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const { id } = await waitingOn44(link);
    const miss = idOf(await answer(link, id, { senderTail: "8301", claveTail: "0412" }));
    const row = await rowById(miss);
    expect(row).toMatchObject({ status: "validating", lastError: "CEP_UNDECIDED", tieBreak: "none", nextValidationAt: null });
    const trail = JSON.parse(row.matchTrail!);
    expect(trail.candidates.filter((c: { fate: string }) => c.fate === "kept")).toHaveLength(2);
    expect(await read(miss)).toMatchObject({ ask: "tie_break", tieBreak: { ways: ["sender_tail", "clave_tail"], missed: true, several: true } });
  });

  it("…55: the characters 5510 leave both — tie_break several, the digits asked — and 4417 with the characters carried confirms", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const [, from4417] = mockTieBreakSearch("55", TODAY);
    const id = idOf(await typed(link));
    const several = idOf(await answer(link, id, { claveTail: "5510" }));
    expect(await rowById(several)).toMatchObject({ tieBreak: "several", claveTail: "5510", senderTail: null });
    expect(await read(several)).toMatchObject({ ask: "tie_break", tieBreak: { ways: ["sender_tail"], missed: false } });
    /* the page sends only the field it shows; the characters ride forward */
    const done = await rowById(idOf(await answer(link, several, { senderTail: "4417" })));
    expect(done).toMatchObject({ status: "confirmed", trackingKey: from4417.clave, senderTail: "4417", claveTail: "5510" });
    expect(JSON.parse(done.matchTrail!)).toMatchObject({ by: "clave_tail" });
  });

  it("both ways given and several left asks the whole clave", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const t = (end: string, time: string): SyntheticTransfer => ({
      clave: `MOCKREF77${TODAY.replace(/-/g, "")}${crypto.randomUUID().slice(0, 4).toUpperCase()}${end}`,
      operationDay: TODAY,
      creditDay: TODAY,
      creditTime: time,
      senderAccount: SENDER_8301,
      beneficiaryAccount: BUSINESS_CLABE,
      amount: "351.50",
    });
    mockSeveral([t("A5510", "07:00:00"), t("B5510", "08:00:00")]);
    const id = idOf(await typed(link));
    const both = idOf(await answer(link, id, { senderTail: "8301", claveTail: "5510" }));
    expect(await rowById(both)).toMatchObject({ tieBreak: "several" });
    expect(await read(both)).toMatchObject({ ask: "clave", tieBreak: null });
  });

  it("three misses on a link ask the whole clave; a fourth tail is TIE_BREAK_EXHAUSTED and writes no row; a whole clave still confirms", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const { id, from4417 } = await waitingOn44(link);
    let waiting = id;
    for (const digits of ["1111", "2222", "3333"]) {
      waiting = idOf(await answer(link, waiting, { senderTail: digits }));
      expect((await rowById(waiting)).tieBreak).toBe("none");
    }
    expect(await read(waiting)).toMatchObject({ ask: "clave", tieBreak: null });
    const rows = (await db().select().from(payments)).length;
    const fourth = await answer(link, waiting, { claveTail: "0412" });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error?.code).toBe("TIE_BREAK_EXHAUSTED");
    expect(await db().select().from(payments)).toHaveLength(rows);
    /* the whole clave is never limited (FR-016) */
    const calls = await providerCalls();
    const byClave = await pay(link.token, { transfer: { trackingKey: from4417.clave, senderBank: "AZTECA", date: TODAY }, supersedes: waiting });
    expect(byClave.status).toBe(201);
    const confirmed = await rowById(idOf(byClave));
    expect(confirmed).toMatchObject({ status: "confirmed", trackingKey: from4417.clave });
    expect(JSON.parse(confirmed.confirmation!)).toMatchObject({ tieBreakMisses: 3 });
    expect(await providerCalls()).toBe(calls);
  });

  it("the window moves: misses at t, t+1 h and t+2 h; at t+24 h+1 min one more answer is accepted and a second refused", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const { id } = await waitingOn44(link);
    let waiting = id;
    const misses: string[] = [];
    for (const digits of ["1111", "2222", "3333"]) {
      waiting = idOf(await answer(link, waiting, { senderTail: digits }));
      misses.push(waiting);
    }
    /* step the clock back instead: the first miss is now 24 h + 1 min old,
       the other two 23 h and 22 h */
    const now = Date.now();
    const ages = [24 * 60 + 1, 23 * 60, 22 * 60];
    for (const [i, missId] of misses.entries()) {
      await db().update(payments).set({ createdAt: new Date(now - ages[i] * 60_000) }).where(eq(payments.id, missId));
    }
    expect(await read(waiting)).toMatchObject({ ask: "tie_break", tieBreak: { missed: true } });
    const accepted = await answer(link, waiting, { senderTail: "4444" });
    expect(accepted.status).toBe(201);
    const refused = await answer(link, idOf(accepted), { senderTail: "5555" });
    expect(refused.body.error?.code).toBe("TIE_BREAK_EXHAUSTED");
  });

  it("a miss followed by a fitting answer confirms with one miss recorded", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const { id, from8301 } = await waitingOn44(link);
    const miss = idOf(await answer(link, id, { claveTail: "ZZZZ" }));
    const done = await rowById(idOf(await answer(link, miss, { claveTail: "977I" })));
    expect(done).toMatchObject({ status: "confirmed", trackingKey: from8301.clave });
    expect(JSON.parse(done.confirmation!)).toMatchObject({ tieBreakMisses: 1 });
  });

  it("answers never count toward the hourly budget: two misses after three confirmations and corrections, and a sixth row that is an answer is accepted", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    mockTieBreakSearch("44", TODAY);
    let id = idOf(await typed(link));
    for (const bank of ["BANORTE", "NUBANK"]) {
      mockTieBreakSearch("44", TODAY);
      id = idOf(await pay(link.token, { transfer: { referenceSource: "typed", referenceNumber: SHARED, senderBank: bank, date: TODAY }, supersedes: id }));
    }
    expect((await rowById(id)).correctionCount).toBe(2);
    const answerAt = (waitingId: string, tails: Record<string, string>) =>
      pay(link.token, { transfer: { referenceSource: "typed", referenceNumber: SHARED, senderBank: "NUBANK", date: TODAY, ...tails }, supersedes: waitingId });
    id = idOf(await answerAt(id, { senderTail: "1111" }));
    id = idOf(await answerAt(id, { senderTail: "2222" }));
    const sixth = await answerAt(id, { claveTail: "0412" });
    expect(sixth.status).toBe(201);
    expect(await rowById(idOf(sixth))).toMatchObject({ status: "confirmed", correctionCount: 2 });
  });

  it("an answer keeps the waiting row's search, ladder_round and correction_count, whatever the body says", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const { id } = await waitingOn44(link);
    const waiting = await rowById(id);
    const res = await pay(link.token, {
      transfer: { referenceSource: "typed", referenceNumber: "5550001", senderBank: "BANORTE", date: shiftDay(TODAY, -2), senderTail: "9999" },
      supersedes: id,
    });
    expect(res.status).toBe(201);
    expect(await rowById(idOf(res))).toMatchObject({
      referenceNumber: SHARED,
      senderBank: "AZTECA",
      transferDate: TODAY,
      ladderRound: waiting.ladderRound,
      correctionCount: waiting.correctionCount,
      tieBreak: "none",
    });
  });

  it("a tail on a row not waiting on a tie-break is TIE_BREAK_NOT_ASKED: no row, no call; so is the second of two tabs", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    mockNotFound();
    const notFound = idOf(await own(link));
    const before = (await db().select().from(payments)).length;
    const calls = await providerCalls();
    const refused = await own(link, { senderTail: "4417" }, { supersedes: notFound });
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("TIE_BREAK_NOT_ASKED");
    expect(await db().select().from(payments)).toHaveLength(before);
    expect(await providerCalls()).toBe(calls);

    const { link: other } = await apiPayer(business, "beto");
    const { id } = await waitingOn44(other);
    expect((await answer(other, id, { claveTail: "1234" })).status).toBe(201);
    const late = await answer(other, id, { senderTail: "4417" });
    expect(late.body.error?.code).toBe("TIE_BREAK_NOT_ASKED");
  });

  it("an answer naming a transfer another payment took meanwhile hears it was already used, with no call", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const { id, from4417 } = await waitingOn44(link);
    const { link: other } = await apiPayer(business, "beto");
    await db().insert(payments).values({
      paymentLinkId: other.id,
      businessId: business.id,
      amountCents: 35150,
      invoiceCents: 35000,
      serviceFeeCents: 150,
      proofMode: "transfer",
      status: "confirmed",
      trackingKey: from4417.clave,
      confirmedAt: new Date(),
    });
    const calls = await providerCalls();
    const res = await answer(link, id, { senderTail: "4417" });
    expect(await rowById(idOf(res))).toMatchObject({ status: "invalid", lastError: "TRANSFER_ALREADY_USED", tieBreak: null });
    expect(await providerCalls()).toBe(calls);
  });

  it("an answer naming a transfer the search already found used hears it was used — never a miss", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const transfers = tieBreakTransfers("44", TODAY);
    const [, from4417] = transfers;
    const { link: other } = await apiPayer(business, "beto");
    await db().insert(payments).values({
      paymentLinkId: other.id,
      businessId: business.id,
      amountCents: 35150,
      invoiceCents: 35000,
      serviceFeeCents: 150,
      proofMode: "transfer",
      status: "confirmed",
      trackingKey: from4417.clave,
      confirmedAt: new Date(),
    });
    mockSeveral(transfers);
    const id = idOf(await typed(link));
    expect(await read(id)).toMatchObject({ ask: "tie_break", tieBreak: { several: false } });
    const res = await answer(link, id, { senderTail: "4417" });
    expect(await rowById(idOf(res))).toMatchObject({ status: "invalid", lastError: "TRANSFER_ALREADY_USED", tieBreak: null });
  });

  it("an unanswered tie-break keeps no slot and never expires: no call at any slot", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const { id } = await waitingOn44(link);
    for (const minutes of [2, 8, 20, 45, 120, 360, 720, 1440]) {
      expect(await stepTo(id, minutes)).toMatchObject({ claimed: 0 });
    }
    expect(await rowById(id)).toMatchObject({ status: "validating", lastError: "CEP_UNDECIDED", nextValidationAt: null });
    expect(await providerCalls()).toBe(1);
    expect((await read(id)).ask).toBe("tie_break");
  });

  it("012's typed cases that stand: another person's reference is refused, unsafe digits search as a shared reference, the payer's own is own", async () => {
    const business = await seedReferenceBusiness();
    const { digits: theirs } = await apiPayer(business, "otro");
    const { link, digits: mine } = await apiPayer(business, "yo");
    const refused = await typed(link, theirs);
    expect(refused.body.error?.code).toBe("REFERENCE_OF_ANOTHER");
    expect(await db().select().from(payments)).toHaveLength(0);

    for (const unsafe of ["1234567", "0123999"]) {
      mockTieBreakSearch("44", TODAY);
      const id = idOf(await typed(link, unsafe));
      expect(await rowById(id)).toMatchObject({ referenceSource: "typed", referenceNumber: unsafe, senderTail: null });
      expect((await read(id)).ask).toBe("tie_break");
    }

    mockNotFound();
    const asOwn = await typed(link, mine);
    expect(await rowById(idOf(asOwn))).toMatchObject({ referenceSource: "own", referenceNumber: mine });
  });

  it("no status or pay response carries account digits, candidate claves or a list of candidates (FR-018)", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const transfers = mockTieBreakSearch("44", TODAY);
    const paid = await typed(link);
    const id = idOf(paid);
    const miss = await answer(link, id, { senderTail: "9999" });
    const bodies = JSON.stringify([paid.body, miss.body, (await status(id)).data, (await status(idOf(miss))).data, (await linkRead(link.token)).body]);
    for (const t of transfers) {
      expect(bodies).not.toContain(t.clave);
      expect(bodies).not.toContain(t.clave.slice(-4));
      expect(bodies).not.toContain(t.senderAccount);
      expect(bodies).not.toContain(t.senderAccount.slice(-4));
    }
    /* 8301 is the account number inside its CLABE (positions 14–17); 4417's
       would collide with the business's own CLABE tail, which every link
       read shows, so only 8301's is looked for */
    expect(bodies).not.toContain("8301");
    expect(bodies).not.toMatch(/candidates|senderAccount|"tail"/);
  });
});

/* ---- US3: an account that pays for several people ---- */

describe("confirmation-hierarchy US3: an account that pays for several people never decides alone (T023, D4, D10)", () => {
  /* Account 8301 paid A last month and B (another person) since */
  async function sharedBetweenTwo(business: Business) {
    const { link: a } = await apiPayer(business, "ana");
    const { link: b } = await apiPayer(business, "beto");
    await seedPaidBy(db(), { businessId: business.id, link: a, account: SENDER_8301 });
    await seedPaidBy(db(), { businessId: business.id, link: b, account: SENDER_8301 });
    return { a, b };
  }

  it("A's typed …44 meets the tie-break: 8301 is learned for A but not A's alone", async () => {
    const business = await seedReferenceBusiness();
    const { a } = await sharedBetweenTwo(business);
    const { id } = await waitingOn44(a);
    expect(await rowById(id)).toMatchObject({ status: "validating", lastError: "CEP_UNDECIDED" });
    expect((await read(id)).ask).toBe("tie_break");
  });

  it("A answering the digits 8301 is asked the characters only; the right ones confirm", async () => {
    const business = await seedReferenceBusiness();
    const { a } = await sharedBetweenTwo(business);
    const { id, from8301 } = await waitingOn44(a);
    const digits = idOf(await answer(a, id, { senderTail: "8301" }));
    expect(await rowById(digits)).toMatchObject({ status: "validating", tieBreak: "one" });
    expect(await read(digits)).toMatchObject({ ask: "tie_break", tieBreak: { ways: ["clave_tail"], missed: false } });
    const done = await rowById(idOf(await answer(a, digits, { claveTail: "977I" })));
    expect(done).toMatchObject({ status: "confirmed", trackingKey: from8301.clave });
    expect(JSON.parse(done.matchTrail!)).toMatchObject({ by: "clave_tail" });
  });

  it("the same holds for B, the other person: history does not decide for either", async () => {
    const business = await seedReferenceBusiness();
    const { b } = await sharedBetweenTwo(business);
    const { id } = await waitingOn44(b);
    expect((await read(id)).ask).toBe("tie_break");
    const digits = idOf(await answer(b, id, { senderTail: "8301" }));
    expect(await read(digits)).toMatchObject({ tieBreak: { ways: ["clave_tail"] } });
  });

  it("a customer whose learned 4417 is theirs alone is confirmed with no question", async () => {
    const business = await seedReferenceBusiness();
    await sharedBetweenTwo(business);
    const { link: c } = await apiPayer(business, "carla");
    await seedPaidBy(db(), { businessId: business.id, link: c, account: SENDER_4417 });
    const { id, from4417 } = await waitingOn44(c);
    const row = await rowById(id);
    expect(row).toMatchObject({ status: "confirmed", trackingKey: from4417.clave });
    expect(JSON.parse(row.matchTrail!)).toMatchObject({ by: "learned_account" });
  });

  it("exclusivity is read at the tie: what 4417 decided while it was Carla's stays; once it pays another person, the next tie asks", async () => {
    const business = await seedReferenceBusiness();
    const { link: c } = await apiPayer(business, "carla");
    await seedPaidBy(db(), { businessId: business.id, link: c, account: SENDER_4417 });
    const first = await waitingOn44(c);
    expect((await rowById(first.id)).status).toBe("confirmed");

    const { link: d } = await apiPayer(business, "dario");
    await seedPaidBy(db(), { businessId: business.id, link: d, account: SENDER_4417 });
    expect((await rowById(first.id)).status).toBe("confirmed");
    const next = await waitingOn44(c);
    expect(await rowById(next.id)).toMatchObject({ status: "validating", lastError: "CEP_UNDECIDED" });
  });

  it("own reference, two of the person's transfers, the learned account shared with another person: the earliest not yet used confirms", async () => {
    const business = await seedReferenceBusiness();
    const { a } = await sharedBetweenTwo(business);
    const early = { clave: `OWNEARLY${crypto.randomUUID().slice(0, 8).toUpperCase()}`, operationDay: TODAY, creditDay: TODAY, creditTime: "07:00:00", senderAccount: SENDER_4417, beneficiaryAccount: BUSINESS_CLABE, amount: "351.50" };
    const shared = { ...early, clave: `OWNLATE${crypto.randomUUID().slice(0, 8).toUpperCase()}`, creditTime: "11:00:00", senderAccount: SENDER_8301 };
    mockSeveral([shared, early]);
    const row = await rowById(idOf(await own(a)));
    expect(row).toMatchObject({ status: "confirmed", trackingKey: early.clave });
    expect(JSON.parse(row.matchTrail!)).toMatchObject({ by: "earliest" });
  });

  /* 012 D26: Juan held 7815678; a phone ending in it came, and the row
     passed to Ana — the state `ensurePayerReference` leaves */
  async function handedOver(business: Business) {
    const { link: juan } = await apiPayer(business, "juan");
    const juans = await referenceOfLink(db(), juan);
    const ana = await seedApiLink(business, "ana-nueva");
    const [passed] = await db()
      .insert(payerReferences)
      .values({
        businessId: business.id,
        digits: "7815678",
        origin: "phone",
        previousReferenceId: juans!.id,
        transitionEndsAt: new Date(Date.now() + 60 * 86_400_000),
        changedAt: new Date(),
      })
      .returning();
    await db().insert(payerReferenceCustomers).values({ businessId: business.id, referenceId: passed.id, source: "api", customerKey: "ana-nueva" });
    return { juan, ana };
  }

  it("the transition: Juan's previous digits, from an account not his alone, ask the tie-break", async () => {
    const business = await seedReferenceBusiness();
    const { juan } = await handedOver(business);
    const { link: other } = await apiPayer(business, "otro");
    await seedPaidBy(db(), { businessId: business.id, link: juan, account: SENDER_8301 });
    await seedPaidBy(db(), { businessId: business.id, link: other, account: SENDER_8301 });
    mockTieBreakSearch("44", TODAY);
    const id = idOf(await typed(juan, "7815678"));
    expect(await rowById(id)).toMatchObject({ status: "validating", referenceSource: "typed", lastError: "CEP_UNDECIDED" });
    expect((await read(id)).ask).toBe("tie_break");
  });

  it("the transition: the new owner's transfer from an account not known for her asks the tie-break with both ways — and her answer confirms", async () => {
    const business = await seedReferenceBusiness();
    const { juan, ana } = await handedOver(business);
    await seedPaidBy(db(), { businessId: business.id, link: juan, account: SENDER_8301 });
    const [, from4417] = mockTieBreakSearch("44", TODAY);
    const id = idOf(await own(ana));
    const trail = JSON.parse((await rowById(id)).matchTrail!);
    expect(trail.candidates.find((c: { why: string }) => c.why === "excluded")).toBeTruthy();
    expect(await read(id)).toMatchObject({ referenceSource: "own", ask: "tie_break", tieBreak: { ways: ["sender_tail", "clave_tail"], several: false } });
    const done = await own(ana, { senderTail: "4417" }, { supersedes: id });
    expect(await rowById(idOf(done))).toMatchObject({ status: "confirmed", trackingKey: from4417.clave, referenceSource: "own" });
  });
});

/* every row this suite writes stays inside its business (constitution V) */
describe("confirmation-hierarchy US3: the answer reads one business (T023, D4)", () => {
  it("another business's payment from a candidate's account is never another person here: the account still decides alone", async () => {
    const business = await seedReferenceBusiness();
    const elsewhere = await seedReferenceBusiness();
    const { link } = await apiPayer(business, "ana");
    const { link: theirs } = await apiPayer(elsewhere, "otro");
    await seedPaidBy(db(), { businessId: business.id, link, account: SENDER_8301 });
    await seedPaidBy(db(), { businessId: elsewhere.id, link: theirs, account: SENDER_8301 });
    const { id, from8301 } = await waitingOn44(link);
    const row = await rowById(id);
    expect(row).toMatchObject({ status: "confirmed", trackingKey: from8301.clave });
    expect(JSON.parse(row.matchTrail!)).toMatchObject({ by: "learned_account" });
    const rows = await db().select().from(payments).where(inArray(payments.businessId, [elsewhere.id]));
    expect(rows.every((r) => r.status === "confirmed")).toBe(true);
  });
});

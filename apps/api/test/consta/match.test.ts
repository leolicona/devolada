import { describe, expect, it } from "vitest";
import { fitClave, fitClaveTail, fitTieBreak, matchCandidates, MATCH_POLICY, shownTail, tailFits } from "../../src/consta/bundle/match";
import type { CepRecord, ReceiptSide } from "../../src/consta/bundle/types";
import type { RegisteredAccount } from "../../src/consta";
import { wallClockMs } from "../../src/time/business-day";
import { SENDER_4417, SENDER_8301 } from "./bundle-fixtures";

/* cep-bundle-match US1, US2, US3 — the matcher's rules as tables (D6, D7,
   D8, D11). Pure: no database, no clock, no provider. */

const BUSINESS = { bank: "BBVA MEXICO", clabe: "012180001234567897" } as RegisteredAccount;
const DAY = "2026-09-26";
let serial = 0;

function cep(creditTime: string, over: Partial<CepRecord> = {}): CepRecord {
  serial += 1;
  const creditDate = over.creditDate ?? DAY;
  return {
    id: `cep-${serial}`,
    clave: `2609280711560000${String(serial).padStart(2, "0")}I`,
    bundleId: "bundle-1",
    operationDate: "2026-09-28",
    creditDate,
    creditTime,
    creditedAt: wallClockMs("America/Mexico_City", creditDate, creditTime),
    senderBank: "AZTECA",
    senderAccountType: "40",
    senderAccount: SENDER_8301,
    receiverSpeiCode: "40012",
    receiverAccountType: "40",
    receiverAccount: BUSINESS.clabe,
    amountCents: 300,
    certificateNumber: "00001000000999999999",
    seal: "c2VhbA==",
    sealStatus: "not_verified",
    ...over,
  };
}

const receipt = (over: Partial<ReceiptSide> = {}): ReceiptSide => ({
  time: null,
  day: DAY,
  tail: null,
  amountCents: 300,
  accounts: [BUSINESS],
  ...over,
});

const none = new Set<string>();
const fateOf = (result: ReturnType<typeof matchCandidates>, c: CepRecord) => result.trail.find((t) => t.cepId === c.id)!;

describe("cep-bundle-match US1: integrity and use come first (D8)", () => {
  it("another amount, or a destination that ties to none of the payment's accounts, is dropped and named", () => {
    const right = cep("07:11:20");
    const amount = cep("07:11:25", { amountCents: 301 });
    const account = cep("07:11:30", { receiverAccount: "646180157000000004" });
    const r = matchCandidates(receipt(), [right, amount, account], none);
    expect(r).toMatchObject({ decided: "chosen", chosen: { id: right.id }, by: "none", distanceS: null });
    expect(fateOf(r, amount)).toMatchObject({ fate: "dropped", why: "amount" });
    expect(fateOf(r, account)).toMatchObject({ fate: "dropped", why: "account" });
  });

  it("a clave a live payment holds is used; every one used is all_used; nothing of the business's is none_fit", () => {
    const a = cep("07:11:20");
    const b = cep("11:40:47");
    const used = new Set([a.clave.toLowerCase()]);
    expect(matchCandidates(receipt(), [a, b], used)).toMatchObject({ decided: "chosen", chosen: { id: b.id } });
    const all = matchCandidates(receipt(), [a, b], new Set([a.clave, b.clave]));
    expect(all).toMatchObject({ decided: "undecided", reason: "all_used" });
    expect(fateOf(all, a)).toMatchObject({ fate: "dropped", why: "used" });
    expect(matchCandidates(receipt({ amountCents: 500 }), [a, b], none)).toMatchObject({ decided: "undecided", reason: "none_fit" });
    expect(matchCandidates(receipt(), [], none)).toMatchObject({ decided: "undecided", reason: "none_fit" });
  });
});

describe("cep-bundle-match US1: the tail follows the CEP's account type (D7)", () => {
  it("40: the CLABE's end, or its first 17 digits' end — 8301 of a CLABE ending 83010", () => {
    expect(tailFits("8301", { senderAccountType: "40", senderAccount: SENDER_8301 })).toBe(true);
    expect(tailFits("3010", { senderAccountType: "40", senderAccount: SENDER_8301 })).toBe(true);
    expect(tailFits("4417", { senderAccountType: "40", senderAccount: SENDER_8301 })).toBe(false);
    expect(tailFits("4417", { senderAccountType: "40", senderAccount: SENDER_4417 })).toBe(true);
  });

  it("3 and 10: the number's own end — never the digits before a check digit", () => {
    expect(tailFits("1234", { senderAccountType: "3", senderAccount: "4152313412341234" })).toBe(true);
    expect(tailFits("1234", { senderAccountType: "10", senderAccount: "5512341234" })).toBe(true);
    expect(tailFits("3123", { senderAccountType: "3", senderAccount: "4152313412341234" })).toBe(false);
  });

  it("the panel shows the four the receipt matched, else the account's last four — never more (FR-010)", () => {
    const clabe = { senderAccountType: "40", senderAccount: SENDER_8301 };
    expect(shownTail(clabe, "8301")).toBe("8301");
    expect(shownTail(clabe, "***301")).toBe("8301");
    expect(shownTail(clabe, "3010")).toBe("3010");
    expect(shownTail(clabe, "4417")).toBe("3010");
    expect(shownTail(clabe, null)).toBe("3010");
    expect(shownTail({ senderAccountType: "3", senderAccount: "4152313412341234" }, "1234")).toBe("1234");
  });

  it("the tail decides alone: the other account is dropped, by = tail", () => {
    const mine = cep("07:11:20");
    const theirs = cep("11:40:47", { senderAccount: SENDER_4417 });
    const r = matchCandidates(receipt({ tail: "8301" }), [mine, theirs], none);
    expect(r).toMatchObject({ decided: "chosen", chosen: { id: mine.id }, by: "tail", distanceS: null });
    expect(fateOf(r, theirs)).toMatchObject({ fate: "dropped", why: "tail", tail: "4171" });
    /* the four the receipt matched, not the CLABE's own end (FR-010) */
    expect(fateOf(r, mine)).toMatchObject({ fate: "chosen", tail: "8301" });
  });

  it("fewer than three digits is no tail: nothing is dropped for it", () => {
    const a = cep("07:11:20");
    const b = cep("11:40:47", { senderAccount: SENDER_4417 });
    expect(matchCandidates(receipt({ tail: "01" }), [a, b], none)).toMatchObject({ decided: "undecided", reason: "no_signal" });
  });

  it("a tail that fits nothing is none_fit — a misread digit asks the clave", () => {
    const a = cep("07:11:20");
    expect(matchCandidates(receipt({ tail: "9999" }), [a], none)).toMatchObject({ decided: "undecided", reason: "none_fit" });
  });
});

describe("cep-bundle-match US2: the window, the nearest, the margin (D6)", () => {
  const at = (time: string) => receipt({ time });

  it("the edges: −60 in, −61 out, +180 in, +181 out", () => {
    const c = cep("12:00:00");
    expect(matchCandidates(at("12:01:00"), [c], none)).toMatchObject({ decided: "chosen", distanceS: -60 });
    expect(matchCandidates(at("12:01:01"), [c], none)).toMatchObject({ decided: "undecided", reason: "none_fit" });
    expect(matchCandidates(at("11:57:00"), [c], none)).toMatchObject({ decided: "chosen", distanceS: 180 });
    expect(matchCandidates(at("11:56:59"), [c], none)).toMatchObject({ decided: "undecided", reason: "none_fit" });
    expect(fateOf(matchCandidates(at("11:56:59"), [c], none), c)).toMatchObject({ fate: "dropped", why: "window", distanceS: 181 });
  });

  it("an HH:MM receipt is the whole minute: a credit inside it is 0 s away, one after is measured from its end", () => {
    const inside = cep("12:00:40");
    expect(matchCandidates(at("12:00"), [inside], none)).toMatchObject({ decided: "chosen", distanceS: 0, by: "none" });
    const after = cep("12:03:59");
    expect(matchCandidates(at("12:00"), [after], none)).toMatchObject({ decided: "chosen", distanceS: 180 });
    expect(matchCandidates(at("12:00"), [cep("12:04:00")], none)).toMatchObject({ decided: "undecided", reason: "none_fit" });
  });

  it("the nearest wins at 83 s apart; the other was inside the window and farther", () => {
    const early = cep("11:42:13");
    const late = cep("11:43:36");
    const r = matchCandidates(at("11:42:05"), [early, late], none);
    expect(r).toMatchObject({ decided: "chosen", chosen: { id: early.id }, by: "time", distanceS: 8 });
    expect(fateOf(r, late)).toMatchObject({ fate: "dropped", why: "farther", distanceS: 91 });
    const r2 = matchCandidates(at("11:43:20"), [early, late], none);
    expect(r2).toMatchObject({ decided: "chosen", chosen: { id: late.id }, by: "time", distanceS: 16 });
    expect(fateOf(r2, early)).toMatchObject({ fate: "dropped", why: "window", distanceS: -67 });
  });

  it("the two nearest credited within 30 s of each other are too close to call", () => {
    const a = cep("11:42:13");
    const b = cep("11:42:33");
    const r = matchCandidates(at("11:42:05"), [a, b], none);
    expect(r).toMatchObject({ decided: "undecided", reason: "too_close" });
    expect(fateOf(r, a)).toMatchObject({ fate: "kept", why: "too_close" });
    expect(fateOf(r, b)).toMatchObject({ fate: "kept", why: "too_close" });
    /* one second past the margin decides */
    expect(matchCandidates(at("11:42:05"), [a, cep("11:42:44")], none)).toMatchObject({ decided: "chosen", chosen: { id: a.id } });
  });

  it("an HH:MM receipt with two credits inside that minute is too close, however far apart they are", () => {
    expect(matchCandidates(at("11:42"), [cep("11:42:01"), cep("11:42:59")], none)).toMatchObject({
      decided: "undecided",
      reason: "too_close",
    });
  });

  it("no time and two left is no_signal; both are kept", () => {
    const a = cep("11:42:13");
    const b = cep("11:43:36");
    const r = matchCandidates(receipt(), [a, b], none);
    expect(r).toMatchObject({ decided: "undecided", reason: "no_signal" });
    expect(fateOf(r, a)).toMatchObject({ fate: "kept", why: null });
  });

  it("the day carries the instant: 23:59:50 against a credit at 00:00:20 the next day is 30 s", () => {
    const next = cep("00:00:20", { creditDate: "2026-09-27" });
    expect(matchCandidates(receipt({ time: "23:59:50" }), [next], none)).toMatchObject({ decided: "chosen", distanceS: 30 });
  });

  it("tail and time together: by = both, and the distance is recorded even when the tail alone would do", () => {
    const mine = cep("07:11:20");
    const mineLater = cep("09:00:00");
    const theirs = cep("07:11:40", { senderAccount: SENDER_4417 });
    expect(matchCandidates(receipt({ time: "07:10:58", tail: "8301" }), [mine, mineLater, theirs], none)).toMatchObject({
      decided: "chosen",
      chosen: { id: mine.id },
      by: "both",
      distanceS: 22,
    });
    expect(matchCandidates(receipt({ time: "07:10:58", tail: "8301" }), [mine, theirs], none)).toMatchObject({
      by: "tail",
      distanceS: 22,
    });
  });

  it("the policy is the clarified one", () => {
    expect(MATCH_POLICY).toEqual({ beforeS: 60, afterS: 180, marginS: 30 });
  });
});

describe("cep-bundle-match US3: a typed clave against the kept candidates (fitClave, D11)", () => {
  const KEPT = ["260928071158256772I", "260928071158273815I"];

  it("as typed, with O for 0, with 1 for I, and with one character missing", () => {
    expect(fitClave("260928071158256772I", KEPT)).toBe(KEPT[0]);
    expect(fitClave("26O928O71158256772I", KEPT)).toBe(KEPT[0]);
    expect(fitClave("2609280711582567721", KEPT)).toBe(KEPT[0]);
    expect(fitClave("26092807115825677I", KEPT)).toBe(KEPT[0]);
    expect(fitClave("260928071158273815i", KEPT)).toBe(KEPT[1]);
  });

  it("two fits, or none, is no answer", () => {
    /* one character short of both: the last digit differs only where it is missing */
    expect(fitClave("2609280711582", ["26092807115821", "26092807115823"])).toBeNull();
    expect(fitClave("999999999999999999I", KEPT)).toBeNull();
    expect(fitClave("", KEPT)).toBeNull();
  });
});

/* ---- payment-without-receipt: the payer's own reference and a typed one ---- */

const own = (r: ReceiptSide, cands: CepRecord[], used: ReadonlySet<string> = none) =>
  matchCandidates(r, cands, used, MATCH_POLICY, "own");
const typed = (r: ReceiptSide, cands: CepRecord[], used: ReadonlySet<string> = none) =>
  matchCandidates(r, cands, used, MATCH_POLICY, "typed");

describe("payment-without-receipt US2: `own` mode — every transfer found is the payer's (T020, D10)", () => {
  it("keeps integrity: another amount or another destination is dropped exactly as in `receipt` mode", () => {
    const right = cep("07:13:02");
    const amount = cep("07:11:20", { amountCents: 301 });
    const account = cep("07:11:25", { receiverAccount: "646180157000000004" });
    const r = own(receipt(), [amount, account, right]);
    expect(r).toMatchObject({ decided: "chosen", chosen: { id: right.id }, by: "earliest" });
    expect(fateOf(r, amount)).toMatchObject({ fate: "dropped", why: "amount" });
    expect(fateOf(r, account)).toMatchObject({ fate: "dropped", why: "account" });
  });

  it("drops used claves and takes the earliest credited of the rest; the others stay kept for the next confirmation", () => {
    const first = cep("07:11:20");
    const second = cep("07:13:02");
    const third = cep("07:15:40");
    const r = own(receipt(), [third, second, first], new Set([first.clave]));
    expect(r).toMatchObject({ decided: "chosen", chosen: { id: second.id }, by: "earliest", distanceS: null });
    expect(fateOf(r, first)).toMatchObject({ fate: "dropped", why: "used" });
    expect(fateOf(r, third)).toMatchObject({ fate: "kept", why: null });
  });

  it("is undecided only as all_used — never no_signal, too_close or none_fit on the payer's own transfers", () => {
    const a = cep("07:11:20");
    const b = cep("07:11:21");
    expect(own(receipt(), [a, b], new Set([a.clave, b.clave]))).toMatchObject({ decided: "undecided", reason: "all_used" });
    /* two a second apart — `receipt` mode's too_close — are both the payer's */
    expect(own(receipt(), [b, a])).toMatchObject({ decided: "chosen", chosen: { id: a.id } });
    /* no time, no tail — `receipt` mode's no_signal */
    expect(matchCandidates(receipt(), [a, b], none)).toMatchObject({ decided: "undecided", reason: "no_signal" });
    expect(own(receipt(), [a, b])).toMatchObject({ decided: "chosen" });
  });

  it("every `receipt` table above is unchanged: the default mode is `receipt`", () => {
    const a = cep("07:11:20");
    const b = cep("11:40:47", { senderAccount: SENDER_4417 });
    const r = receipt({ tail: "8301" });
    expect(matchCandidates(r, [a, b], none)).toEqual(matchCandidates(r, [a, b], none, MATCH_POLICY, "receipt"));
  });
});

describe("payment-without-receipt US3: `own` mode prefers an account learned for the service (T030, D10, FR-021)", () => {
  it("a candidate from a known account is chosen, even when not the earliest", () => {
    const early = cep("07:11:20", { senderAccount: SENDER_8301 });
    const known = cep("11:40:47", { senderAccount: SENDER_4417 });
    const r = own(receipt({ knownAccounts: [SENDER_4417] }), [early, known]);
    expect(r).toMatchObject({ decided: "chosen", chosen: { id: known.id }, by: "learned_account" });
    expect(fateOf(r, early)).toMatchObject({ fate: "kept" });
  });

  it("an empty list changes nothing", () => {
    const early = cep("07:11:20");
    const late = cep("11:40:47", { senderAccount: SENDER_4417 });
    expect(own(receipt({ knownAccounts: [] }), [late, early])).toEqual(own(receipt(), [late, early]));
  });
});

describe("payment-without-receipt US5, confirmation-hierarchy US2: `typed` mode — only an exclusive learned account ties the transfer (T044 as amended by 017 T013, D10)", () => {
  const a = () => cep("07:11:20", { senderAccount: SENDER_8301 });
  const b = () => cep("11:40:47", { senderAccount: SENDER_4417 });

  it("a known account picking exactly one → chosen, learned_account; compared whole", () => {
    const [x, y] = [a(), b()];
    expect(typed(receipt({ knownAccounts: [SENDER_4417] }), [x, y])).toMatchObject({
      decided: "chosen",
      chosen: { id: y.id },
      by: "learned_account",
    });
  });

  it("two known, or none, is undecided — every free transfer kept for the tie-break", () => {
    const [x, y] = [a(), b()];
    const both = typed(receipt({ knownAccounts: [SENDER_8301, SENDER_4417] }), [x, y]);
    expect(both).toMatchObject({ decided: "undecided", reason: "no_signal" });
    expect(fateOf(both, x)).toMatchObject({ fate: "kept", why: null });
    expect(fateOf(both, y)).toMatchObject({ fate: "kept", why: null });
    expect(typed(receipt(), [x, y])).toMatchObject({ decided: "undecided", reason: "no_signal" });
  });

  it("even one transfer is undecided without an exclusive account — a typed reference alone never confirms (FR-009)", () => {
    const x = a();
    const r = typed(receipt(), [x]);
    expect(r).toMatchObject({ decided: "undecided", reason: "no_signal" });
    expect(fateOf(r, x)).toMatchObject({ fate: "kept" });
  });

  it("a tail or a time on the receipt side changes nothing in this mode: the answer comes later, through fitTieBreak (D6)", () => {
    const [x, y] = [a(), b()];
    expect(typed(receipt({ tail: "4417" }), [x, y])).toMatchObject({ decided: "undecided", reason: "no_signal" });
    expect(typed(receipt({ time: "11:40", tail: "4417" }), [y])).toMatchObject({ decided: "undecided", reason: "no_signal" });
    expect(typed(receipt({ tail: "4417" }), [x, y])).toEqual(typed(receipt(), [x, y]));
  });

  it("used transfers drop first: all used is all_used, nothing of the business is none_fit", () => {
    const [x, y] = [a(), b()];
    expect(typed(receipt(), [x, y], new Set([x.clave, y.clave]))).toMatchObject({ decided: "undecided", reason: "all_used" });
    expect(typed(receipt(), [cep("07:00:00", { amountCents: 999 })])).toMatchObject({ decided: "undecided", reason: "none_fit" });
  });
});

describe("confirmation-hierarchy US2: fitTieBreak — an answer read against the transfers found (T013, D6)", () => {
  /* The sandbox's …44: 8301's clave ends 977I, 4417's ends 0412 */
  const x = () => cep("07:11:20", { senderAccount: SENDER_8301, clave: "MOCKREF4420261001A1B2977I" });
  const y = () => cep("11:40:47", { senderAccount: SENDER_4417, clave: "MOCKREF4420261001C3D40412" });

  it("digits alone: one fit confirms by sender_tail — a CLABE's end or the account inside it (tailFits)", () => {
    const [p, q] = [x(), y()];
    expect(fitTieBreak({ senderTail: "4417" }, [p, q])).toMatchObject({ fit: "one", chosen: { id: q.id }, by: "sender_tail" });
    /* 8301 is the account number inside a CLABE ending 3010; 3010 is its end */
    expect(fitTieBreak({ senderTail: "8301" }, [p, q])).toMatchObject({ fit: "one", chosen: { id: p.id } });
    expect(fitTieBreak({ senderTail: "3010" }, [p, q])).toMatchObject({ fit: "one", chosen: { id: p.id } });
    expect(fitTieBreak({ senderTail: "9999" }, [p, q])).toEqual({ fit: "none" });
  });

  it("characters alone, with O read as 0 and I as 1: 9771 fits …977I, 3010 fits …3O10", () => {
    const [p, q] = [x(), y()];
    expect(fitTieBreak({ claveTail: "977I" }, [p, q])).toMatchObject({ fit: "one", chosen: { id: p.id }, by: "clave_tail" });
    expect(fitTieBreak({ claveTail: "9771" }, [p, q])).toMatchObject({ fit: "one", chosen: { id: p.id }, by: "clave_tail" });
    expect(fitTieBreak({ claveTail: "o412" }, [p, q])).toMatchObject({ fit: "one", chosen: { id: q.id } });
    const single = cep("09:02:31", { clave: "MOCKREF6620261001ABCD3O10" });
    expect(fitTieBreak({ claveTail: "3010" }, [single])).toMatchObject({ fit: "one", chosen: { id: single.id }, by: "clave_tail" });
  });

  it("both agreeing → one, by clave_tail; both disagreeing → none; one way fitting nothing while the other fits → none", () => {
    const [p, q] = [x(), y()];
    expect(fitTieBreak({ senderTail: "4417", claveTail: "0412" }, [p, q])).toMatchObject({ fit: "one", chosen: { id: q.id }, by: "clave_tail" });
    expect(fitTieBreak({ senderTail: "8301", claveTail: "0412" }, [p, q])).toEqual({ fit: "none" });
    expect(fitTieBreak({ senderTail: "9999", claveTail: "0412" }, [p, q])).toEqual({ fit: "none" });
    expect(fitTieBreak({ senderTail: "4417", claveTail: "ZZZZ" }, [p, q])).toEqual({ fit: "none" });
  });

  it("digits alone choosing an account that paid another person ask the characters; the characters then fitting it confirm", () => {
    const [p, q] = [x(), y()];
    expect(fitTieBreak({ senderTail: "8301" }, [p, q], [SENDER_8301])).toEqual({ fit: "needs", ways: ["clave_tail"] });
    expect(fitTieBreak({ senderTail: "8301", claveTail: "977I" }, [p, q], [SENDER_8301])).toMatchObject({
      fit: "one",
      chosen: { id: p.id },
      by: "clave_tail",
    });
    /* the characters alone need no account at all */
    expect(fitTieBreak({ claveTail: "977I" }, [p, q], [SENDER_8301])).toMatchObject({ fit: "one", chosen: { id: p.id } });
  });

  it("several: digits alone ask the characters, characters alone ask the digits, both ask the whole clave", () => {
    /* the sandbox's …55: two accounts, claves sharing their last four */
    const p = cep("07:11:20", { senderAccount: SENDER_8301, clave: "MOCKREF5520261001A5510" });
    const q = cep("11:40:47", { senderAccount: SENDER_4417, clave: "MOCKREF5520261001B5510" });
    const r = cep("12:00:00", { senderAccount: SENDER_8301, clave: "MOCKREF5520261001C7777" });
    expect(fitTieBreak({ senderTail: "8301" }, [p, q, r])).toEqual({ fit: "needs", ways: ["clave_tail"] });
    expect(fitTieBreak({ claveTail: "5510" }, [p, q, r])).toEqual({ fit: "needs", ways: ["sender_tail"] });
    expect(fitTieBreak({ claveTail: "5510", senderTail: "4417" }, [p, q, r])).toMatchObject({ fit: "one", chosen: { id: q.id } });
    const s = cep("12:30:00", { senderAccount: SENDER_8301, clave: "MOCKREF5520261001D5510" });
    expect(fitTieBreak({ claveTail: "5510", senderTail: "8301" }, [p, q, s])).toEqual({ fit: "clave" });
  });

  it("never a candidate outside the list; nothing given, or a short value, fits nothing", () => {
    const [p] = [x()];
    expect(fitTieBreak({ senderTail: "4417" }, [p])).toEqual({ fit: "none" });
    expect(fitTieBreak({}, [p])).toEqual({ fit: "none" });
    expect(fitTieBreak({ claveTail: "77I" }, [p])).toEqual({ fit: "none" });
    expect(fitTieBreak({ senderTail: "8301" }, [])).toEqual({ fit: "none" });
  });
});

describe("payment-without-receipt US5: fitClaveTail (T044, D17)", () => {
  const kept = ["260928071199000011I", "260928071199000012I", "MOCKAZT0000000004417"];

  it("reads O as 0 and I as 1 on both sides, and answers exactly one fit", () => {
    expect(fitClaveTail("011I", kept)).toBe("260928071199000011I");
    expect(fitClaveTail("o11i", kept)).toBe("260928071199000011I");
    expect(fitClaveTail("0111", kept)).toBe("260928071199000011I");
    expect(fitClaveTail("44I7", kept)).toBe("MOCKAZT0000000004417");
  });

  it("two candidates sharing the four, or none, is no answer; never a candidate outside the list", () => {
    expect(fitClaveTail("011I", ["AAAA0011I", "BBBB0011I"])).toBeNull();
    expect(fitClaveTail("9999", kept)).toBeNull();
    expect(fitClaveTail("11I", kept)).toBeNull();
  });
});

describe("payment-without-receipt US5, confirmation-hierarchy US3: `own` mode during a transition (T055 as amended by 017 T022, D26, D10)", () => {
  it("drops the previous holder's accounts, and holds a transfer from an account not known for the new owner — a tail changes nothing", () => {
    const juans = cep("07:11:20", { senderAccount: SENDER_8301 });
    const strangers = cep("11:40:47", { senderAccount: SENDER_4417 });
    const held = own(receipt({ excludedAccounts: [SENDER_8301], knownAccounts: [] }), [juans, strangers]);
    expect(held).toMatchObject({ decided: "undecided", reason: "no_signal" });
    expect(fateOf(held, juans)).toMatchObject({ fate: "dropped", why: "excluded" });
    expect(fateOf(held, strangers)).toMatchObject({ fate: "kept" });
    /* the four digits are an answer now, read by fitTieBreak (D6) */
    expect(own(receipt({ excludedAccounts: [SENDER_8301], tail: "4417" }), [juans, strangers])).toMatchObject({
      decided: "undecided",
      reason: "no_signal",
    });
    /* an account exclusive to her confirms it */
    expect(own(receipt({ excludedAccounts: [SENDER_8301], knownAccounts: [SENDER_4417] }), [juans, strangers])).toMatchObject({
      decided: "chosen",
      chosen: { id: strangers.id },
      by: "learned_account",
    });
  });
});

describe("confirmation-hierarchy US3: `own` mode reads exclusive accounts only (T022, D10, FR-015)", () => {
  it("a learned account that paid another person is not in knownAccounts: the earliest not-used transfer wins", () => {
    const early = cep("07:11:20", { senderAccount: SENDER_8301 });
    const shared = cep("11:40:47", { senderAccount: SENDER_4417 });
    /* the lifecycle passes learned − others: 4417 is learned but shared */
    const r = own(receipt({ knownAccounts: [], othersAccounts: [SENDER_4417] }), [shared, early]);
    expect(r).toMatchObject({ decided: "chosen", chosen: { id: early.id }, by: "earliest" });
  });

  it("an exclusive one goes first, even when not the earliest", () => {
    const early = cep("07:11:20", { senderAccount: SENDER_8301 });
    const mine = cep("11:40:47", { senderAccount: SENDER_4417 });
    expect(own(receipt({ knownAccounts: [SENDER_4417], othersAccounts: [SENDER_8301] }), [early, mine])).toMatchObject({
      decided: "chosen",
      chosen: { id: mine.id },
      by: "learned_account",
    });
  });

  it("during a transition, a candidate from an account not in knownAccounts is held", () => {
    const previous = cep("07:11:20", { senderAccount: "127180555555512344" });
    const shared = cep("11:40:47", { senderAccount: SENDER_4417 });
    const held = own(receipt({ excludedAccounts: ["127180555555512344"], knownAccounts: [], othersAccounts: [SENDER_4417] }), [previous, shared]);
    expect(held).toMatchObject({ decided: "undecided", reason: "no_signal" });
    expect(fateOf(held, shared)).toMatchObject({ fate: "kept" });
  });
});

import { describe, expect, it } from "vitest";
import { fitClave, matchCandidates, MATCH_POLICY, shownTail, tailFits } from "../../src/consta/bundle/match";
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

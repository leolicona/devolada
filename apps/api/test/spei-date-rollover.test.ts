import { describe, expect, it } from "vitest";
import { nextSearchDate, searchDates } from "../src/direct-payments/search-date";
import { timeOf } from "../src/consta/extraction/reader";
import { consta } from "../src/consta";
import { aiReturning, db, engineEnv, extractions, putProof, PNG, RECEIPT_2_READING, seedOwner } from "./consta/helpers";

/* bug: spei-date-rollover — SPEI files a transfer under its operation day,
   which changes at 18:00 Mexico City time (Banxico, "Información operativa
   del SPEI"); a receipt and a payer carry the calendar day. A search by
   referencia numérica has to ask Banxico the operation day. */

/* Mexico City is UTC−6 all year since 2022: 23:50 there on the 24th is
   05:50Z on the 25th */
const at = (iso: string) => new Date(iso);

describe("bug: spei-date-rollover — the day a reference search asks", () => {
  it("a printed time decides: before 18:00 the day printed, from 18:00 the next", () => {
    const submittedAt = at("2026-09-25T15:00:00Z");
    expect(searchDates({ date: "2026-09-24", time: "17:59", submittedAt })).toEqual({
      primary: "2026-09-24",
      alternate: "2026-09-25",
    });
    expect(searchDates({ date: "2026-09-24", time: "18:00", submittedAt })).toEqual({
      primary: "2026-09-25",
      alternate: "2026-09-24",
    });
    expect(searchDates({ date: "2026-09-24", time: "23:50", submittedAt }).primary).toBe("2026-09-25");
  });

  it("a printed time wins over the submission instant", () => {
    /* submitted at 23:50 Mexico City, but the receipt says 10:00 */
    expect(
      searchDates({ date: "2026-09-24", time: "10:00", submittedAt: at("2026-09-25T05:50:00Z") }).primary,
    ).toBe("2026-09-24");
  });

  it("with no time, the submission stands in: before 18:00 that day is certain, later the next day goes first", () => {
    /* 14:00 Mexico City on the 24th: the transfer came before it */
    expect(searchDates({ date: "2026-09-24", time: null, submittedAt: at("2026-09-24T20:00:00Z") }).primary).toBe(
      "2026-09-24",
    );
    /* Abraham, dev: typed at 23:50 Mexico City with the 24th */
    expect(searchDates({ date: "2026-09-24", time: null, submittedAt: at("2026-09-25T05:50:00Z") })).toEqual({
      primary: "2026-09-25",
      alternate: "2026-09-24",
    });
    /* the next morning: the next day first, the date given as the fallback */
    expect(searchDates({ date: "2026-09-24", time: null, submittedAt: at("2026-09-25T15:00:00Z") }).primary).toBe(
      "2026-09-25",
    );
  });

  it("the change is Mexico City's 18:00, whatever the business's zone", () => {
    /* 17:30 in Hermosillo is 18:30 in Mexico City: past the change */
    expect(searchDates({ date: "2026-09-24", time: null, submittedAt: at("2026-09-25T00:30:00Z") }).primary).toBe(
      "2026-09-25",
    );
    /* 17:59 in Mexico City: not yet */
    expect(searchDates({ date: "2026-09-24", time: null, submittedAt: at("2026-09-24T23:59:00Z") }).primary).toBe(
      "2026-09-24",
    );
  });

  it("the next day crosses months and years", () => {
    expect(searchDates({ date: "2026-12-31", time: "19:00", submittedAt: at("2027-01-01T02:00:00Z") })).toEqual({
      primary: "2027-01-01",
      alternate: "2026-12-31",
    });
    expect(searchDates({ date: "2026-09-30", time: "18:30", submittedAt: at("2026-10-01T01:00:00Z") }).primary).toBe(
      "2026-10-01",
    );
  });

  it("only a not_found hands the next attempt the other day", () => {
    const dates = { primary: "2026-09-25", alternate: "2026-09-24" };
    expect(nextSearchDate(dates, null)).toBe("2026-09-25");
    expect(nextSearchDate(dates, { date: "2026-09-25", notFound: true })).toBe("2026-09-24");
    expect(nextSearchDate(dates, { date: "2026-09-24", notFound: true })).toBe("2026-09-25");
    /* `pending` found it in process on that day: ask the same day again */
    expect(nextSearchDate(dates, { date: "2026-09-24", notFound: false })).toBe("2026-09-24");
    /* a search of some other day says nothing about these two */
    expect(nextSearchDate(dates, { date: "2026-09-20", notFound: true })).toBe("2026-09-25");
  });
});

describe("bug: spei-date-rollover — the reader reads the time", () => {
  it("keeps HH:MM on a 24-hour clock and drops anything else", () => {
    expect(timeOf("23:47")).toBe("23:47");
    expect(timeOf(" 7:05 ")).toBe("07:05");
    expect(timeOf("00:00")).toBe("00:00");
    expect(timeOf("25:10")).toBeNull();
    expect(timeOf("12:60")).toBeNull();
    expect(timeOf("7pm")).toBeNull();
    expect(timeOf("11:47 p.m.")).toBeNull();
    expect(timeOf(2347)).toBeNull();
    expect(timeOf(null)).toBeNull();
    expect(timeOf(undefined)).toBeNull();
  });

  it("asks for it, and the reading record stores it", async () => {
    const { key } = await seedOwner();
    const env = engineEnv();
    await putProof(env.PROOFS, "link-1/receipt", PNG(), "image/png");
    const calls: unknown[] = [];
    const AI = aiReturning({ ...RECEIPT_2_READING, hora: "23:47" }, calls);

    await consta({ ...env, AI }, db(), { businessId: key }).extract({ proofKey: "link-1/receipt" });

    const prompt = JSON.stringify((calls[0] as { input: unknown }).input);
    expect(prompt).toContain('\\"hora\\"');
    const [row] = await db().select().from(extractions);
    expect(row.transferDate).toBe("2026-09-09");
    expect(row.transferTime).toBe("23:47");
  });

  it("a receipt that prints no time stores none", async () => {
    const { key } = await seedOwner();
    const env = engineEnv();
    await putProof(env.PROOFS, "link-1/receipt", PNG(), "image/png");
    await consta({ ...env, AI: aiReturning(RECEIPT_2_READING) }, db(), { businessId: key }).extract({
      proofKey: "link-1/receipt",
    });
    const [row] = await db().select().from(extractions);
    expect(row.transferTime).toBeNull();
  });
});

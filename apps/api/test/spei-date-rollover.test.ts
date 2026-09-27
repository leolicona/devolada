import { describe, expect, it } from "vitest";
import { timeOf } from "../src/consta/extraction/reader";
import { consta } from "../src/consta";
import { aiReturning, db, engineEnv, extractions, putProof, PNG, RECEIPT_2_READING, seedOwner } from "./consta/helpers";

/* bug: spei-date-rollover — the reader keeps the time printed beside the
   date. The rule that let it pick the day a reference search asks was
   retired by bug: reference-search-printed-day (Banxico answers the
   printed day only, measured 2026-09-26); those tests live with that bug
   in direct-payment.test.ts. */

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

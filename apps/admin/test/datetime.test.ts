import { describe, expect, it } from "vitest";
import { formatDateRange } from "../src/lib/datetime";

/* payments-and-classes D4 (amended 2026-09-02): the compact range on the
   `Fechas` trigger. US-R03. */
describe("US-R03: the date range reads compact and adaptive on its trigger", () => {
  const year = 2026;

  it.each([
    ["nothing set", "", "", null],
    ["one day", "2026-09-03", "2026-09-03", "3 sep"],
    ["same month", "2026-09-01", "2026-09-15", "1–15 sep"],
    ["across months", "2026-08-28", "2026-09-15", "28 ago – 15 sep"],
    ["across years", "2025-12-28", "2026-01-03", "28 dic 2025 – 3 ene 2026"],
    ["a past year, same month", "2025-09-01", "2025-09-15", "1–15 sep 2025"],
    ["a past year, one day", "2025-09-03", "2025-09-03", "3 sep 2025"],
    ["open at the end", "2026-09-01", "", "Desde 1 sep"],
    ["open at the start", "", "2026-09-15", "Hasta 15 sep"],
    ["open, past year", "2025-09-01", "", "Desde 1 sep 2025"],
  ])("%s", (_name, from, to, expected) => {
    expect(formatDateRange(from, to, year)).toBe(expected);
  });

  it("ignores what is not a calendar date (a half-typed native input yields an empty string, never garbage)", () => {
    expect(formatDateRange("2026-13-40", "", year)).toBeNull();
    expect(formatDateRange("hoy", "2026-09-15", year)).toBe("Hasta 15 sep");
  });
});

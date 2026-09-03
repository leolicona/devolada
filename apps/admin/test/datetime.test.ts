import { describe, expect, it } from "vitest";
import { dateToIso, formatDateRange, isoDateIn, isoToDate, monthStartIso, shiftIsoDate } from "../src/lib/datetime";

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

/* settings D5: the business's zone owns "today". US-R03. */
describe("US-R03: calendar dates come from the business's zone, not the browser's", () => {
  /* 2026-08-14 05:30 UTC: still the 13th in Hermosillo (UTC-7), already the 14th in Mexico City (UTC-6)? No —
     00:30 in Mexico City is the 14th; 22:30 in Hermosillo is the 13th. */
  const ms = Date.UTC(2026, 7, 14, 5, 30);

  it("the same instant is a different calendar day in Hermosillo and Mexico City", () => {
    expect(isoDateIn("America/Mexico_City", ms)).toBe("2026-08-13");
    expect(isoDateIn("America/Hermosillo", ms)).toBe("2026-08-13");
    expect(isoDateIn("America/Mexico_City", Date.UTC(2026, 7, 14, 6, 30))).toBe("2026-08-14");
    expect(isoDateIn("America/Hermosillo", Date.UTC(2026, 7, 14, 6, 30))).toBe("2026-08-13");
  });

  it("shifts and month starts are plain calendar arithmetic", () => {
    expect(shiftIsoDate("2026-08-14", -6)).toBe("2026-08-08");
    expect(shiftIsoDate("2026-03-02", -6)).toBe("2026-02-24");
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(monthStartIso("2026-08-14")).toBe("2026-08-01");
  });

  it("round-trips through the picker's local Dates without sliding a day", () => {
    expect(dateToIso(isoToDate("2026-08-14"))).toBe("2026-08-14");
    expect(dateToIso(isoToDate("2026-01-01"))).toBe("2026-01-01");
  });
});

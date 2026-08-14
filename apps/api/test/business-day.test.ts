import { describe, expect, it } from "vitest";
import { startOfBusinessDayMs } from "../src/time/business-day";

/* docs/admin/settings.spec.md D5 — the pure part, on fixed instants. */

const iso = (ms: number) => new Date(ms).toISOString();

describe("US-A04: the business day starts in the ISP's timezone", () => {
  it("puts the same instant on different days for Sonora and the centre", () => {
    /* 2026-08-14 06:30 UTC — 00:30 in Mexico City (UTC−6), still
       23:30 of the 13th in Hermosillo (UTC−7, no DST). */
    const instant = new Date("2026-08-14T06:30:00.000Z");

    expect(iso(startOfBusinessDayMs("America/Mexico_City", instant))).toBe(
      "2026-08-14T06:00:00.000Z",
    );
    expect(iso(startOfBusinessDayMs("America/Hermosillo", instant))).toBe(
      "2026-08-13T07:00:00.000Z",
    );
  });

  it("follows Baja California through daylight saving", () => {
    /* Tijuana is the one Mexican zone that still changes clocks: PDT in
       August (UTC−7), PST in January (UTC−8). */
    expect(iso(startOfBusinessDayMs("America/Tijuana", new Date("2026-08-14T12:00:00.000Z")))).toBe(
      "2026-08-14T07:00:00.000Z",
    );
    expect(iso(startOfBusinessDayMs("America/Tijuana", new Date("2026-01-14T12:00:00.000Z")))).toBe(
      "2026-01-14T08:00:00.000Z",
    );
  });

  it("uses the offset that applied at midnight, not the one that applies now", () => {
    /* The two days Tijuana changes its clocks. A single-pass conversion
       shifts midnight by the offset at the moment of the request, which
       on these days is the wrong one — charges near midnight would land
       on the wrong business day, twice a year. */
    expect(iso(startOfBusinessDayMs("America/Tijuana", new Date("2026-03-08T21:17:00.000Z")))).toBe(
      "2026-03-08T08:00:00.000Z",
    );
    expect(iso(startOfBusinessDayMs("America/Tijuana", new Date("2026-11-01T22:17:00.000Z")))).toBe(
      "2026-11-01T07:00:00.000Z",
    );
  });

  it("lands exactly on midnight, whatever milliseconds the request carries", () => {
    /* The wall clock only reads down to seconds. Subtracting it from a
       millisecond instant leaked the fraction into the offset, so every
       request got a slightly different boundary and a charge could fall
       on either side of it. */
    for (const ms of [0, 1, 198, 999]) {
      const now = new Date(Date.UTC(2026, 7, 14, 19, 23, 29, ms));
      expect(iso(startOfBusinessDayMs("America/Mexico_City", now))).toBe(
        "2026-08-14T06:00:00.000Z",
      );
    }
  });

  it("handles the first minute of a local day", () => {
    /* Exactly midnight in Mexico City: the day starts now, not 24h ago */
    const midnight = new Date("2026-08-14T06:00:00.000Z");
    expect(startOfBusinessDayMs("America/Mexico_City", midnight)).toBe(midnight.getTime());
  });
});

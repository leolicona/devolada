/* Where a business day starts (settings spec D5).

   The ISP's timezone owns "today", not the browser and not UTC. Mexico
   spans three zones: an ISP in Hermosillo (UTC−7) checking its totals
   from Mexico City must still see its own day.

   How it works: format `now` in the target zone to read the wall clock
   there, treat those parts as if they were UTC, and the difference from
   the real instant is that zone's offset. Midnight of the same wall-clock
   date, shifted back by the offset, is the instant the day began. */

const parts = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = parts.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    parts.set(timezone, f);
  }
  return f;
}

export function startOfBusinessDayMs(timezone: string, now: Date = new Date()): number {
  const read = (list: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
    Number(list.find((p) => p.type === type)?.value ?? 0);

  const list = formatterFor(timezone).formatToParts(now);
  const year = read(list, "year");
  const month = read(list, "month");
  const day = read(list, "day");
  /* en-CA gives 24 for midnight; Date.UTC treats it as the next day's 0 */
  const hour = read(list, "hour") % 24;

  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, read(list, "minute"), read(list, "second"));
  const offsetMs = wallClockAsUtc - now.getTime();
  return Date.UTC(year, month - 1, day) - offsetMs;
}

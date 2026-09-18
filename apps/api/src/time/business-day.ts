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

const read = (list: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
  Number(list.find((p) => p.type === type)?.value ?? 0);

/* How far the zone's wall clock sits from UTC at one instant.
   The wall clock only goes down to seconds, so the instant is floored to
   the same precision before subtracting. Without that, the instant's
   milliseconds leak into the offset and the day boundary lands a few ms
   after midnight — a different boundary on every request. */
function offsetMsAt(timezone: string, instant: Date): number {
  const list = formatterFor(timezone).formatToParts(instant);
  /* en-CA writes midnight as 24; Date.UTC would read that as the next day */
  const hour = read(list, "hour") % 24;
  const wallClockAsUtc = Date.UTC(
    read(list, "year"),
    read(list, "month") - 1,
    read(list, "day"),
    hour,
    read(list, "minute"),
    read(list, "second"),
  );
  return wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/* Which month an instant belongs to on the ISP's wall clock, as
   "YYYY-MM" (settlement spec D2: the same rule that owns "today" also
   owns "this month"). */
export function businessMonthKey(timezone: string, instant: Date): string {
  const list = formatterFor(timezone).formatToParts(instant);
  const month = String(read(list, "month")).padStart(2, "0");
  return `${read(list, "year")}-${month}`;
}

/* Midnight of an arbitrary calendar date on the business's wall clock
   (payments-and-classes D4: the feed's date range filters in the
   business's timezone). Same two-pass offset dance as below. */
export function startOfIsoDateMs(timezone: string, isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const midnightAsUtc = Date.UTC(y, m - 1, d);
  const guess = midnightAsUtc - offsetMsAt(timezone, new Date(midnightAsUtc));
  return midnightAsUtc - offsetMsAt(timezone, new Date(guess));
}

/* The calendar day after an ISO date, for an inclusive `to` bound:
   "up to and including the 30th" is "before the 1st's midnight". Pure
   calendar arithmetic; the zone enters through startOfIsoDateMs. */
export function nextIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function startOfBusinessDayMs(timezone: string, now: Date = new Date()): number {
  const list = formatterFor(timezone).formatToParts(now);
  const midnightAsUtc = Date.UTC(read(list, "year"), read(list, "month") - 1, read(list, "day"));

  /* Two passes, because the offset now is not always the offset at
     midnight. Tijuana changes clocks twice a year: on those two days a
     single pass puts the boundary an hour off, and charges near midnight
     land on the wrong day. The first pass lands close enough to read the
     offset that actually applied at midnight; the second uses it. */
  const guess = midnightAsUtc - offsetMsAt(timezone, now);
  return midnightAsUtc - offsetMsAt(timezone, new Date(guess));
}

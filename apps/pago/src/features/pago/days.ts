/* The business's calendar on the payer's page. Days travel as the date
   input's own shape, "YYYY-MM-DD", and every "today" is the business's
   (constitution II: "today" belongs to the business timezone, not the
   browser). */

/* bug: spei-date-rollover — "today" is the business's day. The UTC date
   (`toISOString`) is already tomorrow from 18:00 in Mexico City, so an
   evening payer was offered a day their receipt does not show. en-CA
   writes YYYY-MM-DD, the date input's own shape; a zone this browser does
   not know falls back to Mexico City's. */
export function todayIn(timezone: string | undefined): string {
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(),
    );
  try {
    return format(timezone ?? "America/Mexico_City");
  } catch {
    return format("America/Mexico_City");
  }
}

/* Calendar arithmetic on the day itself, never on an instant: a day is a
   date, and a date has no timezone left to get wrong once it is one. */
export function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
}

/* Noon UTC, formatted in UTC: the printed day is the day given, whatever
   the browser's zone (a bare "YYYY-MM-DD" parses as UTC midnight, which is
   yesterday anywhere in Mexico) */
const at = (day: string) => new Date(`${day}T12:00:00Z`);

/* "martes 29" — payment-without-receipt D21: the day row's words */
export function weekdayAndDay(day: string): string {
  const weekday = at(day).toLocaleDateString("es-MX", { weekday: "long", timeZone: "UTC" });
  return `${weekday} ${Number(day.slice(8, 10))}`;
}

/* "12 de septiembre" */
export function dayOfMonth(day: string): string {
  return at(day).toLocaleDateString("es-MX", { day: "numeric", month: "long", timeZone: "UTC" });
}

/* "sábado 20 de septiembre" */
export function weekdayDayOfMonth(day: string): string {
  const weekday = at(day).toLocaleDateString("es-MX", { weekday: "long", timeZone: "UTC" });
  return `${weekday} ${dayOfMonth(day)}`;
}

/* "a, b y c" — the way a person lists days */
export function joinSpoken(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/* payment-without-receipt D14: every day the rounds searched, said once —
   "lunes 28, martes 29 y miércoles 30 de septiembre" when they share a
   month, each with its own month when they do not */
export function spokenDays(days: readonly string[]): string {
  const sorted = [...days].sort();
  const oneMonth = sorted.every((d) => d.slice(0, 7) === sorted[0]?.slice(0, 7));
  if (sorted.length > 1 && oneMonth) {
    const month = at(sorted[0]!).toLocaleDateString("es-MX", { month: "long", timeZone: "UTC" });
    return `${joinSpoken(sorted.map(weekdayAndDay))} de ${month}`;
  }
  return joinSpoken(sorted.map(weekdayDayOfMonth));
}

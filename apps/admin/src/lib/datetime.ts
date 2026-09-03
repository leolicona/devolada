import type { SettingsResponse } from "@devolada/api/settings-schema";

/* Settings D6: every time the admin renders passes through here. The API
   always speaks in epoch ms; the ISP's setting decides how it reads. */

export type TimeFormat = SettingsResponse["timeFormat"];

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("es-MX", options);
    cache.set(key, f);
  }
  return f;
}

const timeOptions = (format: TimeFormat, timezone: string): Intl.DateTimeFormatOptions => ({
  timeZone: timezone,
  hour: "2-digit",
  minute: "2-digit",
  hour12: format === "12h",
});

export function formatTime(ms: number, format: TimeFormat, timezone: string): string {
  return formatter(`t-${format}-${timezone}`, timeOptions(format, timezone)).format(new Date(ms));
}

export function formatDateTime(ms: number, format: TimeFormat, timezone: string): string {
  return formatter(`dt-${format}-${timezone}`, {
    ...timeOptions(format, timezone),
    day: "numeric",
    month: "long",
  }).format(new Date(ms));
}

/* The live example under the format picker: a fixed afternoon instant,
   so the ISP sees the difference between the two options at a glance. */
export const SAMPLE_TIME_MS = Date.UTC(2026, 0, 1, 20, 30);

/* payments-and-classes D4 (amended 2026-09-02): the `Fechas` trigger
   names an active range, so collapsing the panel never hides a filter.
   Compact and adaptive — it drops what both ends share: `1–15 sep`,
   `28 ago – 15 sep`, `28 dic 2025 – 3 ene 2026`, `3 sep`. The year
   appears only when either end leaves the current one. Month names are
   fixed es-MX: browsers disagree on "sep" vs "sept." and this is copy. */

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

type CalendarDate = { y: number; m: number; d: number };

function parseIsoDate(iso: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m, d } : null;
}

const dayMonth = (c: CalendarDate) => `${c.d} ${MONTHS[c.m - 1]}`;
const withYear = (c: CalendarDate, currentYear: number) =>
  c.y === currentYear ? dayMonth(c) : `${dayMonth(c)} ${c.y}`;

export function formatDateRange(
  from: string,
  to: string,
  currentYear: number = new Date().getFullYear(),
): string | null {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a && !b) return null;
  if (a && !b) return `Desde ${withYear(a, currentYear)}`;
  if (!a && b) return `Hasta ${withYear(b, currentYear)}`;
  if (!a || !b) return null;
  const year = a.y === currentYear && b.y === currentYear ? "" : ` ${a.y}`;
  if (a.y === b.y && a.m === b.m) {
    return a.d === b.d ? `${dayMonth(a)}${year}` : `${a.d}–${b.d} ${MONTHS[a.m - 1]}${year}`;
  }
  if (a.y === b.y) return `${dayMonth(a)} – ${dayMonth(b)}${year}`;
  return `${dayMonth(a)} ${a.y} – ${dayMonth(b)} ${b.y}`;
}

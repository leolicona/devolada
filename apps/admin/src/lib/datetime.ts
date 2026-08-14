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

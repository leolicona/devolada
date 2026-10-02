/* cash-at-stores: the store app's clock. A store is not a business and has
   no timezone setting of its own; the network runs in Mexico, and its
   pilot business keeps the house default (settings D5). One place to
   change it when stores in another zone join. */
export const STORE_TIMEZONE = "America/Mexico_City";

export const dayOf = (ms: number) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: STORE_TIMEZONE, weekday: "long", day: "numeric", month: "long" }).format(ms);

export const dateOf = (ms: number) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: STORE_TIMEZONE, day: "numeric", month: "short" }).format(ms);

export const timeOf = (ms: number) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: STORE_TIMEZONE, hour: "numeric", minute: "2-digit" }).format(ms);

/* A calendar day on the network's clock, for grouping */
export const dayKey = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

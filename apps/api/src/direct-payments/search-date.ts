/* bug: spei-date-rollover — which day a search by referencia numérica asks
   Banxico about.

   SPEI works 24 hours a day but files every transfer under an operation
   day, and that day changes at 18:00 Mexico City time: "se establece un
   horario para que el SPEI cambie de fecha, actualmente corresponde a las
   18:00 hrs de cada día" (Banxico, *Información operativa del SPEI*, read
   2026-09-25). A receipt and a payer carry the calendar day. A clave finds
   its CEP whatever date comes with it (measured 2026-08-17, the
   `STALE_TRANSFER_DAYS` note in validation.ts), so nothing changes there. A
   reference has no other anchor: on dev, 2026-09-24, three receipts dated
   the 24th after 23:40 were filed under the 25th, and a reference typed
   with the 24th was `not_found` on all seven of its attempts.

   Banxico's clock, not the business's: an ISP in Hermosillo meets the
   change at 17:00 on its own wall clock. And 18:00 is the change "en
   condiciones normales" — Banxico may move it later on a day with an
   incident, and a bank may print the day it already rolled — so the other
   day is always the fallback, on the next retry, at no extra paid call. */
import { businessWallClock, nextIsoDate } from "../time/business-day";

export const SPEI_ZONE = "America/Mexico_City";
export const SPEI_DATE_CHANGE = "18:00";

export type SearchDates = { primary: string; alternate: string };

/* The two candidate days, most likely first.

   - A printed time ("HH:MM", Mexico City's clock as banks print it) says
     it outright: from 18:00 the next day, before it the day printed.
   - Without one, the submission is the only clock: a transfer happens
     before its submission, so one submitted before 18:00 on the date given
     was filed under that date — certain. Submitted at or after 18:00 that
     day, or on a later day, the next day is the likelier (the page's flow
     is transfer, then submit) and the date given is the fallback. */
export function searchDates(args: { date: string; time: string | null; submittedAt: Date }): SearchDates {
  const late =
    args.time != null
      ? args.time >= SPEI_DATE_CHANGE
      : businessWallClock(SPEI_ZONE, args.submittedAt).dateTime >= `${args.date} ${SPEI_DATE_CHANGE}`;
  const next = nextIsoDate(args.date);
  return late ? { primary: next, alternate: args.date } : { primary: args.date, alternate: next };
}

/* The day this attempt asks. The first search asks the likelier day; a
   search Banxico answered `not_found` hands the next attempt the other one.
   Any other outcome — `pending` found it in process, a call that never
   answered found nothing either way — asks the same day again: only a
   `not_found` says the day was wrong. */
export function nextSearchDate(
  dates: SearchDates,
  previous: { date: string; notFound: boolean } | null,
): string {
  if (!previous || (previous.date !== dates.primary && previous.date !== dates.alternate)) {
    return dates.primary;
  }
  if (!previous.notFound) return previous.date;
  return previous.date === dates.primary ? dates.alternate : dates.primary;
}

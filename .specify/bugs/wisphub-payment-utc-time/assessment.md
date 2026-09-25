# Bug Assessment: a payment lands in WispHub hours late, and after 18:00 on the next day

- **Slug**: wisphub-payment-utc-time
- **Created**: 2026-09-23
- **Source**: pasted text (product creator's session). No URL supplied, so the
  URL Trust Policy did not apply and nothing was fetched. The finding came out
  of the same day's live probe of the demo tenant (Postman collection
  *WispHub · Armar el caso en el demo*, run by the creator).
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

> Devolada registers payments in WispHub with `fecha_pago` written as the UTC
> wall clock, but WispHub reads that string as the tenant's local time.
> Measured 2026-09-23 on the demo tenant (api.wisphub.net):
> `POST /facturas/1/registrar-pago/` with `fecha_pago "2026-08-20 12:00"` was
> stored as `"2026-08-20T12:00:00-05:00"` (`GET /facturas/1/`).

## Symptom

Every payment Devolada registers in WispHub carries a time that is the UTC
clock, which WispHub stores as the ISP's local clock. For an ISP in Mexico City
(UTC−6, no DST since 2022) the payment appears **6 hours later** than it was
registered. One registered between **18:00 and 23:59 local** lands on the
**next day**, and on the last day of the month, in the **next month**.

Expected: the time WispHub shows is the moment the payment was registered, on
the ISP's own clock (settings D5: "the ISP's timezone owns today, not UTC").

What moves because of it:

- **The ISP's daily cash totals and closing reports.** WispHub files the
  payment under the wrong day. The ISP sees an evening payment in tomorrow's
  total, and a month-end one in next month's.
- **Reports filtered by payment date.** `GET /facturas/?tipo_fecha=fecha_pago`
  (measured 2026-09-01 as one of the list's filters) answers from the shifted
  stamp.
- **"Recarga" customers.** WispHub's docs say their billing dates follow the
  day they pay (`usuario-tipo-recarga-191`). A payment shifted into the next
  day moves their next payment and cut-off dates a day later. This is **read
  from the docs, not measured**.

No amount is wrong. The debt, the invoice paid and the reconnection are
unaffected. This is a date on the ISP's books.

## Reproduction

Measured 2026-09-23 against the demo tenant, `api.wisphub.net`, tenant offset
−05:00 (the `Date` header read 18:41 GMT while the customer's `ultimo_cambio`
read 13:41):

1. `POST /facturas/` creates invoice 1 for `greyes@wifiplus`, 499.00.
2. `POST /facturas/1/registrar-pago/` with
   `{"forma_pago": 12752, "accion": 0, "fecha_pago": "2026-08-20 12:00", "total_cobrado": 200}`.
3. `GET /facturas/1/` answers `"fecha_pago": "2026-08-20T12:00:00-05:00"`. The
   string was taken as local wall-clock time, not UTC.

From Devolada's side, a payment registered by the sweep at 2026-09-30 20:30
Mexico City time (= 2026-10-01 02:30 UTC) sends `"2026-10-01 02:30"`. WispHub
stores October 1st, 02:30 local. [NEEDS CLARIFICATION: not yet observed on the
pilot's installation (`api.wisphub.io`, whose tenant offset is presumably
−06:00). The demo run is the only measurement.]

## Suspected Code Paths

- `apps/api/src/wisphub/reconnection.ts:48-49` builds both values from UTC:
  `const date = now.toISOString().slice(0, 10);` and
  ``const dateTime = `${date} ${now.toISOString().slice(11, 16)}`;``.
- `apps/api/src/wisphub/reconnection.ts:88`: `registerPayment(..., dateTime, ...)`
  sends that string as `fecha_pago`.
- `apps/api/src/wisphub/reconnection.ts:82`: the "Adeudo anterior" zero-total
  invoice (debt-truth D15) gets the same UTC `date` as `fecha_emision`,
  `fecha_vencimiento` and `fecha_pago`. After 18:00 local it is born dated
  tomorrow.
- `apps/api/src/wisphub/client.ts:582-598`: `registerPayment()` forwards
  `dateTime` untouched as `fecha_pago`.
- The three callers pass the same `now` and no timezone:
  `apps/api/src/reconnection/queue.ts:110`,
  `apps/api/src/direct-payments/validation.ts:954`,
  `apps/api/src/routes/payments/handler.ts:296`.
- The tools to fix it already exist: `businesses.timezone`
  (`apps/api/src/db/schema.ts:47`, default `America/Mexico_City`) and
  `apps/api/src/time/business-day.ts`.
- `apps/api/src/wisphub/client.ts:428` already assumes this for reading:
  "WispHub stamps in the tenant's timezone, not UTC". The write path never
  got the same treatment.

## Root Cause Hypothesis

`attemptReconnection` formats `now` with `toISOString()`, which is always UTC.
WispHub has no timezone field on `registrar-pago` and reads the naive string in
the tenant's zone. Confidence: **high** for the mechanism (measured round trip
plus the code). **Medium** for the exact offset on the pilot, since only the demo
tenant was observed.

## Proposed Remediation

**Preferred**: format `date` and `dateTime` on the business's wall clock.
`attemptReconnection` receives the business's `timezone`; its three callers
already hold the business row or can read it. The strings are built with the
same `Intl.DateTimeFormat` approach `time/business-day.ts` uses, through a small
exported helper there such as `businessWallClock(timezone, instant) →
{ date: "YYYY-MM-DD", dateTime: "YYYY-MM-DD HH:MM" }`, so there is one
definition of "the ISP's clock". The zero-total "Adeudo anterior" invoice takes
the same local `date`.

**Alternatives**:

- *Send an ISO string with an offset* (`2026-09-30T20:30:00-06:00`) and let
  WispHub convert it. Rejected unless measured. `registrar-pago`'s `OPTIONS`
  answers 500, so its accepted formats are unknown, and a string WispHub
  misparses could fail the payment registration, which is a money path.
- *Use the payer's transfer time (the CEP's timestamp) instead of the
  registration time.* This is a different product question. See Open Questions.

**Files likely to change**:

- `apps/api/src/time/business-day.ts` (the wall-clock helper)
- `apps/api/src/wisphub/reconnection.ts` (take `timezone`, use the helper)
- `apps/api/src/reconnection/queue.ts`,
  `apps/api/src/direct-payments/validation.ts`,
  `apps/api/src/routes/payments/handler.ts` (pass the business timezone)
- `apps/api/test/reconnection-queue.test.ts` (or a new
  `apps/api/test/wisphub-payment-utc-time.test.ts`, cited
  `bug: wisphub-payment-utc-time`)

**Tests to add or update**:

- With `now = 2026-10-01T02:30:00Z` and a business in `America/Mexico_City`,
  the body `fetchMock` captures on `registrar-pago` carries
  `fecha_pago: "2026-09-30 20:30"`. Written so it fails if UTC is used.
- The same instant for a business in `America/Hermosillo` (UTC−7) carries
  `"2026-09-30 19:30"`. This proves the zone comes from the business and is not
  hard-coded.
- The "Adeudo anterior" invoice body carries the local date (`2026-09-30`), not
  `2026-10-01`.
- A unit test for the helper at a DST-observing zone boundary, so the helper
  stays correct if a business ever uses one.

## Risks & Considerations

- **Assumes WispHub's tenant zone equals Devolada's `businesses.timezone`.**
  They are set in two different systems. An ISP whose WispHub is configured in
  another zone would still be off, by a different amount. The fix should say so
  in its comment, and the settings screen may later want to show the zone next
  to the WispHub connection.
- **Payments already registered stay shifted.** This fixes new registrations
  only. Rewriting past payments in WispHub is out of scope.
- **Retries.** A payment whose registration was queued and retried later
  (`reconnection/queue.ts`) is registered with the retry's `now`, not the
  moment the money was validated. This fix keeps that behavior and only corrects the zone.
  See Open Questions.
- No schema change, no migration, no API contract change.

## Open Questions

- [NEEDS CLARIFICATION: should `fecha_pago` be the moment Devolada registers
  the payment (today's behavior), the moment the payment was validated, or the
  payer's transfer time on the CEP? For the ISP's cash report the transfer
  time is arguably the truth. A retry that crosses midnight moves the payment
  to another day even after this fix.]
- [NEEDS CLARIFICATION: the pilot's WispHub tenant offset. One
  `GET /facturas/{id}/` on a payment Devolada registered there confirms it.]

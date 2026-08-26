---
status: in-development
stories: [US-A04]
domain: admin
updated: 2026-08-14
debt: [TD-001]
---

# Spec: ISP settings

The Configuración section: the WispHub API key that makes reconnection possible, the money split between the end customer, the store and the platform, and the display settings that decide what "today" and "2:30 p.m." mean. These are the owner's ISP-level configuration notes, finally given a home.

## Decisions

- **D1 — The API key is write-only.** `GET /settings` never returns it; it returns `configured` and the last 4 characters so the ISP can recognise which key is loaded. A key that can be read back is a key that can leak through a screenshot, a proxy log or a browser extension. Replacing it is the only "edit".
- **D2 — "Probar conexión" tests the typed key before it is saved.** `POST /settings/wisphub/test` accepts an optional `apiKey`; with one it tests that candidate, without one it tests the stored key. Saving a key that was never proven turns every later charge into the place where the ISP finds out. WispHub's own answer is the test: one real customer query.
- **D3 — A key that fails the test is still savable, and saving it always re-tests.** The result is reported, not enforced: WispHub can be down while the key is perfectly good (`WISPHUB_UNAVAILABLE` ≠ `WISPHUB_AUTH_FAILED`). Blocking the save on an outage would leave the ISP unable to configure anything. The response says which of the two happened.
- **D4 — The store's commission can never exceed the service fee.** `PATCH` → 400 `COMMISSION_EXCEEDS_FEE`. The platform's share is the difference and is shown live while typing, never stored: one number derived from two, so it cannot drift (same rule as the ledger balance).
- **D5 — The ISP timezone owns "today", and it supersedes charge-feed D2.** The server computes the start of the business day from `isps.timezone`, reports it back as `today.startedAtMs`, and the feed's `todayStartMs` parameter is gone. Reporting the boundary is not decoration: it is how a client (or a test) can tell which day was counted instead of assuming. Mexico spans three zones (UTC-6 centre, UTC-7 Sonora, UTC-8 Baja California), and an ISP in Hermosillo checking totals from Mexico City must still see its own day. **Rejected**: keeping the browser as the source, which made the same charge count on different days depending on where the laptop was.
- **D6 — Time format is a display setting the API never applies.** `timeFormat` (`12h` | `24h`) travels in the session actor and every rendered time in the admin passes through one helper. The API always speaks in epoch ms; formatting belongs to the surface that has a reader.
- **D7 — The settings ride the session.** `/auth/me` carries `timezone`, `timeFormat` and `wisphubConfigured` for an ISP actor, so no screen needs a second request before it can render a time — and the shell knows to show the "missing API key" banner.
- **D8 — Missing key = a banner, not a wall.** The admin stays usable without a key (registering stores and reading the ledger do not need WispHub); the banner is persistent and links here, and charges already fail with a clear `WISPHUB_NOT_CONFIGURED`. **Rejected**: the "first login demands the key" gate from the build plan, which would block an ISP from doing the setup work it can do while it waits for its key.

## Contract (ISP session only)

- `GET /charges/feed` → `today: { count, totalCents, startedAtMs }` — the boundary the server counted from (D5)
- `GET /settings` → `{ serviceFeeCents, storeCommissionCents, platformShareCents, timezone, timeFormat, wisphub: { configured, keyTail }, reconnection: { thresholdPercent, floorCents } }` — the last added 2026-08-25 by `direct-payment/partial-payment.spec.md` D2/D4 (defaults 100 / 0)
- `PATCH /settings` — any of `{ serviceFeeCents, storeCommissionCents, timezone, timeFormat, wisphubApiKey, reconnectionThresholdPercent, reconnectionFloorCents }` → the `GET` shape; the threshold is an integer 0–100, the floor a nonnegative integer of cents
  - 400 `COMMISSION_EXCEEDS_FEE` (D4) · 400 on an unknown timezone (allow-list of the three Mexican zones) · Zod at the edge for the rest
  - a `wisphubApiKey` in the body is always re-tested; the response carries `wisphubTest: { ok, code }` (D3)
- `POST /settings/wisphub/test` — `{ apiKey? }` → `{ ok: true, sampleCustomerCount }` · `{ ok: false, code: "WISPHUB_AUTH_FAILED" | "WISPHUB_UNAVAILABLE" }` (200 either way: the test succeeded in telling us the answer)
- Store sessions → 403.
- `GET /auth/me` for an ISP gains `timezone`, `timeFormat`, `wisphubConfigured` (D7).

## UI Contract

- `/settings`, three cards: **Conexión con WispHub** (masked key `••••1234` or "Sin configurar", field for a new key, "Probar conexión", plain result), **Cobro y comisiones** (service fee and store commission in pesos, with the platform share computed live below), **Zona horaria y hora** (timezone `Select` with the three Mexican zones named in plain es-MX, and a 12h/24h `Select` showing a live example).
- Saving is per card, each with its own state; a saved card says so.
- **Reconexión con pago incompleto** (added 2026-08-25, `partial-payment` D2/D4): the threshold percentage and the floor in pesos, with the meaning of the current values computed in one live sentence — the default (100 / $0) reads "El servicio regresa cuando el pago cubre todo el adeudo."
- The shell shows the missing-key banner while `wisphubConfigured` is false (D8).
- Plain es-MX. Amounts through `formatMoney`/`parseMoney`, never floats.

## Scenarios

1. GET returns the split and never the key, only its tail (US-A04, D1)
2. PATCH saves fee, commission, timezone and format; commission above the fee → 400 (D4)
3. The connection test answers `ok` for a good key and distinguishes the two failures (D2, D3)
4. The feed's "today" totals follow the ISP timezone, not the browser (D5)
5. UI: the settings screen saves the split and shows the platform share while typing (US-A04, D4)
6. UI: testing a typed key reports the result without saving it (D2)
7. UI: the admin renders times in the configured format (D6)

## Definition of Done

- [x] Scenarios 1–4 automated in the API layer (`test/settings.test.ts` 5 tests, `test/charge-feed.test.ts`, `test/business-day.test.ts` 3 tests)
- [x] Scenarios 5–7 automated with Testing Library + MSW (`apps/admin/test/settings.test.tsx`, 4 tests)
- [x] Real check (2026-08-16, owner, deployed dev): the renewed WispHub key was
      saved through the settings screen (live validation) and charges from the
      PWA went through against it — the full save-then-charge loop the box asks
      for. The pilot ISP's key repeats the same motion.

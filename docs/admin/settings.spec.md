---
status: in-development
stories: [US-A04]
domain: admin
updated: 2026-09-03
debt: [TD-001]
---

# Spec: ISP settings

> **2026-08-31, retirement PR**: D4 (commission ≤ fee, the split card) and the settlement card retired with the store network. `serviceFeeCents` survives as the fallback the SPEI fee inherits when unset (direct-payment D3).
>
> **Phase 2 (business-and-memberships D3)**: cards render by area — owner/admin see the business cards, the CLABE field is the owner's alone (an admin reads it as text), **Usuarios** (members, invite with the roles the caller may grant, remove) shows for owner/admin, and the passkey card is every role's. Viewers get a masked CLABE and no key tail from the API.
>
> **2026-09-02, account hub (US-A05)**: the page became a hub of sub-pages under `/settings` — the four business cards live at `/settings/business` (ids kept), Saldo at `/settings/credit`, Usuarios at `/settings/users`, the passkey card at `/settings/security`; the **Sesión** card retired (the hub's Cerrar sesión is the door at every width, BUG-016 still closed). [account-hub.spec.md](account-hub.spec.md) D4–D5.
>
> **2026-09-03, the page splits (D11)**: `/settings/business` is retired as a page — **Pago directo y conciliación** (`/settings/direct-payment`) and **Preferencias** (`/settings/preferences`) are two rows of the hub's rail. The old path redirects, hashes included.
>
> **2026-09-03, no index (D10)**: the in-page section index retired with the page it was built for — `/settings/business` is three cards and no table of contents.
>
> **2026-09-03, one fee (BUG-017)**: the **Cargo por servicio** card retired — the SPEI card's "Cargo por servicio SPEI" is the service fee's only control (D9). `/settings/business` holds three cards; `#cargo` lands on the SPEI card.

The Configuración section: the WispHub API key that makes reconnection possible, the money split between the end customer, the store and the platform, and the display settings that decide what "today" and "2:30 p.m." mean. These are the owner's ISP-level configuration notes, finally given a home.

## Decisions

- **D1 — The API key is write-only.** `GET /settings` never returns it; it returns `configured` and the last 4 characters so the ISP can recognise which key is loaded. A key that can be read back is a key that can leak through a screenshot, a proxy log or a browser extension. Replacing it is the only "edit".
- **D2 — "Probar conexión" tests the typed key before it is saved.** `POST /settings/wisphub/test` accepts an optional `apiKey`; with one it tests that candidate, without one it tests the stored key. Saving a key that was never proven turns every later charge into the place where the ISP finds out. WispHub's own answer is the test: one real customer query.
- **D3 — A key that fails the test is still savable, and saving it always re-tests.** The result is reported, not enforced: WispHub can be down while the key is perfectly good (`WISPHUB_UNAVAILABLE` ≠ `WISPHUB_AUTH_FAILED`). Blocking the save on an outage would leave the ISP unable to configure anything. The response says which of the two happened.
- **D4 — The store's commission can never exceed the service fee.** `PATCH` → 400 `COMMISSION_EXCEEDS_FEE`. The platform's share is the difference and is shown live while typing, never stored: one number derived from two, so it cannot drift (same rule as the ledger balance).
- **D5 — The ISP timezone owns "today", and it supersedes charge-feed D2.** The server computes the start of the business day from `isps.timezone`, reports it back as `today.startedAtMs`, and the feed's `todayStartMs` parameter is gone. Reporting the boundary is not decoration: it is how a client (or a test) can tell which day was counted instead of assuming. Mexico spans three zones (UTC-6 centre, UTC-7 Sonora, UTC-8 Baja California), and an ISP in Hermosillo checking totals from Mexico City must still see its own day. **Rejected**: keeping the browser as the source, which made the same charge count on different days depending on where the laptop was.
- **D6 — Time format is a display setting the API never applies.** `timeFormat` (`12h` | `24h`) travels in the session actor and every rendered time in the admin passes through one helper. The API always speaks in epoch ms; formatting belongs to the surface that has a reader.
- **D7 — The settings ride the session.** `/auth/me` carries `timezone`, `timeFormat` and `wisphubConfigured` for an ISP actor, so no screen needs a second request before it can render a time — and the shell knows to show the "missing API key" banner. *(2026-09-02: the flag is `integrationConfigured` and the banner names no provider — integrations-hub D10.)*
- **D8 — Missing key = a banner, not a wall.** The admin stays usable without a key (registering stores and reading the ledger do not need WispHub); the banner is persistent and links here, and charges already fail with a clear `WISPHUB_NOT_CONFIGURED`. **Rejected**: the "first login demands the key" gate from the build plan, which would block an ISP from doing the setup work it can do while it waits for its key.
- **D9 — One service fee, one control: the SPEI card's (2026-09-03, BUG-017).** With the store network gone (pivot D15) SPEI is the only channel, so the "general" fee the SPEI fee used to inherit from (direct-payment D3) had no reader of its own — yet the page kept two cards that both edited "the service fee", and an owner who changed one saw the other stand still. The **Cargo por servicio** card retires. The SPEI card's field is the fee: it opens on the fee **in force** (`spei.effectiveServiceFeeCents`, never a blank with a placeholder), it is required, and it always saves `speiServiceFeeCents` as a number. `serviceFeeCents` stays in the row and on the `GET` as the **birth default** (1500) a business is born with until it saves a fee — the D3 fallback still resolves rows that never saved one — but it is **not patchable**: a second writable fee is exactly how the page grew two cards for one number. `speiServiceFeeCents: null` is still accepted by the API (a fresh row is null; nothing forces a migration) but no surface sends it. **Rejected**: keeping the general card as "the default" (a default nobody can see in the flow it applies to is a second number, not a default); a migration copying `serviceFeeCents` into `speiServiceFeeCents` and dropping the column (nothing on the wire needs it and the fallback is one line; the drop can ride any later migration).
- **D10 — No in-page index (2026-09-03).** The anchor row above the cards
  answered a design review of a page that was ~3,000px tall and ended at
  Usuarios; a reader could not see that the page had a Zona horaria
  card. The hub moved four cards to pages of their own (account-hub D4)
  and D9 retired a fifth, so what is left is three cards a reader takes in
  by scrolling once. A table of contents for a page you can already see is
  furniture, and it read as a fourth navigation layer under the nav, the
  rail and the page title. The **ids stay** — `#spei`, `#politica` and
  `#zona` are the deep-link contract the CLABE banner, the wizard and
  `HASH_HOMES` depend on, and they are what makes the index removable
  without breaking a link. The one-card sub-pages drop theirs (`#saldo`,
  `#usuarios`, `#acceso`) along with the `scroll-mt` that served them: the
  hub redirects those hashes to the page, not into it, so nothing could
  land on them — an anchor no link can reach is not a contract, it is the
  index's shadow. The retirement is a **FRONTEND law**, not a settings
  preference: no surface gets an in-page anchor index. **Rejected**: keeping it until the page grows
  again (the growth rule is rows, not cards — the IA's S4 — so it never
  will); turning it into tabs (one document becomes four, and a shareable
  URL becomes a component's state).
- **D11 — Configuración splits in two (2026-09-03).** One page was
  answering three unrelated questions — where the money arrives (CLABE,
  banco, beneficiario, the service fee), how a payment is judged against
  what was asked (tolerance, surplus), and how a clock reads (timezone,
  format) — under a title that named none of them. "Configuración" as a
  row inside a settings hub tells the reader nothing; a row has to say
  what is behind it. Two rows, two pages:
  **Pago directo y conciliación** (`/settings/direct-payment`: the SPEI
  card and the reconciliation policy) and **Preferencias**
  (`/settings/preferences`: zona horaria y hora). The policy rides with
  the channel because SPEI is the only one (pivot D15), so today "the
  rules of this channel" and "the rules of all payments" are the same
  sentence; when a second channel exists the policy promotes to a row of
  its own. The label is **not** "Cobro y conciliación": *Cobros* already
  names the payment-requests section, and the glossary allows one word one
  concept. `/settings/business` stays as a **permanent redirect** —
  `#zona` lands on Preferencias, everything else on Pago directo y
  conciliación with its hash — because the CLABE banner, the wizard,
  Cobros and months of habit point at it, and a path is never deleted,
  only redirected (IA S2). **Rejected**: keeping one page with three cards
  (the cheapest option, and the one that made "Configuración" mean
  nothing); moving the policy next to WispHub's class→action mapping (the
  policy is the business's, not the integration's — pivot D8 — and it
  breaks the day a second integration exists); renaming the page without
  splitting it (a title cannot name three subjects honestly).

## Contract (ISP session only)

- `GET /charges/feed` → `today: { count, totalCents, startedAtMs }` — the boundary the server counted from (D5)
- `GET /settings` → `{ serviceFeeCents, storeCommissionCents, platformShareCents, timezone, timeFormat, wisphub: { configured, keyTail }, reconnection: { thresholdPercent, floorCents } }` — the last added 2026-08-25 by `direct-payment/partial-payment.spec.md` D2/D4 (defaults 100 / 0)
- `PATCH /settings` — any of `{ storeCommissionCents, timezone, timeFormat, wisphubApiKey, reconnectionThresholdPercent, reconnectionFloorCents }` → the `GET` shape; the threshold is an integer 0–100, the floor a nonnegative integer of cents. *(2026-09-03, D9: `serviceFeeCents` left the PATCH — the fee is written as `speiServiceFeeCents`, per direct-payment US-D05; a body carrying `serviceFeeCents` has the key dropped at the edge and the row stands.)*
  - 400 `COMMISSION_EXCEEDS_FEE` (D4) · 400 on an unknown timezone (allow-list of the three Mexican zones) · Zod at the edge for the rest
  - a `wisphubApiKey` in the body is always re-tested; the response carries `wisphubTest: { ok, code }` (D3)
- `POST /settings/wisphub/test` — `{ apiKey? }` → `{ ok: true, sampleCustomerCount }` · `{ ok: false, code: "WISPHUB_AUTH_FAILED" | "WISPHUB_UNAVAILABLE" }` (200 either way: the test succeeded in telling us the answer)
- Store sessions → 403.
- `GET /auth/me` for an ISP gains `timezone`, `timeFormat`, `wisphubConfigured` (D7).

## UI Contract

- `/settings`, three cards: **Conexión con WispHub** (masked key `••••1234` or "Sin configurar", field for a new key, "Probar conexión", plain result), **Cobro y comisiones** (service fee and store commission in pesos, with the platform share computed live below), **Zona horaria y hora** (timezone `Select` with the three Mexican zones named in plain es-MX, and a 12h/24h `Select` showing a live example).
- **2026-09-03 (D11)**: **Pago directo y conciliación** (`/settings/direct-payment`) holds **Pago directo por SPEI** (`#spei`) and **Política de conciliación** (`#politica`); **Preferencias** (`/settings/preferences`) holds **Zona horaria y hora** (`#zona`) — and, since 2026-09-05, no page title above it: one card whose heading already says the row's words (account-hub D11). `/settings/business` renders nothing and redirects, keeping the hash. The hub's rail lists both rows, gated by `settings: update`.
- **2026-09-03 (D9)**: the direct-payment page holds **Pago directo por SPEI** (CLABE, banco, beneficiario, and **Cargo por servicio SPEI** — the fee's only field, opened on the fee in force, required, helper "Lo que paga tu cliente además de su cargo del periodo al transferir"), **Política de conciliación** with no index above them (D10); **Zona horaria y hora** moved to Preferencias (D11). The cards keep their ids (`#spei`, `#politica`, `#zona`). No card named "Cargo por servicio" exists, and no anchor links to one.
- Saving is per card, each with its own state; a saved card says so.
- **Reconexión con pago incompleto** (added 2026-08-25, `partial-payment` D2/D4): the threshold percentage and the floor in pesos, with the meaning of the current values computed in one live sentence — the default (100 / $0) reads "El servicio regresa cuando el pago cubre todo el adeudo."
- The shell shows the missing-integration banner while `integrationConfigured` is false (D8; copy and target per integrations-hub D10).
- **Entrar con huella o rostro** (US-S07): the user's own card, every role — the credentials listed with "Quitar", the enrolment button (better-auth D18).
- **Sesión** (added 2026-09-02, BUG-016): the last card, every role, every width — the email and "Cerrar sesión". The phone's only door out of the shell.
- Plain es-MX. Amounts through `formatMoney`/`parseMoney`, never floats.

## Scenarios

1. GET returns the split and never the key, only its tail (US-A04, D1)
2. PATCH saves fee, commission, timezone and format; commission above the fee → 400 (D4)
3. The connection test answers `ok` for a good key and distinguishes the two failures (D2, D3)
4. The feed's "today" totals follow the ISP timezone, not the browser (D5)
5. UI: the settings screen offers the service fee once — on the SPEI card, opened on the fee in force — saves it as `speiServiceFeeCents`, and refuses an empty fee (US-A04, D9; *was*: saves the split and shows the platform share, D4, retired with the store network)
6. UI: `/settings/business` redirects — with `#zona` to Preferencias, with `#spei` to Pago directo y conciliación, hash kept; the hub's rail offers both rows (D11)
7. UI: testing a typed key reports the result without saving it (D2)
8. UI: the admin renders times in the configured format (D6)
9. UI: a viewer signs out from the Sesión card and lands on login (BUG-016); the passkey card lists and removes credentials (better-auth D18)

## Definition of Done

- [x] Scenarios 1–4 automated in the API layer (`test/settings.test.ts` 5 tests, `test/charge-feed.test.ts`, `test/business-day.test.ts` 3 tests)
- [x] Scenarios 5, 7 and 8 automated with Testing Library + MSW (`apps/admin/test/settings.test.tsx`; scenario 5 rewritten 2026-09-03 for D9, the index suite rewritten the same day for D10 — no section nav, ids intact, plus `apps/api/test/settings.test.ts` "the general fee is not patchable" and `apps/admin/test/account-hub.test.tsx` "#cargo lands on the SPEI card")
- [x] Scenario 6 automated (`apps/admin/test/settings.test.tsx` — the redirect with each hash, and the two rail rows in `account-hub.test.tsx`)
- [x] The real-API journey follows the rename (`tests/passkey/identity-journey.spec.ts`: the wizard's CLABE step lands on Pago directo y conciliación) — it runs on the dev deploy, not in PR CI, and it caught D11 the way it caught the hub (TESTING rule 13)
- [x] Scenario 9 automated (`apps/admin/test/session-round.test.tsx`, 2026-09-02)
- [x] Real check (2026-08-16, owner, deployed dev): the renewed WispHub key was
      saved through the settings screen (live validation) and charges from the
      PWA went through against it — the full save-then-charge loop the box asks
      for. The pilot ISP's key repeats the same motion.

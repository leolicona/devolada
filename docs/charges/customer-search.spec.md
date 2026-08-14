---
status: in-development
stories: [US-C01]
domain: charges
updated: 2026-08-14
debt: []
---

# Spec: Customer search

The store types an ID, phone or name. The API asks WispHub and returns the minimum data to confirm identity. This is the first screen of the charge path. First feature with the new code organization: `src/routes/charges/` in the API, `src/features/charge/` in the PWA.

## Decisions

- **D1 — The query type is detected, not selected.** Only digits → `?telefono=`. Contains `@` → `?usuario=`. Anything else → `?nombre=`. Discarded option: a type selector in the UI (one more tap for the shopkeeper, zero gain).
- **D2 — Minimum identity only (privacy rule from the brief).** The API returns: WispHub id, `usuario`, name, zone, service status, monthly fee in cents. It never returns address, exact phone, or history. The mapping is a allow-list: new WispHub fields never leak by accident.
- **D3 — WispHub failures have two distinct codes.** `WISPHUB_NOT_CONFIGURED` (the ISP has no API key, **or WispHub rejects the key** — both are setup problems) and `WISPHUB_UNAVAILABLE` (WispHub did not answer — feeds the amber "queue" notice in the UI). Both are 503. A generic error would hide the difference the store needs to see. Found in the manual check: the rotated old key first looked like an outage; now 401/403 from WispHub maps to the setup code.
- **D4 — Store sessions only.** The admin does not use this proxy in the MVP. Other actor types get 403.
- **D5 — Money converts at the border.** WispHub sends string decimals (`"499.00"`). A parser in the WispHub adapter turns them into integer cents. Floats never touch the value (ARCHITECTURE.md money law).

## Contract

`GET /charges/customers?q=<text>` (session cookie, store only)

Success: `{ success: true, data: { customers: [ { wisphubId, usuario, name, zone, serviceStatus, monthlyFeeCents } ] } }`

- `serviceStatus`: `"active" | "suspended" | "unknown"` (mapped from WispHub `estado`; unknown values never break the UI).
- Failures: 400 (q shorter than 2 chars) · 401 no session · 403 not a store · 503 `WISPHUB_NOT_CONFIGURED` · 503 `WISPHUB_UNAVAILABLE`.

`src/routes/charges/schema.ts` exports the Zod schemas. The PWA derives its types from them. MSW handlers validate against them.

## Business rules

1. The ISP's WispHub API key comes from `isps.wisphub_api_key` (the store's ISP). No key → `WISPHUB_NOT_CONFIGURED`.
2. All WispHub traffic goes through the adapter `src/wisphub/client.ts` (adapters own the outside world).
3. `usuario` must come from the WispHub **list** endpoint. The detail endpoint returns it as null (spike finding).
4. Results are limited to 10.

## UI Contract

- The search screen replaces the placeholder at `/` (feature folder `src/features/charge/`).
- The input focuses on open. Search starts from 2 characters, with a small debounce.
- Each result card: name, zone, `StatusBadge` (active/suspended) and the monthly fee. Tapping a card goes to `/charge/$customerId` (placeholder until the next task).
- States: initial (hint text), searching, no results ("Sin resultados"), `WISPHUB_UNAVAILABLE` (amber notice: charges will queue), `WISPHUB_NOT_CONFIGURED` (plain message: the ISP has not connected WispHub yet).
- Copy in plain es-MX. No technical words on screen.

## Scenarios

1. Digits query → API calls WispHub with `?telefono=` (US-C01)
2. Name query → `?nombre=`; `@` query → `?usuario=` (US-C01)
3. Response maps to minimum identity: cents conversion, status mapping, no extra fields (US-C01, D2)
4. ISP without API key → 503 `WISPHUB_NOT_CONFIGURED` (D3)
5. WispHub down → 503 `WISPHUB_UNAVAILABLE` (D3)
6. No session → 401; ISP session → 403 (D4)
7. UI: typing shows result cards with name, zone and status badge (US-C01)
8. UI: WispHub down shows the amber queue notice (US-C01, D3)
9. UI: no results shows "Sin resultados"

## Definition of Done

- [x] Scenarios 1–6 automated in the API layer (`test/charge-search.test.ts`, 9 tests)
- [x] Scenarios 7–9 automated with Testing Library + MSW (`test/charge-search.test.tsx`, 3 tests)
- [ ] Manual check against the real WispHub demo tenant (blocked: needs the rotated API key in `.dev.vars`)

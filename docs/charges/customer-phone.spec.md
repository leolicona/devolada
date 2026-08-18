---
status: in-development
stories: [US-C07]
domain: charges
updated: 2026-08-17
---

# Spec: Customer phone capture

When WispHub has no phone for the customer, the receipt's `wa.me` link opens
WhatsApp with no recipient (receipt D3). The shopkeeper is standing in front of
the person who owns that phone. This spec lets the store save the number once,
so the receipt opens straight into the customer's chat — this time and every
time after.

## The probe that shaped this spec

The backlog asked first whether `telefono` can be written **back to WispHub**
via `PATCH /clientes/{id}/`, so the data would live in the ISP's system and not
in ours. Probed against the demo tenant (2026-08-17); the answer is **no**:

- `telefono` appears only in the **list** serializer. The detail resource
  (`GET /clientes/{id_servicio}/`) does not carry the field at all — it is a
  network-config resource.
- `OPTIONS /clientes/{id}/` lists 34 writable fields; `telefono` is not one.
- An empirical `PATCH {"telefono": "..."}` neither echoes nor persists the
  value (list still shows the old value afterwards).

Recorded in `docs/integrations/wisphub.md`. Write-back is off the table; the
fallback the backlog anticipated — storing it ourselves — is the only path.

## Decisions

- **D1 — We store the phone ourselves, because WispHub won't take it.** The
  probe above closes the preferred alternative. **Rejected**: asking the ISP to
  type numbers into the WispHub UI by hand — the shopkeeper is the one facing
  the customer at charge time; routing the number through the ISP's back
  office means it never gets captured.
- **D2 — Capture happens on the confirm screen, and it is optional.** When the
  found customer has no phone (from WispHub **or** from us, per D4), the charge
  confirm screen shows one optional field: "Teléfono para el comprobante
  (opcional)". Skipping it changes nothing — the charge proceeds and the
  receipt falls back to the contact picker (receipt D3). **Rejected**:
  capturing at receipt time (after the charge) — the phone must exist before
  the charge is recorded, because the charge copies it at record time (receipt
  D4) and that copy is what the receipt reads; a later capture would only help
  the *next* charge. **Rejected**: making it required — nothing blocks a
  charge, the product's oldest law.
- **D3 — The number is remembered per customer, not per charge.** New table
  `customer_contacts` (`ispId`, `wisphubCustomerId`, `phone`, timestamps;
  unique per ISP + customer). The charge keeps copying the resolved phone into
  `charges.customer_phone` at record time exactly as today — the receipt path
  does not change shape, only the source gets richer. **Rejected**: storing
  only on the charge row — the shopkeeper would retype the same number every
  month, and one typo per month is one lost receipt per month.
- **D4 — WispHub wins; ours fills the gap.** At search/confirm time the
  resolved phone is WispHub's `telefono` when present, else our
  `customer_contacts` row, else null. A captured number never overrides what
  the ISP has on file — WispHub stays the source of truth for its own data,
  ours is a patch over its holes. If WispHub later gains a phone for that
  customer, it silently takes precedence; our row stays but stops being read.
- **D5 — Minimal data, honest purpose.** We keep one phone per customer,
  digits only, normalized like the receipt already does (10 national digits,
  `52` prefix at link time). It exists to deliver receipts; it feeds nothing
  else. A wrong number is fixed by typing a new one at the next charge
  (upsert). **Deferred, not rejected**: an ISP-facing view/delete of captured
  numbers — worth doing when the admin gets a customer view; today the ISP can
  ask us. Noted as debt: TD-014.

## Contract

- `GET /charges/customers?q=` and `GET /charges/customers/:usuario` (search and
  quote): every `customerResult` gains **`hasPhone: boolean`** — the D4
  resolution (WispHub first, then `customer_contacts`) reduced to the only
  question the UI has. *(Refined during development: the spec first said the
  resolved `phone` and a `phoneSource` would cross the wire. They must not —
  customer-search D2 makes the response an allow-list of identity fields, and
  the phone deliberately stops at the server. The screen only needs to know
  whether to ask, and `hasPhone` says exactly that; `phoneSource` died with it,
  since the UI treats both origins identically anyway.)*
- `POST /charges` (existing): accepts optional `customerPhone` (10 digits,
  Zod-validated). When present and the customer has no WispHub phone, it
  upserts `customer_contacts` and is copied to `charges.customer_phone`; when
  the customer already has a WispHub phone, the field is ignored (D4).
- Receipt endpoint: unchanged (it already reads `charges.customer_phone`).

## UI Contract

- Confirm screen, only when `hasPhone` is false: one optional input labeled
  **"Teléfono para el comprobante (opcional)"**, hint "Para enviarle su
  comprobante por WhatsApp". Numeric input capped at 10 digits, non-digits
  dropped as they are typed. It has **no error state at all**: an unfinished
  number is not a mistake, it is simply no phone — it stays out of the request
  and the charge button never notices.
- No new screen, no new state names. A captured number is treated exactly like
  a WispHub one (no badge — the shopkeeper does not care where it lives).

## Scenarios

1. Customer without phone anywhere: confirm screen offers the field; captured
   number lands on the charge and the receipt links straight to the chat
   (US-C07, D2, D3)
2. Next charge for the same customer: search resolves the captured phone,
   the field does not appear, the receipt links directly (D3, D4)
3. Customer with a WispHub phone: no capture field; a `customerPhone` sent
   anyway is ignored (D4)
4. Charge without the optional field: recorded exactly as today, receipt falls
   back to the picker (D2)
5. Re-capture over an existing captured number: upsert, the new number wins
   from the next charge on (D5)
6. Validation: a `customerPhone` that is not 10 digits → 400 with the envelope
   error code; UI never lets it block the charge button

## Definition of Done

- [x] Scenarios 1–5 automated in the API layer (`test/customer-phone.test.ts`,
      5 tests, WispHub mocked)
- [x] Scenario 6 automated: API validation (same file) and the UI's two halves
      — field offered or not, unfinished number never blocking
      (`apps/tienda/test/charge-confirm.test.tsx`, 3 tests)
- [x] Migration for `customer_contacts` applied (`0008_unknown_shooting_star.sql`)
- [x] TD-014 registered in `docs/TECH_DEBT.md`
- [ ] Real check on deployed dev: capture a number on a charge against the
      demo tenant and see the receipt open into the chat

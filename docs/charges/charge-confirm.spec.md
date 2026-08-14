---
status: in-development
stories: [US-C02, US-K04]
domain: charges
updated: 2026-08-14
debt: []
---

# Spec: Confirm & charge screen

The shopkeeper taps a search result and sees one screen: who the customer is, the exact amount with its breakdown, and one big button. This screen is the number the shopkeeper says out loud. The charge action itself (recording + reconnection) is the next task; this spec covers the quote and the screen.

## Decisions

- **D1 — The customer loads by `usuario`, not by numeric id.** Spike finding: the WispHub detail endpoint returns `nombre` and `usuario` as null. The list endpoint with `?usuario=` is the only reliable way to fetch one customer. The route param `$customerId` carries the `usuario` string.
- **D2 — The quote is computed server-side.** The API returns `{ customer, quote, cap }` in one call. The breakdown (monthly fee + service fee = total) is never computed in the browser: the service fee lives in the ISP row and the money law says cents only.
- **D3 — `billingStatus` joins the allow-list.** Mapped from WispHub `estado_facturas`: "Pagadas" → `paid`, "Pendiente de Pago" / "Vencidas" → `due`, anything else → `unknown`. "Paid" means the screen shows "Sin adeudo" and no button (US-C02 rule: exact monthly fee only, no advance payments).
- **D4 — The balance cap check ships here (US-K04, first half).** The quote includes `cap: { balanceCents, capCents, blocked }`. The balance is the ledger SUM, read through `src/ledger/` (first use of the ledger module law). When blocked, the button is disabled with a plain explanation.
- **D5 — The button exists but the charge action is honest.** Recording the charge is the next task. Pressing the button shows a plain "next task" note. No fake success.

## Contract

`GET /charges/customers/:usuario` (session cookie, store only)

Success:
```
{ customer: { wisphubId, usuario, name, zone, serviceStatus, billingStatus, monthlyFeeCents },
  quote:    { monthlyFeeCents, serviceFeeCents, totalCents },
  cap:      { balanceCents, capCents, blocked } }
```

Failures: 401 / 403 (as search) · 404 `CUSTOMER_NOT_FOUND` · 503 `WISPHUB_NOT_CONFIGURED` / `WISPHUB_UNAVAILABLE`.

`billingStatus` is also added to the search response (same allow-list, same mapping).

## Business rules

1. `totalCents = monthlyFeeCents + serviceFeeCents`; the service fee comes from `isps.service_fee_cents`.
2. The store's balance = SUM of its ledger entries, read only through `src/ledger/`.
3. `blocked = balanceCents >= capCents` (cap from `stores.balance_cap_cents`).
4. A suspended customer with `due` billing is the normal case — the screen treats it as chargeable.

## UI Contract

- `/charge/$customerId` (feature folder `src/features/charge/`): identity card (name, zone, `StatusBadge`), total at `--font-size-amount`, `AmountBreakdown`, and the 64px "Cobrar $X" button anchored at the bottom.
- States: loading · `paid` → "Sin adeudo" notice, no button · `cap.blocked` → disabled button + "Registra una entrega para seguir cobrando" · 404 → plain not-found message · WispHub errors → same notices as the search screen.
- Copy in plain es-MX.

## Scenarios

1. Quote returns the customer and the computed breakdown (total = monthly + service fee) (US-C02)
2. `estado_facturas` "Pagadas" maps to `paid` (US-C02, D3)
3. Unknown `usuario` → 404 `CUSTOMER_NOT_FOUND` (D1)
4. Ledger balance at or above the cap → `cap.blocked: true` (US-K04, D4)
5. UI: the screen shows name, breakdown lines and the "Cobrar $X" button with the total (US-C02)
6. UI: `paid` shows "Sin adeudo" and no charge button (US-C02)
7. UI: `blocked` shows a disabled button and the plain explanation (US-K04)

## Definition of Done

- [x] Scenarios 1–4 automated in the API layer (`test/charge-quote.test.ts`, 4 tests)
- [x] Scenarios 5–7 automated with Testing Library + MSW (`test/charge-confirm.test.tsx`, 3 tests)
- [ ] Manual check against the real WispHub demo tenant (blocked: rotated API key)

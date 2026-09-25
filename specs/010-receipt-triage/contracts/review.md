# Contract: a payment held for the ISP's decision

**Feature**: receipt-triage · **Decisions**: D31 (plan), spec FR-006,
FR-020a · **Route**: `apps/api/src/routes/payments/{index,handler,schema}.ts`
· **Screen**: the payments feed, `apps/admin/src/features/feed/`

Two confirmations are held instead of settled: a transfer Banxico confirmed
to an account the ISP had **removed** (FR-020a), and one found by reference
whose CEP carried **no clave** while the provider could not say whether it
was used before (FR-006). Both reuse the observation pattern the panel
already has (integrations-hub D4/D5: `actionOutcome = "observation"` and
`POST /payments/:id/execute-action`), with its own outcome so the feed can
say why.

## The row

- `status` = `confirmed` — Banxico did confirm; the verdict is not rewritten.
- `action_outcome` = **`review`** (new value, TypeScript only; the column is
  text) — nothing is registered in WispHub, nothing is reconnected, no
  webhook announces the verdict yet.
- `review_reason` (new column) = `retired_account` | `no_clave`.

## `POST /payments/:id/review` — `reviewDecisionRequest`

```ts
z.object({ decision: z.enum(["accept", "reject"]) })
```

- `requireArea("payments", "operate")`; tenant-scoped like every payments
  route; only a row with `action_outcome = "review"` qualifies, otherwise
  `NOT_REVIEWABLE` (409).
- `accept` → `action_outcome = "queued"`, the row joins the action queue
  exactly as an accepted observation does; an API link announces its verdict
  now.
- `reject` → `status = "invalid"`, `last_error = "REJECTED_BY_BUSINESS"`,
  `action_outcome = null`; an API link announces `invalid`.
- Both record who decided and when (`reviewed_by`, `reviewed_at`).

## Feed and page

- The feed shows the row with the existing `StatusBadge` pattern (icon +
  text): "En revisión", and, for `retired_account`, "Pagó a tu {tarjeta}
  ••••1234, que ya no está registrada. Banxico confirmó la transferencia."
  Two buttons: "Aceptar pago" and "Rechazar".
- The payer's status reads `inReview: true` (payment-page contract) and sees
  "Tu pago está en revisión con {ispName}."

## Amended 2026-09-25 (implementation)

- **The status is the settlement's.** A held row is written at the
  observation gate's own place, after the debt is read and the settlement
  computed, so its `status` is `confirmed` — or `partial` when the transfer
  fell short. Writing `confirmed` over a short transfer would have told the
  panel no money was missing. Banxico's verdict is still not rewritten.
- **Accept, per link kind.** A panel payment dispatches what the gate
  recorded, at once, through "Ejecutar ahora"'s own path — so `actionOutcome`
  after accept is what that attempt reached (`done`, `queued` or `withheld`),
  not always `queued`. When the business keeps its actions in observation, an
  accepted row becomes `observation` (the owner's gate still holds); with no
  WispHub key it is `queued` and waits like any queued action. An API payment
  closes its one-time link and announces its verdict now; its outcome is the
  delivery's, as for any API payment.
- **Not paid while held.** The feed's "today" totals leave out `review`
  rows, and the feed carries `reviewReason` and `reviewAccount` (`{ kind,
  last4 }`) so the row can say which removed account received the money.
- The panel's decision buttons read "Aceptar pago" and "Rechazar"; the badge
  is the shared `StatusBadge` status `inReview` ("En revisión").

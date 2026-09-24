# Contract: a payment held for the ISP's decision

**Feature**: receipt-triage · **Decisions**: D31 (plan), spec FR-006,
FR-020a · **Route**: `apps/api/src/routes/payments/{index,handler,schema}.ts`
· **Screen**: the payments feed in `apps/admin`

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

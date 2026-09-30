# Contract: the panel — the switch, a customer's reference, the feed, the quota

**Feature**: payment-without-receipt · **Decisions**: D5, D6, D19, D20,
D23 · **Routes**: `routes/settings`, `routes/direct-payments`,
`routes/payments`, `routes/platform` · **Screens**: `apps/admin`

All additive; schemas exported from `@devolada/api` as today.

The panel only reads. The system decides every reference alone — who is
the same person, who gets an assigned number, when a phone takes digits
back (D4, D6, D26) — and the panel has no action that changes one, and no
sheet of a customer's banks or accounts (clarified 2026-09-30: the actions
added work to the business; the one case the system cannot settle, a name
written two ways, waits for the phone's future check by message).

## The switch (D20) — `settings: update`

`settingsResponse` and `settingsPatchRequest` (`routes/settings/schema.ts`)
gain `payByReference: z.boolean()`. Turning it on starts the backfill
(D5); turning it off stops showing references to payers and keeps every
reference for when it is turned on again. The settings screen shows it
with one sentence: "Tus clientes pagan con su referencia y confirman sin
comprobante. El comprobante sigue disponible."

## A customer's reference on the Links page — `payments: read`

`customerRow` (`routes/direct-payments/schema.ts:487-510`) gains

```ts
/* D1: null when the customer has no link or no reference yet */
payerReference: z
  .object({
    digits: z.string(),
    origin: z.enum(["phone", "assigned"]),
  })
  .nullable()
  .optional(),
```

`CustomerLine` shows "Ref. 234 5678 · celular" or "Ref. 781 2044 ·
asignada" — text, with nothing to press. After a D26 pass it shows the
current digits, like any other reference.

## The feed

`feedCharge` (`routes/payments/schema.ts:49-123`) gains

```ts
/* D8/D11/D23: the path that confirmed it; null on a clave, a receipt,
   and every row of a business with the feature off */
referenceSource: z.enum(["own", "typed"]).nullable().optional(),
```

`ChargeRow` adds, in text beside the existing `StatusBadge`: "Con su
referencia" (`own`) or "Con referencia escrita" (`typed`). No other mark: what chose among
several transfers stays in the row (`match_trail`, D23) for the success
criteria, not on the screen, and a confirmation from a new account is not
marked (clarified 2026-09-30).

## The quota (D19) — platform operators only

`GET /platform/provider-quota` → `{ provider: "apicep", remaining:
number, observedAt: number } | null`. `/operador`'s "Reglas" tab shows
"Consultas restantes del proveedor: 612 (hace 3 min)"; nothing when null.

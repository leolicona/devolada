# Contract: the panel — the switch, a customer's payer profile, the feed, the quota

**Feature**: payment-without-receipt · **Decisions**: D5, D6, D12, D19,
D20, D23 · **Routes**: `routes/settings`, `routes/direct-payments`,
`routes/payments`, `routes/platform` · **Screens**: `apps/admin`

All additive; schemas exported from `@devolada/api` as today.

## The switch (D20) — `settings: update`

`settingsResponse` and `settingsPatchRequest` (`routes/settings/schema.ts`)
gain `payByReference: z.boolean()`. Turning it on starts the backfill
(D5); turning it off stops showing references to payers and keeps every
reference for when it is turned on again. The settings screen shows it
with one sentence: "Tus clientes pagan con su referencia y confirman sin
comprobante. El comprobante sigue disponible."

## A customer's reference on the Links page

`customerRow` (`routes/direct-payments/schema.ts:487-510`) gains

```ts
/* D1: null when the customer has no link or no reference yet */
payerReference: z
  .object({ digits: z.string(), origin: z.enum(["phone", "assigned"]), sharedWith: z.number().int().min(0).max(2) })
  .nullable()
  .optional(),
```

`CustomerLine` shows "Ref. 234 5678 · celular" or "Ref. 781 2044 ·
asignada", and "· compartida con 1" when `sharedWith > 0`.

## `GET /direct-payments/payer-profiles/:linkId` — `payments: read`

```ts
payerProfileResponse = z.object({
  reference: z.object({ digits, origin: z.enum(["phone", "assigned"]) }).nullable(),
  /* the other customers holding the same reference (FR-006) */
  sharedWith: z.array(z.object({ source: z.enum(["panel", "api"]), customerKey: z.string() })),
  /* D12: per person */
  banks: z.array(bank),
  /* D12: per service; the last four digits only — the whole account never
     leaves the API (FR-019, spec 013 FR-010) */
  accounts: z.array(z.object({ bank, accountType: z.string(), tail: z.string() })),
});
```

Errors: 404 `NOT_FOUND` (a link of another business, or none).

## `POST /direct-payments/payer-profiles/:linkId/reset` — `payments: operate`

Retires the customer's reference and gives it a new assigned number (D6);
the others who shared it keep theirs. Answers `payerProfileResponse`.
Confirmation dialog: "El cliente tendrá que usar una referencia nueva. Si
la guardó en su banco, deberá cambiarla."

## `POST /direct-payments/payer-profiles/:linkId/not-personal` — `payments: operate`

Blocks the phone's digits and gives each customer who held them an
assigned number of its own (D6). Only for a `phone` reference; 409
`NOT_A_PHONE_REFERENCE` otherwise. Dialog: "Cada cliente con este teléfono
recibirá su propia referencia."

## The feed

`feedCharge` (`routes/payments/schema.ts:49-123`) gains

```ts
referenceSource: z.enum(["own", "typed"]).nullable().optional(),
/* D10/D11/D17: what chose the transfer — null for a single match */
decidedBy: z.enum(["learned_account", "earliest", "sender_tail", "clave_tail", "clave", "tail", "time"]).nullable().optional(),
/* FR-020 */
senderAccountNew: z.boolean().optional(),
```

`ChargeRow` adds, in text beside the existing `StatusBadge`: "Con su
referencia" or "Con referencia escrita", and "Cuenta nueva" when
`senderAccountNew`. The proof dialog lists `confirmation.days` — the days
the rounds searched.

## The quota (D19) — platform operators only

`GET /platform/provider-quota` → `{ provider: "apicep", remaining:
number, observedAt: number } | null`. `/operador`'s "Reglas" tab shows
"Consultas restantes del proveedor: 612 (hace 3 min)"; nothing when null.

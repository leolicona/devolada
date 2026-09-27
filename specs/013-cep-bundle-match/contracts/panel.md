# Contract: the panel — the decision, the undecided, the unmatched

**Feature**: cep-bundle-match · **Decisions**: D8, D10, D14 · **Routes**:
`apps/api/src/routes/payments/{index,handler,schema}.ts` · **Screen**: the
Pagos feed, `apps/admin/src/features/feed/FeedScreen.tsx`

The operator sees how every clave-less search was decided (FR-013), every
undecided payment with its reason (SC-004), and the transfers received that
no payment holds (FR-009). Other senders appear by the last four digits of
their account, never by name, and never on the payer's page (FR-010).

## `feedCharge` — one field

```ts
/* cep-bundle-match D10: set while the row is validating with
   last_error CEP_UNDECIDED — why the bundle did not decide */
undecided: z.enum(["all_used", "no_signal", "too_close", "none_fit",
                   "unreadable", "too_large"]).nullable().optional(),
```

The feed polls every 5 s, so only this enum rides it; the candidates travel
with the proof (below). The row's `StatusBadge` stays `validating`; the
detail's right column adds the reason in words:

| `undecided` | Copy |
| --- | --- |
| `all_used` | "Varias coincidencias, todas ya usadas en otros pagos" |
| `no_signal` | "Varias coincidencias; el comprobante no muestra hora ni cuenta" |
| `too_close` | "Varias coincidencias con menos de 30 s de diferencia" |
| `none_fit` | "Ninguna transferencia encontrada coincide con el comprobante" |
| `unreadable` | "No se pudo leer el archivo de coincidencias" |
| `too_large` | "Demasiadas coincidencias para revisarlas" |

…followed by "Se pidió la clave de rastreo al cliente." and a "Ver
coincidencias" button that opens the proof dialog.

## `GET /payments/:id/proof` — `proofResponse.match`

```ts
match: z.object({
  source: z.enum(["several", "single"]),
  decided: z.enum(["chosen", "undecided"]),
  by: z.enum(["tail", "time", "both", "none"]).nullable(),
  reason: z.enum([...undecided reasons]).nullable(),
  distanceS: z.number().int().nullable(),
  receipt: z.object({ time: z.string().nullable(), tail: z.string().nullable() }),
  candidates: z.array(z.object({
    clave: z.string(),
    creditDate: z.string(),     // YYYY-MM-DD
    creditTime: z.string(),     // HH:MM:SS
    amountCents: z.number().int(),
    senderBank: z.string(),
    senderTail: z.string(),     // last four digits
    fate: z.enum(["chosen", "dropped", "kept"]),
    why: z.enum(["used", "tail", "window", "too_close", "amount", "account", "unreadable"]).nullable(),
  })),
}).nullable(),
```

- `requireArea("payments", "read")`, tenant-scoped, as today. `match` comes
  from `match_trail` joined to `cep_records` of the same business; `null`
  for a row that never matched.
- The dialog opens for money statuses as today **and** for an undecided
  row. For a confirmed row it adds, beside the CEP: "Varias coincidencias ·
  resuelta por cuenta y hora" (`by`), the credit time and the distance
  ("abonada 22 s después de la hora del comprobante"). It lists the
  candidates: time, amount, bank, "cuenta …8301", clave, and what happened
  ("Elegida", "Ya usada", "Otra cuenta", "Fuera de la ventana de hora",
  "Muy cerca de otra").

## `GET /payments/unmatched-transfers` — new (US4)

```ts
unmatchedTransfersQuery = z.object({ from: z.string().date().optional() });
unmatchedTransfersResponse = z.object({
  transfers: z.array(z.object({
    clave: z.string(),
    creditDate: z.string(),
    creditTime: z.string(),
    amountCents: z.number().int(),
    senderBank: z.string(),
    senderTail: z.string(),
  })),
});
```

- `requireArea("payments", "read")`; the business's `cep_records` that no
  live payment holds (data-model.md, *unmatched*), newest credit first, the
  last 30 days unless `from`, at most 200.
- The feed gains a chip "Sin pago" that shows this list instead of the
  charges: "Transferencias recibidas que ningún pago ha usado." Amounts
  with tabular numerals and `Intl.NumberFormat("es-MX")` (constitution
  II); 40px compact rows (VI).

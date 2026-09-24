# Contract: the business's receiving identifiers in Cuenta

**Feature**: receipt-triage · **Schema**: `apps/api/src/routes/settings/schema.ts`
(`@devolada/api/settings-schema`) · **Screen**:
`apps/admin/src/features/settings/SettingsScreen.tsx`

## `GET /settings` — `settingsResponse.spei`

Added:

```ts
card: z.string().nullable(),       // 16 digits, or masked "••••1234"
cardBank: z.string().nullable(),
phone: z.string().nullable(),      // 10 digits, or masked "••••5678"
phoneBank: z.string().nullable(),
```

A role that cannot update settings reads `card` and `phone` masked to the
last four, exactly as it reads the CLABE today. `configured` and
`bankUnknown` keep their meaning: they speak of the CLABE (D26).

## `PATCH /settings` — `settingsPatchRequest`

Added, each nullable (explicit `null` clears), all within the existing
`.partial()`:

```ts
speiCard: z.string().trim().regex(/^\d{16}$/).refine(luhn).nullable(),
speiCardBank: z.string().trim().pipe(z.enum(BANKS)).nullable(),
speiPhone: z.string().trim().regex(/^\d{10}$/).nullable(),
speiPhoneBank: z.string().trim().pipe(z.enum(BANKS)).nullable(),
```

Rules, checked in the handler against the merged row (a patch may send one
half and rely on the stored other half):

- A number and its bank are set together or cleared together; otherwise
  `VALIDATION_ERROR`.
- Any of the four fields in a patch requires the `clabe` area
  (`roleCan(role, "clabe", "update")`, owner only) — the same gate the CLABE
  has; otherwise `FORBIDDEN_FOR_ROLE` (403) and nothing is written.

## Screen

In Cuenta, below the CLABE and inside the same owner-only block:

- "Tarjeta de débito (opcional)" — 16 digits and a bank picker. Help text:
  "Debe ser una tarjeta de débito que reciba transferencias."
- "Celular para transferencias (opcional)" — 10 digits and a bank picker.
  Help text: "El número que tu banco tiene registrado para recibir
  transferencias."
- Errors, inline, es-MX: "La tarjeta debe tener 16 dígitos." · "Revisa el
  número de la tarjeta: no es válido." · "El celular debe tener 10 dígitos." ·
  "Elige el banco."
- Controls at the compact 40px size of the admin; tokens only; the bank
  picker is the searchable `Combobox` over `BANK_OPTIONS` that the CLABE's
  bank already uses (007-searchable-picker).

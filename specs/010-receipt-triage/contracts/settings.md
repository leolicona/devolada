# Contract: the business's receiving accounts in Cuenta

**Feature**: receipt-triage · **Schema**: `apps/api/src/routes/settings/schema.ts`
(`@devolada/api/settings-schema`) · **Screen**:
`apps/admin/src/features/settings/SettingsScreen.tsx`

Re-planned 2026-09-24 for the rescoped Story 3 (spec D9, FR-016): an ISP
registers up to a CLABE, a debit card and a phone, and chooses one as its
*cuenta de cobro*. No kind is required; the channel is available once the
cuenta de cobro is registered.

## `GET /settings` — `settingsResponse.spei`

Added:

```ts
card: z.string().nullable(),       // 16 digits, or masked "••••1234"
cardBank: z.string().nullable(),
phone: z.string().nullable(),      // 10 digits, or masked "••••5678"
phoneBank: z.string().nullable(),
/* receipt-triage D29: which registered account the payers see */
collectKind: z.enum(["clabe", "card", "phone"]).nullable(),
```

A role that cannot update settings reads `card` and `phone` masked to the
last four, exactly as it reads the CLABE today. **`configured` changes
meaning** (D32): true when the cuenta de cobro is registered with a bank the
provider knows — a CLABE is no longer needed. `bankUnknown` speaks of the
cuenta de cobro's bank. A business born before this feature reads
`collectKind: "clabe"` (a NULL column means the CLABE, D29), so its
`configured` is exactly today's.

## `PATCH /settings` — `settingsPatchRequest`

Added, each nullable (explicit `null` clears), all within the existing
`.partial()`:

```ts
speiCard: z.string().trim().regex(/^\d{16}$/).refine(luhn).nullable(),
speiCardBank: z.string().trim().pipe(z.enum(BANKS)).nullable(),
speiPhone: z.string().trim().regex(/^\d{10}$/).nullable(),
speiPhoneBank: z.string().trim().pipe(z.enum(BANKS)).nullable(),
speiCollectKind: z.enum(["clabe", "card", "phone"]),
```

Rules, checked in the handler against the merged row (a patch may send one
half and rely on the stored other half):

- A number and its bank are set together or cleared together; otherwise
  `VALIDATION_ERROR`.
- The cuenta de cobro must be a registered account: choosing a kind that is
  not set, or clearing the account that is the cuenta de cobro, is a
  `VALIDATION_ERROR` naming the problem. The CLABE may now be cleared when it
  is not the cuenta de cobro.
- **Retiring an account** (D30): when a patch changes or clears a CLABE, card
  or phone that was set, the old `{ kind, value, bank }` is appended to
  `spei_retired_accounts` with `removedAt`, in the same write. A number set
  again is taken off that list.
- Any of these fields requires the `clabe` area (`roleCan(role, "clabe",
  "update")`, owner only) — the gate the CLABE has; otherwise
  `FORBIDDEN_FOR_ROLE` (403) and nothing is written.

## Screen

In Cuenta, the section "Pago directo" becomes "Cuentas para recibir pagos":

- Three rows, each optional: "CLABE" (18 digits), "Tarjeta de débito" (16,
  help: "Debe ser una tarjeta de débito que reciba transferencias.") and
  "Celular para transferencias" (10, help: "El número que tu banco tiene
  registrado para recibir transferencias."), each with the searchable bank
  `Combobox` over `BANK_OPTIONS` (007-searchable-picker).
- Below them, a radio group "¿Dónde quieres que te paguen tus clientes?" —
  one option per registered account, with its kind and last four digits
  ("CLABE ••••8195"). Help: "Tus clientes solo verán esta cuenta. Si alguien
  te paga en otra de las que registraste, también la verificamos." Nothing
  is selectable until an account is registered.
- With a lock icon: "Solo la persona dueña del negocio puede cambiarlas."
- Errors, inline, es-MX: "La tarjeta debe tener 16 dígitos." · "Revisa el
  número de la tarjeta: no es válido." · "El celular debe tener 10 dígitos." ·
  "Elige el banco." · "Elige la cuenta donde te pagarán." · "No puedes
  borrar la cuenta donde te pagan: elige otra primero."
- The section keeps its one save button, "Guardar pago directo". Controls at
  the compact 40px size of the admin; tokens only.

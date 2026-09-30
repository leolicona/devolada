# Contract: the payer's page — reference, confirmation, ladder

**Feature**: payment-without-receipt · **Decisions**: D2, D7, D8, D11,
D14–D17, D21, D22, D24–D26 · **Route**: `apps/api/src/routes/direct-payments/{handler,schema}.ts`
· **Page**: `apps/pago/src/features/pago/PaymentPage.tsx`

> **Amended 2026-09-30 by spec 017** ([`confirmation-hierarchy` page
> contract](../../017-confirmation-hierarchy/contracts/payment-page.md)).
> Superseded here, and built as 017 says: `senderTail` and `claveTail` (both
> answers to the tie-break, both requiring `supersedes`); the refusal
> `SENDER_TAIL_NEEDED` (never built); `ask` (now `check_data`, `clave`,
> `tie_break`, with `tieBreak`); step 2's item 6 (the small exits); the
> "No puse la referencia" paragraph; the asks `sender_tail` and
> `clave_tail`; and every placement of "Sube tu comprobante", which becomes
> the quiet `ReceiptLink`, last. D25's line reads with 017 D8.

Everything here is additive and exported from
`@devolada/api/direct-payments-schema` (constitution III). With
`pay_by_reference` off, every new field is absent or null and the page is
today's page.

## `linkStatusResponse` — three fields

```ts
/* payment-without-receipt D1/D22: the payer's own number — never the
   concepto, which keeps the name `reference`. Null while the feature is
   off or before the phone could be counted (D5): the page is then
   today's page. */
payerReference: z
  .object({
    digits: z.string().regex(/^[1-9]\d{6}$/),
    /* FR-004: said to be the phone's last seven digits only when it is */
    fromPhone: z.boolean(),
    /* FR-010: some confirmation of this person already found it */
    proven: z.boolean(),
    /* D26/FR-040: this person's previous digits, while their reference
       changed and they have not yet confirmed with the new one; the page
       shows the notice and asks which reference they put */
    previousDigits: z.string().regex(/^[1-9]\d{6}$/).nullable(),
  })
  .nullable()
  .optional(),
/* D12: this person's banks, most recent first — banks only, never an
   account (FR-019) */
learnedBanks: z.array(bank).max(3).optional(),
/* D7: what "Otro banco" lists first — this business's most used banks */
bankOrder: z.array(bank).max(5).optional(),
```

## `payRequest.transfer` — four fields

```ts
/* D8: "own" — the server writes the link's reference and ignores any sent;
   "typed" — "No puse la referencia" (D11); absent — today's typed door */
referenceSource: z.enum(["own", "typed"]).optional(),
/* D11: the last four digits of the sending account, typed; never offered */
senderTail: z.string().regex(/^\d{4}$/).optional(),
/* D17: the clave's last four characters, only on a row that supersedes an
   undecided one; chooses among kept candidates, never searched */
claveTail: z.string().regex(/^[A-Za-z0-9]{4}$/).optional(),
/* D23: what the page preselected, for SC-005 */
preselected: z.object({ bank: bank.nullable(), day: isoDate }).optional(),
```

The refinement that demands a key (`schema.ts:144`) accepts
`referenceSource: "own"` without one. `claveTail` requires `supersedes`.

### New refusals of `POST /links/:token/pay`

| HTTP | `error.code` | When | Page |
| --- | --- | --- | --- |
| 409 | `REFERENCE_NOT_READY` | `own` asked, and the link has no reference (feature off, or not born yet) | today's receipt step |
| 409 | `TRANSFER_DATE_OUT_OF_RANGE` | `own`/`typed` day before today − 30 or after today (business timezone) | the day row, with the copy below |
| 409 | `REFERENCE_OF_ANOTHER` | `typed` reference is another person's reference in this business (FR-034); the payer's own previous reference during a transition (FR-041) and digits no person holds go on | the clave and the receipt |
| 409 | `SENDER_TAIL_NEEDED` | `typed`, no `senderTail`, no account learned for this service at that bank (FR-032) | the four-digit field |
| 409 | `CORRECTIONS_EXHAUSTED` | a fourth search-spending correction without a clave or a receipt (FR-024) | the clave and the receipt |

`REFERENCE_SHARED` is never answered to `own` or `typed` (D9).
`TOO_MANY_ATTEMPTS` (429) never refuses a row that carries a clave, a
clave tail or a receipt (D25); confirmations and corrections still count.

## `directPaymentStatusResponse` — four fields

```ts
/* D15: what the page asks now; null when it asks nothing */
ask: z.enum(["check_data", "clave", "sender_tail", "clave_tail"]).nullable().optional(),
/* D23: which path this row is */
referenceSource: z.enum(["own", "typed"]).nullable().optional(),
/* D11: as the payer typed them — their own input, read back (FR-023) */
senderTail: z.string().nullable().optional(),
/* D14: every day the rounds searched, for the read-back */
searchedDays: z.array(isoDate).optional(),
/* D24: on TRANSFER_ALREADY_USED, the payment that used the transfer —
   only when it is one of the same person's; null otherwise (FR-013) */
usedBy: z.object({ day: isoDate, amountCents: z.number().int() }).nullable().optional(),
```

`publicPaymentError` gains no word: the asks are fields, and the existing
codes keep their copy. A row with a `referenceSource` never opens the form
by `validationAttempts` (D15).

## The page

**Step 1 — "Haz tu transferencia"** (with `payerReference`): the
existing `CopyField`s for amount and account, then **Tu referencia** —
`234 5678`, copyable (the digits without the space), "Son los últimos 7
números de tu celular" when `fromPhone`. Below it, the where-to-type line
(D21) and the save-as-contact tip. The concepto stays as today.

**Step 2 — "Confirma tu pago"** replaces "Envía tu comprobante" as the
first thing step 2 shows:

0. With `previousDigits` (FR-040): the notice "Tu referencia cambió: ahora
   es 402 9185. Actualiza el contacto en tu banco." and, before anything
   else, "¿Qué referencia pusiste en tu transferencia?" — *402 9185* (the
   new one, continues as below) or *781 5678* (the previous one: sends
   `referenceSource: "typed"` with those digits, which the server accepts
   as the payer's own previous reference and guards by FR-041).

1. When `proven` is false: "¿Pusiste la referencia 234 5678 en tu
   transferencia?" — *Sí* continues; *No* opens "No puse la referencia"
   and spends nothing (FR-010).
2. **¿Desde qué banco pagaste?** — `ChoiceGroup` of `learnedBanks`, the
   first preselected, then "Otro banco" (native select, `bankOrder` first).
3. **¿Qué día?** — "Hoy, martes 29" preselected · "Ayer, lunes 28" ·
   "Otro día" (date field, today − 30 … today).
4. Read-back: "Buscaremos $350.00 con la referencia 234 5678, desde Banco
   Azteca, hoy martes 29."
5. **Confirmar pago** — decisive, 64px. Sends `transfer: { referenceSource:
   "own", senderBank, date, amountCents?, preselected }`.
6. Small exits: "Pagué otra cantidad" (an amount field; the read-back
   follows it), "No puse la referencia", "Sube tu comprobante".

**"No puse la referencia"**: the existing `TransferForm` in `keys =
"either"`, labelled for this case, plus the four-digit field when the
server answers `SENDER_TAIL_NEEDED`; "Sube tu comprobante" second.

**Validating** (a row with `referenceSource`): the read-back of what is
searched — amount, reference, bank, day (or `searchedDays`), and the tail
or clave given — under "Ver los datos que enviaste", with **Corregir**
always there (FR-023). Then, by `ask`:

| `ask` | Copy (es-MX) | Form |
| --- | --- | --- |
| null | "Seguimos buscando tu transferencia en Banxico." | none |
| `check_data` | "Todavía no encontramos tu transferencia. Revisa que estos datos sean los de tu app, y que hayas puesto la referencia 234 5678." | *Todo está bien* (remembered on the device, no call) · *Corregir* |
| `clave` | "Para encontrarla con seguridad, escribe tu clave de rastreo. Puedes copiarla del detalle de la transferencia en tu app." | clave field, `focusClave` · "Sube tu comprobante" |
| `sender_tail` | "Esa referencia la usan otras personas. Escribe los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste." — on an own row during a transition (D26): "Para confirmar que esta transferencia es tuya, escribe los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste." | four digits (asked before `clave_tail`, D15) |
| `clave_tail` | "Encontramos más de una transferencia con esos datos. Escribe los últimos 4 caracteres de tu clave de rastreo." | four characters · "Sube tu comprobante" |

With a provisional release standing, every ask adds: "Tu servicio sigue
activo. Tu clave o tu comprobante confirman el pago antes de que venza."
(D18). The copy says what was searched and what could differ; it never
suggests the payer lied (FR-037).

**Used before** (`TRANSFER_ALREADY_USED`): with `usedBy`, "Ya se usó para
tu pago del 12 de septiembre por $350.00."; without it, today's sentence.

**Expired** (a row with `referenceSource`): the clave field and "Sube tu
comprobante" stay on the page (FR-030); there is no "Reintentar ahora",
which needs a clave.

**Refusals**: `TRANSFER_DATE_OUT_OF_RANGE` — "Elige un día de los últimos
30 días."; `REFERENCE_OF_ANOTHER` — "Esa referencia es de otra persona.
Escribe tu clave de rastreo o sube tu comprobante."; `CORRECTIONS_EXHAUSTED`
— "Ya corregiste tus datos varias veces. Escribe tu clave de rastreo o sube
tu comprobante."

**Constitution VI**: `ChoiceGroup` items 48px with visible focus, the
chosen one marked by icon and text; decisive action 64px; tokens only;
waiting breathes, the outcome cross-fades; no horizontal scroll at 360.

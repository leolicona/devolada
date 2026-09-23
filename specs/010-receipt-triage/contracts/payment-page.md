# Contract: the public payment page

**Feature**: receipt-triage · **Schema**:
`apps/api/src/routes/direct-payments/schema.ts` (exported as
`@devolada/api/direct-payments-schema`) · **Page**:
`apps/pago/src/features/pago/PaymentPage.tsx` and two new files beside it,
`CaptureGuide.tsx` and `bank-hints.ts`

The zod schema is the contract (constitution III): the page derives its types
from it and its MSW handlers validate fixtures against it. Every change below
is additive — an optional field, or an optional property on an object — so an
older page keeps working against a newer API and vice versa. Routers do not
change; the logic is in the handlers.

## `GET /direct-payments/links/:token` — `linkStatusResponse`

Added, all optional, present only when the business registered them (D1):

```ts
speiCard: z.string().optional(),       // 16 digits, shown whole: the payer copies it
speiCardBank: z.string().optional(),
speiPhone: z.string().optional(),      // 10 digits, shown whole
speiPhoneBank: z.string().optional(),
```

Both the panel-link and the API-link branches of `getLinkStatus` set them.
An ISP with only a CLABE produces exactly today's payload (SC-009).

**Page**: the transfer step lists the CLABE as today, then — labelled and
copyable, with the existing `CopyField` — "Tarjeta de débito" and "Celular",
each with its bank. Nothing is shown for an identifier that is not set.

## `POST /direct-payments/links/:token/read` — `proofReadingResponse`

Added:

```ts
/* receipt-triage D6: the engine's stop, reported. The page renders it;
   the engine also enforces it on the receipt door, so skipping the page
   buys nothing. Null when the capture may go on to the paid call. */
stop: z
  .object({
    reason: z.enum(["key_missing", "not_spei", "wrong_destination"]),
    fields: z.array(z.enum(["trackingKey", "amount", "date", "senderBank"])),
  })
  .nullable(),
```

The route passes the business's receiving identifiers to `extract` so the
destination can be judged. The endpoint still "cannot reject anybody"
(two-eyes D2): it reports, and the page acts.

## `POST /direct-payments/links/:token/pay` — `payRequest`

`transfer` gains:

```ts
/* receipt-triage D2/R4: which of the business's own identifiers the
   payer sent to — a name, never a number (direct-payment D1: the
   beneficiary is server-side). Required when the link offers more than
   one identifier, ignored when it offers one. */
receivingAccount: z.enum(["clabe", "card", "phone"]).optional(),
```

The handler answers `VALIDATION_ERROR` (400) when the link offers more than
one identifier and a `transfer` names none, or names one the business does not
have. `payResponse` and `publicPaymentError` do not change: the three new
engine codes are internal, like every provider code — a page never pays a
reading its `stop` refused.

## Page behaviour

### The capture guide (Story 2, D3, D18)

Above the upload control on "Envía tu comprobante", in this order:

1. "Tu captura debe mostrar:" and a small drawing of a receipt with four
   numbered markers, each named in text beside the drawing: **1** Clave de
   rastreo · **2** Monto · **3** Fecha · **4** Cuenta a la que transferiste.
2. Three rules: "Captura el detalle de la transferencia, no el resumen." ·
   "Que se vea toda la pantalla, sin recortar." · "Si tomas una foto, que no
   tenga reflejos."
3. A `Collapsible`: "¿Dónde está la clave de rastreo en mi banco?" — one line
   per entry in `bank-hints.ts`.

Nothing is placed before the upload control that needs a tap (FR-011).

### The ask (Story 1, D4, D17)

Rendered from `reading.stop` instead of the payment call, in the existing
`Alert` (icon + text), above the upload control, which stays open:

| `stop.reason` | Message (es-MX) | Ways forward |
| --- | --- | --- |
| `key_missing` | "Tu captura no muestra la clave de rastreo." + one sentence naming any other field in `fields` ("Tampoco vemos el monto ni la fecha.") + the hint: the bank's entry ("En Banorte, toca «Ver más detalles» y captura esa pantalla.") or the generic one ("Abre el detalle de la transferencia en tu app y captura la pantalla donde aparece la clave de rastreo.") | "Subir otra captura" (the picker, first) · "Escribir los datos" (the manual form, pre-filled with every field the reading passed, asking only for `fields`) |
| `wrong_destination` | "Esta transferencia fue a otra cuenta, no a una de {ispName}. Revisa tu comprobante." | "Subir otra captura" · "Escribir los datos" (for a misread: the typed door is never second-guessed) |
| `not_spei` | "Este movimiento de Spin no pasó por SPEI, así que Banxico no lo registra y no podemos confirmarlo. Contacta a tu proveedor de internet con tu comprobante." | "Subir otra captura" |

**Lead with typing** (FR-005): when a second `key_missing` arrives in the
same visit, the form comes first — "Tu captura tampoco muestra la clave de
rastreo. Escribe los datos de tu transferencia." — and the upload is the
second option. The count lives in the page (D17).

### Later asks (two-eyes D8, D20)

The existing per-field sentences stay; when `status.senderBank` has an entry
in `bank-hints.ts` and `trackingKey` is among the disputed fields, one line
follows: "En {banco}: {dónde}".

### The manual door (Story 3, R4)

When the link offers more than one identifier, the form adds "¿A cuál cuenta
transferiste?" — one option per identifier, masked to its last four digits
with its kind and bank ("CLABE ••••8195 · BBVA MEXICO"), none pre-selected —
and sends `receivingAccount`. With one identifier nothing is added.

When the bank picked is `SPIN BY OXXO`, one line under the picker: "Si tu
CLABE de Spin empieza con 646, elige STP." (D14).

## `bank-hints.ts`

```ts
type BankHint = { where: string; source: string; verified: string /* YYYY-MM-DD */ };
export const BANK_HINTS: Partial<Record<Bank, BankHint>>;
```

Keyed by the `Bank` type re-exported from the schema, so an entry for a name
outside the vocabulary does not compile (constitution III). Launch entry:
`BANORTE` — where: "toca «Ver más detalles» y captura esa pantalla"; source:
"receipt 1, receipt-triage spec"; verified: 2026-09-23 (D16).

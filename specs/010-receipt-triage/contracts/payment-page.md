# Contract: the public payment page

**Feature**: receipt-triage · **Schema**:
`apps/api/src/routes/direct-payments/schema.ts` (exported as
`@devolada/api/direct-payments-schema`) · **Page**:
`apps/pago/src/features/pago/PaymentPage.tsx`, and two new files beside it,
`CaptureGuide.tsx` and `bank-hints.ts`

The zod schema is the contract (constitution III): the page derives its types
from it, and its MSW handlers validate fixtures against it. Every change below
is additive — an optional field, an optional property, or a new enum value —
and the routers do not change.

## `POST /direct-payments/links/:token/read` — `proofReadingResponse`

Added:

```ts
/* receipt-triage D10: only a reference that passed the gate — 1 to 7
   digits, as printed */
referenceNumber: z.string().nullable(),
gate: z.object({
  trackingKey: z.enum(["ok", "malformed", "missing"]),
  referenceNumber: z.enum(["ok", "malformed", "missing"]), // + new
  senderBank: z.enum(["ok", "unknown", "missing"]),
  amount: z.enum(["ok", "malformed", "missing"]),
}),
/* receipt-triage D13: the engine's ask, reported. The page renders it;
   the engine also enforces it on the receipt door, so skipping the page
   buys nothing. Null when the capture may go on to the paid call. */
ask: z
  .object({ fields: z.array(z.enum(["key", "amount", "date", "senderBank"])).min(1) })
  .nullable(),
```

The endpoint still "cannot reject anybody" (two-eyes D2): it reports, and the
page acts.

## `POST /direct-payments/links/:token/pay` — `payRequest`

`transfer` changes from "a clave is required" to "a key is required":

```ts
transfer: z
  .object({
    trackingKey: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/).optional(),
    /* receipt-triage D1/D10: the SPEI referencia numérica — 1 to 7 digits,
       as printed; required when there is no clave */
    referenceNumber: z.string().trim().regex(/^\d{1,7}$/).optional(),
    senderBank: …,  // unchanged
    date: …,        // unchanged
    amountCents: …, // unchanged
  })
  .refine((t) => t.trackingKey || t.referenceNumber, {
    message: "trackingKey or referenceNumber is required",
  })
  .optional(),
```

An older page that always sends a clave keeps working unchanged.

## `GET /direct-payments/:id/status` — `directPaymentStatusResponse`

Added: `referenceNumber: z.string().nullable().optional()`;
`disputedFields` gains `"referenceNumber"`.

## `publicPaymentError`

Gains `"REFERENCE_AMBIGUOUS"` (D15): the payment is still `validating`, and
the page asks for the clave alone.

## Page behaviour

### The capture guide (Story 3, D8, D18)

Above the upload control on "Envía tu comprobante", in this order:

1. "Tu captura debe mostrar:" and a small drawing of a receipt with four
   numbered markers, each named in text beside it: **1** Clave de rastreo o
   número de referencia · **2** Monto · **3** Fecha · **4** Cuenta a la que
   transferiste.
2. Three rules: "Captura el detalle de la transferencia, no el resumen." ·
   "Que se vea toda la pantalla, sin recortar." · "Si tomas una foto, que no
   tenga reflejos."
3. A `Collapsible`: "¿Dónde encuentro estos datos en mi banco?" — one line per
   entry in `bank-hints.ts`.

Nothing that needs a tap is placed before the upload control (FR-020).

### The ask at the upload (Story 2, D5)

Rendered from `reading.ask`, in the existing warning `Alert` (icon + text) at
the top of the step — the place today's two refusals use — which receives
focus when it appears. Three sentences:

| Part | Rule | Example |
| --- | --- | --- |
| The key | Always, first | "Tu captura no muestra la clave de rastreo ni el número de referencia." |
| The rest | Only the fields in `ask.fields` besides `key`, in form order; omitted when there are none | "Tampoco vemos la fecha." · "Tampoco vemos el monto ni la fecha." |
| Where | The entry in `bank-hints.ts` for `reading.senderBank` when there is one; the general sentence otherwise | "En Banorte, toca «Ver más detalles» y captura esa pantalla." · "Abre el detalle de la transferencia en tu app y captura la pantalla donde aparecen estos datos." |

Below it, two buttons at the touch size: **"Subir otra captura"** (moves
focus to the picker) and **"Escribir los datos"** (opens the form). The
upload control stays open.

**The form** (`TransferForm`) opened from the ask:

- is pre-filled with every field the reading passed (amount, date, bank);
- shows the key as two fields, "Clave de rastreo" and "Número de referencia",
  with the line "Escribe al menos uno."; the reference field takes digits
  only (`inputMode="numeric"`) and keeps leading zeros;
- under each field the capture lacked, shows "No aparece en tu captura" in
  text;
- sends `transfer` with the proof attached, as the manual door already does
  when a proof exists.

**Lead with typing** (FR-012): when a second ask arrives in the same visit,
the form renders first — "Tu captura tampoco muestra la clave de rastreo ni
el número de referencia. Escribe los datos de tu transferencia." — and the
upload becomes the second option. The count lives in the page.

### The later asks (D6, D15)

The existing per-field sentences stay. Added:

- `referenceNumber` disputed: "Confirma tu número de referencia mirando tu
  comprobante."
- `error === "REFERENCE_AMBIGUOUS"`: "Tu número de referencia coincide con más
  de una transferencia. Escribe tu clave de rastreo para encontrar la tuya." —
  the form asks for the clave only, everything else pre-filled.
- When a key is asked for and `status.senderBank` has an entry in
  `bank-hints.ts`, one more line: "En {banco}: {dónde}".

### The manual door

"No tengo el comprobante a la mano" opens the same form, with the same key
block ("Escribe al menos uno.").

## `bank-hints.ts`

```ts
type BankHint = { where: string; source: string; verified: string /* YYYY-MM-DD */ };
export const BANK_HINTS: Partial<Record<Bank, BankHint>>;
```

Keyed by the `Bank` type re-exported from the schema, so an entry for a name
outside the vocabulary does not compile. Launch entry: `BANORTE` — where:
"toca «Ver más detalles» y captura esa pantalla"; source: "receipt 1,
receipt-triage spec"; verified: "2026-09-23" (D17).

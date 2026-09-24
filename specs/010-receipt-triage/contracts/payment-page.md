# Contract: the public payment page

**Feature**: receipt-triage · **Schema**:
`apps/api/src/routes/direct-payments/schema.ts` (exported as
`@devolada/api/direct-payments-schema`) · **Page**:
`apps/pago/src/features/pago/PaymentPage.tsx`, and two new files beside it,
`CaptureGuide.tsx` and `bank-hints.ts`

**Design**: the canvas "Receipt triage screens",
https://claude.ai/artifact/HjmxGRx5YA9vZDsXoqR9HU (private to the product
creator; read it with the Artifact tool), draws every state below at 390px.
Where the canvas and this file disagree, this file wins and the canvas is
redrawn.

The zod schema is the contract (constitution III): the page derives its types
from it, and its MSW handlers validate fixtures against it. Every change below
is additive — an optional field, an optional property, or a new enum value —
and the routers do not change.

## `GET /direct-payments/links/:token` — `linkStatusResponse`

Added, all optional, present only when the ISP registered them (D9):

```ts
speiCard: z.string().optional(),      // 16 digits, shown whole: the payer copies it
speiCardBank: z.string().optional(),
speiPhone: z.string().optional(),     // 10 digits, shown whole
speiPhoneBank: z.string().optional(),
```

Both branches of `getLinkStatus` (panel links and API links) set them. An ISP
with only a CLABE produces exactly today's payload (SC-008).

## `POST /direct-payments/links/:token/read` — `proofReadingResponse`

Added:

```ts
/* receipt-triage D12: only a reference that passed the gate — 1 to 7
   digits, as printed */
referenceNumber: z.string().nullable(),
gate: z.object({ …, referenceNumber: z.enum(["ok", "malformed", "missing"]) }),
/* receipt-triage D15: the engine's ask, reported. The page renders it;
   the engine also enforces it on the receipt door, so skipping the page
   buys nothing. Null when the capture may go on to the paid call. */
ask: z
  .discriminatedUnion("reason", [
    z.object({
      reason: z.literal("no_key"),
      fields: z.array(z.enum(["key", "amount", "date", "senderBank", "account"])).min(1),
    }),
    z.object({ reason: z.literal("wrong_destination") }),
  ])
  .nullable(),
/* receipt-triage D24: which of the ISP's accounts the destination tied
   to, for the form to pre-select */
tiedAccount: z.enum(["clabe", "card", "phone"]).nullable(),
```

The route passes the ISP's accounts to the engine's `extract`. The endpoint
still "cannot reject anybody" (two-eyes D2): it reports, and the page acts.

## `POST /direct-payments/links/:token/pay` — `payRequest`

`transfer` changes from "a clave is required" to "a key is required", and
learns which account the payer sent to:

```ts
transfer: z
  .object({
    trackingKey: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/).optional(),
    /* receipt-triage D1/D12: the SPEI referencia numérica — 1 to 7 digits,
       as printed; required when there is no clave */
    referenceNumber: z.string().trim().regex(/^\d{1,7}$/).optional(),
    /* receipt-triage D10/R13: which of the ISP's own accounts — a name,
       never a number (direct-payment D1: the beneficiary is server-side).
       Required when the link offers more than one; naming an account the
       ISP does not have is refused either way. */
    receivingAccount: z.enum(["clabe", "card", "phone"]).optional(),
    senderBank: …,  // unchanged
    date: …,        // unchanged
    amountCents: …, // unchanged
  })
  .refine((t) => t.trackingKey || t.referenceNumber, {
    message: "trackingKey or referenceNumber is required",
  })
  .optional(),
```

One rule, amended 2026-09-24 (analyze A1): the handler answers
`VALIDATION_ERROR` (400) when a `transfer` names an account the ISP does not
have, or names none while the ISP has more than one. Naming the one account a
CLABE-only ISP has, or naming none, is accepted.
An older page that always sends a clave to a CLABE-only ISP keeps working
unchanged.

## `GET /direct-payments/:id/status` — `directPaymentStatusResponse`

Added: `referenceNumber: z.string().nullable().optional()`; `disputedFields`
gains `"referenceNumber"`.

## `publicPaymentError`

Gains `"REFERENCE_AMBIGUOUS"` (D17): the payment is still `validating`, and
the page asks for the clave alone. `RECEIPT_INCOMPLETE` and
`RECEIPT_WRONG_DESTINATION` stay internal: a page never pays a reading its
`ask` stopped.

## Page behaviour

### The ISP's accounts on the transfer step (Story 3)

The CLABE as today; then, labelled and copyable with the existing
`CopyField`, "Tarjeta de débito" and "Celular", each with its bank. Nothing is
shown for an account that is not set. When there is more than one account,
the list has the heading "Transfiere a cualquiera de estas cuentas".

### The capture guide (Story 4, D8, D20)

Above the upload control on "Envía tu comprobante", in this order:

1. "Tu captura debe mostrar:" and a small drawing of a receipt with four
   numbered markers, each named in text beside it: **1** Clave de rastreo o
   número de referencia (Referencia numérica) · **2** Monto · **3** Fecha ·
   **4** Cuenta a la que transferiste. "(Referencia numérica)" is the label
   most banks print (amended 2026-09-24, analyze T2).
2. Three rules: "Captura el detalle de la transferencia, no el resumen." ·
   "Que se vea toda la pantalla, sin recortar." · "Si tomas una foto, que no
   tenga reflejos."
3. A `Collapsible`: "¿Dónde encuentro estos datos en mi banco?" — one line per
   entry in `bank-hints.ts`.

Nothing that needs a tap is placed before the upload control (FR-026).

### The ask at the upload (Story 2, D5, D18)

Rendered from `reading.ask`, in the existing warning `Alert` (icon + text) at
the top of the step — the place today's two refusals use. The warning `Alert`
already carries `role="status"` (`packages/ui/src/components/alert.tsx`), so it
is announced politely; it also receives focus when it appears (`tabIndex={-1}`,
then `focus()`), so a keyboard or screen-reader user starts from it.

**`no_key`** — three sentences:

| Part | Rule | Example |
| --- | --- | --- |
| The key | Always, first | "Tu captura no muestra la clave de rastreo ni el número de referencia." |
| The rest | Every field in `ask.fields` besides `key`, in form order, the account last as "a cuál cuenta transferiste" (amended 2026-09-24, analyze I1); omitted when there are none | "Tampoco vemos la fecha." · "Tampoco vemos el monto ni la fecha." · "Tampoco vemos la fecha ni a cuál cuenta transferiste." |
| Where | The entry in `bank-hints.ts` for `reading.senderBank` when there is one; the general sentence otherwise | "En Banorte, toca «Ver más detalles» y captura esa pantalla." · "Abre el detalle de la transferencia en tu app y captura la pantalla donde aparecen estos datos." |

**`wrong_destination`** — one sentence: "Esta transferencia fue a otra
cuenta, no a una de {ispName}. Revisa tu comprobante."

Below either, two buttons at the touch size: **"Subir otra captura"** (moves
focus to the picker) and **"Escribir los datos"** (opens the form). The upload
control stays open.

**The form** (`TransferForm`) opened from the ask:

- is pre-filled with every field the reading passed (amount, date, bank);
- shows the key as two fields, "Clave de rastreo" and "Número de referencia",
  with the line "Clave de rastreo o número de referencia. Escribe al menos
  uno."; the reference field takes digits only (`inputMode="numeric"`), keeps
  leading zeros, and says so: "Hasta 7 dígitos, con los ceros del inicio.";
- when the link offers more than one account, asks "¿A cuál cuenta
  transferiste?" — one option per account with its kind, last four digits
  and bank ("Tarjeta ••••1234 · BANORTE") — pre-selecting `reading.tiedAccount`
  when there is one, with "la que muestra tu captura" under it;
- under each field the capture lacked, shows "No aparece en tu captura" in
  text;
- sends `transfer` with the proof attached, as the manual door already does
  when a proof exists;
- ends with the text button "Mejor subo otra captura", which closes the form
  and moves focus to the picker.

**Lead with typing** (FR-012): when a second `no_key` ask arrives in the same
visit, the form renders first — "Tu captura tampoco muestra la clave de
rastreo ni el número de referencia. Escribe los datos de tu transferencia." —
and the upload becomes the second option. The count lives in the page.

### The later asks (D6, D17)

The existing per-field sentences stay. Added:

- `referenceNumber` disputed: "Confirma tu número de referencia mirando tu
  comprobante."
- `error === "REFERENCE_AMBIGUOUS"`: "Tu número de referencia coincide con más
  de una transferencia. Escribe tu clave de rastreo para encontrar la tuya." —
  the form asks for the clave only, everything else pre-filled.
- `trackingKey` and `referenceNumber` both disputed — the clave fell back to
  the reference and Banxico found nothing with it (spec FR-004, clarified
  2026-09-24): "No encontramos tu transferencia todavía. Confirma tu clave de
  rastreo o tu número de referencia mirando tu comprobante; con uno basta." —
  the form's key block with both fields, "Escribe al menos uno.", everything
  else pre-filled.
- When a key is asked for and `status.senderBank` has an entry in
  `bank-hints.ts`, one more line: "En {banco}: {dónde}".

### The manual door

"No tengo el comprobante a la mano" opens the same form, with the same key
block and, when the link offers more than one account, the account choice
with nothing pre-selected.

## `bank-hints.ts`

```ts
type BankHint = { where: string; source: string; verified: string /* YYYY-MM-DD */ };
export const BANK_HINTS: Partial<Record<Bank, BankHint>>;
```

Keyed by the `Bank` type re-exported from the schema, so an entry for a name
outside the vocabulary does not compile. Launch entry: `BANORTE` — where:
"toca «Ver más detalles» y captura esa pantalla"; source: "receipt 1,
receipt-triage spec"; verified: "2026-09-23" (D19).

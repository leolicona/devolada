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

Added (re-planned 2026-09-24, D29): the one account the payer sends money
to — the cuenta de cobro — whatever its kind:

```ts
/* receipt-triage D29: exactly one account, never a list — the payer makes
   no choice about where to send the money (spec D9, FR-017) */
collectAccount: z.object({
  kind: z.enum(["clabe", "card", "phone"]),
  value: z.string(),   // 18, 16 or 10 digits, shown whole: the payer copies it
  bank: z.string(),
}),
```

`speiClabe` and `speiBank` stay in the payload for an older page, filled only
when the cuenta de cobro is the CLABE. Both branches of `getLinkStatus` set
it. An ISP whose cuenta de cobro is its CLABE (every ISP before this feature)
renders exactly today's transfer step (SC-008). The ISP's other registered
accounts never leave the server.

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
      fields: z.array(z.enum(["key", "amount", "date", "senderBank"])).min(1),
      /* D7 (clarified 2026-09-24): the reference is one another payment of
         the ISP already holds that day */
      shared: z.boolean().optional(),
    }),
    z.object({ reason: z.literal("wrong_destination") }),
  ])
  .nullable(),
```

`proofReadingResponse` also gains `destinationSeen: z.boolean()` — at least
three digits of the destination were read — for the checklist's "Cuenta"
item (Story 4, D8); the digits themselves never reach the page.

`ask.fields` never holds `"account"` (re-planned 2026-09-24): the form never
asks which account (FR-005, FR-018). `tiedAccount` is not sent to the page.
The route passes the ISP's registered accounts, current and retired, to the
engine's `extract` so it can judge the destination (D24, D30). The endpoint
still "cannot reject anybody" (two-eyes D2): it reports, and the page acts.

## `POST /direct-payments/links/:token/pay` — `payRequest`

`transfer` changes from "a clave is required" to "a key is required". It
never names an account: typed data is checked against the cuenta de cobro
(FR-018; re-planned 2026-09-24, the `receivingAccount` field is dropped):

```ts
transfer: z
  .object({
    trackingKey: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/).optional(),
    /* receipt-triage D1/D12: the SPEI referencia numérica — 1 to 7 digits,
       as printed; required when there is no clave */
    referenceNumber: z.string().trim().regex(/^\d{1,7}$/).optional(),
    senderBank: …,  // unchanged
    date: …,        // unchanged
    amountCents: …, // unchanged
  })
  .refine((t) => t.trackingKey || t.referenceNumber, {
    message: "trackingKey or referenceNumber is required",
  })
  /* receipt-triage D2 (clarified 2026-09-24): a generic reference is no
     key — the clave is required beside it. `isGenericReference` lives in
     this schema so the page and the handler share one rule. */
  .refine((t) => t.trackingKey || !isGenericReference(t.referenceNumber), {
    message: "a generic referenceNumber needs a trackingKey",
  })
  .optional(),
```

The handler snapshots the cuenta de cobro and the ISP's registered accounts
onto the row at submission (D30).
An older page that always sends a clave to a CLABE-only ISP keeps working
unchanged.

## `GET /direct-payments/:id/status` — `directPaymentStatusResponse`

Added: `referenceNumber: z.string().nullable().optional()`; `disputedFields`
gains `"referenceNumber"`; `inReview: z.boolean().optional()` — true while
the ISP decides on the payment (FR-006, FR-020a; D31), and the page then
shows, in the existing info `Alert`: "Tu pago está en revisión con
{ispName}. Te avisaremos aquí cuando lo confirme." — no success state, no
reconnection copy.

## `publicPaymentError`

Gains `"REFERENCE_AMBIGUOUS"` (D17): the payment is still `validating`, and
the page asks for the clave alone. Gains `"REFERENCE_SHARED"` (D7, clarified
2026-09-24): the pay route refused typed data whose reference another
payment of the ISP already holds with the same date, sending bank, amount
and account, and no clave beside it — nothing was created or billed; the
page shows the generic-reference note under the field ("Esta referencia la
usan muchas transferencias. Escribe tu clave de rastreo para encontrar la
tuya.") and requires the clave. On the upload, `/read` reports the same
finding as `ask: { reason: "no_key", fields: ["key", …], shared: true }` and
the first sentence becomes "El número de referencia de tu captura ({ref}) ya
lo usó otra transferencia de ese día y no muestra la clave de rastreo." `RECEIPT_INCOMPLETE` and
`RECEIPT_WRONG_DESTINATION` stay internal: a page never pays a reading its
`ask` stopped.

## Page behaviour

### The account on the transfer step (Story 3, D29)

One account, the cuenta de cobro, in the existing `CopyField`, labelled by
its kind — "CLABE", "Tarjeta de débito" or "Celular" — with its bank. No
list, no heading, no choice. A CLABE renders exactly as today.

### The capture guide (Story 4, D8, D20 — compact, re-planned 2026-09-24)

**On the transfer step**, one line under the account, in the muted body
style with a small camera icon: "Al terminar, captura el detalle de tu
transferencia." Nothing else.

**On "Envía tu comprobante"**, above the upload control:

1. "Tu captura debe mostrar:" and four items on one or two lines at 360px,
   each a small neutral icon + its word: **Clave o referencia** · **Monto** ·
   **Fecha** · **Cuenta**. A text button "Ver ejemplo" at the end.
2. "Ver ejemplo" opens in place (the existing `Collapsible`, closed by
   default): the small drawing with the four items marked by number and
   named in text, the three rules ("Captura el detalle de la transferencia,
   no el resumen." · "Que se vea toda la pantalla, sin recortar." · "Si
   tomas una foto, que no tenga reflejos.") and "¿Dónde los encuentro en mi
   banco?" with the entries of `bank-hints.ts`.
3. **After a reading**, the same four items take their state from the
   reading — each icon becomes a check ("se ve") or an open circle ("no se
   ve"), with that word beside it for assistive technology and in text,
   never colour alone. The swap is the vocabulary's outcome cross-fade
   (`--duration-*` tokens); reduced motion keeps only the opacity change.
   The `Alert` of the ask (below) still carries the sentences; the
   checklist is the at-a-glance version of the same facts.

Nothing that needs a tap is placed before the upload control (FR-026), and
the closed guide takes no more than the checklist's lines.

### The ask at the upload (Story 2, D5, D18)

Rendered from `reading.ask`, in the existing warning `Alert` (icon + text) at
the top of the step — the place today's two refusals use. The warning `Alert`
already carries `role="status"` (`packages/ui/src/components/alert.tsx`), so it
is announced politely; it also receives focus when it appears (`tabIndex={-1}`,
then `focus()`), so a keyboard or screen-reader user starts from it.

**`no_key`** — three sentences:

| Part | Rule | Example |
| --- | --- | --- |
| The key | Always, first; the second form when the reading's `gate.referenceNumber` is `generic` | "Tu captura no muestra la clave de rastreo ni el número de referencia." · "El número de referencia de tu captura ({ref}) lo usan muchas transferencias y no muestra la clave de rastreo." |
| The rest | Every field in `ask.fields` besides `key`, in form order; omitted when there are none (the account is never asked — re-planned 2026-09-24) | "Tampoco vemos la fecha." · "Tampoco vemos el monto ni la fecha." |
| Where | The entry in `bank-hints.ts` for `reading.senderBank` when there is one; the general sentence otherwise | "En Banorte, toca «Ver más detalles» y captura esa pantalla." · "Abre el detalle de la transferencia en tu app y captura la pantalla donde aparecen estos datos." |

**`wrong_destination`** — honest and kind, never an accusation (clarified
2026-09-24): "Parece que esta transferencia se hizo a otra cuenta, no a la de {ispName}.
{ispName} recibe pagos en {kind} terminada en {last4}. Si leímos mal tu
comprobante, sube otra captura o escribe tus datos."

Below either, two buttons at the touch size: **"Subir otra captura"** (moves
focus to the picker) and **"Escribir los datos"** (opens the form). The upload
control stays open.

**The form** (`TransferForm`) opened from the ask:

- is pre-filled with every field the reading passed (amount, date, bank);
- leads with the reference (FR-005, clarified 2026-09-24): "Número de
  referencia" first — digits only (`inputMode="numeric"`), leading zeros
  kept, "Hasta 7 dígitos, con los ceros del inicio." — then, as the
  alternative, "¿No tienes número de referencia? Escribe tu clave de
  rastreo" and the "Clave de rastreo" field; "Con uno basta." The clave is
  required only by the generic and shared rules below;
- never asks for the destination account (FR-018);
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

### A generic reference on the typing form (D2, clarified 2026-09-24)

As the payer types a reference that `isGenericReference` matches, the field
shows, in text under it: "Esta referencia la usan muchas transferencias.
Escribe tu clave de rastreo para encontrar la tuya." — and the clave field
becomes required ("Escribe tu clave de rastreo."). Submitting without it is
refused on the page and, for a client that skipped the page, by the schema
(`VALIDATION_ERROR`).

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
  the form's key block with both fields, reference first, "Escribe al menos uno.", everything
  else pre-filled.
- When a key is asked for and `status.senderBank` has an entry in
  `bank-hints.ts`, one more line: "En {banco}: {dónde}".

### The manual door

"No tengo el comprobante a la mano" opens the same form, with the same key
block, reference first. It never asks for an account (FR-018).

## `bank-hints.ts`

```ts
type BankHint = { where: string; source: string; verified: string /* YYYY-MM-DD */ };
export const BANK_HINTS: Partial<Record<Bank, BankHint>>;
```

Keyed by the `Bank` type re-exported from the schema, so an entry for a name
outside the vocabulary does not compile. Launch entry: `BANORTE` — where:
"toca «Ver más detalles» y captura esa pantalla"; source: "receipt 1,
receipt-triage spec"; verified: "2026-09-23" (D19).

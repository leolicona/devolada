# Contract: Devolada's methods on the WispHub screen (US4)

Three surfaces of the WispHub integration's own routes
(`apps/api/src/routes/integrations/`), so the provider's name may appear in
the route and in the screen's copy (constitution IX). Browser-facing: one
envelope, no `message`, no `retryable` (constitution III). The schema lives
in `schema.ts` and is exported as today through `@devolada/api/integrations-schema`.

## The block (shared)

```ts
export const devoladaMethodStatus = z.enum(["found", "missing", "duplicate"]);

export const devoladaMethodLine = z.object({
  /* The exact name to create — the adapter's constant (D1), so the
     screen never carries a literal of its own */
  name: z.string(),
  /* Devolada's description to type beside it (D15); never checked */
  description: z.string(),
  status: devoladaMethodStatus,
});

export const devoladaMethods = z.discriminatedUnion("checked", [
  z.object({
    checked: z.literal(true),
    link: devoladaMethodLine,
    /* null when the business's store channel is off (FR-008) */
    network: devoladaMethodLine.nullable(),
  }),
  /* The provider could not be reached: never "missing" (FR-009) */
  z.object({ checked: z.literal(false) }),
]);
```

## `GET /integrations/wisphub/payment-methods`

- Authorization: `requireSession`, `requireArea("integrations", "manage")`,
  the same as every route of the hub (integrations-hub D1).
- No key saved → `409` `WISPHUB_NOT_CONFIGURED`, the code the rest of the
  API already answers for an unconfigured integration.
- Success: `{ success: true, data: DevoladaMethods }`.
- A refused key reads as `checked: false` here; "Probar conexión" is where
  a refused key is explained (provider-address-per-isp FR-010).
- Reads the list fresh. When the provider answered, it stamps the
  integration's `payment_methods_seen_at` (D16), so the next payment
  anywhere uses what it found. The stamp is the one write of this read:
  a cache version, so repeating the read repeats the stamp and changes
  nothing else.

## `POST /integrations/wisphub/test` (extended)

Also answered by `PATCH /integrations/wisphub` when it carries a key or an
installation (`integrationsResponse.wisphubTest`), so save-then-test shows
the same block.

`wisphubTestResponse` gains:

```ts
/* payment-method-per-channel D8: read with the payment_methods probe;
   null when the test stopped before that probe */
devoladaMethods: devoladaMethods.nullable(),
```

| The `payment_methods` probe | `devoladaMethods` |
| --- | --- |
| Answered | The block (`checked: true`) |
| Ran and failed (refused, timed out, unusable answer) | `{ checked: false }`, never "missing" (FR-009) |
| Never ran: the test stopped at an earlier probe | `null`; the screen keeps the card it already shows |

Only a test of the saved key and installation stamps
`payment_methods_seen_at` (D16); a candidate's test stamps nothing.

The `payment_methods` probe reads the whole list (contract
[wisphub-recording.md](wisphub-recording.md) §1) instead of one row, with
the candidate key and installation the test was given. The probe's own
outcome is unchanged: whether `payment_methods` is verified does not
depend on whether Devolada's methods exist.

The handler asks the adapter for the block
(`wisphub/payment-methods.ts`); it builds no provider path and parses no
provider payload (constitution IX). Only the capability entry point and
the integration's own setup routes reach the adapter: the rule recorded in
the debt `core-reads-provider-directly` ("Confirm on the tree").

## `PATCH /integrations/wisphub` turning execution on (D14)

When the patch carries `actionsEnabled: true` and the row has it false
(or there is no row yet):

| The key and installation the row will have, and the block read with them | Answer | Saved |
| --- | --- | --- |
| No key | `409` `WISPHUB_NOT_CONFIGURED`, before any provider call | Nothing |
| Every required line `found` or `duplicate` (SPEI always; the network's when the store channel is on) | `200`, as today | The whole patch, and `payment_methods_seen_at` (D16) |
| A required line `missing` | `409` `PAYMENT_METHODS_MISSING` | Nothing |
| `checked: false` | `503` `PAYMENT_METHODS_UNCHECKED` | Nothing |

Any other patch — execution off, execution left as it is, `true` on a row
already on — is answered as today, with no provider call. The request
schema does not change.

Whatever else it carries, a patch that saves a new key or a new
installation also stamps `payment_methods_seen_at`, with no provider call
for it (D16): the next payment reads the new account's methods.

## The screen (es-MX copy, indicative)

The order is the creator's: *Conexión* (the key card), then *Formas de
pago de Devolada*, then the mapping, then *Ejecución*.

A block *Formas de pago de Devolada* on the WispHub screen:

- One line per method: the exact name (JetBrains Mono, like a folio) and
  its description, and a `StatusBadge`. Each of the two is itself the
  copy control (the creator, 2026-10-02): the whole field is one
  `<button>` — its label with a copy icon beside it, then the value —
  and a tap copies the value; the icon turns into a check and
  *"Copiado"*. No separate copy buttons. Its accessible name starts
  with "Copiar el/la …"; the whole field is the touch target. Three statuses are new in
  `packages/ui` (`StatusBadge` is the only representation of a status):
  `methodFound` *Creada* (success, check), `methodMissing` *Falta crearla*
  (info: a setup step, not a failure), `methodDuplicate` *Repetida*
  (warning). Under a duplicate: *"Hay dos con este nombre; usamos la más
  antigua."* (FR-003.)
- Under a missing method, as a setup step, not an error (FR-008): while
  observing, *"Créala para poder encender la ejecución."*; with execution
  on, *"Mientras no exista, esos pagos se registran como efectivo, igual
  que hoy."*
- The instruction: *"Créalas en WispHub con estos nombres exactos y no las
  uses para cobros en mostrador."* (FR-008, FR-010.)
- `checked: false`: *"No pudimos revisar tus formas de pago en WispHub.
  Vuelve a intentar."* Never shown as missing (FR-009).
- The network's line only when `session.storeChannel.on`.
- No key saved (`wisphub.configured` false): the card makes no read and
  says *"Conecta WispHub para revisar tus formas de pago."*; a `409
  WISPHUB_NOT_CONFIGURED` from the read says the same, with no retry.
- *Ejecución*: the switch cannot be turned on, and says why, in three
  cases: no key saved → *"Primero conecta WispHub."*; a required method
  missing → *"Para encender la ejecución, primero crea tus formas de pago
  de Devolada."* with a link to the block; the block not checked → *"No
  pudimos revisar tus formas de pago en WispHub. Vuelve a intentar."* It
  can always be turned off. The refusals, when the API has the last word:
  `WISPHUB_NOT_CONFIGURED` → *"Primero conecta WispHub."*;
  `PAYMENT_METHODS_MISSING` → *"Aún falta crear una forma de pago de
  Devolada en WispHub."*; `PAYMENT_METHODS_UNCHECKED` → *"No pudimos
  revisar tus formas de pago en WispHub. Vuelve a intentar."*
- When "Probar conexión" of the saved connection, or a save, answers
  `devoladaMethods`, a block replaces the card's; `null` leaves the card
  as it is. A test of a typed key or another installation never touches
  the card: the card speaks for the connection the execution gate checks
  (`/speckit-analyze` U1, 2026-10-02).
- While the read runs, the waiting label sits inside `<Pending>`
  (pending-lint).

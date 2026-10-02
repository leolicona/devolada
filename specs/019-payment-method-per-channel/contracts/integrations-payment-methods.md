# Contract: Devolada's methods on the WispHub screen (US4)

Two surfaces of the WispHub integration's own routes
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

The `payment_methods` probe reads the whole list (contract
[wisphub-recording.md](wisphub-recording.md) §1) instead of one row, with
the candidate key and installation the test was given. The probe's own
outcome is unchanged: whether `payment_methods` is verified does not
depend on whether Devolada's methods exist.

The handler asks the adapter for the block
(`wisphub/payment-methods.ts`); it builds no provider path and parses no
provider payload, as `testWisphubKey` already does for its probes
(constitution IX).

## The screen (es-MX copy, indicative)

A block *Formas de pago de Devolada* on the WispHub screen:

- One line per method: the exact name (JetBrains Mono, like a folio), a
  copy button, and a `StatusBadge`. Three statuses are new in
  `packages/ui` (`StatusBadge` is the only representation of a status):
  `methodFound` *Creada* (success, check), `methodMissing` *Falta crearla*
  (info: a setup step, not a failure), `methodDuplicate` *Repetida*
  (warning). Under a duplicate: *"Hay dos con este nombre; usamos la más
  antigua."* (FR-003.)
- Under a missing method: *"Mientras no exista, esos pagos se registran
  como efectivo, igual que hoy."* As a setup step, not an error (FR-008).
- The instruction: *"Créalas en WispHub con estos nombres exactos y no las
  uses para cobros en mostrador."* (FR-008, FR-010.)
- `checked: false`: *"No pudimos revisar tus formas de pago en WispHub.
  Vuelve a intentar."* Never shown as missing (FR-009).
- The network's line only when `session.storeChannel.on`.
- While the read runs, the waiting label sits inside `<Pending>`
  (pending-lint).

# Contract: the panel's same-bank payments (Phase A)

Area `payments` (`routes/payments/{index,handler,schema}.ts`), exported as
`@devolada/api/payments-schema`. Envelope and codes as constitution III.
Every query filters by the actor's business (constitution V).

## `GET /payments/feed` — one more filter

`requireArea("payments", "read")`. `feedQuery` gains:

```ts
/* bank-statement-match D8: the "Por confirmar en tu banco" chip — same-bank
   payments waiting for the business (D3), including one an operator's
   decision is settling right now */
awaiting: z.enum(["bank"]).optional(),
```

`awaiting=bank` answers rows with `status = 'validating'` and
`last_error IN ('SAME_BANK', 'BANK_CHECKING')`, newest first, with the
feed's usual paging, search and dates. It combines with `q`, `from`, `to`;
`status`, `action` and `class` are ignored when it is present.

`feedCharge` gains two derived fields (defaulted, so fixtures born before
them still parse):

```ts
/* bank-statement-match D6, D8: null on every row that never waited for the
   business. `by` is the operator's display name, never an email. */
bankCheck: z
  .object({
    state: z.enum(["waiting", "received", "not_received"]),
    by: z.string().nullable(),
  })
  .nullable()
  .default(null),
```

and a **new** release field — the feed carries none today:

```ts
/* bank-statement-match D4, D8: the provisional release, as the panel shows
   it beside a waiting same-bank payment. Null when none was made. */
release: z
  .object({
    kind: z.enum(["reconnect", "protect"]),   // from releaseKind
    lapsed: z.boolean(),                      // promiseDeadline(createdAt) < today, business timezone
  })
  .nullable()
  .default(null),
```

`state` is derived: `waiting` from `last_error` `SAME_BANK` or
`BANK_CHECKING`; `received` on a confirmed, partial or unapplied row
whose sender and collection banks are equal and that `reviewed_by` decided;
`not_received` from `expired` + `NOT_RECEIVED`.

## `POST /payments/:id/bank-check`

`requireSession` + `requireArea("payments", "operate")`, beside
`/payments/:id/review`. Body:

```ts
export const bankCheckBody = z.object({ received: z.boolean() });
```

| Outcome | Answer |
| --- | --- |
| `received: true`, settled | `200 { success: true, data: feedCharge }` — the row as the feed shows it: `confirmed`, `partial` or `unapplied`, with its folio and action state |
| `received: false` | `200 { success: true, data: feedCharge }` — `expired`, `bankCheck.state = "not_received"` |
| The row is not this business's, or does not exist | `404 NOT_FOUND` (the route's existing code) |
| The row is not waiting for the business (already decided, by an operator or a statement, or never same-bank), or another decision holds it | `409 NOT_AWAITING_BANK` |
| The business's system could not be read while settling | `503 INTEGRATION_UNAVAILABLE`; the row is waiting again |

The handler records `reviewed_by = actor.userId`, `reviewed_at = now` on
both answers (D6). Its claim sets `last_error = 'BANK_CHECKING'` and a
two-minute lease on `next_validation_at`; the sweep reclaims a lease whose
decision never finished (D6).

## The feed screen (`apps/admin/src/features/feed/FeedScreen.tsx`)

- **Chip** "Por confirmar en tu banco" in `statusFilters`; `feedPath` maps
  it to `awaiting=bank`.
- **Strip**, above the feed, only when N is above zero and the chip is not
  selected: "{N} pago(s) esperan que los confirmes en tu banco" · **Verlos**
  selects the chip. Exactly the failed strip's mechanism: its own query of
  the feed with `awaiting=bank`, N = the rows of its first page, polled
  like the feed.
- **Row** with `bankCheck.state = "waiting"`:
  - `StatusBadge kind="awaitingBank"`.
  - "Desde {banco}, el mismo banco de tu cuenta de cobro. Revisa en tu
    banca si llegó." Then the customer, the amount, the reference and
    the day the payer gave.
  - When `release` is set: "Reconectado mientras lo confirmas"
    (`reconnect`) or "Protegido del corte mientras lo confirmas"
    (`protect`) — or, once `lapsed`, "La reconexión provisional ya
    venció".
  - With `payments: operate`: **Sí, llegó** and **No llegó**, each opening
    an `AlertDialog`:
    - **Sí, llegó** → "¿Confirmas que recibiste {monto} de {cliente}?
      Registraremos el pago." Confirm: "Sí, lo recibí".
    - **No llegó** → "¿Confirmas que este pago no llegó a tu cuenta? Ya no
      podrás confirmarlo." Confirm: "No llegó".
  - While a decision is in flight the buttons sit inside `<Pending>`
    (`pending-lint`).
  - A 409 refreshes the row; a 503 shows an `Alert`: "No pudimos
    registrar el pago en tu sistema. Inténtalo de nuevo."
- **Ended rows**: `received` → the usual confirmed badges plus "Confirmado
  a mano por {nombre}"; `not_received` → `StatusBadge kind="notReceived"`.

## `@devolada/ui` — `StatusBadge`

Two kinds, existing tones and lucide icons, no new token:

| Kind | Tone | Icon | Label |
| --- | --- | --- | --- |
| `awaitingBank` | warning | `Landmark` | Por confirmar |
| `notReceived` | error | `CircleSlash` | No llegó |

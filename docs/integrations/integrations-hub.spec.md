---
status: in development
stories: [US-I01, US-I02, US-I03]
domain: integrations
updated: 2026-09-01
debt: []
---

# Spec: Integrations hub — where the oracle is allowed to act

Phase 5 of the pivot (platform/pivot.spec.md, sequencing 5). The oracle
already validates, classifies and shows its proof; this spec builds the
one place where a business decides **what the oracle may do about it**:
the WispHub connection, the class→action mapping, the master switch that
turns every action off (modo observación), and the provisional-release
vote as integration config (pivot D18). It formally amends
provisional-release D10 (pivot Open item 1) and builds the action
dispatch under the Open item 5 constraints. Decided with the owner in
the phase-5 interview (2026-09-01).

What the pivot already fixed and this spec only inherits: three fixed
mapping rows and adapter-declared actions (D9); `invalid`, `not_found`,
`expired` and `unapplied` never trigger an action (D9); one integration
per business (D10); no outgoing webhooks in v1 (D17).

## Decisions

- **D1 — The page and the catalog.** Nav gains **Integraciones** (route
  `/integrations` — routes are English identifiers, IA rule), the fifth
  and last section (IA: ≤5). The page is a catalog of one real card —
  WispHub, "Conectada"/"Sin conectar", opening the detail — plus the
  D17 backlog as a dead second card ("Integración genérica — en el
  futuro"): the shape the page grows into, visible so the pilot ISP
  knows webhooks are a road, not a wall. The area is
  `integrations: manage` (owner/admin, role-matrix as is); operators
  and viewers do not see the section (the law: hide, never disable —
  their view of actions is the outcome on each Pago row). **Rejected**:
  a read-only view for operators (there is nothing for them to do here,
  and Pagos already tells them everything that happened).

- **D2 — The `integrations` table: the config moves into one house
  (owner decision).** New table, one row per connected business:
  `provider` (`wisphub`), the WispHub `api_key`, the three mapped
  actions, `threshold_percent` + `floor_cents`, `provisional_release_enabled`,
  `actions_enabled`, `status` timestamps. The migration creates a row
  for every business that has a WispHub key today — values copied,
  `actions_enabled = true` so **the pilot's behavior does not change
  with the deploy** — and retires `wisphub_api_key`,
  `reconnection_threshold_percent`, `reconnection_floor_cents` and
  `provisional_release_enabled` from `businesses`. Every read moves to
  the integration row (validation, both sweeps, cobros, link status,
  the WispHub test). No row = not connected — exactly today's "no key".
  The key is stored like the business's other tenant credentials
  (payments-and-classes D7 settled this posture: encrypting one column
  guards a leak that already exposes the rest). **Rejected**: config in
  two houses (mapping in a table, dials on the business row) — the
  first bug is a screen editing the copy nothing reads.

- **D3 — Two actions per class; "nothing" is not offered (owner
  decision).** Each mapping row selects **`register_and_reconnect`** or
  **`register_only`**. There is no "do nothing": the money already
  reached the ISP's account, and not registering it makes WispHub's
  books lie — the select's floor is honesty, not convenience. The
  `short` row hosts the threshold % and floor $ inline (pivot D9); the
  threshold only means anything under `register_and_reconnect`.
  Defaults are today's behavior verbatim: all three classes
  `register_and_reconnect` (short obeying threshold+floor,
  partial-payment D2–D5 unchanged inside the adapter). **Rejected**: a
  third "nada" option (maximum freedom, divergent books — the support
  call it produces costs more than the freedom is worth).

- **D4 — Observation is zero writes (owner decision).** The master
  switch — es-MX: **"Ejecutar acciones automáticamente"** — off means
  the adapter writes NOTHING to WispHub: no registrar-pago, no
  reconnection, no auto-activate. Reads continue untouched (debt,
  customers, Cobros); validation, classification and the credit debit
  continue untouched — the oracle keeps earning its keep, the hand
  stays the business's. A NEW integration is born observing
  (`actions_enabled = false`): the trust ramp — the second tenant hands
  Devolada write access only after watching it be right; migrated rows
  are born `true` (D2). The shell wears a chip while observing —
  "Modo observación", CreditChip pattern, every role sees it: a paused
  hand is context everyone reading Pagos needs. **Rejected**:
  register-still-writes observation (a "watching" mode that writes to
  the books would surprise exactly the distrustful ISP it exists for);
  actions-on at birth (connecting a key is consent to read, not yet to
  act).

- **D5 — The observed row records the hypothetical verdict, and
  "Ejecutar ahora" runs it (owner decision).** At a verdict under
  observation the payment row gets outcome `observation` plus what the
  mapping WOULD have executed — the action of its class and the
  threshold's answer, both computable right there: "Observación — se
  habría reconectado" / "Observación — se habría registrado sin
  reactivar (umbral)". That is the ramp's instrument: the ISP compares
  the oracle against their own hand, row by row. The row offers
  **"Ejecutar ahora"** (`payments: operate`): it dispatches exactly the
  recorded action through the real queue — outcome leaves `observation`
  for `queued`, then `done`/`failed`; the registered amount is the one
  settled at the verdict, the same number a retry registers
  (partial-payment D9). The button exists **only** on observation rows:
  a `withheld` row (threshold said no) gets no button — the threshold
  is the owner's law and the exception is made in WispHub, as today.
  Turning the master switch on **never rewrites history in either
  direction**: old `observation` rows keep their hypothesis and their
  button (each still executed one by one, with the human look that is
  the guard), and turning it off later only changes how the NEXT rows
  are born. **Rejected**: observation rows with no hypothesis (nothing
  to compare — the ramp teaches nothing); "Ejecutar ahora" on
  `withheld` (a one-click bypass of the owner's own policy; revisited
  only if the pilot asks for it, as its own decision); **"aplicar a
  todas"** — a batch execute over the observed backlog (owner
  evaluated 2026-09-01): during the ramp the backlog is not pending
  work but work the ISP already did BY HAND, so a batch replay
  double-registers nearly every payment in books with no idempotency
  (TD-009), and the hypotheses have aged against debt that moved — the
  one-row human look is exactly the guard the batch removes. The one
  scenario where it earns its keep — observation used as an emergency
  pause, with rows nobody handled — is a recovery tool built when the
  pilot produces it, with a fresh-debt re-check per row (D14's
  doctrine) as its entry price.

- **D6 — The event ledger is real from day one (owner decision,
  against the minimal option).** Table `integration_events`: one row
  per dispatch decision — business, payment, integration, the
  **reconciliation class** (Open item 5: the event carries the class,
  never just "validated"), the mapped action, status
  (`dispatched → acked | failed`), timestamps, the error. Dispatch is
  acknowledged: `acked` when the adapter's action reaches its terminal
  outcome. The observation gate sits **before** dispatch, so a gated
  verdict writes NO event — the payment row's `observation` outcome is
  the record; "Ejecutar ahora" creates the event at the moment it
  really dispatches. `invalid`/`not_found`/`expired`/`unapplied` never
  create events. The **retry schedule stays on the payment row**
  (reconnection-queue D2 survives unamended: the row is the queue; the
  event row is the ledger the queue writes through) — one queue, one
  ledger, no second source of truth. D17's webhooks arrive later as a
  second consumer reading `acked` events, amending nothing here.
  **Rejected**: no table until webhooks (the owner wants the ledger
  accumulating from the first dispatch — same doctrine as the refs:
  history not collected is history lost); moving the retry queue into
  the events table (rewrites reconnection-queue for zero behavior).

- **D7 — The action outcome goes generic now (owner decision).**
  `payments.reconnection_status` becomes **`action_outcome`**:
  `queued | done | withheld | failed | observation` (migration maps
  `reconnected → done`); `reconnected_at` → `action_done_at`,
  `reconnection_attempts` → `action_attempts`, `reconnection_error` →
  `action_error`; the wire renames with it (`actionOutcome`,
  `actionDoneAt`, `actionAttempts`, `actionError`) and the retry route
  becomes `POST /payments/:id/retry-action`; the feed's outcome filter
  travels as `action=` and the row's `attempts`/`lastError` ride along
  as `actionAttempts`/`actionError` — one vocabulary end to end, no
  stragglers. One rename, now, while
  renames are still cheap — the same logic as D20's "no second
  migration between the pilot and the trust layer". The es-MX label
  stays **action-specific**, adapter-aware: `done` under
  `register_and_reconnect` reads "Reconectado", under `register_only`
  reads "Registrado"; `withheld` keeps "Sin reactivar"; `observation`
  reads "Observación". **Rejected**: adding `observation` to the old
  enum and deferring the rename (two vocabularies for one concept, and
  a second rename later that touches strictly more code).

- **D8 — provisional-release D10, formally amended (pivot Open item
  1).** The switch "Proteger el servicio mientras Banxico confirma"
  moves from Configuración to the integration detail as its own
  **pre-verdict** switch — never a fourth mapping row (D9's mapping is
  post-verdict). Observation pauses provisional actions too: a release
  is a WispHub write, and D4 says zero writes. Revocation
  (provisional-release D5/D8) is declared an **adapter action**, so
  both halves of the cycle live in the same layer; the good-faith
  evidence (reading check, human data, trust block) stays
  adapter-agnostic oracle machinery — an adapter only declares whether
  it offers a provisional action. `provisional-release.spec.md` D10
  carries the dated amendment note in this same PR.

- **D9 — Configuración slims.** The WispHub card and the Reconexión
  card move to the integration detail; the key flow reuses settings
  D1–D3 **verbatim** (write-only, tail shown, testable before saving).
  Configuración keeps what belongs to the business itself: SPEI/CLABE
  (its own bank account — money, not integration), the reconciliation
  policy, display, Saldo y recargas, Usuarios, passkey.

- **D10 — The shell's banner names no provider (owner, 2026-09-02).**
  "Falta tu llave de WispHub. Sin ella no podemos reconectar a los
  clientes" assumed the ISP on every business; the pivot says an ISP is
  one kind of business and integrations are chosen. The actor's flag is
  `integrationConfigured` (was `wisphubConfigured`; settings D7), read as
  "has an integration with a key", whatever the provider; the banner says
  "Conecta el sistema con el que cobras. Sin una integración no hay
  Cobros que validar" and its button, "Ver integraciones", opens the
  catalog (D1) — not a provider's detail. Provider words stay where the
  provider is: the WispHub detail and the per-payment reasons
  (`WISPHUB_*`), which only ever fire for a WispHub row. **Said in the
  open**: pivot D2 still ships one source of Cobros, so a business of
  another trade can register, add its CLABE and find nothing to collect;
  the banner is right about the fact and now right about the words.
  Whether manual Cobros move up is a pivot decision, not this one.

## Schema

- `integrations`: id, `business_id` (unique, FK), `provider`
  (`wisphub`), `api_key` text, `exact_action` / `short_action` /
  `over_action` (`register_and_reconnect | register_only`),
  `threshold_percent` int (default 100), `floor_cents` int (default 0),
  `provisional_release_enabled` bool (default false),
  `actions_enabled` bool (default **false** — born observing),
  `created_at`.
- `integration_events`: id, `business_id`, `payment_id`,
  `integration_id`, `class` (`exact|short|over`), `action`, `status`
  (`dispatched|acked|failed`), `error` text null, `created_at`,
  `acked_at` null.
- `payments`: `reconnection_status` → `action_outcome`
  (`queued|done|withheld|failed|observation`; `reconnected → done`),
  `reconnected_at` → `action_done_at`, `reconnection_attempts` →
  `action_attempts`, `reconnection_error` → `action_error`; +
  `observed_action` text null (the D5 hypothesis: the action plus the
  threshold's answer, recorded at the verdict).
- `businesses`: − `wisphub_api_key`, − `reconnection_threshold_percent`,
  − `reconnection_floor_cents`, − `provisional_release_enabled`
  (migrated into `integrations`, then retired).

## Contract

| Route | Actor | Notes |
|---|---|---|
| `GET /integrations` | `integrations: manage` | the catalog: WispHub card state (configured, keyTail, actionsEnabled, mapping, threshold, floor, provisionalReleaseEnabled) |
| `PATCH /integrations/wisphub` | `integrations: manage` | key (write-only, re-tested like settings D3), mapping, threshold+floor, both switches |
| `POST /integrations/wisphub/test` | `integrations: manage` | settings D2 verbatim, moved |
| `POST /payments/:id/execute-action` | `payments: operate` | D5: observation rows only; 409 otherwise; dispatches the recorded action |
| `POST /payments/:id/retry-action` | `payments: operate` | renamed from `retry-reconnection` (D7); semantics unchanged |
| `GET /payments/feed` | `payments: read` | rows say `actionOutcome`, `actionDoneAt`, `actionAttempts`, `actionError`, `observedAction` |
| `GET /auth/me` | — | the actor says `observing: true` while the active business's integration has actions off (the shell chip) |

## UI Contract

- **Integraciones** (list): WispHub card with StatusBadge
  Conectada/Sin conectar; dead "Integración genérica" card.
- **WispHub detail**: key card (settings D1–D3 verbatim); mapping —
  three fixed rows with a two-option select each, threshold % + floor $
  inline in the `short` row with the computed one-line meaning
  (settings' ReconnectionCard copy survives the move); the master
  switch with honest copy ("Apagado: Devolada no escribe nada en
  WispHub; tú registras y reconectas a mano"); the provisional switch
  (D8) with its existing copy.
- **Shell**: "Modo observación" chip while observing (icon + text,
  never color alone), tapping opens the integration detail.
- **Pagos**: observation rows wear the "Observación" badge, the
  expansion shows the hypothesis line and **Ejecutar ahora** for
  `payments: operate`; `done` rows label by action (Reconectado /
  Registrado). Which button lives on which row — the two never coexist:

  | row outcome | button | what it does |
  |---|---|---|
  | `observation` | Ejecutar ahora | first dispatch of the action the gate held back (D5) |
  | `failed` | Reintentar | re-queue an action that was dispatched and failed (payments-and-classes D5) |
  | `queued` / `done` / `withheld` | none | nothing to execute — `withheld` is where "the threshold is law" is written |

## Scenarios

1. A business with no integration row: Integraciones shows "Sin
   conectar"; the link page says unavailable (as today with no key);
   connecting a key creates the row **observing** (D4).
2. Migration: a business with a WispHub key gets its row with today's
   values and `actions_enabled = true`; a payment confirmed right after
   the deploy behaves exactly as before it (D2).
3. Mapping: `short` → `register_only` — a short payment registers and
   never touches the router, whatever the threshold says; back to
   `register_and_reconnect`, the threshold decides again (D3).
4. Observation: a confirmed payment writes nothing to WispHub — no
   registrar-pago, no PATCH — and the row reads outcome `observation`
   with its hypothesis; the credit was debited; Cobros still reads live
   (D4/D5).
5. "Ejecutar ahora" on an observed row dispatches the recorded action:
   outcome `queued → done`, an `integration_events` row is born
   `dispatched` and ends `acked`; a second click answers 409; a viewer
   never sees the button and the route answers 403 (D5/D6).
6. A `withheld` row offers no execute button (D5).
7. The event ledger: a confirmed payment with actions on creates one
   event carrying the class and the action, `acked` when the outcome
   lands; an `unapplied` payment creates none; an observed verdict
   creates none (D6).
8. Rename holds end to end: the feed says `actionOutcome: "done"` where
   it said `reconnectionStatus: "reconnected"`; old rows read `done`
   after migration; the retry route answers at its new path (D7).
9. Provisional release obeys the integration: switch on + observation
   on → no release (zero writes wins); switch on + actions on → the
   release fires as provisional-release specifies (D8).
10. Configuración no longer shows the WispHub or Reconexión cards; the
    integration detail edits key, mapping, threshold and both switches;
    a role without `integrations: manage` sees no Integraciones section
    (D1/D9).
11. The shell chip appears for every role while observing and
    disappears when actions turn on (D4).
12. Tenant isolation: business A's integration, events and outcomes are
    invisible to business B (house law).

## Definition of Done

- [x] Migrations (foundation PR): `integrations` (+ backfill from
      `businesses` with actions enabled, then column retirement),
      `integration_events` (born, unwritten until the dispatch PR), the
      `payments` renames with `reconnected → done` mapped, and
      `observed_action`. Configuración serves as a FAÇADE over the
      integration row until the UI PR moves its cards (D9).
- [x] Scenarios 3, 4, 5, 7 and 9 (server halves) automated in the
      dispatch PR (`integration-dispatch.test.ts`); the rest ride the
      hub-UI PR.
- [x] Scenarios 1, 2, 6, 8 and 10–12 automated (hub-UI PR:
      `integrations.test.ts` api-side; `integrations.test.tsx` and the
      feed's observation tests admin-side; scenario 8 held by the
      charge-feed suite since the rename).
- [ ] provisional-release D10 amendment note landed (same PR as this
      spec); pivot Open item 1 marked executed.
- [x] D10 (2026-09-02): the shell banner provider-agnostic, pointing at
      the catalog; `integrationConfigured` on the actor
      (`apps/admin/test/shell.test.tsx`)
- [x] Glossary: Modo observación row (#143) and the Ejecutar ahora row
      (hub-UI PR).
- [x] Light + dark, contrast-lint (e2e page: the WispHub detail), axe
      (catalog + detail) on the new screens; states: loading /
      error-with-retry / role-hidden (nav and 403).
- [ ] The pilot on deployed dev: flip observation on, receive one real
      payment, read its hypothesis, execute it by hand from the row,
      flip actions back on.

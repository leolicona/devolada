# Bug Assessment: a retried action reconnects a customer the business's rule left cut

- **Slug**: queue-retry-forgets-action
- **Created**: 2026-10-01
- **Source**: pasted text — `specs/018-cash-at-stores/research.md` D10 and
  `tasks.md` T002 (found while reading the queue for 018, 2026-10-01). No URL
  supplied, so the URL Trust Policy did not apply and nothing was fetched.
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

> The sweep retries `queued` rows with `attemptReconnection(…)` and no
> `reconnect` argument. That argument defaults to true (`queue.ts:119-138`,
> `reconnection.ts:46`). `retryAction` hard-codes `register_and_reconnect`
> (`routes/payments/handler.ts:627`).
>
> A payment whose action should only register is retried as register *and
> reconnect* if its first attempt met an outage. That covers a short payment
> under the threshold (`withheld`) and a class mapped to `register_only`. The
> customer gets the service back against the business's own rule. No test or
> bug entry covers it today. (research D10)

## Symptom

A confirmed payment whose decided action is "register only" — a class the
business mapped to `register_only`, or a short payment below its threshold
or floor (`partial-payment` D5) — is registered in WispHub with `accion: 1`
(reconnect) when its first attempt failed and the queue retries it. The
customer gets the service back against the business's rule.

Expected: every retry runs the action the verdict decided, exactly as the
first attempt would have.

A second symptom rides on the first: when the retry does run register-only
correctly (it cannot today, but it must after the fix), the sweep has no
branch for the adapter's `withheld` answer. It would fall to the backoff
branch, spend an attempt, and end in `failed` for a flow that worked.

## Reproduction

From the code (not observed on a live tenant):

1. A business maps `short` to `register_and_reconnect` with a threshold of
   80 %. A payer sends 300.00 of a 499.00 debt: `settle()` answers
   `reconnect: false`, so `settlePanelPayment` calls `attemptReconnection(…,
   reconnect = false)`.
2. WispHub answers 503 on the payment-method list or on `registrar-pago`. The
   adapter answers `{ status: "queued", error: "WISPHUB_UNAVAILABLE",
   paymentRegistered: false }`; the row is `queued` with a next attempt in one
   minute.
3. The every-minute sweep (`reconnection/queue.ts`) calls
   `attemptReconnection` with no seventh argument. `reconnect` defaults to
   true, so `registerPayment(…, reconnect = true)` posts `accion: 1`.
4. WispHub registers the payment **and reactivates the service**.

The same holds for a class mapped to `register_only` (step 1 with any amount),
for a `failed` row the operator retries (`POST /payments/:id/retry-action`
records `register_and_reconnect` in the ledger and queues the row for the same
sweep), and for an "Ejecutar ahora" of a withhold hypothesis that met a 503.

## Suspected Code Paths

- `apps/api/src/reconnection/queue.ts:107-127` — the sweep's
  `attemptReconnection` call passes no `reconnect` argument.
- `apps/api/src/wisphub/reconnection.ts:46` — `reconnect = true` default.
- `apps/api/src/reconnection/queue.ts:132-189` — the sweep maps
  `reconnected` → `done`, `WISPHUB_AUTH_FAILED` → wait, everything else →
  backoff. A `withheld` answer has no branch.
- `apps/api/src/routes/payments/handler.ts:620-630` — `retryAction` records
  `action: "register_and_reconnect"` whatever the row decided.
- `apps/api/src/direct-payments/validation.ts` (`settlePanelPayment`) and
  `routes/payments/handler.ts` (`dispatchObserved`) — the two places that
  decide the action and dispatch it; neither writes the decision anywhere a
  retry can read it back, except `observedAction` on a row the observation
  gate held.

## Root Cause Hypothesis

The decision (the mapped action plus the threshold's vote) is computed once at
the verdict and passed to the first attempt as an argument, then forgotten.
The queue's row carries the registered amount and the invoice
(`partial-payment` D9, TD-009) but not the decision, so every later attempt
falls back to the adapter's default. Confidence: high — read from the code;
the default and the missing argument are both explicit.

## Proposed Remediation

**Preferred**: keep the decided action on the row and read it back on every
retry.

- A sibling of `observed_action`, `decided_action`, nullable text in the same
  vocabulary (`hypothesisOf`: `register_only`,
  `register_and_reconnect:reconnect`, `register_and_reconnect:withhold`).
  `observed_action` is taken: its contract is "null on every row that really
  dispatched" (`schema.ts` comment, pinned by `integration-dispatch.test.ts`
  scenario 3), and the panel reads it as the observation gate's hypothesis.
- Written at every dispatch decision: `settlePanelPayment`'s first attempt,
  `dispatchObserved` ("Ejecutar ahora" and the accept of a held payment).
- Read back by the sweep (`parseHypothesis`) and passed as `reconnect`; the
  sweep maps the adapter's answer with `outcomeOf`, so `withheld` becomes
  `done` under `register_only` and `withheld` under a withhold vote, both
  terminal and acked.
- `retryAction` records the row's decided action in the ledger instead of a
  hard-coded `register_and_reconnect`.
- A row with no decision on file (queued before this fix) falls back to
  `observed_action`, then to today's `register_and_reconnect:reconnect` — the
  same fallback `dispatchObserved` already uses.

**Alternatives**:
- Reuse `observed_action` for every row. Rejected: it breaks a pinned
  contract and makes the observation gate's instrument ambiguous.
- Recompute the decision at retry time from today's mapping and threshold.
  Rejected: integrations-hub D5 — "the policy may move; the record must not".
- Read the action from the dispatch ledger (`integration_events`). It carries
  the action but not the threshold's vote, so a withhold cannot be told from a
  reconnect.

**Files likely to change**:
- `apps/api/src/db/schema.ts` and one additive migration (`ADD COLUMN`)
- `apps/api/src/reconnection/queue.ts`
- `apps/api/src/direct-payments/validation.ts`
- `apps/api/src/routes/payments/handler.ts`
- `apps/api/test/queue-retry-forgets-action.test.ts` (new)

**Tests to add or update**:
- A `withheld` payment (short, below the threshold) whose first attempt met a
  503: the sweep retries with `accion: 0` and the row ends `withheld`.
- A `register_only` payment whose first attempt met a 503: the sweep retries
  with `accion: 0` and the row ends `done`, with the ledger acked.
- The operator's retry of a `failed` register-only row records
  `register_only` in the ledger and the sweep registers with `accion: 0`.
- Both cite `bug: queue-retry-forgets-action`.

## Risks & Considerations

- Rows queued in production before the deploy carry no decision and keep
  today's behaviour (reconnect). The pilot's queue is drained within hours
  (five retries over about five hours), so the window is one deploy.
- The migration is additive (`ADD COLUMN`, nullable), safe for the per-PR
  preview against the live dev database (constitution, Data row).
- `specs/018-cash-at-stores` D9 moves these call sites behind
  `paymentActions`; this fix lands first so that move carries the decision
  with it.

## Open Questions

- None.

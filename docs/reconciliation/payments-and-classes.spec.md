---
status: in development
stories: [US-R02, US-R03]
domain: reconciliation
updated: 2026-09-01
debt: []
---

# Spec: Payments and their classes — the oracle's verdict, named

Phase 4 of the pivot (platform/pivot.spec.md, sequencing 4), second half.
Every confirmed payment gets a **class** against its Cobro — exacto,
corto, excedente — by the business's own policy, and the Pagos section
becomes the place where a payment shows its proof. This spec also
executes two pivot decisions that were waiting for this phase: **one
Consta key per business (D20)** and the trust layer's refs (US-V15's
cheap half), and it performs the **rename** the IA scheduled for the
moment both sections exist. Decided with the owner in the phase-4
interview (2026-09-01). Its companion is
[cobros-mirror.spec.md](cobros-mirror.spec.md).

## Decisions

- **D1 — The reconciliation policy is the business's, with platform
  defaults: tolerance $0, surplus flagged.** `tolerance_cents` decides
  `exact` (|received − asked| ≤ tolerance); below is `short`, above is
  `over`. Birth default **$0** — SPEI is exact to the cent, a $1
  difference is a real short payment, not rounding — editable per
  business, default editable by the operator (`default_tolerance_cents`,
  operator-panel D1). `over_treatment` decides what a surplus means:
  **`flag`** (the business owes the payer the difference and sees it as
  such) or **`credit`** (the surplus stays as the customer's credit).
  Birth default **`flag`**. **Rejected**: $1 tolerance (hides real
  shortfalls to absorb rounding that a SPEI transfer does not have).

- **D2 — An integration that absorbs surplus turns `flag` into
  `credit`.** Owner decision: WispHub keeps a running account, so an
  overpayment becomes the customer's credit by itself (partial-payment
  D10, measured). The adapter declares the capability
  (`absorbsOverpayment: true`), and the **effective** treatment for a
  business with such an integration is `credit` whatever the policy
  says — not a loosening of the business's rule but a fact about where
  the money already went. A business with no integration keeps `flag`.
  Phase 5's integration hub shows this on the WispHub card.

- **D3 — The class is computed at the verdict, against the fresh debt.**
  The same numbers `settle()` already uses (partial-payment D5/D8): what
  arrived (`receivedCents`) against the debt read at confirmation — never
  the debt remembered at submission. `reconciliation_class` (born
  nullable, business-and-memberships D6) is written on `confirmed`,
  `partial` and `unapplied` (`unapplied` = `over` by definition: money with
  nothing to absorb it); a short payment is `short` even when the
  integration's threshold reconnects it (phase 5 owns the action; the
  class is the fact). Never on `invalid`/`expired` (no money).

- **D4 — Pagos lists with filters and shows its proof.** Filters: status
  (all the lifecycle's, including `queued_for_credit`), date range in the
  business's timezone (settings D5), and customer (usuario or name). The
  class is a `StatusBadge` variant next to the reconnection status — icon
  + text, never color alone. **"Ver comprobante"** opens the proof: the
  CEP as Banxico answered it (clave, amount, date, sender bank, sender
  name, beneficiary) and, when the payer uploaded a capture, the **image
  through a short-lived signed URL** (direct-payment D12's own mechanism).
  The proof is the whole truth — what Banxico said and what the payer
  sent — and it is read for **every role** (a viewer reads; a dispute is
  answered by whoever picks up the phone). **Rejected**: CEP only (the
  operator answering a dispute wants the receipt as it arrived); image
  only (the image is not the proof).

- **D5 — A failed action can be retried by an operator.** `POST
  /payments/:id/retry-reconnection` (D3 matrix: `payments: operate`) puts
  a `failed` reconnection back in the queue — `queued`, next attempt now —
  touching neither the payment nor the credit; the sweep does the rest with
  the idempotency it already has (TD-009's invoice guard). The row shows
  its action outcome as its own line (IA): reconnected / withheld / failed
  with the reason / observación (phase 5). **Rejected**: deferring to
  phase 5 (the matrix promised this to operators in phase 2; until now it
  was kept only by waiting).

- **D6 — The rename, in one PR.** The moment the Cobros section exists,
  the feed of money received is called what it is: nav **Pagos**, route
  `/pagos`, `GET /payments/feed` answers `{ payments: [...] }` (the
  `charges` key and the `totalCents` alias retire), and
  `admin/charge-feed.spec.md` is superseded by this spec's Pagos contract
  — its file stays as history with a banner. Never two words for one
  thing, never one word for two (IA).

- **D7 — One Consta key per business, issued when the business is born
  (pivot D20 executed).** Consta already has the door: `POST /admin/keys`
  guarded by `CONSTA_ADMIN_TOKEN` (validation US-V05, by hand — now by the
  first-party consumer). `POST /businesses` calls it and stores
  `businesses.consta_api_key` (as the WispHub key is stored); every
  validation of that business's payments uses **its** key; top-ups keep
  the **platform's** key (prepaid-credit D6). Existing businesses get
  theirs in a one-shot backfill sweep. Consta's per-key log stays cost
  telemetry, never billing (pivot D20). The shared token is a Worker
  secret synced like the others (CICD D5).

- **D8 — The trust layer's refs travel from the moment the business's
  key exists — not before.** `customerRef`/`paymentRef` already travel on
  every validation (provisional-release D4) under the platform key; from
  this PR they travel under the business's key, so history accumulates in
  the right tenant's chains (trust-layer D2, `(apiKeyId, customerRef)`).
  History sent on dev under the platform key is lost on the switch —
  accepted (TASKS: refs start when the key exists); dev only.

## Schema

- `businesses`: + `tolerance_cents` integer not null default 0,
  `over_treatment` text (`flag | credit`) not null default `flag`,
  `consta_api_key` text nullable.
- `platform_settings` keys: + `default_tolerance_cents` (cents, 0,
  0–10000), `default_over_treatment` (enum `flag | credit`, `flag`).
- `payments.reconciliation_class` gains its semantics (D3); no column
  change.

## Contract

| Route | Actor | Notes |
|---|---|---|
| `GET /payments/feed?status=&from=&to=&q=&cursor=` | `payments: read` | rows carry `reconciliationClass`, `receivedCents`, `askedCents` (the debt at the verdict), `missingCents`/`surplusCents`, the action outcome; response key `payments` (D6) |
| `GET /payments/:id/proof` | `payments: read` | the CEP fields + `imageUrl` (signed, short-lived) or null |
| `POST /payments/:id/retry-reconnection` | `payments: operate` | 200 → `queued`; 409 unless the row is `failed` |
| `PATCH /settings` | `settings: update` | + `toleranceCents`, `overTreatment` (`effectiveOverTreatment` read-only in the GET) |
| `POST /businesses` | — | issues the Consta key (D7) |

## UI Contract

- **Pagos** (renamed feed): filter bar (status chips incl. "Pago
  parcial" = `short`, date range, customer search); rows gain the class
  badge; expansion shows the ask/received/missing-or-surplus lines
  (partial-payment D15's voice, now for `over` too: "Sobrante $X — queda a
  favor del cliente" or "Sobrante $X — devolver al cliente" per the
  effective treatment), the action outcome line with **Reintentar** for
  `payments: operate` roles when `failed`, and **Ver comprobante**.
- **Comprobante** (dialog): the CEP block and the image when present, with
  the payer's proof door named.
- **Configuración → Política de conciliación**: tolerance (money field)
  and surplus treatment (select), with the effective treatment explained
  when an integration overrides it (D2).

## Scenarios

1. Received = asked → `exact`; received = asked − $1 with tolerance $0 →
   `short`; tolerance raised to $1 → `exact` (D1).
2. Received > asked → `over`; `unapplied` → `over` (D3).
3. A business with WispHub: effective treatment `credit` although the
   policy says `flag`; without an integration: `flag` (D2).
4. The class rides the payment and the feed row; `invalid`/`expired`
   carry none (D3).
5. Feed filters: status, date range in the business's zone, customer by
   usuario and by name; isolation across businesses holds (D4).
6. Proof: a transfer-door payment answers the CEP and `imageUrl: null`; a
   receipt-door payment answers a signed URL that serves the image and
   expires (D4); a viewer may read it.
7. Retry: a `failed` row → `queued` with next attempt now; a second retry
   on a non-failed row → 409; the sweep reconnects it under the same
   invoice (D5, TD-009).
8. Rename: `/payments/feed` answers `payments`; the admin nav reads Pagos
   · Cobros · Links · Integraciones… (D6).
9. `POST /businesses` issues a Consta key and stores it; the next
   validation of that business sends that key and its refs; a top-up
   still sends the platform's (D7/D8).
10. Backfill: existing businesses without a key get one, once (D7).

## Definition of Done

- [ ] Migration (additive) for the three business columns; the two
      platform keys born in code.
- [ ] Scenarios 1–10 automated, citing their stories.
- [ ] `CONSTA_ADMIN_TOKEN` synced by both deploys (warning when unset:
      businesses are born without a key and validate under the platform's
      until the backfill runs).
- [ ] `charge-feed.spec.md` bannered as superseded; SPEC.md glossary
      **Cobro** = `payment_request`, **Pago** unchanged; nav renamed;
      TASKS.md phase 4 boxes ticked.
- [ ] The pilot on deployed dev: one real short payment reads `short`
      with the right missing pesos in Pagos, and its proof opens.

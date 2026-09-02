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
[cobros-live.spec.md](cobros-live.spec.md).

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
  Phase 5's integration hub shows this on the WispHub card. **The override
  never reaches `unapplied`** (PR #135 review): an `unapplied` payment is
  precisely the one *not* registered in WispHub (direct-payment D14, pivot
  D9: "nothing absorbs it"), so no credit exists for it to have gone to —
  its effective treatment is always `flag`, "resolver con el cliente",
  integration or not. Saying "queda a favor del cliente" over money sitting
  unapplied in the business's bank would be the lie D14 was written to
  prevent.

- **D3 — The class is computed at the verdict, against the fresh debt.**
  The same numbers `settle()` already uses (partial-payment D5/D8): what
  arrived (`receivedCents`) against the debt read at confirmation — never
  the debt remembered at submission. `reconciliation_class` (born
  nullable, business-and-memberships D6) is written on `confirmed`,
  `partial` and `unapplied` (`unapplied` = `over` by definition: money
  arrived against a debt of zero — a class, not a credit; D2 keeps its
  treatment at `flag`; since the design-review pass 2026-09-01 the row also
  keeps `receivedCents`, the CEP sender and the customer identity read at
  the verdict, so the feed and the proof name the person to resolve with); a short payment is `short` even when the
  integration's threshold reconnects it (phase 5 owns the action; the
  class is the fact). Never on `invalid`/`expired` (no money).

- **D4 — Pagos lists with filters and shows its proof.** Filters: status
  (all the lifecycle's, including `queued_for_credit`), date range in the
  business's timezone (settings D5), and customer (usuario or name).
  *Implementation (2026-09-01)*: `status` names the lifecycle; the action
  outcome keeps its own `reconnection` filter (D5's dimension) and the
  class its `class` filter — three questions, three parameters, never one
  parameter meaning two things. `from`/`to` travel as calendar dates
  (`YYYY-MM-DD`), inclusive, and the server owns the midnight boundary in
  the business's zone. **The default view answers money that arrived**
  (`confirmed`, `partial`, `unapplied` — scenario 11 needs the last one
  visible); the rest of the lifecycle is reached through the filter.
  *Amended 2026-09-02 (pilot-UX round, owner decision)*: `validating`
  joins the default too — the owner staring at "¿ya me pagó?" during
  the verification window was blind exactly when they look hardest. The
  row wears "Verificando pago", the folio reads "—", the identity comes
  from the link, and a "Verificando" chip isolates them; today's totals
  still count only `confirmed` + `partial`. The
  class is a `StatusBadge` variant next to the reconnection status — icon
  + text, never color alone. **"Ver comprobante"** opens the proof: the
  CEP as Banxico answered it (clave, amount, date, sender bank, sender
  name, beneficiary **name** — the CEP Consta returns carries no account,
  so the CLABE business-and-memberships D3 masks for viewers never enters
  through this door) and, when the payer uploaded a capture, the **image
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
  the feed of money received is called what it is: nav label **Pagos**,
  route **`/payments`** (routes are identifiers and therefore English —
  the rule the IA now states; the inherited Spanish paths are TD-017),
  `GET /payments/feed` answers `{ payments: [...] }` (the
  `charges` key and the `totalCents` alias retire), and
  `admin/charge-feed.spec.md` is superseded by this spec's Pagos contract
  — its file stays as history with a banner. Never two words for one
  thing, never one word for two (IA).

- **D7 — One Consta key per business, issued when the business is born
  (pivot D20 executed — now, not deferred; owner decision 2026-09-01).**
  The owner weighed deferring it until the trust layer (US-V15, still
  `proposed`) leaves its shadow, and chose to execute: the product must be
  ready with a key per business from the first real tenant, so the
  evidence the shadow accumulates lands in the right chain from day one
  (D8). The door is **issue-only**: validation D5 is amended with
  `CONSTA_ISSUER_TOKEN`, a second secret that `POST /admin/keys` accepts
  and `DELETE /admin/keys/:id` refuses — `apps/api` can mint keys for its
  businesses and nothing else (PR #135 review: handing it the admin token
  made a compromised SaaS the admin of every Consta tenant, external
  customers included). `POST /businesses` calls it and stores
  `businesses.consta_api_key` **in D1, in the row, as the WispHub key is
  stored** (owner decision: same trust as the other tenant credential;
  encrypting it would guard a leak that already exposes the WispHub keys).
  Every validation of that business's payments uses **its** key; top-ups
  keep the **platform's** key (prepaid-credit D6). Existing businesses get
  theirs in a one-shot backfill sweep; a business whose key is missing
  (issuer down at birth) validates under the platform's until the next
  sweep backfills it, and the feed says nothing — a key is plumbing.
  Consta's per-key log stays cost telemetry, never billing (pivot D20).
  Both secrets are synced by their deploys like the others (CICD D5).
  **Rejected**: deferring to US-V15's activation (nothing lost today, but
  the owner wants no second migration between the pilot and the trust
  layer); a prefixed `customerRef` under one key (pivot D20's rejection
  stands, and the manual Cobro after the pivot brings refs without a
  tenant suffix).

- **D8 — The trust layer's refs travel from the moment the business's
  key exists — not before.** `customerRef`/`paymentRef` already travel on
  every validation (provisional-release D4) under the platform key; from
  this PR they travel under the business's key, so history accumulates in
  the right tenant's chains (trust-layer D2, `(apiKeyId, customerRef)`).
  History sent on dev under the platform key is lost on the switch —
  accepted (TASKS: refs start when the key exists); dev only, and the
  trust layer reads none of it yet (US-V15 `proposed`: Consta measures,
  the client decides — the switch itself is a later toggle in Devolada,
  not an automatic threshold).

- **D9 — A suspended business validates nothing, queued rows included
  (owner decision 2026-09-01).** Suspension (business-and-memberships D3:
  403 for every member) never touched the public link: `validation.ts`
  reads no `businesses.status`, so a suspended business's payers kept
  validating and spending its credit. Now: the link answers 409
  `BUSINESS_SUSPENDED` (payer copy: "Este negocio no puede recibir pagos
  por ahora. Contacta a tu proveedor."), and the re-validation sweep
  **skips** the business's `validating` rows — their schedule freezes
  where it was, exactly as the credit pause does (prepaid-credit D8), and
  resumes on reactivation; nothing is expired or refused for having been
  suspended, since the money may already have moved. Consta's key is
  **not** revoked: revocation is for a business that leaves, and a
  revoked key would 401 rows that must resume. **Rejected**: revoking the
  key as the cut (couples a reversible platform state to an irreversible
  Consta one); letting queued rows finish (spends the credit of a business
  the platform just froze).

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
| `POST /businesses` | — | issues the Consta key through `CONSTA_ISSUER_TOKEN` (D7) |
| `GET /direct-payments/links/:token` · `POST …/pay` | public | 409 `BUSINESS_SUSPENDED` while the business is suspended (D9) |

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
   `short`; with the tolerance raised to $1, a **new** payment $1 short →
   `exact` while the earlier row keeps `short` (D1, D3: computed once).
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
10. Backfill: existing businesses without a key get one, once (D7); a
    business born while the issuer is down validates under the platform's
    key until then.
11. `unapplied` with WispHub: class `over`, effective treatment `flag`, the
    row reads "resolver con el cliente" — never "queda a favor" (D2).
12. Suspended business: the link answers 409 `BUSINESS_SUSPENDED`; a
    `validating` row is skipped by the sweep with its schedule intact, and
    validates on reactivation; the Consta key is untouched (D9).

## Definition of Done

- [x] Migration (additive) for `tolerance_cents` + `over_treatment`; the
      two platform keys born in code (`consta_api_key` rides the D7 PR,
      which owns the rest of this list's key work).
- [x] Scenarios 1–7 and 11 automated, citing their stories (classes PR);
      scenario 8 was the #140 rename; 9, 10 and 12 in the keys PR
      (`consta-keys.test.ts` + the issuer-door tests in Consta's
      `admin-keys.test.ts`). Scenario 7's sweep half leans on the
      reconnection-queue suite (TD-009's invoice guard is tested there).
      Scenario 9's top-up half is the top-up suite's platform-key path,
      unchanged by this PR.
- [x] `CONSTA_ISSUER_TOKEN` synced by both deploys (Consta dev + api
      dev/prod; Consta has no prod env yet) with a warning when unset:
      businesses are born without a key and validate under the platform's
      until the backfill runs. Validation D5's amendment (the issue-only
      door) shipped with it. **Owner sets the secret in the GitHub
      environments.**
- [x] Migration 0024 (`consta_api_key`, additive); issuance at birth,
      the every-minute backfill sweep, refs under the business's key
      (D8 — they already rode every validation), and the D9 suspension
      cut (link 409, sweeps skip, queued release skips, key kept).
- [x] The IA's route rule written and TD-017 opened for the inherited
      Spanish paths (PR #135).
- [x] `charge-feed.spec.md` bannered as superseded; SPEC.md glossary
      **Cobro** = `payment_request` (+ the class row), **Pago** unchanged;
      nav renamed (#140); TASKS.md phase 4 boxes ticked.
- [ ] The pilot on deployed dev: one real short payment reads `short`
      with the right missing pesos in Pagos, and its proof opens. Same
      pass: confirm the Desde/Hasta native date pickers read `dd/mm` on a
      Mexican device (the browser owns their language; page `lang` does
      not move Chromium — design-review 2026-09-01).

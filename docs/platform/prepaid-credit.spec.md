---
status: in development
stories: [US-B04, US-B05, US-B06, US-L03]
domain: platform
updated: 2026-09-01
debt: []
---

# Spec: Prepaid credit — the fee, the balance, the top-up, the pause

Phase 3 of the pivot (platform/pivot.spec.md, sequencing 3), first half.
The platform's revenue model as code: a **fixed fee per validation**,
**prepaid** (pivot D5), debited from a balance the business tops up by
transferring to the platform — validated by the platform itself (D7).
A business that runs dry never punishes its payer (D6). Decided with the
owner in the phase-3 interview (2026-09-01); the operator's side — where
the numbers are edited — is [operator-panel.spec.md](operator-panel.spec.md).

## Decisions

- **D1 — The numbers are platform settings, and these are their birth
  values.** Fee **$5.00 MXN per validation** (`validation_fee_cents =
  500`), welcome bonus **20 validations** (`welcome_bonus_validations =
  20`, credited as `20 × fee` at the moment of birth), negative cap
  **−$50.00** (`negative_cap_cents = 5000`), top-up minimum **10
  validations** (`topup_min_cents = 5000`). Read from `platform_settings`
  (operator-panel D1) at the moment of each event — never cached in the
  business row. Owner's reasoning: a third of the $15 service fee, so the
  fee fits even when the business absorbs the commission (direct-payment
  D19); the bonus covers a small ISP's first month; the cap buys days of
  margin without financing anyone. **Rejected**: $3 (too close to the
  provider's cost when a pending payment eats several re-checks — each
  re-check bills 1 apiCEP credit, measured 2026-08-27); $8 (more than half
  the service fee leaves with the platform when the business absorbs it).

- **D2 — The unit is the terminal verdict, once per payment.** A
  `validation_fee` entry is written when a payment reaches a **terminal
  verdict with a CEP behind it**: `confirmed`, `partial`, `unapplied`
  (the oracle proved a transfer exists) **and `invalid`** — which in this
  codebase is exactly Consta's `contradicted` (direct-payment D17): Banxico
  answered and disagreed, a verdict the business can act on. Never
  `expired` (only `not_found`s, no verdict ever came), never `validating`,
  never the edge rejections (a bank outside the catalog, a malformed clave
  — no provider call happened), and **never per attempt**: a payment whose
  reading was corrected three times (`superseded` chain, D18) pays once —
  the fee keys on the payment that reaches the verdict, and a superseded
  row is never terminal. Idempotent by construction: `credit_entries` holds
  a unique `payment_id` for `validation_fee` rows, so a retried sweep can
  never charge twice. **Rejected**: charging every provider call, valid or
  not — it moves the risk to the business: the payer's typo and the
  payer's malice (direct-payment D13's budget is 5 submissions per hour
  per link → up to $600 a day per link) would drain a wallet the payer
  does not own. The provider's cost of "we don't know" stays with the
  platform, which sets the fee to absorb it; two open items below keep the
  question alive. **Rejected**: valid CEPs only (the earlier draft) — a
  `contradicted` is work done and truth delivered.
  **Amended 2026-09-01 (PR #132 review, owner decision) — one transfer
  pays once.** `payments`' unique index excludes `invalid`, so the payer
  who corrects a typo submits a **fresh** row (validation-status-ux D7/D9;
  a terminal row is never superseded), and when it confirms the fee is
  booked again: one transfer, two verdicts, two fees — the cost-by-the-
  payer's-error this decision rejected. So when a fresh row on the same
  link reaches a **valid** CEP, every earlier row of that link that ended
  `invalid` and was charged gets its fee back as a **`fee_reversal`** —
  its own kind, not an `adjustment` (which is the operator's, with an
  author): keyed on the reversed row's `payment_id` with the same partial
  unique index as the fee, so it is idempotent by construction, and read
  in the history as "Cobro revertido", never as prose. Reason carries the
  confirming payment's id; the author is the system (null). Accepted edge:
  a payer who first fabricates a receipt and then sends a real transfer
  earns the reversal too — the business pays once, the platform paid the
  provider twice; cheap, and consistent with "the cost of the provider's
  'we don't know' stays with the platform".

- **D3 — Balance = SUM, never stored; entries are append-only.**
  `credit_entries` is the house's append-only table (ARCHITECTURE.md): one
  row per event, `cents` signed, balance derived with `SUM` per business.
  Kinds: `welcome_bonus` (+), `top_up` (+), `validation_fee` (−),
  `fee_reversal` (+, the system's, D2 amendment), `adjustment` (±,
  operator-panel D5). Corrections are new rows.
  **Rejected**: a `balance_cents` column (it drifts; the old ledger's
  lesson).

- **D4 — One fee, with a negotiated exception per business.** The debit
  uses `businesses.fee_override_cents` when set, else the global
  `validation_fee_cents` current at that moment (D1). The override is
  written only from the operator panel (operator-panel D6). **Rejected**:
  global only (the pilot and the first customers will negotiate, and a
  deal with nowhere to live becomes a global change or a promise outside
  the system).

- **D5 — The welcome bonus is per user, and only their first business.**
  When `POST /businesses` creates a business, the bonus is credited only if
  no `welcome_bonus` row exists for the creating `user_id` anywhere. A
  second business by the same owner is born at $0 and tops up — the
  legitimate two-instance operator (pivot D10) pays a small top-up; the
  "create businesses for free credit" leak is closed. The row records
  `granted_to_user_id`. **Rejected**: per business (20 free validations
  per business anyone creates, without limit); no bonus (breaks the
  onboarding decided in pivot D7/D12: the first link works without a
  prior top-up).

- **D6 — A top-up is a SPEI transfer the platform validates, submitted
  from the dashboard.** Free amount, minimum `topup_min_cents`. The owner
  transfers to the platform's CLABE (`topup_clabe`/`topup_bank`/
  `topup_beneficiary`, operator-panel D1) and submits the proof
  **authenticated**, from Saldo y recargas — so the top-up is bound to the
  business by the session, and no reference has to be typed. Both proof
  doors of the pago page reuse (screenshot through `/extract`, or the
  manual data — direct-payment D2/D18), with the same reading check. The
  validation runs against Consta with the **platform's own key** (never
  the business's D20 key: this is the platform's transaction) with the
  platform's CLABE as beneficiary; **it is billed to nobody**. On a valid
  CEP the entry credits **the CEP's amount** (not what was claimed) —
  claimed-amount D1's principle. `pending`/`not_found` ride D7's schedule
  through the same sweep; `contradicted` or `expired` ends the top-up
  with the same copy the payer would see. A CEP below the minimum is still
  credited (the money moved; the minimum is a form rule, not a refusal).
  **Rejected**: fixed packs (a CEP for a different amount than the pack
  lands in limbo); no minimum ($20 top-ups that cost more to validate
  than they credit); a card gateway (pivot D7).

- **D7 — Three steps of warning, one non-color signal each.** The chip in
  the shell (IA) and the banners read the balance against the fee: **normal**
  above 5 validations' worth; **"Saldo bajo"** at ≤ `5 × fee` (the IA's
  20%, made relative to the fee instead of to history — with the $100
  bonus they coincide); **"Sin saldo"** at ≤ 0; **"Validación en pausa"**
  below `−negative_cap_cents`. Each step changes label and icon, never
  color alone (FRONTEND law, brief). **Email** to every owner of the
  business at the moment the balance crosses **0** and at the moment it
  crosses **the cap** — once per crossing, through the Resend adapter
  (es-MX copy). Not at 20%: a warning email for a non-urgent state trains
  the reader to ignore the urgent one. **Rejected**: chip only (the owner
  who does not open the dashboard learns about the pause from a customer —
  what pivot D6 exists to prevent); three emails.

- **D8 — In the pause, what started finishes and what is new waits
  without spending.** Below the cap: a payment already `validating` keeps
  its re-check schedule to its end — the payer transferred, the truth is
  owed, and the fee it will earn may push the balance further below the
  cap (accepted: the price of never leaving a payer halfway). A **new**
  proof is stored with `status = 'queued_for_credit'` — no provider call,
  no extraction — and the link answers "validación en pausa" in D6's
  voice: the business must act, the payer did nothing wrong. When a
  `top_up` or `adjustment` lifts the balance above the cap, the direct
  sweep moves queued rows back to `validating` **in arrival order** and
  they follow the normal schedule from that moment. The submission budget
  (direct-payment D13) counts queued rows too. **Rejected**: stopping
  in-flight re-checks (a payer with a CEP about to publish hangs for the
  ISP's arrears); never stopping (the cap is not a cap).

- **D9 — What the payer sees is the business's fault, never theirs.** In
  the pause the link's copy is: *"Este negocio pausó la validación de
  pagos. Tu comprobante quedó guardado y se revisará en cuanto la
  reactiven."* — no CLABE hidden, no "error", and the debt still shown
  (the payer may still transfer; the money reaches the business
  regardless). `queued_for_credit` renders as its own calm state on the
  page (validation-status-ux D12's family), with no countdown.

- **D10 — Nothing here touches Consta's model.** Consta keeps billing its
  integrators per validation under its own keys (validation D6); the
  platform's credit is the SaaS's book alone (pivot D20). The top-up
  validation uses a platform key issued by hand under US-V05 — it is a
  first-party consumer like any other.

## Schema

- `credit_entries` (append-only): `id`, `business_id`, `kind`
  (`welcome_bonus | top_up | validation_fee | fee_reversal | adjustment`),
  `cents` (signed), `payment_id` (nullable, **unique** where kind =
  `validation_fee`, and again where kind = `fee_reversal`), `top_up_id` (nullable), `granted_to_user_id`
  (bonus), `reason` + `author_user_id` (adjustment, operator-panel D5),
  `created_at`. Index `(business_id, created_at)`.
- `top_ups`: `id`, `business_id`, `submitted_by_user_id`, `claimed_cents`,
  `credited_cents` (nullable until valid), the proof columns the payment
  lifecycle already has (`proof_mode`, `tracking_key`, `sender_bank`,
  `transfer_date`, `proof_key`, `reading_check`, `consta_validation_id`,
  `consta_status`, `validation_attempts`, `next_validation_at`,
  `last_error`), `status` (`validating | credited | invalid | expired |
  superseded`), `created_at`, `confirmed_at`. Partial unique index on
  `tracking_key` where status not in (`invalid`, `expired`, `superseded`) —
  one transfer credits once (direct-payment D8's rule).
- `businesses`: + `fee_override_cents` integer nullable (D4).
- `payments.status`: + `queued_for_credit` (D8).
- `platform_settings` keys consumed: `validation_fee_cents`,
  `welcome_bonus_validations`, `negative_cap_cents`, `topup_min_cents`,
  `topup_clabe`, `topup_bank`, `topup_beneficiary` (operator-panel D1).

## Contract

| Route | Actor | Notes |
|---|---|---|
| `GET /credit` | any member | `{ balanceCents, feeCents, step: 'ok'\|'low'\|'empty'\|'paused', capCents, minTopUpCents, topUp: { clabe, bank, beneficiary } }` — the chip and the page read one thing |
| `GET /credit/entries?cursor` | any member | append-only history, newest first; kinds labeled |
| `POST /credit/top-ups` | owner (`credit: manage`) | proof via the same shapes as `POST /direct-payments/links/:token/pay` (receipt upload or manual data); 201 with the top-up row; 400 below `topup_min_cents` unless a CEP already says otherwise |
| `GET /credit/top-ups/:id` | owner | status for the page's calm wait |
| `/auth/me` | — | gains `credit: { balanceCents, step }`, computed in that handler alone — never in the session middleware (a SUM and three settings reads on every request was the wrong price; PR #132 review) |

Debit and pause live in `direct-payments/validation.ts`'s verdict
transitions (D2, D8) and in the sweep (D8's release); the shell never
computes money.

## UI Contract

- **Chip** (shell header, IA): amount; step label + icon per D7; tapping
  opens Configuración → Saldo y recargas. Owner and admin see it; operator
  and viewer see it too (a paused business is everyone's problem to know).
- **Saldo y recargas** (Configuración, owner only — D3 matrix): balance
  large with its step; "Recargar" opens the platform's CLABE/bank/
  beneficiary with copy buttons and the minimum, then the proof form (the
  pago page's two doors, restyled for desktop); a top-up in flight shows
  its calm wait; the entry list below (Bono de bienvenida · Recarga ·
  Validación · Ajuste) with amounts signed, `<Amount>` everywhere.
- **Banners**: "Saldo bajo" and "Sin saldo" as warning alerts in the
  shell; "Validación en pausa" as an error alert with "Recargar".
- **Pago page**: the `queued_for_credit` state per D9.
- es-MX only: Saldo, Recarga, Validación, Ajuste, "Validación en pausa".

## Scenarios

1. A business is born (`POST /businesses`) by a user with no bonus yet →
   one `welcome_bonus` row of `20 × fee`; balance $100.00; the same user's
   second business is born at $0.00 (D5).
2. A payment confirms → one `validation_fee` of −$5.00; the sweep retrying
   its reconnection later writes no second row (D2 idempotency).
3. A `partial` and an `unapplied` each debit once; an `invalid`
   (contradicted) debits once; an `expired` never does; a `superseded`
   row followed by the corrected row's `confirmed` → exactly one fee.
4. An edge rejection (bank outside the catalog) → no provider call, no fee.
5. Fee override: a business with `fee_override_cents = 300` is debited
   $3.00 while another pays $5.00 the same minute (D4).
6. The fee changes in `platform_settings` at 12:00; a payment confirming
   at 11:59 pays the old fee, one at 12:01 the new (D1).
7. Balance crosses 5 validations' worth → `step: 'low'`, chip says "Saldo
   bajo" with its icon; crosses 0 → `'empty'`, one email to each owner;
   crosses −$50 → `'paused'`, one more email; a second payment below the
   cap sends nothing (D7, once per crossing).
8. Paused: a new proof → `queued_for_credit`, no Consta call, link copy per
   D9; a payment already `validating` keeps its schedule and confirms.
9. A top-up submitted from the dashboard with the manual door → validated
   against the platform's CLABE with the platform key; valid CEP of
   $250.00 → `top_up` +$250.00; balance leaves the pause; queued proofs
   move to `validating` in arrival order (D8).
10. A top-up's CEP says $80.00 while the form claimed $100.00 → credited
    $80.00 (D6, the CEP's amount).
11. A top-up below the minimum is refused by the form at 400; the same
    transfer's CEP arriving through the sweep credits anyway.
12. A reused tracking key on a second top-up → refused (one transfer
    credits once).
13. An operator or viewer opens Saldo y recargas → the section does not
    render (D3 matrix); the chip still shows the step.
14. `GET /credit/entries` lists every kind with sign and label; the sum
    of the page equals `balanceCents`.
15. A contradicted row is charged; the same link's fresh submission
    confirms → one `fee_reversal` keyed on the contradicted row, net one
    fee for the transfer; booking the confirmation again reverses nothing
    twice (D2 amendment).

## Open items

1. **Abuse ceiling on the platform's provider cost** (from D2's rejected
   branch): 5 submissions per hour per link can cost the platform ~$600 a
   day per link in provider credits without a single fee. Measure on the
   pilot's traffic before deciding a ceiling (per link per day, or per
   business per day) — a rule with no measurement behind it is the class
   of thing this project does not ship.
2. **A lower fee for `not_found`/`expired`** — the owner's idea for
   sharing the "we don't know" cost fairly if it ever hurts: a second key
   (`unresolved_fee_cents`, default 0) debited at `expired`. Evaluate with
   item 1's data; a fee of 0 is the current decision.
3. **Statement export** (the accountant's job) — the CSV one-liner in
   SPEC.md's backlog covers credit entries too.

## Definition of Done

- [x] `credit_entries`, `top_ups`, `fee_override_cents` migrated
      (0020, additive only — no rebuild, so rule 12's seeded proof is not
      owed); `queued_for_credit` is an enum value with no SQL.
- [x] Scenarios 1–7, 13–15 automated (`test/prepaid-credit.test.ts`); the
      debit and reversal idempotency proven by rows. Scenarios 8–12
      (top-ups, the pause) land with their PR.
- [ ] The two emails send through Resend on deployed dev, once per
      crossing, to every owner.
- [ ] A real top-up on deployed dev with the owner's transfer to the
      platform's CLABE credits the CEP's amount.
- [ ] SPEC.md glossary: **Saldo** / `credit_balance`, **Recarga** /
      `top_up` adopted (pivot glossary).
- [ ] pivot.spec.md sequencing 3 ticked; TASKS.md phase 3 boxes ticked.

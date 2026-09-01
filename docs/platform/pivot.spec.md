---
status: in development
stories: [US-B01, US-B02, US-B03, US-B04, US-B05, US-B06, US-R01, US-R02, US-R03, US-R04, US-I01, US-I02, US-I03, US-L02, US-L03]
domain: platform
updated: 2026-08-31 # D19-D20 and Open items added in the PR #122 review
debt: []
---

# Spec: The pivot — the platform is the oracle

Decided with the owner on 2026-08-31, after contact with customers showed that
the real product is the payment link with automatic SPEI validation, not the
store network. The product becomes a **B2B SaaS that validates and reconciles
SPEI transfers**. It is strictly the **oracle of truth and the reconciliation
engine**: it says whether a transfer is real and what it pays. It never runs
the customer's operation itself — operational actions (reconnect the internet,
etc.) live behind **integrations**, and the business chooses them.

This is an umbrella spec. It fixes the foundation — entities, vocabulary,
configuration levels, revenue, sequencing — so that no child spec re-decides
it. Child specs (one per surface, with their own scenarios and contracts)
detail each part before it is built; this spec is their constitution. Every
decision below was made by the owner in the pivot interview (2026-08-31);
D19 and D20 landed in the PR #122 review round the same day.

## Glossary (pivot)

New and changed terms. The SPEC.md glossary adopts these rows when the
retirement PR (D15) lands; until then this table is the reference.

| Concept | UI copy (es-MX) | Code (English) | Never |
|---------|-----------------|----------------|-------|
| The paying tenant | **Negocio** | `business` (table `businesses`, was `isps`) | "empresa", "ISP" (an ISP is one kind of business) |
| What the business expects to collect | **Cobro** | `payment_request` | "factura" (see D16), "deuda" |
| The transfer that arrived and reconciled | **Pago** | `payment` (absorbs `charges` + `direct_payments`) | "cobro" (that is the expected side) |
| Reconciliation result of a payment | **Clase** (exacto / corto / excedente) | `reconciliation_class` (`exact` / `short` / `over`) | "parcial" as a status (short is a class; the status set stays) |
| Prepaid validation credit | **Saldo** | `credit_balance` (derived from `credit_entries`) | "monedero" |
| Adding credit | **Recarga** | `top_up` | "depósito" |
| Connection to the business's own system | **Integración** | `integration` | "plugin" |
| Actions paused, oracle still working | **Modo observación** | `observation_mode` | — |
| Platform-level rule set | — (operator only) | `platform_settings` | — |

Terms that leave with the store network (D15): Caja/`balance`, Entrega/
`cash_drop`, Movimiento/`ledger_entry`, Comisión (store share), Techo de
saldo/`balance_cap`, Invitación (store invitation). "Cargo por servicio"/
`service_fee` survives — it is the fee the business may pass to its payer
(direct-payment D19/D20 stay as written). Liquidación/`settlement` is
superseded by prepaid credit (D5) and its v1 goes to the store-network repo.

## User stories

Reserved in SPEC.md on 2026-08-31. Letters: **B** business & workspaces,
**R** reconciliation, **I** integrations hub; **L** keeps platform-level
stories.

## Decisions

- **D1 — One product, two doors.** Consta stays as the engine and the API
  door (developers, API keys, fixed fee); the SaaS — dashboard, links,
  integrations — is the no-code door of the **same** product. One brand, one
  tenant model, one billing. Consta stops being an "adjacent product": its
  Worker and D1 remain separate deployables, but no wall says a Devolada spec
  may not depend on it — the SaaS is its first-party consumer. **Rejected**:
  Devolada as a mere API client of Consta (duplicates tenant, settings and
  billing for one owner). *Revised 2026-08-31 (PR #122 review)*: the naming
  half of this decision moved to D19 — the original "no rename" rejection
  did not weigh the brand collision that D15 creates.

- **D2 — The expected amount is an entity: `payment_request` (Cobro).** A
  Cobro has business, customer, amount in cents, concept, due state, and a
  `source`. Reconciliation always compares a transfer against a Cobro,
  whatever the source. **v1 ships with one source only: the WispHub
  integration.** Manual creation, CSV import and the public API for Cobros
  are **deferred** — designed for, not built. **Rejected**: integrations as
  the only model forever (a business without a system could never say
  "cóbrale $650 a Juan"); free-amount links with no expected side (a
  validator, not a reconciler).

- **D3 — The permanent per-customer link survives; it lists open Cobros.**
  direct-payment D1/D8 stay: one non-guessable, permanent link per customer.
  The page lists the customer's open Cobros and reconciles the payment
  against them; "Sin adeudo" when there is nothing open. A one-off link per
  Cobro (fixed amount, expires when paid) is **deferred**. **Rejected for
  v1**: disposable per-payment links as the primary shape (loses the monthly
  return trip that already works).

- **D4 — A WispHub Cobro is a mirror, never the truth.** While the
  integration exists, the truth stays in WispHub — this preserves US-C06/
  US-C08 ("never charge a debt that no longer exists"). The mirror refreshes
  at three moments: when the link opens, immediately before a validation
  verdict is applied, and on a periodic sweep that feeds the dashboard list.
  Rows carry `source = 'wisphub'` plus the external ids. A future manual
  Cobro carries `source = 'manual'` and is its own truth. **Rejected**:
  import-once-then-own (a cash payment registered directly in WispHub would
  make us charge twice); never materializing (no pending-Cobros list, no
  customer filter without hitting WispHub, and it blocks the entity D2
  chose).

- **D5 — Revenue: fixed fee per confirmed validation, prepaid.** The Consta
  model, kept: a fixed fee in cents per **confirmed** validation — never per
  attempt, never a percentage (US-L03). The business holds a prepaid credit
  balance; every confirmed validation debits it at the fee current in
  `platform_settings`. The businesses' switch "customer pays the service fee
  / I absorb it" (direct-payment D19, PROFECO D20) is untouched — that fee
  is between the business and its payer, not ours. Settlement v1 (US-L01)
  is superseded; its code leaves with the store network. **Rejected**:
  monthly subscription (plans, limits and recurring billing before having a
  customer who asks); hybrid (most expensive to build and explain in year
  one).

- **D6 — Zero balance never punishes the payer.** The end customer already
  transferred to the business's CLABE; their proof validates even at balance
  zero, and the business goes **negative up to a cap** set in
  `platform_settings` (e.g. −10 validations). Warnings at 20% and at 0.
  Past the cap, links show "validación en pausa" — worded as the
  business's fault, never the payer's — and the proof is **queued**, then
  validated automatically on top-up. **Rejected**: hard stop at zero (the
  payer sees a broken service and the platform takes the blame); queue-only
  from zero (hours of delay for a paying customer while the business sleeps).

- **D7 — Top-ups are SPEI transfers validated by the platform itself.**
  Dogfooding: the business transfers to the platform's CLABE, submits its
  proof through the same flow its own customers use, and the credit lands
  when the validation confirms. Reuses the `pago` surface and the per-business
  reference idea from settlement v1. A **welcome bonus** (default ~20
  validations, a `platform_settings` value) funds the first links with no
  prior top-up. **Rejected**: card gateway first (~3.6% + KYC + contradicts
  the product's own pitch); both from day one (double integration before
  anyone asks).

- **D8 — Three configuration levels, and the partial question splits in
  two.** (1) **Platform** — what no business decides: fee, welcome bonus,
  negative cap, inheritable defaults, retry schedule, top-up CLABE. (2)
  **Business** — CLABE/bank/beneficiary, who pays the service fee, timezone
  and time format (settings D5–D7 survive), and the **reconciliation
  policy**: tolerance in cents for `exact`, how `over` is treated. That is
  the oracle's arithmetic, so it belongs to the business whether or not an
  integration exists. (3) **Integration** — API key and the **action
  side**: what each class triggers, including the reconnection threshold
  (% + floor $) for `short`. The integration inherits the business policy
  and may only harden it, never loosen it. Passkey ("huella o rostro") is
  **per user and device**, never a business setting. **Rejected**:
  everything at integration level (a business without one could not state a
  tolerance); everything at business level (the reconnection threshold is a
  rule of the operated service, not of the books). This unbraids
  partial-payment D2–D5, which today holds classification and action in one
  per-ISP knob.

- **D9 — Class → action mapping, plus a master switch.** The integrations
  page shows three fixed rows — `exact`, `short`, `over` — each with a
  select of the actions the adapter declares. WispHub v1: exact → register
  payment + reconnect; short → register, reconnect only at/above threshold
  and floor (today's `accion: 0|1`, partial-payment D5, unchanged in the
  adapter); over → register + reconnect (WispHub keeps the credit,
  partial-payment D10). `invalid`, `not_found`, `expired`, `unapplied`
  **never trigger an action** — there is nothing sensible to do in the
  operated system when no money arrived or nothing absorbs it. A master
  switch "ejecutar acciones automáticamente" turns all actions off:
  **modo observación**, where the oracle validates and reconciles while
  the business executes by hand — the trust ramp for a new customer, and
  the key stays configured. **Rejected**: switch only (the first "don't
  reconnect on short" request rebuilds this); full lifecycle-event panel
  (half the events have no sensible ISP action; it is the shape of the
  deferred generic webhook integration, D17, and can grow from this by
  adding rows).

- **D10 — One integration per business; one login, many businesses.** The
  integration config (key, mapping, switch) is singular per business — zero
  ambiguity about which system acts. An operator with two WispHub instances
  runs two businesses — and that is cheap because a single login administers
  N isolated workspaces and switches instantly (Better Auth organizations:
  central identity, per-business data isolation). **Rejected**: many
  integrations with a source-per-customer rule (the "two systems reconnect
  the same customer" class of bugs, bought before anyone needs it).

- **D11 — Full roles from v1.** Owner decision. Memberships (user ↔
  business) carry a role: **owner** (everything; one per business,
  transferable), **admin** (everything except CLABE, credit/top-ups and
  deleting the business), **operator** (sees payments and customers, shares
  links, views proofs, retries a failed action; no settings, integrations,
  users or balance), **viewer** (read-only; never sees the API key or full
  bank data). Permissions are per area, not per button. **Rejected**: single
  shared account (a passkey on one phone opens everyone's business); owner +
  one guest role (the person reviewing proofs at an ISP is rarely the
  owner, and the accountant needs read-only).

- **D12 — Onboarding minimum: name + CLABE + beneficiary.** Without a CLABE
  there is nowhere to transfer; without the beneficiary the proof cannot be
  checked (direct-payment D4). CLABE verification v1 = format + bank derived
  from the first digits; a real micro-transfer verification is a later
  improvement. Everything else starts from platform defaults, and the
  welcome bonus (D7) makes the first link work immediately. **Rejected**:
  email-only signup with broken links; a full checklist wall (a business
  with nothing to integrate would never finish it).

- **D13 — `platform_settings` is a table with an operator panel, and every
  change keeps its author.** What lives there: validation fee, welcome
  bonus, negative cap, inheritable defaults (tolerance, timezone, fee
  payer), the pending-CEP retry schedule, the platform's top-up CLABE. *(2026-09-01, operator-panel D1: the retry schedule is NOT a key — learned-retry governs it from Consta; the rest stands.)*
  Edited from a minimal `/operador` panel behind a `platform_operator`
  role; each change appends a row with date and author (append-only, the
  house rule). **Rejected**: constants + env vars (changing the fee is a
  deploy, and prices must not live in git history only); per-business
  visibility of these values beyond what bills them.

- **D14 — The rename is real: `businesses`, `payments`, and one payment
  table.** `isps` → `businesses`; `charges` and `direct_payments` merge
  into `payments` (class + status + proof evidence in one row); the es-MX
  surfaces say **Negocio / Cobro / Pago** per the pivot glossary. There are
  **no real production data** (owner confirmed), so migrations may be
  destructive — no dual-write, no backfill. **Rejected**: keeping
  `charge`/Cobro for arrived money (the business would read "Cobros" for
  money already received, and `charges` drags store columns); naming the
  entity `transfer` (names the mechanism; one day there is an OXXO deposit
  and the word is too small).

- **D15 — Extract first, from today's `main`; pivot second.** Step 1: the
  whole current `main` (full history) becomes the store-network repo
  **`devolada-red`** — tienda PWA, stores, cash-drops, cashbox, ledger,
  settlement v1, WispHub adapter, UI package — with its own CI and domains.
  That repo is the seed of the independent payment-points network product.
  Step 2: in this repo, one retirement PR removes those apps, routes, specs
  and marks US-C/K/E, US-A02/A03 and US-L01 as *retired → devolada-red* in
  SPEC.md, so `main` obeys the golden rule again **before** the first
  rename lands. Both repos are born from the same commit; nothing is lost.
  *Extended 2026-08-31 (PR #122 review)* — the retirement PR also prunes
  the cross-cutting docs: FRONTEND.md loses its Store-PWA and store-era
  Admin sections; `.design/devolada/` (brief, IA, TASKS of the old
  product) leaves with the network — the design tokens stay, they are
  product-agnostic; the root CLAUDE.md drops its stale "not created yet"
  lines; TESTING.md loses its store-surface citations; and
  ARCHITECTURE.md's Ledger section leaves **generalized, not deleted** —
  the append-only rule (never UPDATE/DELETE; balances derived with SUM)
  survives as a house rule, because `credit_entries` and
  `platform_settings` depend on it. The network is born with its own brand
  and domain (D19); `devoladapago.com` stays with the SaaS.
  **Rejected**: pivot first (weeks of dragging dead code and its tests
  through the rename); extracting only the PWA (a network without ledger and
  cash-drops is not a rescuable product).

- **D16 — "Facturas" means the receivables, and two neighbors are named to
  be excluded.** Reconciliation v1 = transfer vs Cobro, with the class as
  the verdict. **Backlog, explicitly not v1**: bank-statement import
  (CSV/Excel per bank) to catch transfers nobody reported — the real
  "banco vs libros", needs per-bank parsers. **Excluded, explicitly**:
  CFDI/SAT invoicing (PAC, certificates, complemento de pago — another
  product). Writing the exclusions here is what keeps them from leaking in.

- **D17 — No outgoing webhooks in v1.** Coherent with deferring manual
  Cobros: without a way to create expected payments, a webhook has nobody
  useful to call. Reserved in the backlog as the second card of the
  integrations page: "generic integration — Cobros API + signed
  `payment.reconciled` webhook", with its own spec when the first non-ISP
  business arrives.

- **D18 — The direct-payment channel survives intact; two things become
  integration config.** Everything measured and specced on the payer side
  keeps working unchanged: both proof doors (D2), claimed amount (US-D13),
  reading check (US-D14), validation-status UX (US-D12), learned retry
  (US-V16), trust layer (US-V15). `provisional-release` (US-D15) and the
  reconnection threshold stop being product-wide rules and become **WispHub
  integration configuration** — they only mean anything where there is a
  service to release.

- **D19 — The SaaS keeps the Devolada brand and the domain; the network
  is born with a new name.** *(Added 2026-08-31 in the PR #122 review;
  inverted the same day, owner decision.)* The collision D15 creates —
  two independent products sharing one brand — is resolved by exactly one
  product keeping the name, and the SaaS is that product. Three reasons:
  **brand follows the domain** (the permanent payment links, the most
  expensive promise to break, live at `link.devoladapago.com` and never
  move); **the brand equity already built lives on this side** (the
  domain, the live email sender, the pilot links sitting in WhatsApp
  chats — all direct-payment channel); and **the network is the cheap
  side to rename** — it has no operating point under the brand yet, and
  "de volada" (fast) describes payments, not a physical store network,
  which needs its own identity anyway. The naming shortlist from the
  original version of this decision — **Nelti** (Nahuatl *neltiliztli* =
  truth; coined, easiest at IMPI), Empata, Fedata, Constapago, Clabi;
  "Consta"/"Constata" discarded (domains taken; constata.eu is a real
  collision) — passes to the network's naming exercise at its birth. The
  internal name `consta` — folders, `apps/consta`, US-V ids — **never
  changes**: code is not brand. One gate remains, now **non-blocking**:
  verify and file "Devolada" at IMPI before the mark lands in contracts
  with businesses. One watch item from the pilot: written as one word,
  "Devolada" can be misread as "devolución" — if payers or businesses
  actually misread it, this decision returns to the table. Addresses:

  | Surface | Address | Note |
  |---|---|---|
  | Payer links | `link.devoladapago.com` | never moves while the promise stands. Was `pago.` until 2026-09-01: renamed (with `admin.` → `app.`) while the account rebuild (CICD.md D7) had every database empty — the only links ever sent (the 2026-08-20 demo, to the owner's own test customers) were rows of the old dev database and were already gone, so no working link was broken. Last cheap moment; the next rename breaks links pasted in WhatsApp |
  | Business dashboard | `app.devoladapago.com` | replaces the store-era `admin.` |
  | SaaS API (BFF) | `api.devoladapago.com` | |
  | Engine API door (developers) | `consta.devoladapago.com` | as already decided in SPEC.md |
  | Operator panel | `app.devoladapago.com/operador` | a route behind `platform_operator`, not a subdomain; `operador.` reserved if isolation is ever needed |

  **Rejected**: the SaaS renaming behind gates — the first version of
  this decision. It left the domain here but sent the brand away, so the
  SaaS would operate on `devoladapago.com` under a different name until a
  future migration: the double rename event, merely postponed, plus an
  IMPI gamble on a coined word. Also rejected: the network inheriting
  brand and domain (it would serve the SaaS's redirects forever — a
  permanent coupling between separated products); both products keeping
  the name (the collision stands).

- **D20 — One Consta key per business, and one money book.** *(Added
  2026-08-31, PR #122 review.)* Each business gets its own Consta API key,
  issued by the SaaS when the business is created, through a new
  **internal programmatic issuance door** — an explicit amendment to
  validation's US-V05 ("keys by hand"), scheduled for the phase 4 child
  spec: programmatic issuance is for the first-party consumer only;
  third-party keys stay manual. The key boundary keeps trust-layer D2's
  isolation honest — payer histories separate per business at the key,
  not by prefix discipline in SaaS code. Money has **one book**: the
  prepaid debit lives only in `credit_entries` (US-L03, D5); Consta's
  per-key validation log stays what US-V08 made it — provider-cost
  telemetry — and is never a second billing book. **Rejected**: one
  platform key with a prefixed `customerRef` (isolation by convention; a
  prefix bug mixes payer histories across businesses); billing
  authoritative in Consta (two money systems that can diverge, and the
  welcome bonus and negative cap do not exist in Consta's model).

## Schema (sketch — child specs own the details)

New and renamed tables; all money in integer cents, ids as today.

- `businesses` (was `isps`): name, CLABE + bank + beneficiary, fee-payer
  switch, timezone/time format, reconciliation policy (`toleranceCents`,
  `overTreatment`), Consta key reference (D20), status.
- `memberships`: user ↔ business, role (`owner|admin|operator|viewer`) —
  via Better Auth organizations.
- `customers`: per business, `source` + external ids (WispHub customer id /
  usuario), display name, phone; `payment_links.token` moves to point here.
- `payment_requests` (Cobros): business, customer, `amountCents`, concept,
  state (`open|paid|void`), `source` (`wisphub` v1) + external refs,
  `refreshedAt`.
- `payments` (merges `charges` + `direct_payments`): business, customer,
  request, `amountCents`, status (`validating|confirmed|invalid|expired|
  unapplied` + `partial`-era rows become class `short`),
  `reconciliation_class`, proof/CEP evidence columns as today, action
  outcome (`done|withheld|failed|observation`).
- `integrations`: business (unique), provider (`wisphub`), encrypted
  config, class→action mapping, `thresholdPercent` + `floorCents`,
  `actionsEnabled` (master switch), status.
- `credit_entries`: append-only (house rule) — `welcome_bonus | top_up |
  validation_fee | adjustment`; balance = SUM, never stored.
- `platform_settings`: append-only rows (key, value, author, createdAt);
  current value = latest row per key.

Leaving with `devolada-red`: `stores`, `cash_drops`, `ledger_entries`,
store-side auth artifacts.

## Sequencing (each phase = its own PRs, child specs where marked)

1. **Extraction** — ✅ executed 2026-08-31: `devolada-red` created from
   `main` at the tag `stores-network-final` (full history), and the
   retirement PR pruned this repo (D15). No feature work landed before it.
2. **Foundation rename** — D14 migrations, glossary swap in SPEC.md,
   Better Auth organizations + roles (child spec: business & memberships,
   US-B01–B03). A fresh design cycle (brief → IA → tasks) for the SaaS
   surfaces precedes this child spec — `.design/devolada/` left with the
   network (D15). No brand rename rides this phase: the SaaS keeps
   Devolada (D19).
3. **Prepaid credit** — ✅ 2026-09-01: credit entries, warnings, negative
   cap, top-up via validated SPEI, welcome bonus (prepaid-credit.spec.md,
   US-B04–B06, US-L03) + `/operador` panel (operator-panel.spec.md,
   US-L02).
4. **Cobros mirror & reconciliation surfaces** — payment_requests from
   WispHub, class computation, payments list + filters + proof view, link
   page lists Cobros (child specs, US-R01–R04). Includes Consta's
   programmatic key issuance (D20; amends US-V05 in its own decision).
5. **Integrations hub** — page, key management (reuses settings D1–D3
   verbatim), mapping UI, observation mode (child spec, US-I01–I03).

## Open items

Recorded from the PR #122 review (2026-08-31) so no child spec answers
them by accident:

1. **provisional-release D10 amendment (phase 5).** D18 moves the vote of
   confidence to the integration; provisional-release D10 still says
   "Settings". The phase 5 child spec amends it formally: the toggle
   lives on the integrations page as its own **pre-verdict** switch —
   never a fourth row of the class→action mapping (D9 is post-verdict);
   observation mode pauses provisional actions too; revocation
   (provisional-release D5/D8) is an adapter action, so both halves of
   the cycle live in one layer; the good-faith evidence stays
   adapter-agnostic oracle machinery — an adapter only declares whether
   it offers a provisional action.
2. **Consta programmatic key issuance (phase 4).** D20's internal door
   amends validation US-V05; the phase 4 child spec decides who may call
   it and how it is secured.
3. **IMPI filing for "Devolada" (non-blocking).** The SaaS keeps the
   name (D19); verify availability and file the mark at IMPI before it
   lands in contracts with businesses. Watch item: if payers or
   businesses misread "Devolada" as "devolución" during the pilot, D19
   returns to the table. The naming shortlist passes to the network at
   its birth.
4. **Per-tenant replay rejection as a Consta opt-in (backlog).** Today
   validation D4 stands: Consta reports `alreadyValidated`, the
   integrator decides. If it ever graduates: opt-in flag per request; its
   own error code, never the verdict `invalid` (a policy rejection is not
   a verdict — same doctrine as D9); evaluated **after** the provider
   call so learned-retry (US-V16) keeps the `valid` row that closes its
   latency bracket; formal amendment of validation D4 in its own
   mini-spec.
5. **Implementation note, phases 4–5: the internal event bus.** The
   action side may be built as an internal event architecture within
   these constraints: the adapter is **bidirectional** — SOURCE runs
   synchronously inside the reconciliation path (D4's refresh moments),
   ACTIONS go through the event; the event carries the reconciliation
   class, never just "validated"; dispatch is acknowledged — observation
   mode gates *before* dispatch and the outcome returns to the payment
   row (`done|withheld|failed|observation`) so an operator can retry;
   `invalid`/`not_found`/`unapplied` never dispatch. Outgoing webhooks
   and the public API remain D17's backlog — the bus grows into them by
   adding subscribers, amending nothing here.

## Out of scope (v1)

Manual/CSV/API Cobros (D2) · one-off links (D3) · outgoing webhooks and
generic integration (D17) · bank-statement import (D16) · CFDI (D16) ·
card top-ups (D7) · micro-transfer CLABE verification (D12) · more than
one integration per business (D10).

## Definition of Done (umbrella)

- [ ] `devolada-red` exists with full history and green CI; retirement PR
      merged here; spec-lint green with the retired IDs marked.
- [ ] A new business signs up, completes the D12 minimum, shares a link,
      and a real SPEI payment validates and reconciles against a WispHub
      Cobro — with the welcome bonus paying the validation.
- [ ] A short payment classifies as `short` by the business's own policy
      and the WispHub action obeys the mapping and threshold; observation
      mode validates without acting.
- [ ] Balance reaches the negative cap in a test tenant: links pause with
      the D6 copy, the queued proof validates on top-up.
- [ ] Every child spec above exists, is indexed, and every scenario cites
      its US-ID.

# Devolada — brief, stack and feature list

> **Seed document for the Spec Kit migration (PR1.A).** It is the input to the
> constitution (PR1.C) and the backlog for rebuilding the feature specs (PR3).
> It is deliberately short on *how*: the how is in the code, and the *why* is
> in `docs/legacy/`. Written 2026-09-08. Plan and rationale:
> [spec-kit-migration.eval.md](spec-kit-migration.eval.md).

## 1. Brief

**Devolada is the SPEI validation-and-reconciliation platform — the oracle of
truth about whether money arrived.** Operational actions live behind
integrations; the oracle itself never touches the money.

The end customer of a business opens their **permanent payment link**, sees what
they owe, transfers by SPEI **to the business's own CLABE** (never to ours —
no custody, no fintech licence), submits their proof, and the transfer is
validated against Banxico's CEP. On a confirmed verdict the service reconnects
on its own.

- **Today's pilot shape:** ISPs running WispHub. WispHub is one *integration*,
  not the product — no screen, row, column or error may assume it.
- **Market:** Mexico. The product ships in **es-MX**; identifiers and docs are
  English.
- **Business model:** prepaid validation credit. A confirmed validation debits
  the business's balance at the current fee — never per attempt, never a
  percentage.
- **Consta is the validation engine, not a second product** *(decided
  2026-09-08, supersedes the "adjacent product, own product shared house"
  framing in `docs/legacy/SPEC.md` and the owner decisions of 2026-08-17)*.
  It is one domain of Devolada. It is **not sold separately**: the validation
  API is offered **through devoladapago**, to its customers.
  - The **runtime boundary is unchanged** by this decision, because it is
    architectural and not commercial: `apps/consta` stays its own Worker with
    its own D1 and its own API-key auth, on `consta.devoladapago.com`. Nothing
    here licenses merging it into `apps/api`.
  - What the decision does retire is the *reason* the old rule gave for the
    boundary — "so extracting it to its own repo later stays a folder move".
    Whether the no-internals rule survives on architectural merit alone is
    open (§7).

**Out of scope, decided:** funds custody, dynamic CLABEs, percentage fees,
manual verification. The store network (payment points in corner stores) was
extracted to the `devolada-red` repo on 2026-08-31 and is not part of this
product.

### Pivot state (live)

The product pivoted on 2026-08-31 from a store network to the validation
platform. Phase 1 (extraction) is executed. Phases 2–5 are **in flight** —
this migration lands on a moving corpus, which is why the legacy tree is
archived rather than deleted.

## 2. Stack

Measured from the workspaces, not assumed.

| Layer | What |
|---|---|
| Monorepo | pnpm workspaces, `pnpm@10.29.3`, Node 22 |
| Runtime | Cloudflare Workers (`wrangler@^4`) |
| Data | Cloudflare **D1** (5 bindings) · **R2** (3 buckets) · **Workers AI** (2) · cron triggers on `apps/api` |
| API | **Hono** `^4.7` + **Drizzle** `^0.40` + **Zod** `^3.24` |
| Auth | **Better Auth** `^1.6` inside `apps/api` (BFF, HTTP-only cookies) |
| Frontend | **React 19** · **TanStack Router** `^1.95` + **Query** `^5.62` · **Vite 6** · **Tailwind v4** · shadcn primitives |
| Tests | **Vitest** `~3.2` · `@cloudflare/vitest-pool-workers` (real workerd + local D1) · React Testing Library + happy-dom · **MSW** `^2.7` · **Playwright** + axe |
| CI/CD | GitHub Actions only — trunk-based on `main`, PR → gate + preview, merge → dev, `v*` tag → prod with approval. **No deploy ever runs from a local machine.** |

**Not used** (relevant when choosing skills in PR2): KV, Queues, Durable
Objects, Vectorize, Hyperdrive, Turnstile.

```
apps/api      Hono + Drizzle + Zod on Workers + D1 — the only party talking to
              WispHub and to Consta; frontends consume the proxy
apps/consta   Consta: the SPEI validation engine — own Worker, own D1, own keys
apps/pago     Public payment page (no sessions; mobile-first)
apps/admin    Business dashboard (desktop-first)
packages/ui   Design tokens (Tailwind v4) + shared atoms
```

## 3. Invariants

Laws no feature re-decides. **These are not derivable from the code** — the
code has known violations (see `docs/legacy/TECH_DEBT.md`), so they are stated
here as law, not as description.

1. **Money is always integer cents.** Visible formatting comes solely from
   `formatMoney` / `<Amount>` in `packages/ui`.
2. **Money history tables are append-only.** Never UPDATE, never DELETE;
   corrections are counter-entries; balances are derived with SUM, never
   stored. Tests build scenarios with entries, the way production does.
3. **A payment is never rejected because the provider failed.** It is recorded
   and the action is queued on the same row with a visible status
   (`queued → reconnected | failed | withheld`).
4. **`businessId` on every business table.** The business is the tenant;
   multi-workspace since phase 2.
5. **API envelope**: `{ success: true, data }` | `{ success: false, error: { code } }`,
   with Zod validation at the edge.
6. **Sessions are checked against the DB on every request** — suspension is
   immediate revocation, not a token's remaining lifetime.
7. **No provider vocabulary escapes its adapter.** Rows, envelope and copy say
   `PROVIDER_*`; a business with no integration gets a coherent product.
8. **Design tokens are law** (`packages/ui/src/styles/tokens.css`): zero
   hardcoded values. `StatusBadge` is the only representation of domain
   statuses. Light and dark are two palettes, not an inversion. **Status is
   never communicated by colour alone** — always icon + text.
9. **Every test cites its user story** (`describe("US-D03: …")`), so coverage
   is traced by grep rather than faith.
10. **The measured integration contract wins over the vendor's guide.** Where
    `docs/legacy/integrations/*.md` and a vendor's official documentation
    disagree, the local file is right — it was measured.

## 4. Glossary

Single source of vocabulary. **One word per concept, no synonyms.** UI copy is
es-MX; code identifiers are English. This table is not recoverable from the
code — the class/status distinction in particular is exactly the kind of
nuance a code-derived document collapses.

| Concept | UI copy (es-MX) | Code (English) | Never |
|---|---|---|---|
| The paying tenant | **Negocio** | `business` (`businesses`; `businessId` everywhere) | "empresa", "ISP" (an ISP is one kind of business) |
| The transfer that arrived and reconciled | **Pago** | `payment` (`payments`) | "cobro" (that is the expected side) |
| What a customer owes, read live from the provider | **Cobro** | `payment_request` (route `/payment-requests`; **no table** — read live) | "cargo" (reserved for fees); a stored copy |
| The verdict against the ask | **Exacto / Pago parcial / Sobrante** | `reconciliation_class` (`exact/short/over`) | swapping the axes: **"Pago parcial"** is always the CLASS `short`; **"Pago incompleto"** is always the lifecycle STATUS `partial`. A payment can wear both — they answer different questions (what arrived vs. where the row is) |
| Actions paused, oracle still working | **Modo observación** | `actions_enabled = false` on `integrations` | "modo prueba"; "pausa" (that word is the credit pause) |
| Dispatching one observed row by hand | **Ejecutar ahora** | `POST /payments/:id/execute-action` | "forzar" (it never bypasses the threshold) |
| Who may do what inside a business | **Dueño / Administrador / Operador / Lector** | `role` (`owner/admin/operator/viewer`) | "usuario" as a role name |
| Prepaid validation credit | **Saldo** | `credit_balance` (derived: SUM of `credit_entries`) | "monedero" |
| Adding credit | **Recarga** | `top_up` | "depósito" |
| Fee paid by the end customer | **Cargo por servicio** | `service_fee` | — |
| Period's billed charge | **Cargo del periodo** | `invoice` / `invoice_cents` | "mensualidad" (the invoice can bill more than the plan) |
| Service reactivation | **Reconexión** | `reconnection` (`queued/reconnected/failed`) | — |
| Receipt with unique folio | **Comprobante** / **Folio** | `receipt` / `folio` | "ticket" |
| Device biometric sign-in | **Huella / rostro** | `passkey` | "biometría", "WebAuthn" (never in copy) |
| One-time email code | **Código** | `otp` | "token", "OTP", "enlace" (never in copy) |
| Customer's permanent SPEI page | **Link de pago** | `payment_link` | — |
| Bank-transfer payment | **Pago directo** | `direct_payment` (`validating/confirmed/invalid/expired/unapplied`) | "depósito" |
| Customer's transfer evidence | **Comprobante de transferencia** | `proof` | "receipt" (reserved for our folio) |

## 5. Feature list

The reconstruction backlog for PR3, one row per feature. **`Legacy source` is
the second input** — PR3 reads it *and* the code, and a disagreement between
the two is a finding, not a detail to smooth over. Reading only the code would
close every gap in the code's favour.

### Auth & identity
| Feature | Stories | State | Legacy source |
|---|---|---|---|
| Sessions, transparent refresh, revocation | US-S02 | current | `auth/sessions.spec.md` |
| Better Auth (email+code, passkeys, organizations) | US-S04, S06, S07 | current | `auth/better-auth.spec.md` |
| Business signup | US-S04, S06 | in development | `auth/isp-signup.spec.md` |

### Business & workspaces
| Feature | Stories | State | Legacy source |
|---|---|---|---|
| Business, memberships and roles | US-B01, B02, B03 | current | `business/business-and-memberships.spec.md` |

### Platform
| Feature | Stories | State | Legacy source |
|---|---|---|---|
| Pivot umbrella (sequencing, phases 2–5 live) | US-B01–B06, R01–R04, I01–I03, L02, L03 | in development | `platform/pivot.spec.md` |
| Prepaid credit (balance, entries, cap, top-up) | US-B04, B05, B06, L03 | current | `platform/prepaid-credit.spec.md` |
| Operator panel (global versioned settings) | US-L02 | current | `platform/operator-panel.spec.md` |

### Reconciliation
| Feature | Stories | State | Legacy source |
|---|---|---|---|
| Cobros read live from the provider | US-R01, R04 | in development | `reconciliation/cobros-live.spec.md` |
| Payments and reconciliation classes | US-R02, R03 | in development | `reconciliation/payments-and-classes.spec.md` |
| Debt truth (invariants in force) | US-C06, C08 (retired IDs) | decisions in force | `charges/debt-truth.spec.md` |
| Reconnection queue (the SPEI channel rides it) | US-C03, C04 (retired IDs) | in force | `charges/reconnection-queue.spec.md` |

### Direct SPEI payment
| Feature | Stories | State | Legacy source |
|---|---|---|---|
| Direct payment (link, proof, validation, reconnect) | US-D01–D06, D09, D11 | in development | `direct-payment/direct-payment.spec.md` |
| Partial payment | US-D10 | in development | `direct-payment/partial-payment.spec.md` |
| Admin Links view | US-D07 | in development | `direct-payment/admin-links-view.spec.md` |
| Returning-customer access | US-D08 | in development | `direct-payment/returning-customer-access.spec.md` |
| Validation-status UX (the calm wait) | US-D12 | in development | `direct-payment/validation-status-ux.spec.md` |
| Claimed amount (ask with what was transferred) | US-D13 | in development | `direct-payment/claimed-amount.spec.md` |
| Reading check (the second read) | US-D14 | in development | `direct-payment/reading-check.spec.md` |
| Provisional release | US-D15 | proposed | `direct-payment/provisional-release.spec.md` |

### Integrations
| Feature | Stories | State | Legacy source |
|---|---|---|---|
| Integrations hub (connect, map, observation mode) | US-I01, I02, I03 | proposed | `integrations/integrations-hub.spec.md` |
| Provider port (no screen assumes WispHub) | US-I04 | proposed | `integrations/provider-port.spec.md` |

### Admin dashboard
| Feature | Stories | State | Legacy source |
|---|---|---|---|
| Shell | US-S04, S06 (UI) | in development | `admin/shell.spec.md` |
| Charge feed | US-A01 | in development | `admin/charge-feed.spec.md` |
| Settings | US-A04 | in development | `admin/settings.spec.md` |
| Account hub | US-A05 | in development | `admin/account-hub.spec.md` |

### Consta — the validation engine (a domain, not a separate product)
| Feature | Stories | State | Legacy source |
|---|---|---|---|
| Validation (verdict, failure taxonomy, cost, keys) | US-V01–V08 | in development | `consta/validation.spec.md` |
| Proof extraction (receipt reading, clave shapes) | US-V09, V10, V11, V17 | proposed | `consta/proof-extraction.spec.md` |
| Trust layer (payer history beside the verdict) | US-V15 | proposed | `consta/trust-layer.spec.md` |
| Learned retry (when asking again stops being vain) | US-V16 | in development | `consta/learned-retry.spec.md` |

### Polish & reliability
| Feature | Stories | State | Legacy source |
|---|---|---|---|
| List states (never an empty state for an error) | US-P01 | in development | `polish/list-states.spec.md` |
| Dark mode and contrast | US-P02, P04 | in development | `polish/dark-and-contrast.spec.md` |
| Accessibility | US-P04 | in development | `polish/accessibility.spec.md` |
| Responsive | US-P03, P02, P04 | in development | `polish/responsive.spec.md` |
| Design review (one word, one meaning) | US-P05, P03, P04, P02, R03 | in development | `polish/design-review.spec.md` |
| Provider latency (a stalled provider never blocks) | US-P06 | in development | `polish/provider-latency.spec.md` |
| Presence freshness (no refresh button) | US-P07 | in development | `polish/presence-freshness.spec.md` |

**36 features · 60 live user stories · cited in 85 test files.** Those
citations (`describe("US-D03: …")`) are live references: any renumbering in
PR3 must carry the tests with it, or the trace dies silently.

### Retired identifiers — never reuse

| Range | Why |
|---|---|
| US-S01, S03, S05 · US-C01–C08 · US-K01–K04 · US-E01–E02 · US-A02, A03 | Store network, extracted to `devolada-red` (2026-08-31) |
| US-L01 | Settlement statement v1, superseded by the prepaid credit |
| **US-V12–V14** | Bank-email provisional match — **discarded before any code was written.** The measurements that killed it (per-bank email capability, DKIM survival through Gmail auto-forward, the SPIN hyphen that became TD-016) exist only in branch `feat/email-provisional-match` (PR #93, reverted) and in `docs/legacy/`. Nothing in the codebase records this. Without the record, it gets proposed again. |

## 6. What lives in `docs/legacy/`, and why it is not deleted

The previous documentation system — 36 living specs, ~120 000 words, **367
numbered decisions with their discarded alternatives**, cited 2 347 times
across the corpus. It is archived, not deleted, because **code says *what* and
never *why not***, and four kinds of knowledge in it cannot be recovered from
the codebase:

| In legacy | Why it cannot be regenerated |
|---|---|
| `SPEC.md` | The user-story registry, the workflow rules, and the record of what was retired and why |
| `<domain>/*.spec.md` | 367 decisions, each with the alternative that was rejected and the reason. Several killed features that never had code |
| `TECH_DEBT.md` | 19 × `TD-NNN` with payment conditions — **the list of places where the code and the law knowingly disagree.** TD-019: the 44px touch floor is asserted in two specs and `Button` is `h-10` = 40px. A document regenerated from the code would write "40px" and the debt would stop existing |
| `BUGS.md` | Defect and regression memory. BUG-021 (D1's 100-parameter cap) was found by *reading code against a spec*; no test fails, because the local D1 does not enforce the cap |
| `integrations/*.md` | Contracts **measured live** against third parties, at the cost of time and paid calls: `telefono` is read-only through WispHub's PATCH; apiCEP answers 401 for a bad credential and 400 for a bad body; where these disagree with a vendor guide, the local file wins |
| `ARCHITECTURE` · `FRONTEND` · `TESTING` · `CICD` | The cross-cutting laws §3 summarizes, with the incidents that produced each one |

`docs/legacy/integrations/apicep.md` is **not documentation** — it is a source
file. `scripts/gen-banks.mjs` generates `apps/consta/src/provider/banks.ts` and
`apps/api/src/direct-payments/banks.ts` from its bank vocabulary, and CI
verifies it with `gen-banks.mjs --check`.

Legacy is deleted in the migration's last PR, once PR3 has emptied it of value
— not before.

## 7. Open questions this brief does not answer

Recorded so PR1.C writes a constitution around what is decided, and PR3 does
not quietly invent an answer while rebuilding a spec.

1. ~~How an API integrator is billed.~~ **Decided 2026-09-08: an integrator
   is a `business` with prepaid credit like any other — there is no second
   billing path** (constitution, Principle IV). The API surface itself is
   later work and stays undefined for now; what is settled is the billing
   model it must arrive into, so no spec invents a parallel one meanwhile.
   `US-V05` still logs every validation under its API key, but as accounting
   under the one model rather than as Consta's own billing.
2. **Whether the no-internals rule survives.** `docs/legacy/SPEC.md` forbids
   any Devolada spec depending on Consta's internals, justified by keeping a
   future extraction to a folder move. That justification is gone. The
   boundary still has independent merit — separate Worker, separate D1,
   separate secrets, API keys instead of cookies — but "still a good idea" and
   "still law" are different claims, and only the second one belongs in a
   constitution.
3. **What the US-V actor is called.** The stories say "integrators
   (developers calling its API)" and "the operator". The integrator is still a
   real actor, but is now a devoladapago customer rather than a Consta
   customer. The glossary has no row for them.

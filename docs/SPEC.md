# Devolada — SPEC

The project's sacred index. **Golden rule: if it exists in the code but is not here, it's wrong.**

A network of payment points in neighborhood corner stores for ISPs running WispHub. The customer pays their monthly internet fee at the store around the corner, their service reconnects automatically within seconds, the store earns a commission with zero investment, and the ISP collects faster without field collection runs.

> **Pivot (decided 2026-08-31, proposed)**: the product becomes the SPEI
> validation-and-reconciliation platform — the oracle of truth; operational
> actions live behind integrations. The store network above moves to its own
> repo (`devolada-red`). Umbrella spec: [platform/pivot.spec.md](platform/pivot.spec.md).
> Until its retirement PR lands, the description above and every story below
> remain the truth of `main`.

## Spec-driven workflow rules (adapted)

1. Every new feature: interview → justified decisions (D1…Dn as mini-ADRs: decision + discarded alternatives + why) → reserve a US-ID here → write `docs/<domain>/<feature>.spec.md` → register it in this index **within the same PR**.
2. The `.spec.md` is updated with reality during development; it never forks.
3. **Lite path**: bugfixes, typos and copy tweaks carry no spec or plan — they carry an entry in `BUGS.md` (if production was affected) and a test. The threshold: if a business rule or contract changes, it's a spec; otherwise it's the lite path.
4. `.plan.md` files are **ephemeral**: deleted or archived on merge. Only the spec is maintained.
5. On completion: conscious debt → `TECH_DEBT.md`; production defects → `BUGS.md`.
6. Tests cite their story (`US-C02: charges the exact monthly fee…`) so spec coverage can be traced with grep.

## Glossary

Single source of vocabulary. UI copy is **es-MX** (the product ships in Mexico); code identifiers are English. One word per concept, no synonyms.

| Concept | UI copy (es-MX) | Code (English) | Never |
|---------|-----------------|----------------|-------|
| Customer payment transaction | **Cobro** | `charge` | "pago" (only on the end-customer receipt) |
| Store's continuous balance | **Caja** / **Balance** | `balance` (derived) | "corte" |
| Cash handover to the ISP | **Entrega** | `cash_drop` | "corte" |
| Fee paid by the end customer | **Cargo por servicio** | `service_fee` | — |
| Period's billed charge (invoice total) | **Cargo del periodo** | `invoice` / `invoice_cents` | "mensualidad" (the invoice can bill more than the plan — debt-truth D16) |
| Store's earnings | **Comisión** | `commission` | (never shown to the end customer) |
| Ledger entry | **Movimiento** | `ledger_entry` | — |
| MikroTik reactivation | **Reconexión** | `reconnection` (`queued/reconnected/failed`) | — |
| Receipt with unique folio | **Comprobante** / **Folio** | `receipt` / `folio` | "ticket" |
| Store's initial access | **Invitación** | `invitation` (`sent/accepted`) | — |
| Balance threshold | **Techo de saldo** | `balance_cap` | — |
| Device biometric sign-in | **Huella / rostro** | `passkey` | "biometría", "WebAuthn" (never in copy) |
| Platform's share collection | **Liquidación** | `settlement` | "corte" |
| One-time email code | **Código** | `otp` | "token", "OTP", "enlace" (never in copy) |
| Customer's permanent SPEI page | **Link de pago** | `payment_link` | — |
| Bank-transfer payment (no store) | **Pago directo** | `direct_payment` (`validating/confirmed/invalid/expired/unapplied`) | "depósito" |
| Customer's transfer evidence | **Comprobante de transferencia** | `proof` | "receipt" (reserved for our folio) |

## User Stories

### Auth & sessions (S)
- **US-S01** — As a store, I log in with phone + password and my session lasts for weeks on my device.
- **US-S02** — As a signed-in user, I never see "session expired" during normal operation: tokens renew on their own.
- **US-S03** — As an ISP, suspending a store revokes its access immediately, even mid-session.
- **US-S04** — As an ISP, I sign up with email + password and verify my email with a code (Resend) before operating. *(link → code 2026-08-15, better-auth.spec.md D4)*
- **US-S05** — As a store, I receive an invitation via WhatsApp/SMS and set my password **and recovery email** from the link. *(email added 2026-08-15, better-auth.spec.md D8)*
- **US-S06** — As any user, my email is my master recovery key: a code sent to it restores my access. As a store, the ISP can also re-send my invitation. *(rewritten 2026-08-15; was ISP-only and link-based)*
- **US-S07** — As any user, I can enable my device's fingerprint or face (passkey) and sign in with one touch, no email or password involved.

### Charges (C)
- **US-C01** — As a store, I search for the customer by ID, phone or name and see only the minimum needed to confirm their identity.
- **US-C02** — As a store, I charge the exact monthly fee with a visible breakdown (monthly fee + service fee).
- **US-C03** — As an end customer, my service reconnects automatically within seconds after paying; the store sees the status live.
- **US-C04** — As a store, a charge is never rejected because of WispHub failures: it gets recorded and the reconnection is queued with retries.
- **US-C05** — As an end customer, I receive a receipt via WhatsApp/SMS with a unique folio.
- **US-C06** — As an end customer, I can only be charged what I actually owe: a debt that no longer exists cannot be charged again. *(added 2026-08-16, found live: WispHub's summary label lags the invoices in both directions)*
- **US-C07** — As a store, when WispHub has no phone for the customer, I can save it once during the charge, and the receipt opens straight into their chat — this time and every time after. *(reserved 2026-08-17, backlog #3; WispHub write-back probed and impossible)*
- **US-C08** — As an end customer, I am charged exactly what I owe — the whole of it, including anything carried over from a payment that fell short — and a debt that was only half paid never becomes invisible. *(reserved 2026-08-20, found live: WispHub keeps a running account, so a partly paid invoice closes as "Pagada" and the rest survives in `saldo`, where nothing was looking)*

### Cash box (K)
- **US-K01** — As a store, I see my balance (the ISP's cash in my hands) and my commission for the current drop cycle; every number breaks down into its ledger entries. *(commission per cycle 2026-08-17, cashbox.spec.md D5 — was "accumulated"; the drop is the shopkeeper's corte)*
- **US-K02** — As a store, I record a cash drop that stays pending until the ISP confirms it.
- **US-K03** — As a store, I browse my immutable ledger (charges, commissions, cash drops).
- **US-K04** — As a store, the balance cap warns me as I approach it and blocks charges once exceeded, with a clear explanation.

### Cash drops — admin side (E)
- **US-E01** — As an ISP, I confirm receipt of a cash drop and the store's balance goes down.
- **US-E02** — As an ISP, I dispute a cash drop with a note if the amount doesn't match; both sides see the same ledger to resolve it.

### Admin (A)
- **US-A01** — As an ISP, I watch charges appear in real time with their reconnection status; failed ones demand my attention.
- **US-A02** — As an ISP, I register stores and send them invitations; I can re-send one while it hasn't been accepted.
- **US-A03** — As an ISP, I manage each store: commission, balance cap, suspend, view its ledger.
- **US-A04** — As an ISP, I configure my WispHub API Key (validated live), the service fee and the commission split.

### Platform (L)
- **US-L01** — As the platform, my share of every charge accrues per ISP and per month; as an ISP, I see each month's statement with exactly what to transfer and the reference to use. *(reserved 2026-08-17, backlog #1)*
- **US-L02** — As the platform operator, every global rule — validation fee, welcome bonus, negative-balance cap, inheritable defaults, retry schedule, top-up CLABE — lives in one versioned place I edit from an operator panel, and every change keeps its date and author. *(reserved 2026-08-31, pivot)*
- **US-L03** — As the platform, every confirmed validation debits the business's prepaid credit at the current fee — never per attempt, never a percentage. *(reserved 2026-08-31, pivot)*

### Consta (V)
Stories of the adjacent product (see "Adjacent product" below). Its users are
**integrators** (developers calling its API) and **the operator** (the owner).

- **US-V01** — As an integrator, I validate a SPEI transfer by its data (tracking key or reference number, date, amount, banks) and get a verdict backed by the Banxico CEP.
- **US-V02** — As an integrator, I validate a transfer from a receipt image URL and get the same verdict shape.
- **US-V03** — As an integrator, a transfer whose CEP is not generated yet reads as "pending" — never as a false "invalid" — so I can retry later.
- **US-V04** — As an integrator, a CEP that was already validated before comes flagged, so one proof of payment cannot be reused twice.
- **US-V05** — As the operator, I issue and revoke API keys by hand, and every validation is logged under its key so the fixed fee per transaction can be derived later.
- **US-V06** — As an integrator, when a validation cannot be completed I am told whether waiting can ever help and when to try again, so a permanent failure never becomes a long silence for my customer.
- **US-V07** — As an integrator, a request that cannot possibly validate — a bank name outside the provider's vocabulary, a malformed tracking key — is refused instantly with the accepted values, instead of costing a call and coming back "invalid".
- **US-V08** — As the operator, every call records what the provider charged, how long it took and how much quota is left, so the channel's cost and health are visible before it breaks.
- **US-V09** — As an integrator, a receipt image is read reliably and validated through the door that does not miss, so a customer who really paid is not told their transfer could not be verified.
- **US-V10** — As an integrator, when a receipt cannot be read I am told which field failed and nothing is charged, so I can ask the customer to correct one thing instead of leaving them waiting.
- **US-V11** — As an integrator, a receipt-door validation also returns what the provider's OCR read off the image — a second, independent reading I can compare against my own, clearly labeled as a reading and never a verdict. *(reserved 2026-08-26; gated on measuring whether the provider returns its reading on failures)*
- **US-V12 — US-V14** — *Retired 2026-08-27; never reuse these IDs.* They belonged to bank-email provisional match, discarded before any code: the pilot's bank (BBVA) sends no email for received transfers at all, coverage measured fragile by construction (2 of 4 banks usable, per-bank parsers forever), and the demand window was never measured. The full spec, the spike's measurements (per-bank email capability table, DKIM survives Gmail auto-forward, the SPIN hyphen that became TD-016) and the rejection reasons live in branch `feat/email-provisional-match` (PR #93, reverted). The successor is the adaptive retry schedule that pays TD-013.
- **US-V15** — As an integrator, a `pending` or `not_found` verdict for a payer I have named carries that payer's measured history — eventual-valid rate with its sample size, incidents, and my own tenant baseline — next to the verdict, never instead of it, so I can decide to release service early with my own threshold and my own risk. *(reserved 2026-08-27)*
- **US-V16** — As an integrator, a `not_found` or `pending` verdict tells me when asking again stops being spending in vain — a retry moment learned from measured traffic for my bank pair, omitted when the data is not there — so my schedule wastes neither credits on impossible attempts nor minutes in the gaps between my own slots. *(reserved 2026-08-27; gated on the phase-0 report: per-cell signal and the does-pending-bill answer; pays Devolada's TD-013 through its consumer PR)*
- **US-V17** — As an integrator, a reading whose clave does not fit its bank's learned shape warns me before I spend a credit, and a reading whose receipt names no bank suggests the one bank its clave's shape fits — a warning and a suggestion for my customer to confirm, never a refusal and never a guess sent onward. *(reserved 2026-08-30; per-bank shapes derived only from Banxico-confirmed claves, thresholds in proof-extraction D14)*

### Direct SPEI payment (D)
- **US-D01** — As an end customer with bank access, I open my payment link and see whether I owe anything; if I do, I see the exact amount and SPEI instructions (CLABE, beneficiary, amount, reference).
- **US-D02** — As an end customer, I submit proof of my SPEI transfer (screenshot or manual data) and the system validates it against Banxico.
- **US-D03** — As an end customer, my service reconnects automatically after my transfer is validated; I see the status live on the page.
- **US-D04** — As an end customer, if Banxico hasn't generated the CEP yet, the system keeps checking and I see "verifying" — never a false rejection.
- **US-D05** — As an ISP, I configure my CLABE, beneficiary name, and SPEI service fee from settings; payment links work automatically for all my customers.
- **US-D06** — As an ISP, I see direct SPEI payments in my charge feed alongside store charges, clearly distinguished.
- **US-D07** — As an ISP, I can search for a customer and share their permanent SPEI payment link via WhatsApp directly from the dashboard.
- **US-D08** — As an end customer, I get back to my payment page next month without asking my ISP for the link again.
- **US-D09** — As an end customer, I upload my receipt and it just works when it can; when it cannot, I am shown what was read from it and can correct it in seconds, instead of waiting hours for a rejection I cannot act on.
- **US-D10** — As an end customer, if my transfer falls short my money is not lost: it is applied to my debt, I am told in pesos exactly how much is missing, and my service comes back when the rest arrives. *(reserved 2026-08-20; today a short transfer is refused with no record at all, while the money is already in the ISP's account)*
- **US-D11** — As an ISP, I choose whether my customer pays the SPEI service fee or I absorb it, and either way my customer is shown a single number to transfer. *(reserved 2026-08-20)*
- **US-D12** — As an end customer whose transfer Banxico has not published yet, the page stays calm while the wait is normal, asks me to review my data only when it stops being normal, tells me when the next automatic attempt will run, and always lets me correct my data or start over with another receipt. *(reserved 2026-08-25)*
- **US-D13** — As an end customer, the amount that is checked against Banxico is the amount I actually transferred — read from my receipt or typed by me — so a transfer for a different amount than my debt is found and settled, never lost. *(reserved 2026-08-26; measured the same day: correct clave and date, three `not_found`, only because the system asked with the debt instead of the transfer)*
- **US-D14** — As an end customer whose transfer is not found on the first attempt, a second reading of my receipt happens within minutes: if both readings agree the page waits with evidence and never asks me by the clock; if they disagree I am asked to confirm exactly the disputed field against my receipt. *(reserved 2026-08-26)*
- **US-D15** — As an end customer whose transfer carries evidence of good faith, my service is not interrupted while Banxico confirms — reconnected if I was suspended, protected from the cut if I was current — and only a burned ride or proven bad faith closes that fast lane for me, never an error that was not mine. *(reserved 2026-08-27; mechanism gated on measuring WispHub's payment-promise API)*

### Business & workspaces (B)
Pivot stories (platform/pivot.spec.md); "business" is the paying tenant, was "ISP".

- **US-B01** — As a business owner, I sign up and start with the minimum: business name, CLABE (format/bank verified) and beneficiary name; everything else runs on platform defaults, and I can share payment links from that moment. *(reserved 2026-08-31, pivot D12)*
- **US-B02** — As a user, one login gives me all my businesses as isolated workspaces, and I switch between them instantly without re-entering credentials. *(reserved 2026-08-31, pivot D10)*
- **US-B03** — As a business owner, I invite people with a role — owner, admin, operator or viewer — and each role's reach is enforced: admin never touches the CLABE or the credit, operator operates payments, viewer only reads. *(reserved 2026-08-31, pivot D11)*
- **US-B04** — As a business, I see my prepaid validation credit, every entry that consumed or added it, and I am warned before it runs out. *(reserved 2026-08-31, pivot D5/D6)*
- **US-B05** — As a business, I top up my credit with a SPEI transfer validated by the platform itself: I transfer to the platform's CLABE, submit my proof, and the credit lands when it confirms. *(reserved 2026-08-31, pivot D7)*
- **US-B06** — As an end customer, my proof validates even when the business's credit hits zero — the business goes negative up to a cap; past the cap the link says validation is paused as the business's fault, never mine, and my proof waits and validates on top-up. *(reserved 2026-08-31, pivot D6)*

### Reconciliation (R)
Pivot stories (platform/pivot.spec.md); Cobro = what is expected, Pago = what arrived.

- **US-R01** — As a business with WispHub, my customers' debts appear as Cobros mirrored from WispHub — refreshed when the link opens, before a verdict applies, and periodically — so a debt paid elsewhere is never charged again. *(reserved 2026-08-31, pivot D4; carries US-C06/C08 forward)*
- **US-R02** — As a business, every confirmed Pago is classified against its Cobro — exact, short or over — by my own reconciliation policy (tolerance in cents, treatment of surplus), and the class travels with the payment everywhere. *(reserved 2026-08-31, pivot D8)*
- **US-R03** — As a business, I browse my Pagos filtered by status, date and customer, and one tap shows the transfer evidence behind any of them. *(reserved 2026-08-31, pivot)*
- **US-R04** — As an end customer, my permanent link lists my open Cobros and the exact amount to transfer; when I owe nothing, it says so. *(reserved 2026-08-31, pivot D3)*

### Integrations hub (I)
Pivot stories (platform/pivot.spec.md); the bridge to operational actions.

- **US-I01** — As a business, I connect my system from the integrations page: I pick WispHub, paste my API key — write-only, testable before saving — and see it validated live. *(reserved 2026-08-31, pivot D9; reuses settings D1–D3)*
- **US-I02** — As a business, I map each reconciliation class to an action my integration declares — and for a short payment, reconnection obeys my threshold percent and floor in pesos; invalid or not-found never triggers any action. *(reserved 2026-08-31, pivot D8/D9)*
- **US-I03** — As a business, a master switch pauses all automatic actions (observation mode): the oracle keeps validating and reconciling while I execute by hand, and my key stays configured. *(reserved 2026-08-31, pivot D9)*

### Polish & reliability (P)
- **US-P01** — As a user of either app, a failed request tells me so and lets me retry; it never shows me an empty state that says I have nothing.
- **US-P02** — As a user, the app follows my system's light or dark preference, and dark is a real palette, not an inversion.
- **US-P03** — As a store, the PWA works on a 360px phone; as an ISP, the admin works on my phone when I confirm a handover away from the desk.
- **US-P04** — As a user with low vision or a screen reader, every status reaches me as icon + text, contrast holds, and the feed announces what changed.
- **US-P05** — As a user of either app, every list row tells me what it is about, and every word and colour means one thing across both surfaces.
- **US-P06** — As a user of any of the three apps, a slow or stalled WispHub never leaves me waiting: the app answers quickly, or it tells me it could not reach the provider. *(added 2026-08-18, found live: WispHub stalls ~1 call in 8 and never recovers, and our adapter had no deadline)*

## Features by Phase

Operational detail in `.design/devolada/TASKS.md` (execution layer).

- **Phase 0 — Risk**: WispHub spike (payment → reactivation). ✅ executed 2026-08-13 (`.design/devolada/WISPHUB_SPIKE.md`). The router flip was **rehearsed on a real RouterOS 2026-08-17** (CHR linked to the demo tenant via WispHub's VPN; full suspend → charge → reactivate loop observed on the router — reconnection-queue.spec.md DoD); the pilot ISP's own hardware remains as final confirmation
- **Phase 1 — Foundation**: live tokens ✅ · shared atoms ✅ · API base with sessions ✅ · ISP signup/access ✅ (email live on `devoladapago.com`, reaching third parties — TD-011 paid)
- **Phase 2 — Store PWA**: shell ✅ · search ✅ · charge ✅ · live result ✅ · cash box ✅ · cash drops ✅ · ledger ✅ · special states ✅
- **Phase 3 — Admin Dashboard**: shell ✅ · live feed ✅ · stores ✅ · cash drops ✅ · settings ✅
- **Phase 4 — Supporting backend**: reconnection queue ✅ · receipts ✅ (manual `wa.me` until TD-003)
- **Phase 5 — Polish**: list states ✅ (US-P01) · dark mode ✅ (US-P02) · responsive ✅ (US-P03) · accessibility ◐ (US-P04 — markup, contrast and touch targets done; **keyboard order and visible focus are covered by no test**) · design review ✅ (US-P05) · provider latency ◐ (US-P06 — deadlines, parallel calls and a display-only cache; the deployed check with the live tenant is open)
- **Phase 6 — Better Auth migration** (better-auth.spec.md; spike passed 2026-08-15): spec ✅ · API ✅ · admin pages ✅ · tienda pages ✅ · custom domains ✅ (`*.devoladapago.com`, browser login verified) · passkeys ✅ (scenario 9 e2e in deploy-dev) — retired Agnostic Auth; TD-001 and TD-012 died by elimination

Every ✅ above means "built, specced and tested". None of them means "verified on
the deployed apps with a real ISP": those checks are the open boxes at the foot of
each spec, and they are what the pilot is for.

## Post-MVP backlog

Ideas live here as one-liners until one is picked up; picking one up means
reserving its US-ID above and writing its spec — the golden rule starts there,
not here. Owner's priority order (2026-08-16):

1. ✅ **Platform settlement** *(shipped 2026-08-17 as US-L01, platform/settlement.spec.md — statement v1; collection waits for Consta)* — the admin shows *"Para la plataforma quedan $6.00"*
   but nothing accumulates it and no flow collects it: today Devolada's share
   travels inside the ISP's cash and stays with the ISP. Needs: a per-ISP
   accumulated share (derivable from the ledger), a monthly cut visible in the
   admin, and the collection mechanism. Natural first consumer of the transfer
   validation service below.
2. ✅ **Commission per drop cycle** *(shipped 2026-08-17, cashbox.spec.md D5)* — "Tu comisión ganada" is the all-time sum and
   only grows; the drop is the shopkeeper's *corte*, so the card should read
   "desde tu última entrega" and restart with each confirmed drop. Derivable
   from the ledger (commission entries after the last confirmed `cash_drop`);
   query + copy, no schema change. The label must carry the period, or a $0
   morning reads as stolen commission.
3. ✅ **Customer phone capture** *(shipped 2026-08-17 as US-C07, charges/customer-phone.spec.md — capture at the counter; the deployed-dev check is still open)* — when WispHub has no phone, the receipt's
   `wa.me` opens with no recipient. Probe first whether `telefono` is writable
   via `PATCH /clientes/{id}/` (the same call that flips
   `auto_activar_servicio`): writing it back to WispHub keeps the data in the
   ISP's system and out of ours. Storing it ourselves is the fallback and a
   personal-data commitment to weigh. *(Probed 2026-08-17: `telefono` is
   read-only via the API — absent from the detail resource and the PUT
   schema, PATCH ignores it. The fallback is the spec.)*
4. **Period reports** — the ledger already holds every movement forever; what
   is missing are the aggregations: monthly cortes per store and per ISP
   (charges, commission, drops). Pure derivation, no new writes.
5. **WhatsApp Business API** — already decided as its own later feature
   (TD-003): real sending for receipts and invitations, `wa.me` stays as the
   fallback.
6. **Direct SPEI payment channel** — permanent payment link for banked
   customers to pay via SPEI without visiting a store; spec written
   (direct-payment.spec.md, US-D01–D06). Validates transfer against Banxico
   via Consta, triggers reconnection. Complementary to the store network
   (stores serve unbanked customers). Owner decision (2026-08-17): WABA
   under Devolada (centralized) for MVP, migrating to BSP model at scale.
   First consumer of Consta from the Devolada product.

**Adjacent product (own product, shared house): Consta, the bank-transfer
validation service.** Automates SPEI transfer validation under a fixed fee per
transaction; three reconciliation methods (attached-receipt analysis, dynamic
CLABEs, bank-reference validation); Hono + Cloudflare; orchestrates
infrastructure providers (e.g. CEP validation APIs) behind one API — no
percentage fees, no manual verification. Value: drops easily into the owner's
apps and third-party apps, sold as a Devolada Pagos service. Devolada
touchpoints: platform settlement (#1) is its first real use case, and a store
could one day settle its cash drop by validated transfer.

Owner's decisions:

- (2026-08-17) **The product is named Consta**, from "que conste" ("let it be
  on record") — the service's whole job is leaving proof that a payment
  exists, and the word echoes the CEP (Comprobante Electrónico de Pago).
  "Folio" was ruled out: it is already a reserved glossary word (receipts).
  The name is brand and folder; code identifiers stay English.
- (2026-08-16) **v1 = receipt analysis + bank-reference/CEP validation** —
  pure validation, money goes straight to the business's own account, no funds
  custody and no fintech-license territory; **dynamic CLABEs deferred** to a
  later phase with their own regulatory decision, since they normally imply a
  concentrator account and custody.
- (2026-08-17, revises the earlier "own repo" idea) **It lives in this
  monorepo** as `apps/consta`, under a subdomain of the same domain
  (`consta.devoladapago.com`). What it shares: the repo, the domain, the
  methodology (spec-driven + spec-lint, CI/CD through Actions). What it does
  NOT share: it is its **own Worker with its own D1** (its customers are
  developers with API keys, not cookie sessions; its own billing; its own
  secrets), its own deploy job, and its **own spec tree** under
  `docs/consta/` with US-IDs reserved here like any other domain. It is
  still not a Devolada *feature*: no Devolada spec may depend on its
  internals, only on its public API — so extracting it to its own repo later
  stays a folder move.

## Spec index

| Spec | Domain | Stories | Status |
|------|--------|---------|--------|
| [auth/sessions.spec.md](auth/sessions.spec.md) | auth | US-S01, US-S02, US-S03 | current |
| [auth/better-auth.spec.md](auth/better-auth.spec.md) | auth | US-S01, US-S02, US-S04, US-S05, US-S06, US-S07 | in development |
| [auth/isp-signup.spec.md](auth/isp-signup.spec.md) | auth | US-S04, US-S06 | in development |
| [auth/store-invitation.spec.md](auth/store-invitation.spec.md) | auth | US-S05 | in development |
| [store-pwa/shell.spec.md](store-pwa/shell.spec.md) | store-pwa | US-S01, US-S02, US-S03 (UI) | in development |
| [charges/customer-search.spec.md](charges/customer-search.spec.md) | charges | US-C01 | in development |
| [charges/charge-confirm.spec.md](charges/charge-confirm.spec.md) | charges | US-C02, US-K04 (partial) | in development |
| [charges/charge-record.spec.md](charges/charge-record.spec.md) | charges | US-C03, US-C04 | in development |
| [charges/reconnection-queue.spec.md](charges/reconnection-queue.spec.md) | charges | US-C03, US-C04 (retries) | in development |
| [charges/receipt.spec.md](charges/receipt.spec.md) | charges | US-C05 | in development |
| [charges/debt-truth.spec.md](charges/debt-truth.spec.md) | charges | US-C06, US-C08 | in development |
| [charges/customer-phone.spec.md](charges/customer-phone.spec.md) | charges | US-C07 | in development |
| [cashbox/cashbox.spec.md](cashbox/cashbox.spec.md) | cashbox | US-K01, US-K04 | in development |
| [cashbox/cash-drop-and-ledger.spec.md](cashbox/cash-drop-and-ledger.spec.md) | cashbox | US-K02, US-K03 | in development |
| [cash-drops/confirm-cash-drop.spec.md](cash-drops/confirm-cash-drop.spec.md) | cash-drops | US-E01, US-E02 | in development |
| [admin/shell.spec.md](admin/shell.spec.md) | admin | US-S04, US-S06 (UI) | in development |
| [admin/charge-feed.spec.md](admin/charge-feed.spec.md) | admin | US-A01 | in development |
| [admin/stores.spec.md](admin/stores.spec.md) | admin | US-A02, US-A03 | in development |
| [admin/settings.spec.md](admin/settings.spec.md) | admin | US-A04 | in development |
| [platform/settlement.spec.md](platform/settlement.spec.md) | platform | US-L01 | in development |
| [polish/list-states.spec.md](polish/list-states.spec.md) | polish | US-P01 | in development |
| [polish/dark-and-contrast.spec.md](polish/dark-and-contrast.spec.md) | polish | US-P02, US-P04 (contrast) | in development |
| [polish/accessibility.spec.md](polish/accessibility.spec.md) | polish | US-P04 | in development |
| [polish/responsive.spec.md](polish/responsive.spec.md) | polish | US-P03, US-P02, US-P04 (rendered) | in development |
| [polish/design-review.spec.md](polish/design-review.spec.md) | polish | US-P05, US-P03, US-P04, US-P02 | in development |
| [polish/provider-latency.spec.md](polish/provider-latency.spec.md) | polish | US-P06 | in development |
| [consta/validation.spec.md](consta/validation.spec.md) | consta | US-V01, US-V02, US-V03, US-V04, US-V05, US-V06, US-V07, US-V08 | in development |
| [consta/proof-extraction.spec.md](consta/proof-extraction.spec.md) | consta | US-V09, US-V10, US-V11, US-V17 | proposed |
| [consta/trust-layer.spec.md](consta/trust-layer.spec.md) | consta | US-V15 | proposed |
| [consta/learned-retry.spec.md](consta/learned-retry.spec.md) | consta | US-V16 | in development |
| [direct-payment/direct-payment.spec.md](direct-payment/direct-payment.spec.md) | direct-payment | US-D01, US-D02, US-D03, US-D04, US-D05, US-D06, US-D09, US-D11 | in development |
| [direct-payment/partial-payment.spec.md](direct-payment/partial-payment.spec.md) | direct-payment | US-D10 | in development |
| [direct-payment/admin-links-view.spec.md](direct-payment/admin-links-view.spec.md) | direct-payment | US-D07 | in development |
| [direct-payment/returning-customer-access.spec.md](direct-payment/returning-customer-access.spec.md) | direct-payment | US-D08 | in development |
| [direct-payment/validation-status-ux.spec.md](direct-payment/validation-status-ux.spec.md) | direct-payment | US-D12 | in development |
| [direct-payment/claimed-amount.spec.md](direct-payment/claimed-amount.spec.md) | direct-payment | US-D13 | in development |
| [direct-payment/reading-check.spec.md](direct-payment/reading-check.spec.md) | direct-payment | US-D14 | in development |
| [direct-payment/provisional-release.spec.md](direct-payment/provisional-release.spec.md) | direct-payment | US-D15 | proposed |
| [platform/pivot.spec.md](platform/pivot.spec.md) | platform | US-B01–B06, US-R01–R04, US-I01–I03, US-L02, US-L03 | proposed |

## Cross-cutting layers

- [ARCHITECTURE.md](ARCHITECTURE.md) — global architectural rules
- [FRONTEND.md](FRONTEND.md) — UI laws no feature re-decides
- [CICD.md](CICD.md) — pipeline: trunk-based, per-PR previews, auto dev, gated prod
- [TESTING.md](TESTING.md) — testing rules
- [BUGS.md](BUGS.md) · [TECH_DEBT.md](TECH_DEBT.md)
- [integrations/](integrations/) — third-party contracts (consumed, never re-decided)
- `.design/devolada/` — design layer: brief, IA, tokens, tasks (the design system lives in `packages/ui`)

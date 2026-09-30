# Research: payment-without-receipt

**Date**: 2026-09-30 · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Phase 0. Each section says what was **found** in the code (paths and lines
as of `20783f2`), then the **decision** the plan takes. Code comments cite
the decisions as `payment-without-receipt D<n>` (constitution I).

## What was measured, and what could not be

Nothing new was measured for this plan. It stands on the provider and
Banxico measurements of 2026-09-26/27
(`.specify/bugs/reference-finds-other-transfer/measurement.md`) and on the
code. Four things stay unmeasured and are named where they matter:

- which bank apps keep a numeric reference on a saved contact (spec
  Assumptions; the pilot measures it);
- whether a reference that starts with `0` survives every bank app (R3);
- whether the last four digits an app shows for the sending account are
  the CEP's (spec Assumptions; spec 013 assumes the same for receipts);
- how many of the pilot business's customers have no phone or share one
  (spec Assumptions; counted before tasks, R4).

## R1 — Where the phone comes from, and what counts as one

**Found.** The phone is WispHub's `telefono`, trimmed and nothing else
(`wisphub/client.ts:93`). It reaches the core as `WispHubCustomer.phone`
(`client.ts:53`) through `getCustomer` (`client.ts:413`) and the customer
lists. The one normaliser that exists is `toWhatsAppPhone`
(`receipt/index.ts:10-18`): ten digits, or `52…` / `521…` reduced, else
null. A link stores no phone (`links-on-demand-search` FR-010; asserted by
`test/links-identity-only.test.ts:87-92`); a payment copies it
(`payments.customer_phone`, `schema.ts:444`; `handler.ts:704-715`). An API
link has none (`handler.ts:662`; the `/v1` create takes no phone).

**Decision (D2).** A customer has a phone when its digits, with a leading
`52` or `521` removed, are exactly ten — the same rule as
`toWhatsAppPhone`, moved to the core as `nationalPhone(raw)` and used by
both. Anything else — empty, a landline of other length, two numbers in one
field — is **no phone**, and the customer gets an assigned number (FR-002).
Conservative on purpose: a wrong phone is a shared reference; a missing one
only costs the payer a number that is not their phone.

## R2 — Where the reference lives

**Found.** `payment_links` is identity-only by requirement
(`links-on-demand-search` FR-010): usuario or customerRef beside operational
fields, never a name or a phone (`schema.ts:118-128`). Links can also be
deleted — the one-time prune of never-used links (`links/prune.ts`) — and
recreated on demand, while a reference lives in the payer's bank app and
must survive both. There is no local table of a business's customers
(`wisphub/snapshot.ts:98-107`: the roster was retired).

**Decision (D1).** Two new tables (data-model.md):
`payer_references` — the number, its origin (`phone` | `assigned`) and its
state (`active` | `retired` | `blocked`); `payer_reference_customers` —
which customers hold it, keyed like the links are (`panel` + usuario, `api`
+ customerRef), so a pruned and recreated link finds its number again. The
digits are stored because they **are** the reference — shown to the payer
and printed on every transfer. The whole phone is never stored. The link
row is untouched; FR-010 of links-on-demand-search still holds word for
word.

## R3 — Which seven digits may not be a reference

**Found.** `isGenericReference` (`routes/direct-payments/schema.ts:19-30`)
calls a reference generic when it is one repeated digit, or when the whole
of it is a straight run up or down, three digits or longer — the defaults
bank apps fill in — and
the pay contract demands a clave beside one (`schema.ts:151`). The fixture
phone `5512345678` ends in `2345678`, which the rule calls generic. Banco
Azteca's default reference is the last seven digits of the receiving CLABE
(measurement item 9). Whether a leading `0` survives every app's numeric
field is not measured.

**Decision (D3).** Seven digits are not used as a phone reference, and are
never assigned, when they are: generic by `isGenericReference`; starting
with `0`; the last seven digits of any account the business has registered
to receive (`registeredAccounts`, `direct-payments/accounts.ts:96`,
retired ones included); or digits the business already holds in any state
(R6). Each case gives the customer an assigned number. The first two
refine the spec: a generic phone tail is exactly the reference strangers
type by default, and a lost leading zero is a transfer that is never
found. **FR-002 is amended by this plan** (spec.md, dated note); the
creator confirms it with the plan.

## R4 — Who is the same person

**Found.** Customers are read live. `searchCustomers` runs `__contains`
filters over `nombre`, `apellido`, `usuario`, `telefono`
(`client.ts:195, 333-368`), paged 10–50 (`client.ts:214-215, 380-385`);
calls take 0.4–0.6 s (`snapshot.ts:45-48`). The large tenant holds about
6,500 customers (`snapshot.ts:23`). A customer carries its name
(`WispHubCustomer`, `client.ts:47-69`). The adapter declares capabilities
through `integrations/registry.ts:23` (`capabilitiesOf`) and
`wisphub/receivables.ts:32,280`; the core asks by capability, never by
provider (constitution IX).

**Decision (D4)** — *amended 2026-09-30 after `/speckit-analyze` (U1): the
first version shared a phone's reference among up to three customers and
blocked it past three; the creator chose "same phone and same name"
instead.* A new adapter capability, `customersWithPhone(phone)`: the core
passes a national ten-digit phone and receives, for every customer whose
phone normalises to it, its key and its name. WispHub's adapter asks
`telefono__contains=<last seven>`, pages to the end, and compares after
`nationalPhone` — the filter's words and paging stay in `wisphub/`. The
core groups them by `personName(nombre, apellido)`: lower case, accents
removed, spaces collapsed.

- **One name** → one person; the phone's digits are that person's
  reference, shared by all their services.
- **Several names** → several people; nobody can tell whose phone it is,
  so each person gets an assigned number and the digits are `blocked`.
- **Later**, a customer whose phone and name match a person joins that
  person; a new name becomes a new person with an assigned number, and
  whoever held the phone's digits keeps them (FR-003).

The business corrects the grouping from the panel (D6). Names are read,
compared and forgotten: the core stores no name and no phone. A business
whose integration lacks the capability — or has none, like a business on
`/v1` alone — has no phone to compare, and every customer gets an
assigned number.

*Rejected:* storing a hash of the phone to compare locally. Ten-digit
Mexican numbers are few enough to reverse a hash in minutes, so it would be
the phone under another name. *Rejected:* reading the whole customer list
once per business to group phones — cheaper for a first backfill, but it
rebuilds the retired roster. *Rejected by the creator:* the business
deciding every repeated phone by hand, and the payer confirming their
services (the wallet).

## R5 — When a reference is born

**Found.** A panel link is made by `createLink`
(`routes/direct-payments/handler.ts:1787-1835`), which reads the customer
fresh (`getCustomer`) and calls `ensureLink` (`direct-payments/links.ts:121-173`);
the phone is at hand, used only for `waLink`. An API link is made by
`routes/v1/payment-links/handler.ts:69-129`. The payer's read is
`getLinkStatus` (`handler.ts:346-467`). Sweeps ride one trigger
(`src/index.ts:101-126`).

**Decision (D5).** `ensurePayerReference(business, customer)` runs in three
places: when a link is made (panel and API), when the payer reads a link
that has none, and in a backfill sweep that joins the every-minute cron —
twenty links per business per minute while `pay_by_reference` is on and any
link lacks a reference, silent when there is nothing to do. When the
adapter cannot answer (WispHub down, a refused key), no reference is made:
the link reads as today's flow and the next read or sweep tries again.
Never a guess: a reference born without its count could be a shared one.

## R6 — Assigned numbers, new numbers, joining and separating

**Found.** Nothing assigns numbers today. The unique index on
`payments.tracking_key` shows the house way to make a value unique per
business (`schema.ts:536-543`).

**Decision (D6)** — *amended 2026-09-30 after `/speckit-analyze` (I1, U1).*
An assigned number is drawn at random from seven digits whose first is
1–9, skipping every D3 case, and inserted under a unique index on
`(business_id, digits)` over **all** states — so no digits are ever reused
in a business, and a retry draws again on a clash. A reference row is one
person; `payer_reference_customers` says which customers are that person.
The panel's three actions, all `payments: operate`:

- **Nuevo número** — the person's row becomes `retired` (who, when) and
  every customer of that person moves to one new assigned number. The
  person keeps one number (clarified 2026-09-30).
- **Es la misma persona** — a customer joins another person whose customers
  share its phone; it takes that person's reference. If the customer was
  alone on an assigned number, that row is `retired`.
- **No es la misma persona** — a customer leaves its person and gets an
  assigned number of its own. When the person it leaves held the phone's
  digits and the two now have different names on one phone, the digits
  stay with the ones who kept them (FR-003: nothing changes by itself).

A row's `state` is `active`, `retired` (a new number or an empty person)
or `blocked` (a phone's digits shared by different people, held by no
one). No digits are ever used again.

## R7 — The confirmation door

**Found.** The typed door already exists: `POST /direct-payments/links/:token/pay`
with `transfer { trackingKey?, referenceNumber?, senderBank, date,
amountCents? }` (`schema.ts:110-197`) creates a `proofMode = 'transfer'`
row, `acceptedFrom = 'human'`, due at +2 min with the first attempt run
inline under `waitUntil` (`handler.ts:774-831, 993-1002`). It supersedes,
refuses identical attempts, budgets five rows per link per hour
(`handler.ts:88, 102-117`), and asks the page for nothing it does not
need. The date is not checked against today (`validation.ts:721`
falls back to the business's day).

**Decision (D8).** The confirmation is that door with one new field,
`transfer.referenceSource`:

- `"own"` — the server writes the link's active reference into
  `reference_number` and ignores any the client sent; the amount defaults
  to what the link asks; the day must fall between today − 30 and today in
  the business's timezone (STALE_TRANSFER_DAYS, `validation.ts:75`).
- `"typed"` — the "No puse la referencia" path (D11).
- absent — today's typed door, unchanged, for a business with the feature
  off.

`preselected: { bank, day }` rides along for SC-005 (D23). One route, one
lifecycle, every guard the typed door already has. *Rejected:* a separate
`/confirm` route — it would duplicate 550 lines of `submitPayment` or pull
them apart for no behaviour the field cannot carry.

## R8 — The shared-reference stops and a per-person reference

**Found.** Receipt-triage D7 stops a search by reference that another
payment of the business shares (reference, day, bank, amount, account) in
four places; spec 013 D12 narrowed three of them to a row with neither time
nor tail. The typed door's stop is unchanged in effect
(`handler.ts:750-761`), and so is the lifecycle's for typed rows
(`validation.ts:675-687`), because typed data carries neither. With a
per-person reference, two services of one phone at the same price on the
same day are twins by that rule, and the second confirmation would be
refused.

**Decision (D9).** A row whose `reference_source` is `own` never meets a
shared-reference stop: its reference belongs to one person, and every
transfer it finds is theirs (clarified 2026-09-30). A `typed` row meets
none either, because it never searches without a second fact (D11). Rows
with no `reference_source` keep today's four stops.

## R9 — Several matches on the payer's own reference

**Found.** The matcher (`consta/bundle/match.ts:80-180`) runs integrity
(amount, receiving account) → used → tail (three digits or more) → time
window, and says `all_used`, `none_fit`, `too_close` or `no_signal` when it
cannot decide. A typed row has no time and no tail, so a bundle on it ends
`no_signal` and asks for the clave (`validation.ts:892-903`).

**Decision (D10).** `matchCandidates` gains an `own` mode. After integrity
and used, it prefers the candidates sent from an account learned for the
service being confirmed (R10), then takes the earliest credited;
`match_trail.by` records `learned_account` or `earliest`. Nothing on the
own reference is undecided except `all_used` (every transfer found already
paid something), which keeps spec 013's `CEP_ALL_USED` ask. The others stay
in `cep_records`, found again by the payer's next confirmation.

## R10 — What Devolada has learned, and where

**Found.** Sender facts are split: `payments.sender_bank` on every row that
reached a CEP or a typed bank; `payments.sender_tail` (read from receipts);
`cep_records.sender_account` whole, but only for transfers a search
**without a clave** returned (spec 013 D5; `consta/bundle/store.ts:377-399`).
The provider sends `senderAccount` on every `valid`, clave searches
included (spec 013 D1). No query groups banks per customer today.

**Decision (D12).** "Learned" is a query, never a stored fate, as spec 013
did for "used":

- **banks, per person** — the distinct `sender_bank` of the confirmed or
  partial payments of every customer who shares the reference, most recent
  first, three at most. A bank suggestion follows the person's habit.
- **accounts, per service** — the `cep_records.sender_account` whose clave
  a confirmed payment of that customer adopted. An account decides money
  between services, so it stays with the service it paid.

A confirmation from an account that customer never used, when it has at
least one learned account, sets `payments.sender_account_new` for the
operator (FR-020).

The spec says the same since 2026-09-30 (FR-016 amended after the
analysis, I2 and I4): banks from every confirmed payment, past ones
included, per person; accounts from confirmations after launch, per
service.

**Decision (D13).** Spec 013 D5 widens: the engine keeps a `cep_records`
row for **every** `valid` of a business, clave searches included, through
the existing `storeSingleRecord`. From this feature on, every confirmation
teaches an account. Payments confirmed before it teach their bank only —
the account of a receipt searched by clave was never kept.

## R11 — "No puse la referencia"

**Found.** Nothing asks for the sending account's digits today; the pay
contract has no tail field (`schema.ts:110-197`). The matcher's tail step
accepts three digits or more and knows the CEP's account types
(`match.ts:41-46`; spec 013 D7).

**Decision (D11).** `referenceSource: "typed"` with the payer's
`referenceNumber` and an optional `senderTail` (four digits):

1. A reference that is another person's in the business (an `active`
   row) is refused with `409 REFERENCE_OF_ANOTHER` (FR-034); the payer's
   own is treated as `own`. `blocked` digits — a phone different people
   share — belong to no one and go on as any shared reference
   (*amended 2026-09-30, analysis I8*).
2. With no tail and no account learned for this service at the chosen bank,
   the request is refused with `409 SENDER_TAIL_NEEDED` before anything is
   created or billed; the page shows the four-digit field (FR-032).
3. Otherwise the search runs. The matcher's receipt side carries the
   service's learned accounts and the typed tail; learned accounts are
   compared whole, before the tail step. One fit confirms.
4. No fit: with a typed tail, nothing confirms and the page offers the
   clave and the receipt (FR-033); without one, the payer is asked for the
   four digits (`ask: "sender_tail"`), and the answer is fitted against the
   kept candidates without a call.
5. Several that neither picks → spec 013's undecided path, asking the
   clave's last four characters (D17).

## R12 — Rounds, and the neighbouring days

**Found.** There is no date alternation today: every attempt sends
`transfer_date` or the business's day (`validation.ts:712-721`); the fix of
bug `reference-search-printed-day` left the misremembered day to this spec's
User Story 2, scenario 5 (`.specify/bugs/reference-search-printed-day/fix.md:80`).
`validation_attempts` counts provider calls, written before each call
(`validation.ts:750-767`). The schedule is offsets 2, 8, 20, 45, 120, 360
minutes from `created_at`, plus 720 for a `not_found`, with learned-retry
moving the middle (`schedule.ts`). A correction is a new row that
supersedes the old one, with a new `created_at`.

**Decision (D14).** A **round** is one attempt that got an answer from
the provider. A `429`, an outage or a missing credential is not a round. Rows with a
`reference_source` count them in `payments.ladder_round`, carried from the
row a correction supersedes, so the ladder spans the chain:

| Round | When | What it searches |
| --- | --- | --- |
| 1 | inline, at confirmation | the day given |
| 2 | the schedule's first slot | the day given |
| 3 | its second slot | each neighbouring calendar day once — the day before, and the day after when it is not after today; never the operation day |
| 4 | its third slot, or at once on a correction | the day given (or the corrected one) |
| 5, 6 | the 2-hour slot and the last slot (360, or 720 on `not_found`) | the day given |

After round 6 the row expires. Without a correction, a clave or a receipt, a
payment spends at most seven calls (1 + 1 + 2 + 1 + 2), SC-003's ceiling.
A neighbouring day that finds the transfer confirms it like any other.
Rows without a `reference_source` keep today's schedule untouched.

## R13 — The asks

**Found.** The page opens its form from `disputedFields`, `error` and
`validationAttempts >= 5` (`PaymentPage.tsx:1016, 1038-1040`); the status
schema carries no ask of its own (`schema.ts:341-415`).

**Decision (D15).** `directPaymentStatusResponse` gains `ask`:
`"check_data"` once round 3 found nothing (FR-028); `"clave"` once round 4
found nothing (FR-029, the whole clave), and on a typed row whose four
digits fit none of the transfers found (FR-033); `"sender_tail"` (D11);
`"clave_tail"` (D17); null otherwise. When a typed row needs both, the
account's four digits come first: they are one question for the payer and
may decide alone; the clave's four characters only follow when the
digits leave several (*amended 2026-09-30, analysis I6*). Rows with a `reference_source` never
open the form by `validationAttempts`. "Todo está bien" is the page's own:
remembered per payment on the device, like the step (`step.ts`), with no
route and no state — the next round keeps its slot either way.

## R14 — Corrections

**Found.** `HOURLY_ATTEMPT_BUDGET = 5` rows per link per hour, corrections
included (`handler.ts:88`); an identical attempt returns the open row and
spends nothing (`handler.ts:153-215, 527-539`).

**Decision (D16).** `payments.correction_count`, carried along the chain
like `ladder_round`. A correction that would be the fourth to spend a search
and carries neither a clave nor a receipt is refused with `409
CORRECTIONS_EXHAUSTED`; the page then offers the clave and the receipt. The
identical-attempt rule already makes a correction that changes nothing
free.

**Decision (D25)** — *added 2026-09-30 after `/speckit-analyze` (U2).* A
row that carries a clave, a clave tail, or a receipt never counts toward
`HOURLY_ATTEMPT_BUDGET` and is never refused by it; confirmations and
corrections still count. Receipts keep `UPLOAD_HOURLY_BUDGET` (20 an
hour, `proofs.ts:28`). A clave spends a call each time, so a payer who
loops claves spends calls: the identical-attempt rule stops a repeated
clave, and the quota row (D19) shows the platform operator any burn.
Accepted by the creator, who chose that the safe exits are always open.

## R15 — The clave's last four characters

**Found.** `fitClave` (`match.ts:189-201`) fits a typed clave to the kept
candidates with O as 0, I as 1, one character missing; one fit confirms
without a call (spec 013 D11, `validation.ts:583-614`). The measured claves
that shared a bundle differ in their last characters (`…56772I`, `…73815I`).

**Decision (D17).** `fitClaveTail(tail, candidates)` — the same reading, on
the candidates' last four characters. `transfer.claveTail` rides a
correction that supersedes an undecided row; exactly one fit confirms from
the kept record, as D11 of spec 013 does. Two candidates sharing the four →
`ask: "clave"` (the whole). A tail is never searched at Banxico: it only
ever chooses among transfers already found.

## R16 — Provisional release for a confirmation

**Found.** `releaseEvidenceFor` gives `human` to a `proofMode = 'transfer'`
row with no `proof_key` (`provisional.ts:78`); the not_found and pending
paths call `maybeProvisionalRelease` (`validation.ts:1067-1081, 1104-1113`),
gated on the business's toggle, actions, a panel link and a clean history.

**Decision (D18).** No change: a confirmation is such a row, so FR-014 holds
by construction. What changes is copy: while a release stands, the asks say
the service stays and that the clave or the receipt settles the payment
before it expires (User Story 4, scenario 7). A receipt sent from the ask
supersedes the row, so an honest payer never ends with a burned ride.

## R17 — The provider's quota

**Found.** `X-RateLimit-Remaining` is stored on every call in
`validations.quota_remaining` (`apicep.ts:119-124`; `schema.ts:900-904`),
and nothing reads it. `/operador` has four tabs, none with the quota
(`OperatorScreen.tsx:22-28`). A `429` rides the schedule
(`validation.ts:813`). Reading the latest `quota_remaining` would read
`validations` across businesses — a fourth derived statistic, which
constitution V admits only by amendment.

**Decision (D19).** A platform row, `provider_quota` (no `business_id`,
like `platform_settings`), upserted by the adapter on every answer that
carries the header: remaining and when. `/operador` shows it in the
"Reglas" tab. Running out degrades by D14: a `429` is not a round, the
page keeps "Seguimos buscando", and nobody is asked anything because of it.

## R18 — The switch

**Found.** Business settings sit under `settings: update` (owner, admin;
`auth/role-matrix.ts`); the receiving account under `clabe: update`,
owner only.

**Decision (D20).** `businesses.pay_by_reference` (0/1, default 0), under
`settings: update`. Off: every path is today's, byte for byte. On:
references are born (D5), the page opens on the reference and the
confirmation, and the receipt stays one tap away (FR-039).

## R19 — Choices on a phone

**Found.** `packages/ui` has no choice-group atom; the payer page uses
native controls on purpose (`components/ui/native-select.tsx`, its D16);
the banks come from the generated `BANKS` (`direct-payments/banks.ts`),
sorted es-MX (`PaymentPage.tsx:345-356`).

**Decision (D21).** A `ChoiceGroup` primitive in
`apps/pago/src/components/ui/`, built on native radio inputs for the same
reasons as the native select: 48px items, tokens only, visible focus, the
chosen one marked by icon and text. The bank row offers the learned banks
(three at most) and "Otro banco", which opens the native select ordered by
the business's most used banks, then es-MX. The day row offers "Hoy",
"Ayer" (each with its date) and "Otro día", which opens a date field
bounded to today − 30 … today. "Confirmar pago" is the decisive 64px
action. The where-to-type line comes from `REFERENCE_HINTS`, a sibling of
`BANK_HINTS` under the same rule (receipt-triage D19): verified entries
only, with source and date; Banco Azteca is verified by hand before
launch.

## R20 — The business's own view of its customers' banks

**Found.** No query counts banks per business.

**Decision (D7).** The payer's link read carries `bankOrder`: the banks of
this business's confirmed payments in the last 90 days, most used first,
five at most. It reads one business's rows (constitution V) and names no
customer.

## R21 — The share message and `/v1`

**Found.** `shareText` and `apiShareText` (`handler.ts:1338-1343`) build
the WhatsApp message; `/v1`'s `paymentLink` is at
`routes/v1/payment-links/schema.ts:64-86`, mapped by `toPublic`
(`handler.ts:32-48`). The link read already has a field named `reference`:
the *concepto* (usuario or customerRef, `handler.ts:391, 453`), shown as
"Concepto" (`PaymentPage.tsx:1774`).

**Decision (D22).** The new number is called `payerReference` everywhere,
never `reference`, which keeps meaning the concepto. `shareText` gains a
line with it when the business has the feature on; `/v1`'s `paymentLink`
gains `payerReference` (seven digits or null), additive.

## R22 — Measuring the success criteria

**Found.** `match_trail` already records how a clave-less search was
decided (spec 013 D8).

**Decision (D23).** `payments.reference_source` names the path (own,
typed; null for a clave or a receipt), `match_trail.by` what decided it,
and `payments.confirmation` (JSON) the preselected bank and day next to the
ones sent, for SC-005. SC-001…SC-006 are queries over one business's rows;
none becomes a cross-business number.

## R23 — Tests and the sandbox

**Decision.** Lifecycle tests in workerd against a local D1, apiCEP at its
pinned origin with `fetchMock`, WispHub likewise for `customersWithPhone`;
the sandbox gains scenarios for a reference found on the given day, on the
day before, twice from one account, and never. Matcher tables for `own`
mode and `fitClaveTail` run without a database. The page and the panel get
component tests with MSW and axe; the browser layer measures the new
controls at 360, 768 and 1280 and the 64px action. Every test cites
`payment-without-receipt US<n>`.

## R24 — "Ya se usó para tu pago…"

**Found.** A transfer that already paid something answers
`TRANSFER_ALREADY_USED`, and the page says "Esta transferencia ya fue
utilizada para otro pago." (`PaymentPage.tsx:116`). The unique index on
`(business_id, tracking_key)` names the payment that holds the clave
(`schema.ts:536-543`). Nothing tells the payer which one.

**Decision (D24)** — *added 2026-09-30 after `/speckit-analyze` (C1).*
`directPaymentStatusResponse` gains `usedBy: { day, amountCents } | null`.
It is filled only when the payment holding the clave belongs to a customer
of the same person (the same reference); `day` is its confirmation day in
the business's timezone, `amountCents` what it received. Otherwise null,
and the page keeps today's sentence: nothing of another person's payment
reaches a payer (FR-013, FR-019).

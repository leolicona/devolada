# Research: confirmation-hierarchy

**Date**: 2026-09-30 · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Spec 012 is designed but not built. Its plan (D1–D26), data model and
contracts are the ground this feature stands on; the code below them is
today's `main` (`e2ec70c`). Each item says what was found, what is
decided, and what was set aside. Decisions are tabled in
[plan.md](./plan.md#decisions) and cited in code as
`confirmation-hierarchy D<n>`.

## What was measured, and what could not be

Nothing new was measured. The facts this plan leans on were measured by
others and are cited where used: the claves that shared one bundle differ
in their last characters (012 research R15: `…56772I`, `…73815I`); a clave
typed by hand took four tries (2026-09-26, 012 "Where this comes from").
How often a payer has the account's digits at hand, the clave, or neither,
is not known before the pilot; SC-001 and SC-004 measure it.

## R1 — The ties spec 012 already decides, and where

**Found.** 012 plans three matcher modes in the pure
`consta/bundle/match.ts` (012 D10, D11; `contracts/engine.md`):
`receipt` (today's), `own` (integrity → used → learned account → earliest)
and `typed` (integrity → used → learned account → typed tail). A
several-matches answer that none decides becomes spec 013's undecided row:
`validating`, `last_error = 'CEP_UNDECIDED'`, no slot, no expiry, the
candidates kept in `match_trail` (`validation.ts:892-906`). A later row that
supersedes it is fitted against those candidates without a call
(`validation.ts:583-614`, spec 013 D11), with `fitClave`'s forgiveness (O as
0, I as 1, one character missing; `match.ts:189-201`). 012 D17 adds
`fitClaveTail`, the same reading on the last four characters. The
account's digits are compared by `tailFits` (`match.ts:41-46`): a CLABE's
end, or the account number inside it; a card or a phone on its own end.

**Decision.** Keep every one of those pieces. This feature changes what
the `typed` mode is given (exclusive accounts only, D4), when the payer is
asked (after the search, D5), and how an answer is read (one function for
both ways, D6). The receipt mode is untouched.

## R2 — "Exclusive": which accounts may decide alone

**Found.** 012 D12 learns an account per service: `cep_records.sender_account`
where `clave` equals the `tracking_key` of a confirmed or partial payment of
that customer's links. Nothing reads the other direction — which customers
one account has paid. `cep_records` is indexed by `(business_id, clave)` and
`(business_id, credit_date, amount_cents)` (`db/schema.ts:1178-1179`), not by
account. A person is one phone and one name, decided when the reference is
born and stored as the customers that share a `payer_references` row
(012 D1, D4).

**Decision (D4).** Exclusivity is a query, taken at the moment of a tie and
over the candidates' accounts only (a bundle holds a handful). For each
candidate account: the confirmed or partial payments whose adopted clave
has a `cep_records` row from that account, their links' customers, and
those customers' reference. The account is **exclusive to this person**
when every one of those customers holds this person's reference. A customer
with no reference counts as another person unless it is the customer being
confirmed. The matcher receives two lists: `knownAccounts` — learned for
this service and exclusive — and `othersAccounts` — accounts that paid
another person. An additive index `cep_records (business_id,
sender_account)` makes the lookup a seek.

**Alternatives.** A stored `exclusive` flag on each account — rejected: it
goes stale the day the account pays someone else, and 012 D12 already chose
queries over stored fates. Exclusivity per service instead of per person —
rejected by the spec: two services of one person share their accounts
(Assumptions).

## R3 — The answer, and what a wrong one leaves behind

**Found.** 012 plans the account's digits as a correction that supersedes
the waiting row (012 T048) and the clave's characters as a `claveTail` that
requires `supersedes` (012 D17). A superseding row that fits nothing is not
planned: a typed whole clave that fits no kept candidate is searched at
Banxico (spec 013), but a tail is never searched.

**Decision (D6).** An answer is a new row that supersedes the waiting one,
carrying `senderTail`, `claveTail` or both, and the waiting row's
reference, bank, day and amount. It never calls the provider. One pure
function, `fitTieBreak`, reads it against the kept candidates:

- each given way picks the candidates it fits (`tailFits` for the digits,
  `fitClaveTail`'s reading for the characters);
- with both ways given, the answer fits only the candidates both fit — a
  way that fits nothing, or two ways that fit different transfers, make the
  answer fit nothing, so sending both never tests two guesses at once;
- exactly one fit confirms, unless only the digits picked it and its
  account is in `othersAccounts` (then the characters are asked, FR-013);
- several fits ask the way not yet given, then the whole clave.

A row whose answer fits nothing stays waiting in its place: `validating`,
`CEP_UNDECIDED`, the waiting row's trail copied onto it, so the next answer
supersedes it and still finds the candidates.

**Alternatives.** Answering on the waiting row itself, without a new row —
rejected: 012 and spec 013 already record every payer input as a row in the
chain, and the correction and round counters ride that chain.

## R4 — The limit on wrong answers

**Found.** Today a link allows five payment rows an hour
(`HOURLY_ATTEMPT_BUDGET`, `routes/direct-payments/handler.ts:88`, counted by
`attemptsInLastHour` over `payments_link_idx`). 012 D25 exempts a clave, a
clave tail and a receipt from it; the account's digits are not exempt. A
clave tail is tried only after the digits have narrowed the transfers
(012 D15), which is what made the exemption safe. With the characters
offered as a first answer, each tail is a free guess: at five a minute, a
four-digit tail among three transfers is found within the hour.

**Decision (D8).** At most three answers per link in 24 hours may fit
nothing, both ways counted together. The count is the link's rows with
`tie_break = 'none'` (D7) created in the last 24 hours, over the existing
`payments_link_idx`. A fourth answer that carries a tail is refused with
`409 TIE_BREAK_EXHAUSTED` before any row is written, and the status asks
the whole clave instead. Answers of either way never count toward the
hourly budget; this limit is what bounds them. The whole clave and the
receipt stay outside every limit, as the creator chose (012 D25).

Arithmetic, when a clave ends in four digits: three blind guesses among k
transfers tie one about 3k in 10,000 a day — under 1 in 1,000 for k up to 3.
Claves ending in letters are harder still.

**Alternatives.** Per payment instead of per link — rejected: a new
confirmation starts a new chain, so the limit would reset with each one.
Counting answers in the hourly budget — rejected: five an hour shared with
confirmations would block an honest payer's next confirmation, and it still
allows 120 guesses a day.

## R5 — The ask on the status

**Found.** 012 plans `ask: "check_data" | "clave" | "sender_tail" |
"clave_tail"` on `directPaymentStatusResponse`, derived from the row, never
stored (012 D15, data-model "The ask"). The digits are asked before the
characters.

**Decision (D9).** `ask` becomes `"check_data" | "clave" | "tie_break"`,
with `tieBreak: { ways, missed }` beside it: `ways` is the fields the page
shows (`["sender_tail", "clave_tail"]` by default; `["clave_tail"]` when the
digits already picked another person's account; `["sender_tail"]` when the
characters left several and the digits were not given), and `missed` says
that the last answer fitted nothing. When the link has reached the limit,
the ask is `clave`. The `sender_tail` and `clave_tail` asks are never built.

**Alternatives.** Two ask words for the two ways — rejected by the spec
(FR-011, clarified 2026-09-30): one screen, two ways.

## R6 — Searching before asking

**Found.** 012 D11 refuses a typed confirmation with `409
SENDER_TAIL_NEEDED` before anything is billed when no account is learned
at the chosen bank, so the digits travel with the search.

**Decision (D5).** The typed door searches at once. The clave's characters
can only be compared with transfers already found, and the spec asks after
the search (FR-011). `SENDER_TAIL_NEEDED` is never built. Cost: one provider
call for a typed confirmation that finds transfers and whose payer then
leaves — the call 012 spent after the digits anyway.

## R7 — The step's three recipes

**Found.** `@devolada/ui`'s one `Button` (`packages/ui/src/components/button.tsx`)
has the three declared sizes — decisive 64px, standard 48px, compact 40px —
and the variants `primary`, `secondary`, `ghost` and `link`. `link` has no
box and drops its height (`h-auto p-0`), so it is not a 48px target. Today's
quiet door on the proof step is a `ghost` button, 48px high, `text-sm`,
full width: "No tengo el comprobante a la mano" (`PaymentPage.tsx:1936-1939`).
012 plans the step in its own component, `ConfirmPayment.tsx`, with the
decisive **Confirmar pago** (012 D21).

**Decision (D2).** Option 1 keeps 012's recipe: the only `primary` /
`decisive` button of the step. Option 2 is a `secondary` / `standard`
button, "Usé otra referencia", right below it. Option 3 takes the recipe
of today's quiet door — `ghost`, 48px, `text-sm`, full width, last — in one
component, `ReceiptLink`, used everywhere a page with a reference offers the
receipt: the step, option 2's form, every ask, the expired view. The
receipt and today's manual door swap places, and no new recipe is made.

**Alternatives.** The `link` variant — rejected: it is not a 48px target
(constitution VI). A new "quiet" variant in `packages/ui` — rejected: the
`ghost` recipe already reads as a text link and is already the page's quiet
door.

## R8 — Where options 2 and 3 open

**Found.** Today's proof step shows the capture guide and the upload above
everything (`PaymentPage.tsx:1907-1914`). 012 plans step 2 as
`ConfirmPayment` and the typed path as today's `TransferForm` in `keys =
"either"` (012 contract, "No puse la referencia").

**Decision (D3).** The step has three views, switched in place: the
confirmation (option 1, the default), the typed form (option 2) and the
receipt (option 3: today's capture guide and upload, unchanged). Options 2
and 3 each carry **Volver** to the confirmation. Answering "No" to 012's
question opens the typed form. The view lives in the page's state, not on
the device: a reload lands on the confirmation, which is the order the spec
wants. On a link without a reference, the step is today's, receipt first.

The receipt view does not move the upload. The capture guide, the upload
mutation, the reader's refusals and receipt-triage's asks live in
`PaymentPage` and stay there; `ConfirmPayment` receives that block and
shows it in its receipt view. On a row that waits or has stopped, the same
`ReceiptLink` opens the same block on the re-submission path 012 T042
builds for the ladder. *Amended after `/speckit-analyze` (U1).*

## R9 — The copy

**Decision (D12).** es-MX, saying what was searched and never suggesting
the payer lied (012 FR-037):

| Where | Copy |
| --- | --- |
| Option 2 control | "Usé otra referencia" |
| Option 2 form, intro | "Escribe la referencia que usaste o tu clave de rastreo. Con una basta." |
| Option 3 | "Subir foto del comprobante" |
| Back from options 2 and 3 | "Volver" |
| Tie-break, one transfer found | "Encontramos una transferencia con esos datos. Para confirmar que es tuya, escribe uno de estos datos. Con uno basta." |
| Tie-break, several found | "Encontramos más de una transferencia con esos datos. Para saber cuál es la tuya, escribe uno de estos datos. Con uno basta." |
| Field, digits | "Últimos 4 dígitos de la cuenta o tarjeta con la que pagaste" |
| Field, characters | "Últimos 4 caracteres de tu clave de rastreo" |
| After a miss | "Ese dato no coincide con ninguna de las transferencias que encontramos. Revísalo en el detalle de tu transferencia." |
| Only the characters | "Para confirmar que esta transferencia es tuya, escribe los últimos 4 caracteres de tu clave de rastreo." |
| Only the digits | "Escribe también los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste." |
| Limit reached | 012's clave copy: "Para encontrarla con seguridad, escribe tu clave de rastreo. Puedes copiarla del detalle de la transferencia en tu app." |
| 012's refusals that name the receipt (`REFERENCE_OF_ANOTHER`, `CORRECTIONS_EXHAUSTED`) | their words end "…o sube la foto de tu comprobante", matching the link's words (analysis T1) |

"Genérica" appears nowhere in this feature's copy (FR-007).

## R10 — Reconciling spec 012

**Found.** 012's plan, data model, contracts and tasks are written; two of
its 56 tasks are marked (both dropped, nothing built). Its spec already
points here ("Where spec 017 changes this spec").

**Decision (D1).** One build. 012's tasks stay the backbone and keep their
order; the ones this feature changes carry a note in 012's `tasks.md`, and
this feature's `tasks.md` holds what they build instead. 012's plan, data
model and contracts carry dated amendment notes that name the decision
here. The amended 012 tasks: T021, T027 (step 2), T030, T035 (own mode with
exclusive accounts), T038, T041, T042 (asks and the receipt's place), T043–T049
(the typed path), T051 (the browser layer), T055, T056 (the transition's
ask).

**Alternatives.** Building 012 as written and changing it afterwards —
rejected: its typed path and asks would be built twice. Rewriting 012's
documents wholesale — rejected: the spec keeps this feature's decisions in
their own place, and a dated note keeps the trail.

## R11 — Tests, by the layer that can answer them

**Decision.** Constitution IV and VII, citing `confirmation-hierarchy US<n>`:

- **Pure** (`apps/api/test/consta/match.test.ts`): `fitTieBreak` tables —
  each way alone, both agreeing, both disagreeing, one fitting nothing,
  several, the digits picking another person's account; the `own` and
  `typed` modes given `knownAccounts` and `othersAccounts`.
- **Lifecycle** (`apps/api/test/confirmation-hierarchy.test.ts`, workerd, a
  real D1, apiCEP at its pinned origin): exclusivity across two people
  sharing an account; the search before the ask; an answer spending no
  call; a miss carrying the candidates; the limit per link over 24 hours
  and its refusal; the hourly budget untouched by answers; the transition's
  ask.
- **Page** (`apps/pago/test/confirmation-hierarchy.test.tsx`, MSW, axe):
  the three options in order with their recipes; the views and **Volver**;
  "No" opening option 2; the tie-break screen's fields by `ways`, its miss
  line, and the whole clave at the limit; the receipt link last on every
  view.
- **Browser** (`tests/e2e/pago.spec.ts`): at 360, 768 and 1280 in both
  themes — the decisive button 64px, option 2 and the receipt link 48px,
  focus measured, tab order equal to the visual order, no horizontal scroll.

## R12 — Measuring the success criteria

**Decision (D7).** Queries over one business, like 012 D23:
`match_trail.by` names what decided a confirmation (`learned_account`,
`sender_tail`, `clave_tail`, or a clave); `payments.tie_break` gives each
answer's outcome; `confirmation.tieBreakMisses` counts a confirmed chain's
misses. SC-001 and SC-004 read those; SC-005 reads the receipt rows of
links with a reference; SC-003 is the pay route's own latency for rows that
make no provider call.

## R13 — The payer's copy (User Story 4)

**Found.** A sweep of `main` at `77bc503` (four readers in parallel: the
page, the API's messages to payers, the specs' prescribed copy, the
design prototypes; then one reader who re-opened every hit):

- `apps/pago/src/features/pago/PaymentPage.tsx` renders **fourteen**
  payer sentences that name Banxico (lines 144, 848, 859, 860, 1515, 1634,
  1636, 1637, 1669–1670, 1681–1682, 2013, 2014, 2017, 2018), and every
  other mention in that file is a comment.
- The same page tells the payer to contact "tu proveedor de internet" in
  **nine** places (144, 1349, 1653–1654, 2013, 2014, 2017, 2018, 2021,
  `RootScreen.tsx:33–34`), says "tu internet ya volvió" in **six** (859,
  860, 1515, 1634, 1636, 1637), and is titled "Pago de internet" twice
  (`RootScreen.tsx:28`, `index.html:7`). Each assumes an ISP — a leak of
  constitution IX older than this spec.
- The sender-bank list comes from the generated `BANKS`
  (`apps/api/src/direct-payments/banks.ts:40` lists `BANXICO`), rendered by
  `TransferForm` (`PaymentPage.tsx:420`) and "Otro banco"
  (`ConfirmPayment.tsx:159`).
- The API sends the payer no text that names Banxico; the business's
  email and panel do, and stay (spec Assumptions).
- Spec 012's page contract prescribes "Seguimos buscando tu transferencia
  en Banxico." for the waiting ask; it is the one prescribed payer
  sentence that does.
- The page already knows the business's name on every link view
  (`data.ispName`: "Tu pago está en revisión con {ispName}",
  `PaymentPage.tsx:1816`).
- Six test files assert the old words, seventeen assertions in all:
  `apps/pago/test/pago.test.tsx:628, 648, 673, 939, 740, 762, 1112`;
  `apps/pago/test/payment-without-receipt.test.tsx:325, 563, 680, 686`;
  `tests/design/review-pr88.spec.ts:115, 126`, `review-pr90.spec.ts:188`,
  `review-pr94.spec.ts:142`, `review-pr104-105.spec.ts:132, 145`. The
  "protect face" test (`pago.test.tsx:784`) asserts the absence of
  `/ya volvió/i` and still holds with "tu servicio ya volvió".

**Decision (D13).** One verb per moment: *verificar* while a search runs,
*buscar* with "todavía no la vemos" while nothing is seen, *confirmar* for
the last word ("Solo falta confirmar", "Confirmamos", "No pudimos confirmar
… a tiempo"). The expired default already says "No pudimos confirmar tu
pago a tiempo", so every expired branch now speaks the same way. The
sentence-by-sentence map is in contracts/payment-page.md.

**Decision (D14).** The business by its own name. Every view that sends
the payer back has the link read, so "{negocio}" is its `ispName`. Where
no link is known — a link that does not exist, a device with none saved —
the payer is sent to "quien te envió el link". A service that came back is
"tu servicio", the word the expired view already uses ("tu servicio volvió
a pausa"). The tab and the no-link screen read "Tu pago".

**Decision (D15).** Filter, do not regenerate. `banks.ts` is generated from
the provider's own list (`gen-banks.mjs`, CI fails on drift) and serves the
API's validation too, so Banxico stays in it. The page lists
`payerBanks` — `BANKS` without `BANXICO` — in both places. A saved draft
whose bank is Banxico drops the bank, and the payer picks again.

**Decision (D16).** SC-006 is a test, not a review. A unit test in
`apps/pago` parses every `.ts`/`.tsx` file under `apps/pago/src` with the
TypeScript compiler API (already a dev dependency there) and reads every
string literal, template literal and JSX text, plus the `<title>` of
`apps/pago/index.html`; it fails on `/banxico/i` or `/internet/i` and
names the file and line. Comments are not strings, so the decision trail
that explains Banxico stays where it is.

**Alternatives.** A CI script beside `pending-lint.mjs` — rejected: one
test in the app's own suite runs in the same CI step, with no new gate to
name. Removing `BANXICO` from `banks.data.md` — rejected: the file mirrors
the provider's vocabulary, and the admin and the API read it too.

## R14 — The page's design (User Story 5)

**What was asked.** The creator compared five designs on the design
canvas "Confirma tu pago — propuesta" (A and B on 2026-09-30, C, D and E
on 2026-10-01) and chose E. About A–D: they showed neither the account the
business chose nor the payer's reference, and the page should teach a
little.

**What the page already has** (`main` at `77bc503`):

- The account is one, by kind: `collectAccount { kind: "clabe" | "card" |
  "phone", value, bank }` (receipt-triage D29), shown as a `CopyField`
  labelled by `ACCOUNT_LABEL` (`PaymentPage.tsx:577-581`), with the bank
  beside a card or a phone (`:2342`) and under "Ver los demás datos" for a
  CLABE (`:2414`).
- "Tu referencia" is a `CopyField` row beside the account (`:2347-2354`),
  grouped `234 5678`, copying the seven digits, with the phone's note
  when `fromPhone`; below it, in a well, `referenceHint` (012 D21: a bank's
  own words only when verified, `reference-hints.ts`) and the contact tip.
- Step 2's bank and day are `ChoiceGroup` rows: native radios, 48px,
  icon and "Elegido" (`choice-group.tsx`, 012 D21).
- The motion vocabulary and its tokens: `--duration-fast` 150ms,
  `--duration-normal` 250ms, `--duration-slow` 400ms, `--duration-breath`
  2400ms; `Reveal` and `Pending` carry the cross-fade and the breath.

**Decision (D17).** E is built from these pieces and the tokens, nothing
new in `packages/ui`: what E draws as chips, tags, the reference's box and
the example uses the radius, size, colour and duration tokens that exist.
Two text-on-surface pairs are new and join `contrast-lint.mjs`: the link
ink and the body ink on the accent-subtle surface (the tags and the
reference's box). Measured by hand on 2026-10-01: light `#0f766e` on
`#e4f2f0` is 4.8:1; dark `#34c4b5` on the subtle surface over the dark
card is 6.2:1. Both pass AA for body text.

**Decision (D18).** Chips keep the radios. 012 D21 chose native radios for
reasons that still hold: one tab stop per group, the arrow keys, the
reader's own "seleccionado, 1 de 3", and no script weight on a public
page. A `chips` layout of `ChoiceGroup` changes only how each label is
drawn. *Rejected: toggle buttons with `aria-pressed`, as the prototype
drew them. They need one tab stop each and say nothing about a group.*

**Decision (D19, D20).** Step 1's order follows E. The example is CSS
only: a stepped `clip-path` per value, so the text is in the DOM from the
start and a reader hears the filled form. Replay remounts it by key, so no
timer is kept. *Rejected: typing the text in with a timer. That needs
state per character, and under reduced motion it would have to be turned
off separately.*

**Decision (D21).** Option 2 takes the confirmation's choices. 012 built
the three views as `proofView` in `PaymentPage` (Phase 9, T036), so the
choice moves up beside it and both views read it. The creator accepted
the change to FR-003 by choosing E.

**Decision (D22).** The wait's steps follow the row. A step list driven by
a timer would claim progress the server never reported; the row's status
is what the page knows. The tie-break's illustration uses placeholder
marks, because any real digit or character of a transfer found would hand
a guesser the answer (FR-018).

**Measuring SC-007.** The share of confirmed payments, on links with a
reference at the pilot business, whose confirming row has
`referenceSource = 'own'` — one query over `payments` by business, in the
two months after launch.

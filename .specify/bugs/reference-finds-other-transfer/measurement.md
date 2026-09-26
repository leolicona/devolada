# Measurement: what apiCEP answers when asked by reference (2026-09-26)

- **Instrument**: `scripts/apicep-probe.sh` with
  `scripts/apicep-probe.cases.example.json` (lot 1, E1–E7) and
  `scripts/apicep-probe.cases.lote2.json` (lot 2, F1–F8), run by the
  product creator's request on 2026-09-26 between 18:22 and 18:24 UTC
  against `https://api.apicep.cloud/validate-transfer`.
- **Cost**: 15 paid calls. The token's quota is **50 calls per month**
  (`x-ratelimit-limit`); it went from 15 to 0 and resets 2026-10-26.
- **Raw answers**: kept only on the creator's machine, in the git-ignored
  `apicep-probe-lote1/` and `apicep-probe-lote2/`. They carry the sender's
  name, RFC and account, which is why this file keeps claves and times and
  nothing else.
- **Serves**: this bug, `reference-search-business-day`, and the spec that
  will make a reference the primary key of a payment.

All transfers are the creator's own: Azteca (and one Nu) → the demo BBVA
account ending 417, $3.00 unless stated, referencia 9784417 unless stated.

## Answers

| # | Question the assessments left open | Answer |
| --- | --- | --- |
| 1 | What does a reference that matches several transfers return? | `status: invalid`, `banxicoConfirmed: true`, no `cepDetails`, and a `downloads.cepPdf` that is a **ZIP holding one Banxico CEP per match**. Never a `422`. |
| 2 | Do the amount and the sending bank tell same-reference transfers apart? | **Yes, both.** $3.00 and $3.01 with one reference gave two different valid CEPs; Azteca and Nu with one reference and amount gave two different valid CEPs. |
| 3 | Does the CEP include the operation's time? | **Yes.** `cepDetails.processingTime` is `HH:MM:SS`, and `cdaChain` fields 4–6 are operation date, calendar date, time (`28092026|26092026|114430`). |
| 4 | Does the 18:00 / weekend rule hold? | **Both hold for filing**: Saturday transfers carry operation day Monday 28, and Thursday 23:40–23:48 transfers carry operation day Friday 25 (their CEPs, opened below). **The search is another matter**: the credit (calendar) day found every transfer; the operation day found the Saturday ones (28) but not the Thursday-night ones (25). Unexplained; see below. |
| 5 | Does direct mode hide a CEP already validated? | **No.** It answers `valid` with `cepPreviouslyValidated: true`, on the clave door and on the reference door alike. |

## Every case

| Case | Asked | apiCEP said | Read as |
| --- | --- | --- | --- |
| E1 | ref 9784417, 2026-09-28, $3, Azteca | invalid, Banxico confirmed, ZIP | several matches (three, see below) |
| E2 | ref 9784417, 2026-09-25, $3, Azteca | valid, already validated, `…45184062I`, 07:19:52 | the one Friday-morning transfer |
| E3 | ref 9784417, 2026-09-26 (Saturday), $3, Azteca | invalid, Banxico confirmed, ZIP (3 CEPs by size) | the calendar day finds the Monday matches too |
| E4 | ref 9784417, 2026-09-28, **$3.01**, Azteca | invalid, Banxico **not** confirmed, no file | no transfer of that amount: the amount filters |
| E5 | clave `260928071156210101I`, 2026-09-28 | valid, already validated, 07:11:20 | a validated CEP is not hidden |
| E6 | ref 9784417, 2026-09-24 (Thursday), **$5**, Azteca | invalid, Banxico confirmed, ZIP (3 CEPs, opened below) | the three Thursday-night $5 transfers, found by their credit day |
| E7 | ref 9784417, 2026-09-25, $5, Azteca | invalid, Banxico not confirmed, no file | **not found by their operation day**, although the three CEPs say 25 |
| F1 | ref 5830261, 2026-09-28, $3, Azteca | invalid, Banxico confirmed, ZIP (2 CEPs, opened below) | a fresh exact duplicate is ambiguous from the first call |
| F2 | same as F1 | same as F1 | asking again does not pick one |
| F3 | ref 4917358, 2026-09-28, $3, Azteca | valid, first time, `…58283781I`, 11:44:30 | the bank filters (Nu's twin is F8) |
| F4 | ref 4917358, 2026-09-26 (printed Saturday), $3, Azteca | valid, already validated, same clave as F3 | the calendar day finds it too |
| F5 | ref 6274089, 2026-09-28, $3, Azteca | valid, first time, `…58297980I`, 11:45:59 | base for F7 |
| F6 | clave `260928071158283781I`, 2026-09-28 | valid, already validated (by F3) | a reference validation marks the clave as used |
| F7 | ref 6274089, 2026-09-28, **$3.01**, Azteca | valid, first time, `…58309423I`, 11:46:37 | the amount filters |
| F8 | ref 4917358, 2026-09-28, $3, **Nu** | valid, first time, `NU3AN02K6CS59GIBCF1CQ696SE8Q`, 11:47:58 | the bank filters |

Timing: a found CEP took 3.8–8.2 s; an ambiguous answer 4.4–5.7 s; a
clean "not found" 0.6–1.7 s.

## The ambiguous answer, opened (E1)

The file behind `downloads.cepPdf` is served as `application/pdf` but is a
ZIP. E1's holds three one-page CEPs, `CEP-20260928-<clave>.pdf`, each
signed by the receiving bank, with operation day 28, credit day 26,
credit time, referencia, clave, chain and seal:

| Clave | Credit time | Amount | Validated before this run |
| --- | --- | --- | --- |
| `260928071156202040I` | 07:08:21 | $3.00 | yes |
| `260928071156210101I` | 07:11:20 | $3.00 | yes (E5's) |
| `260928071158244710I` | 11:40:47 | $3.00 | no (T8) |

Two things follow. Banxico returns **every** match, and the amount already
filtered before the list (the creator's $5 transfers of the same reference
are absent). And the list does not say which CEP was used before: that
memory can only be Devolada's. E3's and F2's ZIPs were not opened; at
~28 KB per CEP their sizes say 3 and 2.

## F1 and E6, opened and compared

| Case | Asked | CEP clave | Operation day | Credit day and time | Amount |
| --- | --- | --- | --- | --- | --- |
| F1 | 2026-09-28 | `260928071158256772I` | 28 | 26, 11:42:13 | $3.00 |
| F1 | 2026-09-28 | `260928071158273815I` | 28 | 26, 11:43:36 | $3.00 |
| E6 | 2026-09-24 | `260925071144368901I` | **25** | 24, 23:40:49 | $5.00 |
| E6 | 2026-09-24 | `260925071144378233I` | **25** | 24, 23:43:47 | $5.00 |
| E6 | 2026-09-24 | `260925071144393084I` | **25** | 24, 23:48:18 | $5.00 |

- **F1** is the clean duplicate: two transfers 83 s apart, same reference,
  amount, bank and day, neither validated by anyone. The ZIP is the only
  thing that separates them, by credit time. Every CEP in a ZIP is
  complete and signed; the ZIP is not a shortened list.
- **E6** settles the 18:00 rule for filing: Banxico stamped the three
  Thursday 23:40–23:48 transfers with operation day Friday 25, exactly as
  `spei-date-rollover` modelled. The claves say so too (`260925…`).
- **E6 versus E7** is the surprise. Asked with the **credit day** (24) they
  were found; asked with their **operation day** (25) they were not. Yet
  the Saturday transfers (credit 26, operation 28) were found with both
  days (E1, E3, F3–F8, F4). Across all 15 calls the credit day never
  missed; the operation day missed once, on a plain weekday. What the
  provider does with the date it receives (its own or Banxico's rule, a
  weekend shift, a window) is not documented and this run cannot tell.
  One more probe, when the quota returns, should ask a Friday-night
  transfer with Friday, Saturday and Monday, and a weekday-night one with
  its day and the next.

## What this rules out, and what it opens

- A `422` "duplicate reference" from the provider is not a signal Devolada
  will ever get; ambiguity is `invalid` + `banxicoConfirmed: true` + a file.
- "Ask again on another day" cannot resolve a duplicate; the ZIP can, by
  the credit time next to the receipt's printed time, or by the clave nobody
  has used.
- Azteca's default referencia is the last seven digits of the receiving
  CLABE (`9784417` here), so every Azteca payer of one ISP shares it: the
  ambiguous case is the common case for that bank, not the corner.
- The search never missed when asked with the **credit day** — the date a
  receipt prints. The operation day missed once (E7). Until the provider's
  date handling is understood, the printed day is the safer first ask, and
  the business-day rule matters for what Devolada *records* and compares.
- A validated CEP is visible again with `cepPreviouslyValidated: true`, so
  reuse detection can rely on the provider's flag as well as on our rows.

## Addendum (2026-09-26, read against the dev D1): Friday-night transfers were found by no date

The two Friday transfers made after 18:00 — `260928071152850963I` (18:58)
and `260928071155271843I` (22:46), $3.00, ref 9784417, Azteca → BBVA ***417,
operation day **28** by their CEPs (receipt door, dev `validations`, 04:44
and 06:51 UTC) — are absent from every direct-mode answer:

- **E2** (asked the 25th, their credit day) returned only `…45184062I`,
  the Friday-morning one. So "the credit day never missed" does not hold:
  it missed these two.
- **E1** (asked the 28th, their operation day) returned the three
  Saturday CEPs and not these two. The operation day missed them too.
- **By clave**, `…55271843I` was `not_found` asked with the 28th (10:51
  UTC) and five times with the 26th — while the receipt door found it
  `valid` at 06:51 and 12:59 UTC. So the clave door misses them as well.

Saturday transfers (credit 26, operation 28) were found with both days;
Thursday-night ones (credit 24, operation 25) only with the credit day;
Friday-night ones (credit 25, operation 28 across a weekend) with neither.
The one door that found them is the receipt door. ~~Which three CEPs
E3's ZIP holds, and the next paid probe~~ — answered by lot 3 below: the
Friday-night transfer is found by **clave with its printed day (25)** and
by no other date; by reference, the 27th returned the same three Saturday
CEPs (by size) and not the Friday-night ones.

This also corrects `valid-lost-on-later-failure` step 5: direct mode does
not hide an already-validated CEP (E5, F4, F6 answer `valid` with the flag).
What `0e2aa815-…` met is this Friday-night gap, not reuse.

The dev token's last call (18:49:58 UTC, after the run) carries no status:
the quota of 50/month is spent until 2026-10-26, and every dev validation
fails until it is topped up (bug `provider-refusal-silent`).

## Lot 3 (2026-09-26, 21:00 UTC): which date finds a night transfer

`scripts/apicep-probe.cases.lote3.json`, 9 paid calls on a new token
(**quota 800/month**, 791 left, reset 2026-10-26). Raw answers in the
git-ignored `apicep-probe-lote3/`.

| Case | Asked | Transfer | apiCEP said |
| --- | --- | --- | --- |
| G1 | clave `…52850963I`, **25** (printed) | Friday 18:58, op. day 28 | **valid**, validated before, credit 25 18:59:26 |
| G2 | same clave, 26 (Saturday) | | not found (Banxico not confirmed) |
| G3 | same clave, 27 (Sunday) | | not found |
| G4 | same clave, **28** (its operation day) | | **not found** |
| G5 | ref 9784417 $3, 27 (Sunday) | | ambiguous ZIP, 83 KB = 3 CEPs (the Saturday ones by size) |
| G6 | clave `…44368901I`, **24** (printed) | Thursday 23:40, op. day 25 | **valid**, validated before, credit 24 23:40:49 |
| G7 | same clave, **25** (its operation day) | | **not found** |
| G8 | ref 250926 $3 Nu, 25 | Nu Friday 07:23 | **valid**, first time, `NU3AMPQSD4A98PNQ0F5C6TF9HFF7` |
| G9 | that clave, 25 | | valid, validated before (by G8) |

What lots 1–3 settle together, 24 calls:

- **The printed day is the only date that finds a transfer made after
  18:00.** By clave, the Friday-night transfer answered to 25 and to none
  of 26, 27, 28; the Thursday-night one to 24 and not to 25. The business
  day Banxico files them under (their `operationDate`, what the claves
  encode) found **nothing** in direct mode, by clave or by reference.
- Weekend transfers are the exception that made this look inconsistent:
  a Saturday transfer answers to the Saturday *and* to the Monday (E1, E3,
  F3–F8). A query for a Monday reaches back over the weekend; a query for a
  Friday or a Monday does not reach a Friday-night credit.
- **A Nu reference works like any other** (G8): the earlier misses on dev
  were the folio taken for a clave (`receipt-reader-tuning`), not Nu.
- Every "validated before" answer (G1, G6, G9, E2, E5, F4, F6) came with
  the printed day or, on a weekend, either day. Whether the provider
  answers those from its own store rather than from Banxico cannot be told
  from outside; a never-validated night transfer asked by clave with its
  printed day would settle it. It does not change the rule for Devolada.

**Rule for the product** (replaces the "primary = business day" of
`reference-search-business-day`'s remediation): a direct-mode search asks
**the day printed on the receipt / given by the payer**, first and only.
A retry on the business day buys nothing measured; a retry on the Monday
for a weekend transfer is the one alternate worth a call. The business-day
rule stays for what Devolada records and compares (`operationDate`,
`cdaChain`), never for what it asks.

**Exception, measured (review of 2026-09-26):** a transfer made on a
**Friday after 18:00** — operation day across a weekend — was found by
**no date when asked by reference**: the 25th (E2) returned only the
07:19 transfer as a single `valid`, and 26 (E3), 27 (G5) and 28 (E1)
returned the three Saturday CEPs. Only its clave with the printed day
(G1) or the receipt door found it. A reference-only payment of that kind
must ask the payer for the clave (or go to the receipt door), not retry.
Whether the eve of a holiday behaves the same is not measured.

**Open (2 calls close it):** the night-by-clave evidence (G1, G6) comes
only from transfers validated earlier, which the provider may answer from
its own store. A *fresh* weekday-after-18:00 transfer, uploaded nowhere,
asked by clave and by reference with its printed day, settles whether the
clave rule holds against Banxico itself. E2 points the same way: three
$3 transfers had credit day 25 and the reference search returned one,
the one validated before.

## Banxico by batch (2026-09-26, folio A0E0097211): the credit day is the only day, and the answers are Banxico's

The creator uploaded `banxico-lote1.txt` to Banxico's free batch service
(`cep-scl`): 30 lines, the 16 claves known from lots 1–3 and the opened
ZIPs, every night or weekend transfer twice — with its **credit day** (the
day printed on the receipt) and with its **operation day** (the day Banxico
files it under, which the clave encodes). No provider in between. Banxico
answered within the hour with 16 PDFs and `resumen.txt`.

| Lines | Asked with | Banxico |
| --- | --- | --- |
| 16 | the credit day | **CEP generated, all 16** |
| 14 | the operation day | **"No se pudo localizar el pago", all 14** |

Three things are now settled at the source, not at the provider:

1. **Banxico's CEP query indexes the credit day only.** The operation day
   — a Monday for a Saturday transfer, a Friday for a Thursday-night one —
   finds nothing at Banxico, ever. So the *only* date Devolada may ask with
   is the day the money moved: the day the receipt prints, the day the
   payer gives, the day the statement shows. The business-day rule is for
   what Devolada records (`operationDate`), never for what it asks. This
   closes `reference-search-business-day` the other way round from its
   remediation.
2. **apiCEP's Monday finds were apiCEP's doing.** In lots 1–2 a Saturday
   transfer answered to the 28th (E1, E5, F3, F5–F8). Banxico says no to
   the 28th for every one of them, so the provider reaches back over a
   weekend on its own. That is convenient and undocumented; Devolada must
   not depend on it.
3. **Banxico has the Friday-night transfers, by clave with the 25th**
   (`…52850963I`, `…55271843I`). The provider's reference search never
   returned them on any date (E1, E2, E3, G5). The gap is the provider's,
   not Banxico's — whether its reference search or its store, only the
   provider can say. And the open question above is closed: T8
   (`…58244710I`, never validated by anyone) came back like the rest, so
   these are Banxico's answers, not a cache of earlier validations.

For spec 012: the batch file Devolada prepares (US4, FR-020) carries the
credit day per clave — the statement's date, or the receipt's — and one
line per transfer is enough. Banxico's index names each miss with the
day and clave asked, so a wrong day costs one line, not the batch.

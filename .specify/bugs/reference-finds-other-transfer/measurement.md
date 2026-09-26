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
| 4 | Does the 18:00 / weekend rule hold? | **Weekend, yes**: Saturday transfers are filed under Monday 28, and asking with **either** day finds them. **18:00, no**: Thursday-night transfers stayed on the 24th; the 25th found nothing. |
| 5 | Does direct mode hide a CEP already validated? | **No.** It answers `valid` with `cepPreviouslyValidated: true`, on the clave door and on the reference door alike. |

## Every case

| Case | Asked | apiCEP said | Read as |
| --- | --- | --- | --- |
| E1 | ref 9784417, 2026-09-28, $3, Azteca | invalid, Banxico confirmed, ZIP | several matches (three, see below) |
| E2 | ref 9784417, 2026-09-25, $3, Azteca | valid, already validated, `…45184062I`, 07:19:52 | the one Friday-morning transfer |
| E3 | ref 9784417, 2026-09-26 (Saturday), $3, Azteca | invalid, Banxico confirmed, ZIP (3 CEPs by size) | the calendar day finds the Monday matches too |
| E4 | ref 9784417, 2026-09-28, **$3.01**, Azteca | invalid, Banxico **not** confirmed, no file | no transfer of that amount: the amount filters |
| E5 | clave `260928071156210101I`, 2026-09-28 | valid, already validated, 07:11:20 | a validated CEP is not hidden |
| E6 | ref 9784417, 2026-09-24 (Thursday), **$5**, Azteca | invalid, Banxico confirmed, ZIP (3 CEPs by size) | the three Thursday-night $5 transfers are filed on the 24th |
| E7 | ref 9784417, 2026-09-25, $5, Azteca | invalid, Banxico not confirmed, no file | nothing on the 25th: no 18:00 rollover |
| F1 | ref 5830261, 2026-09-28, $3, Azteca | invalid, Banxico confirmed, ZIP (2 CEPs by size) | a fresh exact duplicate is ambiguous from the first call |
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
memory can only be Devolada's. The other ZIPs were not opened; at ~28 KB
per CEP their sizes say 2 (F1, F2) and 3 (E3, E6).

## What this rules out, and what it opens

- A `422` "duplicate reference" from the provider is not a signal Devolada
  will ever get; ambiguity is `invalid` + `banxicoConfirmed: true` + a file.
- "Ask again on another day" cannot resolve a duplicate; the ZIP can, by
  the credit time next to the receipt's printed time, or by the clave nobody
  has used.
- Azteca's default referencia is the last seven digits of the receiving
  CLABE (`9784417` here), so every Azteca payer of one ISP shares it: the
  ambiguous case is the common case for that bank, not the corner.
- The operation-day search can ask the printed calendar day and still find
  a weekend transfer; the business-day rule matters for what Devolada
  *records*, less for what it *asks*.
- A validated CEP is visible again with `cepPreviouslyValidated: true`, so
  reuse detection can rely on the provider's flag as well as on our rows.

# Measurement: what apiCEP and Banxico answer, by reference and by clave (2026-09-26)

- **Instruments**:
  - `scripts/apicep-probe.sh`, asking apiCEP directly with no Devolada in
    between:
    - lot 1 (E1–E7): `scripts/apicep-probe.cases.example.json`
    - lot 2 (F1–F8): `scripts/apicep-probe.cases.lote2.json`
    - lot 3 (G1–G9): `scripts/apicep-probe.cases.lote3.json`
  - Banxico's free batch service `cep-scl` (folio A0E0097211), with no
    provider in between.
  - The dev D1's `payments` and `validations` rows.
- **Cost**: 24 paid apiCEP calls.
  - Lots 1–2 spent the old token's 50/month; it resets 2026-10-26.
  - Lot 3 ran on a new token of 800/month.
- **Raw answers**: kept only on the creator's machine, in
  `~/labs/devolada-evidencia/` — moved there on 2026-09-27 from the
  git-ignored `apicep-probe-*/` of a worktree, with Banxico's unzipped
  answer rescued from a session scratchpad (its `README.md` lists them).
  They carry the sender's name, RFC and account. This file keeps claves,
  days and times, nothing else.
- **Serves**: this bug, `reference-search-business-day`,
  `valid-lost-on-later-failure` and spec 012.

All transfers are the creator's own. They go from Azteca (and some from Nu)
to the demo BBVA account ending 417. The amount is $3.00 and the referencia
9784417 unless stated.

**Words used below:**
- The *printed day* is the day the receipt shows. The CEP calls it the
  *fecha de abono*, and it is the calendar day the money moved.
- The *operation day* is the business day Banxico files the transfer under:
  the CEP's `operationDate`, also the first digits of an Azteca clave.

This file records only what was asked and what came back. The last section
lists what the answers do not tell.

## Lots 1–2 (apiCEP, 18:22–18:24 UTC)

| Case | Asked | apiCEP said |
| --- | --- | --- |
| E1 | ref 9784417, 28, $3, Azteca | invalid, Banxico confirmed, ZIP. Opened: 3 Saturday CEPs, below |
| E2 | ref 9784417, 25, $3, Azteca | valid, validated before, `…45184062I`, 07:19:52 (a Friday-morning transfer) |
| E3 | ref 9784417, 26 (Saturday), $3, Azteca | invalid, Banxico confirmed, ZIP, not opened (3 CEPs by size) |
| E4 | ref 9784417, 28, **$3.01**, Azteca | invalid, Banxico **not** confirmed, no file |
| E5 | clave `260928071156210101I`, 28 | valid, validated before, 07:11:20 |
| E6 | ref 9784417, 24 (Thursday), **$5**, Azteca | invalid, Banxico confirmed, ZIP. Opened: 3 Thursday-night CEPs, below |
| E7 | ref 9784417, 25, $5, Azteca | invalid, Banxico not confirmed, no file |
| F1 | ref 5830261, 28, $3, Azteca | invalid, Banxico confirmed, ZIP. Opened: 2 CEPs, below |
| F2 | same as F1 | same as F1 |
| F3 | ref 4917358, 28, $3, Azteca | valid, first time, `…58283781I`, 11:44:30 |
| F4 | ref 4917358, 26 (printed Saturday), $3, Azteca | valid, validated before, same clave as F3 |
| F5 | ref 6274089, 28, $3, Azteca | valid, first time, `…58297980I`, 11:45:59 |
| F6 | clave `260928071158283781I`, 28 | valid, validated before (by F3) |
| F7 | ref 6274089, 28, **$3.01**, Azteca | valid, first time, `…58309423I`, 11:46:37 |
| F8 | ref 4917358, 28, $3, **Nu** | valid, first time, `NU3AN02K6CS59GIBCF1CQ696SE8Q`, 11:47:58 |

Timing:

| Answer | Time |
| --- | --- |
| A CEP found | 3.8–8.2 s |
| Several matches | 4.4–5.7 s |
| Not found | 0.6–1.7 s |

On dev the same evening, "not found" answers took 1.8–4.5 s, so time alone
does not tell the answers apart.

### The ZIPs, opened

The file behind `downloads.cepPdf` is served as `application/pdf` but is a
ZIP. It holds one one-page CEP per match, `CEP-<operation day>-<clave>.pdf`.
Each is signed by the receiving bank and carries:
- the operation day, and the credit day and time;
- the amount and the referencia;
- the clave, the chain and the seal.

| Case | Clave | Operation day | Credit day and time | Amount |
| --- | --- | --- | --- | --- |
| E1 | `260928071156202040I` | 28 | 26, 07:08:21 | $3.00 |
| E1 | `260928071156210101I` | 28 | 26, 07:11:20 | $3.00 |
| E1 | `260928071158244710I` | 28 | 26, 11:40:47 | $3.00 |
| F1 | `260928071158256772I` | 28 | 26, 11:42:13 | $3.00 |
| F1 | `260928071158273815I` | 28 | 26, 11:43:36 | $3.00 |
| E6 | `260925071144368901I` | **25** | 24, 23:40:49 | $5.00 |
| E6 | `260925071144378233I` | **25** | 24, 23:43:47 | $5.00 |
| E6 | `260925071144393084I` | **25** | 24, 23:48:18 | $5.00 |

- **E1:** the first two CEPs had been validated before this run; the third
  (T8) had not. Nothing in the ZIP says which is which.
- **F1:** two transfers 83 s apart with the same reference, amount, bank
  and day, neither validated before. Only the credit time separates them.

### Two Friday transfers after 18:00

The receipt door found them `valid` on dev: `260928071152850963I` at 18:58
and `260928071155271843I` at 22:46. Both are $3.00, ref 9784417, Azteca,
printed day 25, operation day 28.

| Asked | What came back |
| --- | --- |
| By reference with 25 (E2) | a single `valid`: the 07:19 transfer, not these two |
| By reference with 28 (E1, opened) | the three Saturday CEPs, not these two |
| By reference with 26 (E3) | a ZIP of 3 CEPs by size, not opened |
| `…55271843I` by clave with 28 (dev `validations`) | `not_found`, once |
| `…55271843I` by clave with 26 (dev `validations`) | `not_found`, five times |

## Lot 3 (apiCEP, 21:00 UTC)

| Case | Asked | Transfer | apiCEP said |
| --- | --- | --- | --- |
| G1 | clave `…52850963I`, **25** (printed) | Friday 18:58, op. day 28 | **valid**, validated before, credit 25 18:59:26 |
| G2 | same clave, 26 | | not found (Banxico not confirmed) |
| G3 | same clave, 27 | | not found |
| G4 | same clave, **28** (operation day) | | not found |
| G5 | ref 9784417, $3, 27 (Sunday) | | ZIP of 83 KB (3 CEPs by size), not opened |
| G6 | clave `…44368901I`, **24** (printed) | Thursday 23:40, op. day 25 | **valid**, validated before, credit 24 23:40:49 |
| G7 | same clave, **25** (operation day) | | not found |
| G8 | ref 250926, $3, Nu, 25 | Nu Friday 07:23 | **valid**, first time, `NU3AMPQSD4A98PNQ0F5C6TF9HFF7` |
| G9 | that clave, 25 | | valid, validated before (by G8) |

## Banxico by batch (`cep-scl`, folio A0E0097211)

The creator sent a 30-line file:
- 16 claves from lots 1–3 and the opened ZIPs, each asked with its
  **printed day**;
- 14 of those (every night or weekend transfer) asked a second time, with
  their **operation day**.

Banxico answered the same day with 16 PDFs and `resumen.txt`.

| Lines | Asked with | Banxico answered |
| --- | --- | --- |
| 16 | the printed day | a CEP, all 16 |
| 14 | the operation day | "No se pudo localizar el pago", all 14 |

The 16 include T8 (`…58244710I`), which no one had validated before.

## Dev, the evening of Saturday 2026-09-26 (read 2026-09-27)

The creator uploaded five receipts from the payer's page.

| Receipt | How it was searched | Date asked | apiCEP said |
| --- | --- | --- | --- |
| Azteca $3.01 (the F7 transfer) | receipt door | none | valid, validated before (by F7) |
| Nu 19:05, $3.00, ref 260926 | receipt door | none | valid, first time |
| Nu 19:15, $3.00, ref 1701712 | receipt door | none | valid, first time |
| Nu 19:25, $2.00, ref 260926 | receipt door | none | valid, first time |
| Nu 19:21, $3.00, ref 260926 | see below | | |

The receipt door does not send a date. The day stored on each confirmed
payment (28) is the CEP's operation day, written after the answer.

The 19:21 transfer (Juan Fernando's link), in order:

1. Receipt door: `not_found`. No clave was recorded as read.
2. By reference 260926, $3, Nu, **27**: Devolada recorded `not_found`.
   - Devolada keeps only its verdict. A "several matches" answer (ZIP) is
     read as `not_found` too, so which of the two came back is not known.
   - apiCEP's id for this call is `dabe7ef1-b637-4e56-ab95-c74cf9f8ce0a`.
3. By clave, typed by hand, with 26: `not_found` four times. The claves
   were mistyped: one character missing once, and O and 0 swapped three
   times.
4. By clave `NU3AN1NOH58F83MPKJHM01OH2K0Q` with **26** (printed): **valid,
   first time**.

## What is settled

1. **Several matches are never a refusal.** They come back as `invalid`,
   `banxicoConfirmed: true` and a ZIP with one signed CEP per match, never a
   `422` (E1, E3, E6, F1, G5). Asking again returns the same ZIP (F2).
2. **The amount and the sending bank filter a reference search.**
   - Amount: E4, F7.
   - Bank: F3 against F8.
   - The request has no field for the time, so time cannot filter.
3. **Each CEP carries the credit day and time to the second** (the ZIPs,
   `cepDetails.processingTime`).
4. **A CEP validated before comes back `valid` with
   `cepPreviouslyValidated: true`**, by clave and by reference alike (E2,
   E5, F4, F6, G1, G6, G9). A validation by reference marks the clave as
   used (F6).
5. **Banxico finds a transfer by its printed day and never by its operation
   day** (the batch: 16 of 16 against 0 of 14). This holds for claves,
   because the batch takes claves only.
6. **apiCEP by clave found night transfers only by the printed day.** Each
   one was asked more than once:
   - Friday 18:58: found with 25 (G1); not with 26, 27 or 28 (G2–G4).
   - Thursday 23:40: found with 24 (G6); not with 25 (G7).
   - A fresh Saturday 19:21 transfer, never validated before: found with
     26 (dev, step 4).
7. **apiCEP also found Saturday transfers when asked for the Monday** (28):
   E1, E5, F3, F5–F8. By reference, a Sunday query (27) returned a ZIP
   whose size matches the three Saturday CEPs (G5). Banxico's batch does
   not answer the Monday, so this comes from the provider, and it is not
   documented.
8. **The operation day of a transfer after 18:00 is the next business
   day.**
   - Thursday 23:40 → Friday 25 (E6).
   - Friday 18:58 and 22:46 → Monday 28.
   - Saturday → Monday 28.
9. **The creator's Azteca receipts carry referencia 9784417 by default.**
   These are the last seven digits of the receiving CLABE.
10. **A Nu reference is searched like any other** (F8, G8).

## What these answers do not tell

- **Why E2 returned one transfer and not three.** On the 25th three
  transfers matched on reference, amount, bank and printed day. apiCEP
  answered a single `valid` with the 07:19 one, which had been validated
  before, and left out the 18:58 and 22:46 ones. No date asked by
  reference returned those two (E1 opened; E3 and G5 by size only).
  - Banxico's batch found them, but by clave; how Banxico answers them by
    reference is not measured.
  - This is **one call**. Whether another Friday transfer after 18:00, or
    a weekday one, behaves the same by reference is not measured.
- **What call 2 of the 19:21 transfer received**: a ZIP or a true "not
  found". apiCEP's panel can show it by the id above.
  - The date asked was a Sunday. G5 shows that a Sunday query by reference
    returned the Saturday transfers of another reference.
  - Two $3.00 Nu transfers with referencia 260926 exist that evening
    (19:05 and 19:21), so a ZIP was possible.
- **Whether apiCEP answers a clave validated before from Banxico or from its
  own store.** G1 and G6 are both transfers validated before. The fresh
  transfer found by clave (dev, step 4) is a Saturday one. A fresh weekday
  transfer after 18:00, asked by clave with its printed day, is not
  measured.
- **Why apiCEP answers the Monday or Sunday for a Saturday transfer**, and
  whether it always will.
- **The eve of a holiday**: not measured.

# Bug Assessment: the reader drops the seconds a receipt prints

- **Slug**: reader-drops-seconds
- **Created**: 2026-09-28
- **Source**: pasted text (product creator, in session, 2026-09-28: "empieza
  por el error, y la lectura de la fecha con segundos"), plus a read-only look
  at the dev D1 the same morning. No URL supplied, so the URL Trust Policy did
  not apply and nothing was fetched.
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

> "Sí, aplica la Regla 1 y empieza por el error, y la lectura de la fecha con
> segundos."

A Nu screenshot uploaded on dev prints "Autorización 28 SEP 2026, 09:14:50 AM
(hora de CDMX)". The reader returned `"hora": "09:14"`, which lost the
seconds. The creator asked for the time to be read with its seconds. As they
said the same session, this must be a general rule drawn from the samples,
not a per-bank one.

## Symptom

The reader answers a receipt's time with the minute alone, although the
receipt prints the seconds. Expected: whenever the receipt prints seconds,
the reading carries them ("09:14:50"), converted to a 24-hour clock.

## Evidence (dev D1, read-only, 2026-09-28)

Every reading below comes from questions version 3 on
`@cf/mistralai/mistral-small-3.1-24b-instruct`.

| When | Receipt | Printed | Answered `hora` |
| --- | --- | --- | --- |
| 06:38 | Azteca | seconds | `06:35:09` |
| 06:48 | Azteca | seconds | `06:36:05` |
| 08:36 | Azteca | seconds | `08:34:47` |
| 09:16 | Nu, screenshot cut before the clave (extraction faf55c47) | `09:14:50 AM` | **`09:14`** |
| 10:00 | Nu, the full receipt of the same transfer (extraction a0e00933) | `09:14:50 AM` | `09:14:50` |

- The same printed time, "09:14:50 AM", was read with its seconds once and
  without them once. The loss is intermittent, not tied to one bank's layout.
- The one miss is also the one case where the model had to convert a 12-hour
  time. The questions ask it to convert and to keep the seconds at once. The
  only 12-hour example they give has no seconds ("11:47 p.m." is "23:47").
- `timeOf` stored what the model gave: the payment's `transfer_time` is
  "09:14". Nothing downstream can recover the seconds.
- Why it matters: the matcher reads a time printed "HH:MM" as its whole
  minute (cep-bundle-match D6, research R7). Two transfers of the same amount
  credited within that minute can never be told apart by time. A receipt read
  with its seconds can separate them whenever their credits are more than
  30 s apart.

### Added 2026-09-29, at the fix (dev D1, read-only)

Added at the creator's request ("add the 13:20 case to the assessment as
evidence"). The remediation below is unchanged. A second miss happened after
this assessment was written. It was on Nu too, on two captures of one
transfer: reference 2546382, $3.00, printed 2026-09-28. Both were read with
questions version 3 on the same model.

| When (UTC) | Extraction | `bancoEmisor` | Answered `hora` | Gate |
| --- | --- | --- | --- | --- |
| 19:22 | eb725182 | "NU" | `13:20:10` | stopped: the bank is outside the vocabulary |
| 19:23 | 1f340d86 | "NUBANK" | **`13:20`** | passed, and searched |

- The same transfer was read with its seconds once and without them once, a
  minute apart. The image was not looked at. The capture read "13:20:10" is
  what says the receipt prints seconds.
- This miss is worse than the 09:14 one. The reading without seconds is the
  one that reached the search. The reading with seconds was stopped by the
  bank name "NU". Payment 56c8e102 recorded the receipt's time as `13:20`,
  and it ended `unreadable` for bug `single-cep-unreadable` (since fixed),
  so no transfer was chosen by the minute alone.
- Tally of fresh version-3 readings on dev whose receipt is known to print
  seconds, from 2026-09-28 to 2026-09-29:
  - Azteca kept the seconds 3 of 3.
  - Nu kept them 3 of 5 (`09:14:50`, `13:20:10`, `22:16:59`) and lost them
    twice (`09:14`, `13:20`).
- Five readings answered `19:30` on 2026-09-29, all `esComprobante: false`.
  They are left out, because nothing shows whether that capture prints
  seconds.
- "NU" in place of NUBANK appeared in three of the five Nu readings (the
  09:14 screenshot, 13:20:10, 22:16:59). That is the out-of-scope finding
  below, seen again.

## Reproduction

1. A receipt image that prints a 12-hour time with seconds and an a.m./p.m.
   mark, such as "09:14:50 AM".
2. Read it with questions version 3 (`/read`, the receipt door, or the
   operator's bench).
3. Sometimes `hora` comes back as "HH:MM", and the seconds are gone from
   `extractions.transfer_time` and `payments.transfer_time`.

The loss is not deterministic: the same time read from the full receipt kept
its seconds. The rate is [NEEDS CLARIFICATION: measured only on the bench,
over the creator's captures].

## Suspected Code Paths

- `apps/api/src/consta/extraction/reader.ts`, `FIELDS`: `"hora": "<the time
  of the operation on a 24-hour clock: HH:MM:SS when the receipt prints
  seconds, otherwise HH:MM, or null>"`. The model is asked to transform and to
  preserve in one step.
- `apps/api/src/consta/extraction/reader.ts`, `RULES`, the `hora` rule: its
  one conversion example drops to "HH:MM" ("11:47 p.m." is "23:47"), beside a
  24-hour example that keeps the seconds.
- `apps/api/src/consta/extraction/reader.ts::timeOf`: accepts only a 24-hour
  "H:MM" or "H:MM:SS", so a transcription such as "09:14:50 AM" would be
  refused today. A test pins "11:47 p.m." to null
  (`apps/api/test/consta/reader-questions.test.ts`), per `bug:
  spei-date-rollover`.
- `QUESTIONS_VERSION` ("3") and its pinned hash, in
  `apps/api/test/consta/reader-questions.test.ts`.

## Root Cause Hypothesis

The time question makes the model convert the clock and keep the seconds in
one step, and its only 12-hour example shows a result without seconds. On the
Nu screenshot the model converted "09:14:50 AM" and dropped the seconds. On
the full receipt it kept them. Confidence: **medium**. The mechanism fits the
evidence, one miss in five readings. Whether a different wording removes the
miss can only be measured on the bench, never asserted by a stub (constitution
IV, receipt-reader-tuning D20).

## Proposed Remediation

**Preferred**: ask for the time exactly as printed, and convert in code.
This is a general rule: copying is the one job a reader does best, and
converting is a job code does without mistakes.

- **Questions version "4".** `hora` becomes "the time printed beside the
  date, copied exactly as printed: hours, minutes, and the seconds and the
  a.m./p.m. mark when they are printed; no date, no zone, nothing else".
  - The rule gets one worked example: "Autorización 28 SEP 2026, 09:14:50 AM
    (hora de CDMX)" is "09:14:50 AM".
  - "Never add seconds it does not print" stays. Every other word stays as in
    version 3.
  - Bump `QUESTIONS_VERSION` to "4" and re-pin the hash.
- **`timeOf` converts.**
  - It accepts a 24-hour time as before.
  - It also accepts a 12-hour time with its mark, in the spellings Mexican
    receipts use ("AM", "a.m.", "a. m.", "PM", "p.m.", "p. m.", any case),
    and a trailing "hrs" or "h".
  - It returns "HH:MM:SS" when seconds were printed, "HH:MM" otherwise, and
    never invents seconds.
  - Conversions: 12 a.m. is 00, 12 p.m. is 12, and 1–11 p.m. add 12. A mark
    with an hour above 12 is null.
  - A time with no mark is read as 24-hour, as it is today.
- **Documentation only**: `reader.ts`'s header records version 4 and why.
  The bench then shows every capture as missing a version-4 reading (it
  compares by `QUESTIONS_VERSION`), which is the measurement to run.

**Alternatives**:

- **Keep version 3's conversion and only add a 12-hour example with
  seconds.** A smaller wording change, but it keeps the step the miss
  happened in.
- **Read the time with a regex from the text.** This works only on the PDF
  door (its text), and images, the common case, need the model.
- **Ask a second model when the time comes back without seconds.** This
  doubles a call's cost, and the reader cannot know whether seconds were
  printed.

**Files likely to change**:

- `apps/api/src/consta/extraction/reader.ts` (`FIELDS`, `RULES`,
  `QUESTIONS_VERSION`, `timeOf`, header)
- `apps/api/test/consta/reader-questions.test.ts` (the pin, the `timeOf`
  cases)
- `apps/api/test/spei-date-rollover.test.ts` (its `timeOf` cases, if the new
  forms touch them)

**Tests to add or update** (`bug: reader-drops-seconds`):

- **`timeOf` converts a transcription**:
  - "09:14:50 AM" is "09:14:50"; "9:14:50 a. m." is "09:14:50".
  - "11:47 p.m." is "23:47"; "12:05:09 a.m." is "00:05:09"; "12:30 PM" is
    "12:30".
  - "23:47:05 hrs" is "23:47:05".
  - "13:10 PM", "24:00", "12:60" and words are null.
  - Seconds are kept when present and never invented.
- **The pin**: version "4" with its new hash, and the `hora` field and rule
  ask for the time as printed with its seconds and mark.
- **The old 24-hour answers still parse**, so version-3 readings replayed
  from the reuse path (two-eyes D14) and the existing stubs keep their
  meaning.
- **No stub carries a version-4 answer** until the bench has measured one
  (constitution IV). The measured version-3 answer of the Nu screenshot
  ("09:14", `NU_0914_READING`) stays as what version 3 did.

## Risks & Considerations

- **A prompt change is unmeasured until the bench reads the captures.** The
  prompt is one text, so a word in `hora` can move another field. The change
  is confined to the time's field and rule. The measurement belongs to the
  open debt `cep-bundle-match-reader-unmeasured`, whose exit now means
  version 4 beside version 3:
  - both Nu images of 2026-09-28;
  - the three Azteca receipts;
  - the bench's set.
- **A 12-hour time printed without a mark** ("02:15" for the afternoon) is
  ambiguous and is read as 24-hour, exactly as version 3 leaves it. A
  receipt's own clock mark is what removes the doubt.
- **Stored raw answers change shape** ("09:14:50 AM" in `raw_output`). The
  normalised `transfer_time` does not.
- **No schema change, no migration, no API change.**
- **Observed on the same reading, out of scope here**: the model answered
  `bancoEmisor: "NU"` from the logo, a name outside the vocabulary, so the
  gate kept no bank. The full receipt ("Entidad Nubank") read NUBANK. Bank
  names answered outside the vocabulary deserve their own general rule,
  whichever bank the reader sees.

## Open Questions

- [NEEDS CLARIFICATION: the rate of the miss, before and after, is the
  bench's to measure over the creator's captures; it does not block the
  change.]

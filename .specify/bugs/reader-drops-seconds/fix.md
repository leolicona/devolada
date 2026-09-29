# Bug Fix: the reader drops the seconds a receipt prints

- **Slug**: reader-drops-seconds
- **Fixed**: 2026-09-29
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The reader now copies the receipt's time exactly as printed, with its seconds
and its a.m./p.m. mark, in questions version "4". `timeOf` converts that to a
24-hour clock in code, and keeps the seconds only when they were printed.
Version 3 asked the model to convert and keep the seconds in one step, and it
dropped them on two of five Nu readings on dev.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/consta/extraction/reader.ts` | modified | `FIELDS` and `RULES` ask for `hora` as printed, with the Nu worked example; `QUESTIONS_VERSION` "4"; `timeOf` converts a 12-hour time with its mark and drops a trailing "hrs"/"h"; the header records version 4, why, and that it is unmeasured |
| `apps/api/test/consta/reader-questions.test.ts` | modified, tests added | `PINNED["4"]`; the pin expects "4"; a `bug: reader-drops-seconds` block; the version-3 block no longer pins the old `hora` wording, and "11:47 p.m." left its list of non-times |
| `apps/api/test/spei-date-rollover.test.ts` | modified | "11:47 p.m." is now "23:47" and "07:10:58 a.m." is "07:10:58", where both were pinned to null |
| `.specify/bugs/reader-drops-seconds/assessment.md` | evidence added | a dated addendum with the 13:20 pair, at the creator's request (see Deviations) |

## Diff Highlights

The question (both prompts share it):

```text
"hora": "<the time printed beside the date, copied exactly as printed: hours,
minutes, and the seconds and the a.m./p.m. mark when they are printed; no date,
no zone, nothing else; or null>"

- "hora" is the time printed beside the date, copied exactly as printed —
  never converted to another clock. Keep the seconds when the receipt prints
  them, and keep the a.m./p.m. mark when it prints one: "Autorización 28 SEP
  2026, 09:14:50 AM (hora de CDMX)" is "09:14:50 AM", and "07:10:58" is
  "07:10:58". Write no date and no zone. Never add seconds it does not print.
  Return null if the receipt prints no time; never guess one.
```

The conversion:

```ts
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?\s*m\.?)?(?:\s*(?:hrs|h)\.?)?$/i;
…
if (m[4]) {
  if (h < 1 || h > 12) return null;
  h = (h % 12) + (m[4].toLowerCase() === "p" ? 12 : 0);
}
```

## Tests Added or Updated

All in `apps/api/test/consta/reader-questions.test.ts`, block "bug:
reader-drops-seconds — the time is copied as printed and converted in code
(version 4)", unless noted:

- **both prompts ask for the time as printed**: the new field, the Nu worked
  example, "never converted to another clock" and "Never add seconds it does
  not print" are present. Version 3's conversion wording is absent.
- **a 12-hour time with its mark is converted**:
  - "09:14:50 AM", "9:14:50 a. m." and "09:14:50AM" are "09:14:50".
  - "11:47 p.m." is "23:47"; "01:20:10 PM" and "1:20:10 p. m." are "13:20:10".
  - "12:05:09 a.m." is "00:05:09"; "12:30 PM" and "12:30 pm" are "12:30".
  - A narrow no-break space before the mark still parses.
- **a trailing hrs or h is dropped**: "23:47:05 hrs", "23:47 h",
  "23:47:05 Hrs.".
- **the seconds are kept when printed and never invented**: "09:14 AM" is
  "09:14".
- **an impossible time or a word is nothing**: "13:10 PM", "00:30 AM",
  "0:30 p.m.", "24:00", "12:60", "12:00:60 PM", "7pm", "09:14:50 xm", words.
- **a version-3 answer still means what it meant**: 24-hour times parse as
  before. The measured Nu stub (`NU_0914_READING`, "09:14") still reads as
  the minute, with nothing invented.
- **the pin** (existing test, updated): `QUESTIONS_VERSION` is "4", and
  `PINNED["4"]` is `17733b96…1af54`.
- `apps/api/test/spei-date-rollover.test.ts`: the two 12-hour cases now
  convert, and each is marked with this bug.

No stub carries a version-4 answer, as the assessment requires
(constitution IV). Whether the model now keeps the seconds is the bench's to
measure.

## Local Verification

- `pnpm --filter @devolada/api test`: the whole API suite ran, because the
  path filter did not reach vitest. Before re-pinning the hash, 935 passed and
  1 failed, the expected pin (`PENDING` against the new hash).
- `npx vitest run test/consta/reader-questions.test.ts
  test/spei-date-rollover.test.ts` (in `apps/api`), after re-pinning: 25
  passed, 2 files.
- `pnpm --filter @devolada/api typecheck`: clean.
- `spec-lint`, `pending-lint`, `gen-banks --check`, `contrast-lint`: clean.
  contrast-lint's AAA warnings are older than this change.
- **Not run**: a version-4 reading on a real model. This environment cannot
  reach the Workers AI binding, and the captures are the creator's.

## Deviations from Assessment

- **The assessment was edited.** This command's guardrail says never to edit
  `assessment.md`. The creator asked in the same instruction for the 13:20
  case to be added to it as evidence, so it went in as a dated addendum at the
  end of **Evidence** ("Added 2026-09-29, at the fix"). No other section
  changed: the remediation, the file list and the tests stand as written.
- **Two small widenings of the accepted forms**, both inside the assessment's
  intent:
  - A trailing "hrs." or "h." with a period is accepted.
  - A time written with no space before its mark ("09:14:50AM") is accepted.
- **An hour of 0 with a mark** ("00:30 AM") is null, because a 12-hour clock
  has no hour 0. The assessment named only "above 12". A null costs the
  time's signal and never a wrong time.

## Follow-ups

- **Measure version 4 on the bench** (`/operador` → Lector), beside version 3,
  with these captures:
  - both Nu captures of 09:14;
  - both Nu captures of 13:20;
  - the three Azteca receipts;
  - the bench's own set.

  Mark `time` on each, then write the dated table in place of "not run" in
  `reader.ts`'s header.
- **The debt `cep-bundle-match-reader-unmeasured`** still names version 3 and
  line numbers that moved. Per the assessment, paying it now means version 4
  beside version 3. Update it with `/speckit-debt-log`, or when it is paid.
- **Bank names outside the vocabulary** ("NU" for NUBANK, in three of five Nu
  readings) stopped the one 13:20 capture that kept its seconds. It deserves
  its own `/speckit-bug-assess`, as a general rule for every bank.
- **A time with its zone** ("09:14:50 AM (hora de CDMX)") is still null if
  the model copies the zone despite the rule. The bench will show whether
  that happens.

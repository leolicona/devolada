---
slug: reader-answer-shape-unmeasured
status: open
kind: deliberate
severity: medium
effort: hours
opened: 2026-09-25
---

# Technical Debt: the reader's second answer shape ships unmeasured

## What was traded

receipt-reader-tuning (plan D10, research R5) lets the operator choose Gemma 4
26B A4B as the reader. How Gemma 4 answers through the Workers AI binding is not
documented and has not been measured. So the rule that takes the answer's text
reads `response` (the shape measured on Mistral since 2026-08-19) and then falls
back to `choices[0].message.content` (the OpenAI-style shape some Workers AI
models use). The implementation container cannot reach the binding. Constitution
IV forbids stubbing a shape nobody measured. So the second branch ships with no
test (tasks T008).

## Where it lives

- `apps/api/src/consta/extraction/reader.ts::answerText` — the
  `choices?.[0]?.message?.content` branch. Its comment names this entry.
- `apps/api/test/consta/helpers.ts::aiReturning` — it stubs only the `response`
  shape, on purpose.

## Interest

- Nothing proves the `choices` branch works. It is either dead code or the one
  path Gemma 4 needs.
- If Gemma 4 answers in a third shape, every Gemma 4 reading fails as
  `READER_UNREADABLE`. On the payer's path the default then reads, and the row
  records `fallback_from`, so the payer loses up to 8 s. On the bench the column
  shows "Respuesta sin datos".

## Paying it

tasks T038, after the first Gemma 4 upload to the bench on dev (T037):

1. Copy one Gemma 4 raw answer and one Mistral raw answer, word for word, from
   dev's `bench_readings.raw_output` into fixtures in
   `apps/api/test/consta/helpers.ts`, each with its date. The raw answer is
   what `answerText` returned. If Gemma 4 needed a new branch, keep the
   binding's whole answer too.
2. Add a test in `apps/api/test/reader-model.test.ts` (cites
   `receipt-reader-tuning US1`) that reads both answers through `answerText`
   and `parseReaderOutput`.
3. Remove every branch of `answerText` that no measured answer uses.

Confirmed paid when:

```
grep -n "unmeasured" apps/api/src/consta/extraction/reader.ts   # no output
pnpm --filter @devolada/api test -- test/reader-model.test.ts   # the fixture test passes
```

**Trigger**: before Gemma 4 is chosen in prod's `/operador` → Lector, or before
the first release tag that carries receipt-reader-tuning, whichever comes first.

## Notes

The same bench run also pays `receipt-triage-reader-unmeasured` (tasks T039).

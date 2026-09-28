---
slug: cep-bundle-match-reader-unmeasured
status: open
kind: deliberate
severity: medium
effort: hours
opened: 2026-09-27
---

# Technical Debt: the reader's version-3 questions were shipped unmeasured

## What was traded

cep-bundle-match (spec 013, D15) asks the reader two more things in
`QUESTIONS_VERSION` "3": `hora` with its seconds when the receipt prints them,
and `cuentaOrigen`, the visible digits of the account the money left. Tasks
T015 and T016 require measuring both on the bench of spec 011 (`/operador` →
Lector) with real captures — an Azteca receipt that prints seconds and
"Guardadito ***8301", one that prints `HH:MM` only, one with no sender
account — before any test stub copies them (constitution IV: a stubbed answer
is a measured one).

The implementation session of 2026-09-27 ran in a container that cannot reach
the Workers AI binding, and the captures are the creator's. So version 3
shipped with its wording written from the receipts as the spec and the bug's
measurement describe them; the bench learned to mark `time` and `senderTail`
(T014), so the measurement can be taken; and the tests stand the reader in
with provisional readings. Same shape as `receipt-triage-reader-unmeasured`.

## Where it lives

- `apps/api/src/consta/extraction/reader.ts:71` — the header's version-3
  paragraph: "**not run — this implementation environment cannot reach the
  Workers AI binding, and the captures are the creator's** (2026-09-27)"
  where the dated table belongs.
- `apps/api/src/consta/extraction/reader.ts::QUESTIONS_VERSION` — "3", pinned
  by hash in `apps/api/test/consta/reader-questions.test.ts` (`PINNED["3"]`).
- `apps/api/src/consta/extraction/reader.ts:175` — the unmeasured question,
  `"cuentaOrigen": "<the digits of the account the money was sent FROM …`, and
  its sender-side rule in `RULES`; `hora`'s "HH:MM:SS when the receipt prints
  seconds" beside it.
- `apps/api/test/consta/helpers.ts::AZTECA_SECONDS_TAIL_READING`,
  `::AZTECA_1858_READING`, `::MINUTE_ONLY_READING` — the provisional readings,
  under the comment "**PROVISIONAL, NOT MEASURED** (2026-09-27)"; every
  cep-bundle-match lifecycle test derives from them
  (`apps/api/test/cep-bundle-match.test.ts`).
- `specs/013-cep-bundle-match/tasks.md` — T015 and T016 left open.

## Interest

- A receipt's time read wrong shifts the receipt's instant against the
  matcher's window (−60 s / +180 s, 30 s margin, `consta/bundle/match.ts`).
  Off by more than the window, the payer's own transfer falls outside it and
  the payment goes undecided — the clave is asked (fails safe, but costs
  SC-001 and SC-005). Seconds invented or misread by tens of seconds can flip
  the nearest choice between two transfers of the same payer (F1: 83 s apart),
  confirming the right payer with their other transfer.
- A `cuentaOrigen` answer that is really the destination's digits ("417") or a
  folio fits no candidate's sender account: undecided, the clave is asked —
  SC-005 ("80% of Azteca receipts confirmed without asking") stays unproven.
- Version 3 changed the prompt every field is read with; whether the clave,
  the reference or the banks read worse than under version 2 is unknown until
  the tally compares them.
- The lifecycle tests prove the matcher and the wiring against answer shapes
  nobody has seen the model give (seconds as "07:10:58", the tail as "8301").

## Paying it

With `pnpm --filter @devolada/api dev` (or a preview) on the real `AI`
binding, open `/operador` → Lector, add the three captures beside the bench's
own receipts, read them all with question versions 3 and 2 on the chosen
model, and mark every field — `time` and `senderTail` included. If a field is
worse in version 3, the wording goes back to T013 and is measured again.
Otherwise write the dated table into `reader.ts`'s header in place of "not
run" (each capture's raw `hora` and `cuentaOrigen`, the wrong counts per field
of both versions — no name, RFC or whole account), replace the three
provisional readings in `test/consta/helpers.ts` with the raw answers the
bench captured (named and dated), and mark T015 and T016 done.

Confirmed paid when:

```
grep -n "PROVISIONAL, NOT MEASURED" apps/api/test/consta/helpers.ts             # no output
grep -n "the captures are the creator's\*\* (2026-09-27)" apps/api/src/consta/extraction/reader.ts   # no output
grep -nE "^- \[[xX]\] T01[56] " specs/013-cep-bundle-match/tasks.md             # two lines
pnpm --filter @devolada/api test -- test/cep-bundle-match.test.ts               # green on the measured stubs
```

**Trigger**: before the first release tag that carries cep-bundle-match
(`production-launch D1` — the tag is the approval).

## Notes

- `receipt-triage-reader-unmeasured` is the same trade for version 1's
  questions and is still open; one bench session can pay both.
- `QUESTIONS_VERSION` moving is what keeps the two wordings apart in the
  bench's tally, so no reading of version 2 is ever counted as version 3.

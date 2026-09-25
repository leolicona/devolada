---
slug: receipt-triage-reader-unmeasured
status: open
kind: deliberate
severity: medium
effort: minutes
opened: 2026-09-25
---

# Technical Debt: the reader's two new questions were shipped unmeasured

## What was traded

receipt-triage (T016, quickstart Step 0, research R2, R14) asks the reader two
more questions in the same prompt: the referencia numérica, and the digits and
kind of the destination account. The plan requires measuring the new prompt on
the product creator's receipts before the feature is called done — receipt 1
(Banorte summary, no clave, no reference, CLABE ••••8195) and receipt 2 (Azteca,
reference `038195`, destination `195`) — and tightening the prompt if the model
takes a folio for a reference or misreads destination digits.

The implementation session (2026-09-25) ran in a container that cannot reach the
Workers AI binding, and the receipts themselves were uploaded in an earlier
session and are never committed. So the prompt shipped with its rules written
from the receipts as described in the spec, and every test stubs the reader at
the binding (constitution IV) with the answers the spec records
(`RECEIPT_1_READING`, `RECEIPT_2_READING`).

What this costs while unpaid, concretely:

- A folio or authorisation number of ≤ 7 digits read as the reference sends a
  search that finds nothing — the payer is asked, as for any misread (spec Edge
  Cases), but receipt 2's promised zero-question path (SC-002) is unproven.
- A misread destination that ends none of the ISP's accounts stops a clear
  capture as `wrong_destination` — kindly worded, but a false stop. Only a
  `completa` picture can be stopped, which bounds it.
- A reference returned as a JSON number loses its leading zero; `reader.ts`
  keeps the text of the number, so `038195` would become `38195` and never
  agree with the provider's reading.

## Where it lives

- `apps/api/src/consta/extraction/reader.ts` — `FIELDS` and `RULES`, and the
  header comment that says "not run".
- `specs/010-receipt-triage/tasks.md` — T016's notes.

## What paying it looks like

With `pnpm --filter @devolada/api dev`, the `AI` binding and a dev link: upload
receipt 1, receipt 2 and any other captures supplied, call `/read`, and record
per receipt `claveDeRastreo`, `referenciaNumerica`, `destino`, `legibilidad`.
Write the dated table into `reader.ts`'s header in place of "not run". If a
folio is taken for a reference, or destination digits are wrong, tighten the
prompt and measure again.

Confirmed paid when:

```
grep -n "not run" apps/api/src/consta/extraction/reader.ts   # no output
grep -n "measured 20" apps/api/src/consta/extraction/reader.ts # the dated table
```

**Trigger**: before the first release tag that carries receipt-triage
(`production-launch D1` — the tag is the approval).

# BUGS

History of defects found in code **already shipped to production**. This file is the tracker (solo-dev project); there is no mirror tracker.

BUG-002…006 stretch that definition on purpose: they were found **live on dev**, against the real provider, in a channel (`direct-payment`) that has no production environment yet. They are recorded here rather than inside their specs because this is the project's only defect tracker and a defect buried in a spec's prose stops being a to-do. Each names its affected spec; move them if the split ever needs to be strict.

Format:

```
## BUG-NNN — short title
- Status: open | fixed
- Detected: date · where
- Affected spec: docs/<domain>/<feature>.spec.md
- Symptom / root cause / fix (commit)
- Regression test: <path or "pending">
```

---

## BUG-001 — WispHub API key committed to the public repo
- Status: mitigated, **pending key rotation by the owner**
- Detected: 2026-08-14 · commit `dc1915c` pushed to `feat/store-pwa-shell` (public repo; branch since deleted, commit unreachable from any branch but fetchable by SHA until GitHub GC)
- Root cause: `.gitignore` covered `.env*` but not `.dev.vars`; a `git add -A` swept the file in.
- Fix: file removed from history going forward (amended cherry-pick `340cf88`), `.dev.vars` added to `.gitignore`.
- Remedy: **rotate the WispHub API key** in the panel — the exposed one must be considered burned. The repo being the shipped artifact, this counts as a production defect.
- Regression test: none automatable; prevention rule — secrets only ever live in `.dev.vars`/worker secrets, and `.gitignore` is verified before the first commit of any new secret file.

## BUG-002 — A provider 401 is retried for six hours, in silence
- Status: open
- Detected: 2026-08-18 · live on dev, watching `wrangler tail` while a real proof was submitted
- Affected spec: docs/consta/validation.spec.md (D3), docs/direct-payment/direct-payment.spec.md (D7)
- Symptom: the payment page sits on *"Verificando tu pago"* until the payment expires 6 h later and the customer is told to contact their ISP — for a transfer that really happened. Nothing alerts; the only trace is `last_error` in a table nobody reads. Measured: row `6b856e39` burned **15 attempts** against a credential that was never going to work.
- Root cause: two layers, each losing information. `apps/consta/src/provider/apicep.ts:81` collapses every `!res.ok` into one `ProviderError`, so a 401 (dead credential, never self-heals) and a 503 (provider blip, heals in minutes) leave through the same hole as `PROVIDER_ERROR` (`apps/consta/src/routes/validate/index.ts:38`). Then `apps/api/src/direct-payments/validation.ts:148` calls `retryLater(code)` **without looking at the code** — so even `CONSTA_AUTH_FAILED`, which `apps/api/src/consta/client.ts:91` already distinguishes correctly, rides the D7 schedule. The distinction exists in the type and changes nothing in behaviour.
- Fix: an authentication failure is terminal, not retryable. Consta needs its own code for a provider 401 instead of folding it into `PROVIDER_ERROR` (contract change → spec), and `retryLater` must branch on the code so the payment fails once, loudly, and visibly to the operator. Mitigated in the meantime by the post-deploy credential probe (CICD D6), which turns the silence into a red deploy.
- Regression test: pending

## BUG-003 — `invalid` with no CEP data is treated as a verdict, and killed on the first attempt
- Status: open
- Detected: 2026-08-18/19 · six live submissions on dev across two customers and three distinct receipts
- Affected spec: docs/direct-payment/direct-payment.spec.md (D2, D7), docs/consta/validation.spec.md (D3)
- Symptom: a legitimate payment, exact amount, is declared `invalid` with `next_validation_at = NULL` — dead on the first try. The customer reads *"No pudimos verificar tu transferencia. Revisa los datos e intenta de nuevo"*, which blames them for something they did not do.
- Root cause: `apps/api/src/direct-payments/validation.ts:159` makes `invalid` terminal. But **two distinct, measured causes produce a provider `invalid` carrying no `cepDetails` at all** — no tracking key, no amount, no `cepStatus` — and neither is a verdict: **(a)** the receipt was captured before the bank accepted the transfer, so the image has no clave de rastreo to read (Nu does not print it while *"En proceso"*); **(b)** the provider's OCR misreads a readable receipt. Both are indistinguishable on the wire from *"this transfer is fake"*. A genuine verdict contradicts something and carries the CEP to contradict it with; this is the absence of one. Consta's `mapStatus` cannot help: D3 recognises "not published yet" only by `cepStatus: "EN PROCESO"`, which is absent precisely when no CEP record exists.
- Evidence: cause (a) — the same transfer (folio `QUTHH45WF`) failed as `invalid` from an *"En proceso"* capture and **confirmed** three minutes later from a re-capture showing *"Aceptada"* and its clave. Cause (b) — receipt `IMG_4931` (folio `QUTHR5TKX`) returned `invalid` twice through the receipt door at 19 and 30 minutes of age, and its clave, read by eye off that same image, **confirmed through the transfer door in 11 s**. CEP age is ruled out: a 16-minute-old receipt confirmed while that 30-minute-old one failed.
- Fix: an `invalid` carrying no `cepDetails` must ride the D7 schedule instead of terminating, and the copy must stop blaming the customer — for (a) tell them to re-capture once the bank accepts; for (b) offer the manual door. Note that retrying the *same image* never fixes (a): that capture will never contain the clave.
- Regression test: pending

## BUG-004 — The Consta deadline is shorter than a healthy provider call, so paid verdicts are thrown away
- Status: open
- Detected: 2026-08-18 · measured twice, and caught live in `wrangler tail`
- Affected spec: docs/polish/provider-latency.spec.md (D1, D6), docs/integrations/apicep.md
- Symptom: `POST /pay` answers after 30.5 s with the payment still `validating`, while Consta's own request shows `[canceled] wall=29875ms` — we hung up on a call that was still working. apiCEP had already done the work and already charged for it, so the credit is spent on a verdict we discard, and the retry pays again. With six D7 slots the worst case is six paid calls thrown away before `expired`.
- Root cause: `apps/api/src/consta/client.ts:18` sets `CONSTA_TIMEOUT_MS = 30_000`, and its comment states the premise honestly — "~2× that worst case" over a measured 13.5–14.6 s. That premise is stale: a real direct-mode validation measured **38.5 s** wall-clock in the Worker (`POST /validate 200 OK (38554ms)`, with an admin call in the same Worker at 76 ms, so the latency is the provider's, not the environment's).
- Fix: raise the deadline on the new evidence (45–60 s), and correct the latency range in `docs/integrations/apicep.md`, which still documents 12.5–19 s.
- Regression test: pending

## BUG-005 — A D1 timeout turns `pay` into a 500 and silently drops the attempt counter that guards D8
- Status: open
- Detected: 2026-08-18 · live on dev, one occurrence
- Affected spec: docs/direct-payment/direct-payment.spec.md (D7, D8)
- Symptom: `POST /pay → 500` after 30.5 s with `D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset`; the cron in the same minute threw too. The customer got an error page, not *"Verificando"*. The payment itself was rescued 2.5 min later by the sweep — D7's "the row is born with its first slot already set" doing exactly the job it was written for, against an interruption the spec had not listed (it names eviction, deploy and a stalled provider; D1 itself failing belongs on that list).
- Root cause: the failing write took the `validationAttempts` increment with it — the row finished with `validation_attempts = 1` after **two** attempts (the inline one and the sweep's). That counter is D8 carve-out (a): it is written *before* the provider call precisely so that "a call may have landed" is knowable in advance. **When D1 is the thing that fails, the defence that depends on writing to D1 fails with it.** This time it did not bite because `alreadyValidated` came back false; with other timing an honest retry of a real payment would be rejected as `TRANSFER_ALREADY_USED`.
- Fix: undecided — needs a design pass. The counter cannot be made durable by writing it harder to the same store that just failed. Options worth weighing: treating a write failure as "assume the call landed", or moving the guard off the counter.
- Regression test: pending

## BUG-006 — `trackingKey` has no format validation, so malformed keys reach the paid provider
- Status: open
- Detected: 2026-08-18 · found by making the mistake live on dev
- Affected spec: docs/direct-payment/direct-payment.spec.md (D13)
- Symptom: a clave de rastreo transcribed from a receipt by an OCR tool arrived as `"NU3AGKK16AH58LTOVUQH55PE З0AA"` — **29 characters, containing a space (U+0020) and a Cyrillic З (U+0417) where a `3` belongs**. It passed validation, spent a paid provider call (~$0.25), and left the payment `invalid` and terminal. The customer-facing copy — *"Revisa los datos e intenta de nuevo"* — happened to be right, but only by accident, and only after the money was spent.
- Root cause: `apps/api/src/routes/direct-payments/schema.ts:33` accepts `z.string().trim().min(5).max(50)`. No length, no alphabet. `trim()` does not help when the damage is mid-string.
- Fix: a clave de rastreo is 28 characters of `[A-Z0-9]`. Validate the shape at the edge and reject it for free with copy that says *which* field is wrong. D13's whole premise is that each attempt costs money, so what cannot possibly be valid must never reach the provider. This is also a prerequisite for any automated extraction: whatever a reader produces has to pass the same check — measured 2026-08-19, a vision model misread the same receipt identically ten times out of ten, producing **27** characters, which this check catches for free.
- Regression test: pending

## BUG-007 — the payer types their bank as free text, and the placeholder teaches three wrong names
- Status: open
- Detected: 2026-08-19 · `apps/pago/src/features/pago/PaymentPage.tsx:91`, found while implementing Consta D12
- Affected spec: docs/direct-payment/direct-payment.spec.md
- Symptom: a customer who really paid is told their transfer could not be verified, with nothing on the wire saying why. Measured 2026-08-19 against one real settled transfer, changing only `sender.bank`: `NUBANK` → `valid` in 7.0 s; `HSBC` → **`invalid`, no `cepDetails`, no `cepStatus`, in 1.3 s** — byte-indistinguishable from a transfer that never happened. apiCEP never rejects a bank name, so no status code will ever say the picker was wrong.
- Root cause: the field is an unconstrained `<Input>`, and its placeholder is `"BBVA, Nu, Banorte…"` — **all three of those are outside apiCEP's vocabulary**, which spells them `BBVA MEXICO`, `NUBANK` and `BANORTE`. The product is prompting the payer to type values it cannot validate. `apps/api/src/routes/direct-payments/schema.ts:34` then accepts anything from 2 to 80 characters. apiCEP tolerates *some* near-misses (`Nu` aliased to NUBANK and validated), which is why this has not failed constantly — the tolerance is undocumented, unmeasured, and silent when it runs out.
- Fix: the payer picks from a list instead of typing. Consta serves it at `GET /banks` (its D12); the ISP's own `speiBank` needs the same treatment, since it travels as `beneficiary.bank` on every call.
- **Blocks a deploy**: Consta D12 now refuses an unknown bank name with 400, and `apps/api/src/consta/client.ts:94` maps every non-2xx to `CONSTA_UNAVAILABLE`, which is retryable. Until the picker lands, shipping D12 to a Devolada environment would turn a mistyped bank into the full six-hour schedule instead of one fast failure — the exact disease D9–D16 exist to cure. Fix this, or land Consta D9 first so a 400 reads as terminal.
- Regression test: pending

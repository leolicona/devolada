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

## BUG-021 — Tenant-wide statements bound more than D1's 100 parameters
- Status: fixed (latent — never triggered: the demo tenant holds 14 customers and prod has no deploy)
- Detected: 2026-09-07 · code reading during the review of PR #167
- Affected spec: docs/direct-payment/admin-links-view.spec.md (D4/D5), docs/reconciliation/cobros-live.spec.md (D4)
- Symptom: none observed. `linksRoster`, `listLinks` and `listPaymentRequests` bound the whole roster (or every debtor) into one multi-row INSERT or one `IN (…)`. D1 caps bound parameters at 100 per query; the roster insert binds six values per row (four columns plus the client-side `id` and `created_at` defaults), so the first tenant past 16 customers would have failed the roster and the batch generator, and past 99 debtors the Cobros read. The local D1 the suite runs on (workerd's SQLite) does not enforce the cap, which is why no test ever failed. Fix: `src/db/params.ts` (`D1_MAX_PARAMS`, `chunks`) on every statement that grows with the tenant; the sweeps stay under the cap by their `BATCH` of 20.
- Regression test: `apps/api/test/direct-payments-links.test.ts` ("150 customers get 150 links in one read") exercises the chunked paths; the cap itself cannot be reproduced locally.

## BUG-020 — The Links roster rewrote every customer's link row on every read
- Status: fixed
- Detected: 2026-09-07 · review of PR #167 (presence-freshness), on dev since the pilot-UX round (2026-09-02)
- Affected spec: docs/direct-payment/admin-links-view.spec.md (D5), docs/polish/presence-freshness.spec.md (D4)
- Symptom: every `GET /direct-payments/links/roster` ran `INSERT … ON CONFLICT DO UPDATE` over the whole tenant, cache hit or not — one row written per customer per read (measured in SQLite: an upsert with unchanged values still writes the row). Harmless while a read was a page load or a click; #167's 3-minute heartbeat made it periodic: with 500 customers, ~80k rows written per present tab per 8 h, against the free plan's 100k rows written per day per account (the ceiling CICD.md D7 already met once). Root cause: the upsert was the mechanism for "every customer has a link" (D5). Fix: `ensureLinks` reads what exists, inserts only the missing usuarios (`ON CONFLICT DO NOTHING`, so two members listing at once do not collide), refreshes a numeric id only when it moved; and Links carries no heartbeat (presence-freshness D4 amended).
- Regression test: `apps/api/test/direct-payments-links.test.ts` (the second read of 150 customers creates nothing and keeps every token); the D5 tests keep covering the id refresh on a recycled id.

## BUG-019 — Links read a stalled WispHub as "conecta tu llave"
- Status: fixed
- Detected: 2026-09-03 · presence-freshness scenario 5 (a background failure with nothing to show) failed against the deployed behaviour
- Affected spec: docs/direct-payment/admin-links-view.spec.md
- Symptom: with the key configured and WispHub down, the roster page showed "Sin conexión a WispHub. Conecta tu llave en Integraciones" — a prompt to fix something that was not broken. Root cause: `LinksScreen` keyed the integration prompt on `status === 503`, and the roster answers 503 for both `WISPHUB_NOT_CONFIGURED` and `WISPHUB_UNAVAILABLE`. Fix: the screen reads the error code (presence-freshness DoD).
- Regression test: `apps/admin/test/presence-freshness.test.tsx` scenario 5 (503 `WISPHUB_UNAVAILABLE` → `ListError` with Reintentar) alongside `links.test.tsx` "without WispHub the page points at Integraciones" (503 `WISPHUB_NOT_CONFIGURED` → the prompt)

## BUG-018 — "consultado hace un momento" after a cache hit up to 30 s old
- Status: fixed
- Detected: 2026-09-03 · code reading while retiring the "Actualizar" button (deployed on dev since the pilot-UX round)
- Affected spec: docs/reconciliation/cobros-live.spec.md (D3), docs/direct-payment/admin-links-view.spec.md
- Symptom: pressing "Actualizar" inside the 30-second display window reset the freshness label to "hace un momento" although the list came from the cache, so the label affirmed a freshness it had not obtained. Root cause: both handlers sealed `readAt: now.getTime()` regardless of where the answer came from. Fix: the cached entry carries `readAt` and the handlers forward it (presence-freshness D7).
- Regression test: `apps/api/test/presence-freshness.test.ts` (scenarios 8, 9 — two reads inside the window answer the same `readAt`)

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
- Status: **fixed** (2026-08-19, Consta D10/D11 + direct-payment D17)
- Detected: 2026-08-18/19 · six live submissions on dev across two customers and three distinct receipts
- Affected spec: docs/direct-payment/direct-payment.spec.md (D2, D7), docs/consta/validation.spec.md (D3)
- Symptom: a legitimate payment, exact amount, is declared `invalid` with `next_validation_at = NULL` — dead on the first try. The customer reads *"No pudimos verificar tu transferencia. Revisa los datos e intenta de nuevo"*, which blames them for something they did not do.
- Root cause: `apps/api/src/direct-payments/validation.ts:159` makes `invalid` terminal. But **two distinct, measured causes produce a provider `invalid` carrying no `cepDetails` at all** — no tracking key, no amount, no `cepStatus` — and neither is a verdict: **(a)** the receipt was captured before the bank accepted the transfer, so the image has no clave de rastreo to read (Nu does not print it while *"En proceso"*); **(b)** the provider's OCR misreads a readable receipt. Both are indistinguishable on the wire from *"this transfer is fake"*. A genuine verdict contradicts something and carries the CEP to contradict it with; this is the absence of one. Consta's `mapStatus` cannot help: D3 recognises "not published yet" only by `cepStatus: "EN PROCESO"`, which is absent precisely when no CEP record exists.
- Evidence: cause (a) — the same transfer (folio `QUTHH45WF`) failed as `invalid` from an *"En proceso"* capture and **confirmed** three minutes later from a re-capture showing *"Aceptada"* and its clave. Cause (b) — receipt `IMG_4931` (folio `QUTHR5TKX`) returned `invalid` twice through the receipt door at 19 and 30 minutes of age, and its clave, read by eye off that same image, **confirmed through the transfer door in 11 s**. CEP age is ruled out: a 16-minute-old receipt confirmed while that 30-minute-old one failed.
- Fix: two layers, because the information had to exist before it could be acted on. **Consta** (D11) splits `invalid` into `contradicted` (a CEP came back and disagrees) and `not_found` (nothing came back at all), the latter carrying `hint: "verify_inputs"`, and records which kind in `validations.reason` so the frequency stops being a matter of opinion. On the way, D10: an unrecognised provider status now raises a failure instead of falling through to `invalid`, which was the same mistake waiting for the next status apiCEP invents. **Devolada** (D17) rides the D7 schedule on `not_found` and terminates only on `contradicted`; a *missing* reason is read as `not_found`, so no older Consta can turn silence back into an accusation. The copy follows: *"todavía no aparece en Banxico"* while waiting, *"no encontramos tu transferencia"* on `expired`, and never again *"revisa los datos e intenta de nuevo"* to somebody who did nothing wrong.
- **What the fix costs, knowingly**: a transfer that genuinely never happened now burns the whole six-hour schedule before expiring, instead of ending on the first call. Nothing on the wire distinguishes it from a real one, so this is the price of not guessing — and it is the right way round, since the schedule is paid in credits and the alternative was paid by customers who really paid. Shortening it needs Consta D9's `retryable`, not a new guess.
- **What this fix does not do**: it does not make (a) and (b) distinguishable, because they are not. It also does not help a payer whose capture will never contain a clave — retrying that same image cannot work — and there is still no ISP-facing view of a payment stuck in `validating`, so "the ISP will see it" is currently a promise the admin app does not keep.
- Regression test: `apps/api/test/direct-payment.test.ts` scenarios 36–40, `apps/consta/test/validate.test.ts` scenarios 24/25/14, `apps/pago/test/pago.test.tsx` scenarios 41–42

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
- Status: **fixed** (2026-08-19, direct-payment D16)
- Detected: 2026-08-18 · found by making the mistake live on dev
- Affected spec: docs/direct-payment/direct-payment.spec.md (D13)
- Symptom: a clave de rastreo transcribed from a receipt by an OCR tool arrived as `"NU3AGKK16AH58LTOVUQH55PE З0AA"` — **29 characters, containing a space (U+0020) and a Cyrillic З (U+0417) where a `3` belongs**. It passed validation, spent a paid provider call (~$0.25), and left the payment `invalid` and terminal. The customer-facing copy — *"Revisa los datos e intenta de nuevo"* — happened to be right, but only by accident, and only after the money was spent.
- Root cause: `apps/api/src/routes/direct-payments/schema.ts:33` accepts `z.string().trim().min(5).max(50)`. No length, no alphabet. `trim()` does not help when the damage is mid-string.
- Fix: `^[A-Za-z0-9]{6,30}$` after trimming, in `apps/api/src/routes/direct-payments/schema.ts` and in Consta's own schema (its D13). D13's premise is that each attempt costs money, so what cannot possibly be valid must never reach the provider. This is also a prerequisite for any automated extraction: whatever a reader produces has to pass the same check — measured 2026-08-19, a vision model misread the same receipt identically ten times out of ten, producing **27** characters, which this check catches for free.
- **Correction to this entry's original fix.** It said "a clave de rastreo is 28 characters of `[A-Z0-9]`". That is Nu's length, not Banxico's rule: apiCEP's own documented example carries a **ten**-character key (`HSBC712057`), and Devolada's payers bank anywhere. A fixed 28 would have locked out every bank issuing a shorter clave — trading a false negative for a false rejection. The bound is a range and a character class, which is what catches the actual failure: whitespace, pasted newlines and the two-line wrap.
- Regression test: `apps/api/test/direct-payment.test.ts` — scenarios 32 and 33, including this bug's live 29-character string with its Cyrillic З

## BUG-007 — the payer types their bank as free text, and the placeholder teaches three wrong names
- Status: **fixed** (2026-08-19, direct-payment D16)
- Detected: 2026-08-19 · `apps/pago/src/features/pago/PaymentPage.tsx:91`, found while implementing Consta D12
- Affected spec: docs/direct-payment/direct-payment.spec.md
- Symptom: a customer who really paid is told their transfer could not be verified, with nothing on the wire saying why. Measured 2026-08-19 against one real settled transfer, changing only `sender.bank`: `NUBANK` → `valid` in 7.0 s; `HSBC` → **`invalid`, no `cepDetails`, no `cepStatus`, in 1.3 s** — byte-indistinguishable from a transfer that never happened. apiCEP never rejects a bank name, so no status code will ever say the picker was wrong.
- Root cause: the field is an unconstrained `<Input>`, and its placeholder is `"BBVA, Nu, Banorte…"` — **all three of those are outside apiCEP's vocabulary**, which spells them `BBVA MEXICO`, `NUBANK` and `BANORTE`. The product is prompting the payer to type values it cannot validate. `apps/api/src/routes/direct-payments/schema.ts:34` then accepts anything from 2 to 80 characters. apiCEP tolerates *some* near-misses (`Nu` aliased to NUBANK and validated), which is why this has not failed constantly — the tolerance is undocumented, unmeasured, and silent when it runs out.
- Also affected the ISP's side, and worse: `apps/admin` settings offered `"STP, BBVA, Banorte…"` for `speiBank`, which travels as `beneficiary.bank` on **every** validation that ISP runs. One wrong value there loses every payment to that ISP, not one.
- Fix: both fields pick from apiCEP's 97 names. The payer's page uses a native `<select>` (97 options, filled once, on a phone); the admin uses the shadcn `Select` it already had. One generated constant per app, from `docs/integrations/apicep.md` via `scripts/gen-banks.mjs`, with `--check` in CI so the three copies cannot drift. `apps/api` enforces the enum at its edge, so a direct POST is refused too. Consta serves the same list at `GET /banks` for other integrators (its D12).
- ~~**Blocks a deploy**~~ — cleared by the same change. The concern stands as a rule: Consta D12 refuses an unknown bank with 400, and `apps/api/src/consta/client.ts:94` still maps every non-2xx to `CONSTA_UNAVAILABLE`, which is retryable. Devolada no longer sends one, but until Consta D9 lands, any *other* integrator's 400 rides a retry schedule it can never escape.
- Regression test: `apps/api/test/direct-payment.test.ts` scenarios 30–31, `apps/pago/test/pago.test.tsx` scenario 34

## BUG-008 — an ISP's stored bank name survived D16 and broke every payment to it
- Status: **fixed** (2026-08-19)
- Detected: 2026-08-19 · live on dev, one hour after D16 shipped, by uploading a receipt through the payment UI
- Affected spec: docs/direct-payment/direct-payment.spec.md (D4, D16)
- Symptom: a receipt upload that had worked twice that morning came back `CONSTA_UNAVAILABLE` in about one second — not a timeout — and the payment sat in `validating` with `consta_status: null`, scheduled to retry for six hours. The customer saw *"Verificando tu pago"* for a payment nothing would ever validate.
- Root cause: the dev ISP held `spei_bank = 'Klar'`; apiCEP's vocabulary spells it `KLAR`. **D16 closed the form and left the data.** `speiBank` travels as `beneficiary.bank` on every validation, so Consta's new `z.enum` (its D12) refused the request with 400 — and `apps/api/src/consta/client.ts` maps every non-2xx to `CONSTA_UNAVAILABLE`, which is retryable. A change that was supposed to turn a silent failure into a fast one turned it into a slow one instead, for this ISP's every payment.
- **The lesson, and it is the general one**: validating an enum at the edge governs new writes only. Values already in the database keep whatever they had, and a stricter reader downstream turns them into failures — worse failures, if the client reads the refusal as transient.
- Fix: `speiAvailable` now requires the bank to be in the vocabulary, so an ISP whose bank cannot resolve shows the payment page as `unavailable` and points at the store network — which is precisely what D4 already said ("a page that shows a CLABE nothing can validate would let customers transfer into the void"); `runValidation` stops with `SPEI_BANK_UNKNOWN` rather than retrying something no retry can fix; and the settings response carries `bankUnknown` so the ISP is told rather than silently degraded. The dev row was corrected by hand to `KLAR`.
- Regression test: `apps/api/test/direct-payment.test.ts` scenario 35 — verified to fail without the fix


## BUG-009 — the clave de rastreo did not fit its own field, on the two screens that exist to have it proofread
- Status: **fixed** (2026-08-20)
- Detected: 2026-08-20 · measured in a real browser at the 360px floor while reworking the payment page flow (D19)
- Affected spec: docs/direct-payment/direct-payment.spec.md (D16, D17, D18)
- Symptom: a 28-character clave rendered 327px wide inside a 276px input — roughly five characters past the right edge, reachable only by dragging a caret. It affected both screens whose entire purpose is review: D18's *"Leímos estos datos de tu comprobante. Revísalos: si algo no coincide, corrígelo"* and D17's *"revisa que estos datos coincidan con tu comprobante"*. The page asked the payer to check a value it was not showing them, and the hidden part was the tail — where a misread character is most likely to sit, because that is where the reader ran out of receipt.
- Root cause: `Input` is a shared 48px atom in the body font at `text-base`, sized for names and amounts. Nobody had put a 28-character opaque code through it. D16 fixed *which* claves are accepted (BUG-006) and D18 started pre-filling them from a machine reading, and neither step asked whether the value could be seen.
- **The lesson**: a field that holds a machine-generated identifier is not the same control as a field that holds a name, even when both are one line of text. Pre-filling a value the user must verify raises the bar from "can they type it" to "can they read all of it".
- Fix: the clave input renders `font-mono text-sm`. Mono is also what the value deserves — it is a code being proofread, where `0` and `O` must look different — and at 14px the full 28 characters occupy about 235px, inside the 276px the field has at 360px.
- Regression test: `tests/e2e/pago.spec.ts` — "the clave de rastreo fits its field at the 360px floor" (and the hand-typed twin), both verified to fail without the fix. This is also what put `apps/pago` in the browser layer: happy-dom reports no layout, so no component test could ever have caught it (TESTING.md layer 4).


## BUG-010 — the payer-history refs never travelled: the secret behind them is in no deploy
- Status: **fixed** (2026-08-28)
- Detected: 2026-08-28 · live on dev, reading the Consta log after three real payments, while measuring how the learned `retryAfter` behaved
- Affected spec: docs/direct-payment/provisional-release.spec.md (D4), docs/consta/trust-layer.spec.md (US-V15)
- Symptom: every row in Consta's `validations` log had `customer_ref` and `payment_ref` **null** — the five calls of that day included. Nothing was broken, nothing was slow, no page misbehaved: the payer history the trust layer exists to accumulate simply was not being written, and had not been since the refs shipped.
- Root cause: `runValidation` sends both refs only when `env.CUSTOMER_REF_SECRET` is set (correctly — the HMAC has no key without it, and D4 says an unset secret must never block a validation). **No deploy workflow ever set that secret.** `grep CUSTOMER_REF_SECRET .github/workflows/` returned nothing: it existed in `env.ts`, in the client type, in the spec and in the tests, and in no worker. The one place that would have revealed it — a warning when the secret is missing — is exactly what a `?:` optional binding does not give you.
- **The lesson**: an optional dependency whose absence degrades silently needs a loud line in the deploy, not just a comment in the code. Every other secret in this repo already had one (`::warning::` for CONSTA_API_KEY, `::error::` for BETTER_AUTH_SECRET) — this one was written to be optional and therefore was written nowhere. Compare BUG-008: there, a value already in the database survived a stricter reader; here, a value that was never anywhere survived every reader, because nobody asked for it out loud.
- Cost: the refs are the opt-in for history collection and history only accumulates forward, so the window between shipping the refs and this fix is **evidence that cannot be recovered** — the exact loss D12's "starting the shadow late impoverishes the dataset forever" names. It also means the D12 shadow would have been built against an empty block.
- Fix: `CUSTOMER_REF_SECRET` synced in both deploy workflows, with a `::warning::` naming the consequence when it is absent, and a note that the value must stay **stable** — rotating it re-pseudonymises every payer and orphans all history written under the old one.
- Regression test: none in code — the defect lives in the deploy, not the app (the app's own behaviour with and without the secret is already covered under US-D15). The deploy log's warning is the standing check.


## BUG-017 — Two cards edited "the service fee", and only one of them was the fee
- Status: **fixed** (2026-09-03 — settings.spec.md D9)
- Detected: 2026-09-03 · owner, on the dev pilot's Configuración (`/settings/business`)
- Affected spec: docs/admin/settings.spec.md (UI contract, D9), docs/direct-payment/direct-payment.spec.md (D3), docs/admin/account-hub.spec.md (D4)
- Symptom: Configuración offered **Cargo por servicio** and, inside Pago directo por SPEI, **Cargo por servicio SPEI** — two fields, two save buttons, for what the payer sees as one number. Once the SPEI fee had been saved the first card's value changed nothing the payer could see; before, it was the one that counted, and the second card's helper said so in a sentence nobody reads twice.
- Root cause: the general fee was the store channel's, and the SPEI fee was designed as its per-channel override (direct-payment D3). The store network left (pivot D15) and the retirement PR kept the general fee "as the fallback" — which kept its card too. An override with nothing left to override is a duplicate.
- **The lesson**: when a channel leaves, its settings leave with it — a fallback is a value, not a card. What survives a retirement has to be re-read from the payer's side: how many numbers can they see?
- Fix: one control — the SPEI card's field, opened on the fee in force, required, saving `speiServiceFeeCents`; `serviceFeeCents` is read-only (the birth default) and left the PATCH; `#cargo` lands on the SPEI card.
- Regression test: `apps/admin/test/settings.test.tsx` — "scenario 5: the page offers the fee once, opened on the fee in force, and saves it as the SPEI fee"; `apps/api/test/settings.test.ts` — "D9 (BUG-017): the general fee is not patchable".

## BUG-016 — On a phone there was no way to sign out
- Status: **fixed** (2026-09-02, session round)
- Detected: 2026-09-02 · owner's question ("no existe un modo de cerrar sesión, correcto?"); dev pilot affected on every phone and tablet
- Affected spec: docs/admin/shell.spec.md (the sidebar's sign-out), docs/admin/settings.spec.md (UI contract), the brief ("the admin follows the ISP to a phone")
- Symptom: the only "Cerrar sesión" inside the shell lived in the desktop sidebar, hidden under `lg`. The mobile header held the switcher and the credit chip; the bottom bar, the sections. A person on a phone could not sign out except by clearing cookies — on a shared device, the next person inherited the session.
- Root cause: the sidebar was designed first and its footer carried the account; the mobile layout replaced the sidebar with a bar and nobody carried the footer over. The design review of 2026-09-02 added a door to the screens *outside* the shell and missed the shell's own phone layout.
- **The lesson**: a control that lives in a container hidden by a breakpoint needs a home in what replaces it — audit every `hidden … lg:flex` for what it hides.
- Fix: a **Sesión** card at the end of Configuración, for every role, at every width: the email and "Cerrar sesión". The sidebar keeps its button.
- Regression test: `apps/admin/test/session-round.test.tsx` — "BUG-016: a viewer signs out from the Sesión card and lands on login".

## BUG-015 — The 30-day sliding session slid in the database, never in the browser
- Status: **fixed** (2026-09-02, session round)
- Detected: 2026-09-02 · owner asked how long a session lasts; reading Better Auth 1.6.29's `get-session` against our middleware. Every deployed environment affected.
- Affected spec: docs/auth/better-auth.spec.md (D5: "30-day sliding in both apps")
- Symptom: nothing visible for a month — then every active user is signed out 30 days after login, whatever they did in between, and the session row stays alive and orphaned in D1 until it expires on its own.
- Root cause: Better Auth refreshes the row after a day of use (`updateAge`) and re-issues the cookie with a fresh `Max-Age` **on the headers of its own response**. The middleware called `auth.api.getSession` server-side and read only the body, so the `Set-Cookie` never reached the browser; the cookie kept login day's 30-day `Max-Age`. The admin only touched Better Auth's own `get-session` endpoint in the wizard and the invitation page.
- **The lesson**: a server-side call into an auth library is a request without a browser — anything the library says through headers has to be carried over by hand, and a promise about time ("sliding") needs a test that ages a row.
- Fix: `getSession({ returnHeaders: true })` in `requireSession`; its `Set-Cookie` is appended to our response. A fresh row (under a day) still sets nothing — no cookie churn per request.
- Regression test: `apps/api/test/sessions.test.ts` — "BUG-015: after a day of use the window slides in the row AND in the browser's cookie".

## BUG-014 — Better Auth's rate limiter was never really on
- Status: **fixed** (2026-09-02, identity round — better-auth.spec.md D11)
- Detected: 2026-09-02 · spec-vs-code audit of the identity subsystem; every deployed environment is affected (the limiter guards login, codes and invitations)
- Affected spec: docs/auth/better-auth.spec.md (contract: "stays on")
- Symptom: nothing visible — which is the symptom. Unlimited sign-in attempts, code guesses and invitation acceptances from one address.
- Root cause: the spec promised the built-in limiter and nobody configured it. Better Auth's default is `enabled: NODE_ENV === "production"` — a variable no deploy of ours sets — with counters in the isolate's memory, which on Workers is reborn every few minutes and never shared. Even "on", it would have forgotten. And its IP header list is `x-forwarded-for` alone; with no resolvable address every visitor shares one bucket.
- **The lesson**: "the library does it by default" is a claim about the library's runtime, not ours. A guarantee that lives in a default has to be pinned in config and proven by a test that trips it — the same lesson as TD-001's secret, one layer up.
- Fix: explicit `rateLimit` (`enabled` unless `AUTH_RATE_LIMIT=off`, `storage: "database"`, our rules for the code checks and the invitation door), `cf-connecting-ip` first, the `rate_limit` table (migration 0026). The test suite alone pins the off switch.
- Regression test: `apps/api/test/rate-limit.test.ts` — "a fourth sign-in within ten seconds answers 429, and the count lives in rate_limit".

## BUG-013 — "Falta tu llave de WispHub" sent the owner to a page where the key no longer lives
- Status: **fixed** (2026-09-02, identity round)
- Detected: 2026-09-02 · spec-vs-code audit; live on dev since the integrations hub moved the key (PR of integrations-hub D1/D2)
- Affected spec: docs/admin/shell.spec.md (the banner), docs/admin/charge-feed.spec.md (the failure sentences), docs/integrations/integrations-hub.spec.md (D1: the key lives at `/integrations/wisphub`)
- Symptom: the shell's banner button "Configurar" opened Configuración, where there is no WispHub key anymore; two feed sentences ("Revísala en Configuración", "Falta la llave de WispHub en Configuración") pointed the same way. The owner who followed the product's own instruction found nothing.
- Root cause: the hub moved the key and its screen; the two surfaces that named the old place were not in the hub's DoD, and no test asserted where the banner's link went.
- **The lesson**: when a thing moves, grep for the sentence that names where it was — copy is a pointer too.
- Fix: the button goes to `/integrations/wisphub`; the feed sentences say Integraciones.
- Regression test: `apps/admin/test/shell.test.tsx` — "BUG-013: the banner's button goes to /integrations/wisphub, not to Configuración".

## BUG-012 — The admin feed never showed a real partial payment as partial
- Status: **fixed** (2026-09-01, by the payments merge — business-and-memberships D6)
- Detected: 2026-09-01 · found in review of the merge PR (#129), reading what the retired `charges` twin used to write; the dev pilot is the affected surface (it is where the pilot ISP operates)
- Affected spec: docs/direct-payment/partial-payment.spec.md (D15), docs/admin/charge-feed.spec.md
- Symptom: a short transfer landed `partial` and the payer's page said "Faltan $150", but the ISP's feed row wore no "Pago parcial" label and its detail showed no "Faltan" line — the row looked like a full payment of the amount received.
- Root cause: the feed derived `missingCents = invoiceCents + carriedBalanceCents − totalCents` from the `charges` twin, and the twin was written with `invoiceCents = ispRegisteredCents` — what **arrived** (below the debt no fee is covered, so `ispRegisteredCents = received`) — with `carriedBalanceCents = 0`. The gap was always zero on real rows; D15's tests passed on hand-built fixtures whose `invoiceCents` was the ask.
- **The lesson**: a derived number is only as true as the column it derives from, and a column reused across two records with two meanings ("what was asked" on the lifecycle, "what was registered" on the twin) lies to whoever reads the wrong one. Fixtures that hand-write both numbers cannot catch it — only a row born through the real path can.
- Fix: one row (the merge). `invoiceCents`/`carriedBalanceCents` are the lifecycle's own — the ask — and the registered amount got its own column, `registeredCents`.
- Regression test: `apps/api/test/charge-feed.test.ts` — "BUG-012: a partial row carries what was asked, so the feed can name the gap".

## BUG-011 — "Ver los datos para transferir" resurfaced the receipt's stale draft
- Status: **fixed** (2026-08-30)
- Detected: 2026-08-30 · live on dev, on a phone, rehearsing the partial flow with a real receipt
- Affected spec: docs/direct-payment/partial-payment.spec.md (D7, scenario 9), docs/direct-payment/direct-payment.spec.md (D18, D19)
- Symptom: a receipt-born payment landed `partial`; tapping "Ver los datos para transferir" — whose promise is the CLABE and the fresh debt — opened "Paso 2 de 2: Confirma estos datos" instead, pre-filled with the old reading (the spent clave, the short amount) and the "no pudimos sacar todos los datos" warning. The payer who owed the rest was handed the form that re-submits the payment they already made.
- Root cause: the D18 draft (the reading waiting for the payer to confirm it) renders **ahead of the step machine**, and nothing consumed it when the payment was born — `pay.onSuccess` set the payment and left the draft alive behind it. The partial screen's button cleared the payment (`retry()`) and set the step, but the surviving draft outranked both. The button's own comment records its twin: "`retry` alone left the remembered step at `proof`, so this button used to land on the upload form" — the step was fixed, the draft was a second state with the same defect.
- **The lesson**: a screen that renders by its own `if` ahead of a state machine is a second state machine. Every transition that "goes back" has to clear it too, or it wins by position. When one going-back path forgets one such state, look for the others: this bug and its documented twin were the same omission on two different variables.
- Fix: the draft is consumed where the payment is born (`pay.onSuccess`), and `retry()` clears it defensively — whatever screen calls retry wants the step machine, never a stale draft in front of it.
- Regression test: `apps/pago/test/pago.test.tsx` — "BUG-011: after a receipt-born partial, the button lands on the CLABE, not the stale draft", verified to fail without the fix.

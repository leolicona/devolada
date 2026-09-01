---
status: in-development
stories: [US-D01, US-D02, US-D03, US-D04, US-D05, US-D06, US-D09]
domain: direct-payment
updated: 2026-08-20
debt: [TD-013]
---

# Spec: Direct SPEI payment channel (Link de pago)

Devolada's store network serves unbanked customers who pay cash at a corner store. This spec adds a second, parallel channel for banked customers: a permanent payment link the ISP shares once, which the customer bookmarks and opens whenever they owe. The page shows the current debt (live from WispHub), SPEI instructions pointing at the ISP's own CLABE, and two ways to submit proof — a screenshot (Consta receipt-URL door) or manual transfer data (Consta transfer door). On validation, the system records a `channel = 'spei'` charge with no store involvement, triggers the same reconnection flow as store charges, and the customer sees the result live. The money flows directly from customer to ISP; Devolada validates but never custodies funds.

## Decisions

- **D1 — Permanent link with opaque token per customer.** The link is `link.devoladapago.com/p/<token>` where `<token>` is a non-guessable, unique, permanent token per customer (per ISP). The link never expires. Each time the customer opens it, the page queries WispHub for current debt. If the customer owes nothing, shows "Sin adeudo". If they owe, shows SPEI payment instructions. The ISP shares the link once and the customer bookmarks it. **Rejected**: per-transaction links with expiration (unnecessary complexity; the customer's debt status is always fresh from WispHub), readable `usuario` in URL (privacy: anyone who guesses it sees debt status).
- **D2 — Both proof doors: screenshot or manual data.** The customer can submit proof via: (a) uploading a screenshot of their bank transfer (Consta's `receiptUrl` door → apiCEP OCR), or (b) entering transfer details manually (tracking key, sender bank, date — Consta's `transfer` door). Amount and beneficiary are pre-filled (the system knows them). **Rejected**: only manual data (many customers don't know what a tracking key is), only screenshot (OCR can fail, manual is the reliable fallback). **Measured 2026-08-18, and the margin is wider than assumed**: of three real Nubank transfers, the receipt door read two and failed the third outright — `invalid` with no CEP data, twice — while the transfer door validated that same transfer in 12.5 s and has not missed one yet. So the doors are not equals with different ergonomics: the screenshot door is the convenient one and the manual door is the *correct* one, and dropping the manual fallback would strand one payer in three. It also sets the shape of anything built on top — extraction should aim the screenshot at the transfer door, not add a second reader in front of the receipt door.
- **D3 — Service fee configurable per ISP.** The ISP configures the service fee for direct SPEI payments separately from the store service fee, from the Admin settings page. A new column `speiServiceFeeCents` on the `isps` table (default: `NULL` → falls back to `serviceFeeCents`). This allows the ISP to incentivize or disincentivize SPEI payments relative to store payments. **Rejected**: hardcoded same fee (ISPs have different strategies), no service fee (Devolada still provides value in validation and reconnection).
- **D4 — The CLABE is the ISP's, never Devolada's.** The ISP configures their own CLABE, bank and beneficiary name in Admin settings (`speiClabe`, `speiBank`, `speiBeneficiaryName` on `isps` table — the bank name landed during development: Consta's transfer door requires the receiving institution by name, and deriving it from the CLABE prefix would mean maintaining a bank catalog). The money flows directly from customer to ISP. Devolada validates but never custodies funds — no fintech license required. "Available" additionally requires Consta's env config (`CONSTA_BASE_URL` + `CONSTA_API_KEY`): a CLABE nothing can validate must not be shown, so prod answers `unavailable` until Consta has a prod env. **Rejected**: Devolada concentrator CLABE (requires fintech licensing, fund custody, and dispersion — regulatory burden incompatible with the current model).
- **D5 — Automatic link generation for all WispHub customers.** Payment links are generated automatically — every customer in the ISP's WispHub tenant gets a permanent link. The `payment_links` table maps `token → (ispId, wisphubCustomerId, customerUsuario)`. Links are created lazily (on first access or on ISP request) or in batch. No manual per-customer creation needed. **Rejected**: manual per-customer link creation from Admin (too much friction for ISPs with hundreds/thousands of customers).
- **D6 — Direct charges bypass stores entirely.** A direct SPEI payment creates a `charge` with `channel = 'spei'` and `storeId = NULL`. No store commission, no store balance impact, no ledger entries for commission. The charge still goes through the same reconnection flow (inline attempt + queue). The admin feed shows both channels with visual distinction. **Rejected**: attributing direct payments to a "virtual store" (breaks the ledger model; a store that doesn't hold cash shouldn't have a balance).
- **D7 — Pending CEP re-validates on a front-loaded schedule, riding the existing cron.** When Consta returns `pending`, the system stores the attempt and re-validates riding the api's existing every-minute scheduled sweep (no new Worker trigger). The cadence follows where CEPs actually appear (researched 2026-08-17): Banxico makes the CEP available at most ~30 minutes after the transfer, and apiCEP's own docs say "normalmente se genera segundos después… pero puede tardar horas". So the schedule is dense inside that first half hour and sparse in the anomaly tail: **+2, +8, +20, +45 min, +2 h, +6 h** — the typical customer confirms in 2–8 minutes, the 30-minute rule is covered with margin, and the worst case stays at ~7 paid calls (≈$1.75) instead of the 72 ($18 — more than the fee itself) a flat 5-minute loop would burn. After 6 h, status becomes `expired` and the customer is told to contact their ISP. **The row is born with its first slot already set, at INSERT** — the inline attempt is an optimisation, not the mechanism. A validation takes ~15 s (consta spec, provider notes), and anything can end a worker inside that window: an eviction, a deploy, a provider stalling past its deadline. Rows used to be inserted with `next_validation_at = NULL` and depend on the inline attempt to schedule themselves, so an interrupted attempt left a row that `sweepDirectPayments` — which selects on `isNotNull(next_validation_at)` — could neither retry nor expire, since the 6 h window only exists inside the sweep. The customer's money had moved and nothing would ever look at the payment again (found live 2026-08-18, first real submission). The log (`created_at`, `confirmed_at`, `validation_attempts`, receiving bank) accumulates our own latency distribution, so the schedule can later be tuned per receiving bank on real evidence. Open dependency: apiCEP hasn't answered whether pending re-checks consume credits (pending email); if they don't, the early cadence can densify. **Rejected**: flat 5-minute polling (cost kills the margin), pure exponential from 5 min (back-loaded: it makes the common seconds-to-minutes case wait longest exactly where the probability mass lives), requiring the customer to re-submit (bad UX). **Amended 2026-08-26 (validation-status-ux D4)**: a payment whose only failure is `not_found` earns one late slot at **+12 h** before `expired` — one more credit, for the bank that releases a held transfer the next morning. `contradicted` and channel failures still end at 6 h. **Amended 2026-08-28 — TD-013 paid: the schedule consumes Consta's learned `retryAfter` (learned-retry D6, US-V16).** On `not_found`/`pending`, Consta may return the learned moment when asking again stops being spending in vain, per bank cell, and the sweep books the next attempt exactly there — before or after the next static slot, whichever the evidence says (`schedule.ts`). What never moves: the inline attempt and the +2 slot (they serve the seconds-fast majority and carry the suggestion back for free), and the horizon — a suggestion is clamped to the final slot, so the last pre-expiry check always runs and the pending budget never stretches; expiry can only follow a fresh check. Cold start is silence: no suggestion → this schedule, byte-identical. **The +2 slot has a third reason to be untouchable, found live 2026-08-28: it is when the reading-check cross runs (US-D14), and that cross is what rescues a misread clave.** A receipt was read as `NU3A17KL…` where Banxico holds `NU3AI7KL…` — a digit `1` for a letter `I`. The transfer-door attempt with the misread key answered `not_found`, and so would every later attempt with it, until `expired` six hours on with the money already in the ISP's account. The cross at +2.7 min sent the image to the provider's own OCR, which read it right, found the CEP and confirmed the payment at 2.8 minutes. The cross is scheduled through `next_validation_at` — the same field the suggestion now writes — so a suggestion free to move the first retry to +10 min would delay every misread rescue by as much. The skeleton guard prevents that by construction, and that is now as much its purpose as the fast majority is. A malformed suggestion does not exist (`suggestedSlot`). The open dependency above is answered the expensive way: pending re-checks DO bill (measured live 2026-08-27, `docs/integrations/apicep.md`), so the early cadence never densifies — the learned middle is how the waste goes away instead.
- **D8 — One transfer pays once, and Devolada keeps that book itself.** The primary defense is ours: a partial unique index on `(isp_id, tracking_key)` over non-`invalid`/non-`expired` `direct_payments` rows makes a second submission of the same transfer — including two racing concurrent ones — fail at the database, with `TRANSFER_ALREADY_USED`. Consta's `alreadyValidated` flag is the secondary signal, with two carve-outs learned from its semantics: (a) re-validations of the *same* `direct_payments` row ignore the flag — our own earlier attempt may have set it (a lost `valid` response would otherwise brick a legitimate payment on retry). **"Attempt", not "verdict": the attempt counter is written *before* the provider call, and the carve-out keys on it.** It first keyed on `consta_status`, which is only written when a call comes *back* — so a call that never returned left no trace, and the retry read as a stranger's validation. Live on 2026-08-18: apiCEP validated the CEP, the worker died before recording it, and the honest retry was answered `TRANSFER_ALREADY_USED` for a transfer the customer had really made, with the money already in the ISP's account. Whether a call *may have landed* is knowable only in advance, so it is recorded in advance; (b) the flag with no local record (someone validated this CEP outside Devolada — e.g. the ISP checked it by hand in apiCEP's web) still rejects, but the rejection is surfaced in the admin feed so the ISP can resolve it with the customer. **Rejected**: trusting the provider flag alone (false rejects on our own retries, and blind to same-instant races it hasn't recorded yet). **Amended 2026-08-26 (validation-status-ux D8)**: carve-out (a) crosses supersede — the fresh row a correction or re-upload creates carries zero counters, so the trace also follows the `supersedes_id` chain and, on the receipt door, a same-link row holding the same revealed tracking key. The flag with no trace of any kind still rejects. **Amended again 2026-08-26 (validation-status-ux D9, found live)**: the index's answer now distinguishes who owns the collision — when the owning row belongs to the *same payment link* and is still `validating`, the submission returns that row (the D18 "unchanged" posture, generalised to the fresh path) instead of `TRANSFER_ALREADY_USED`, because the reader's misreads are deterministic and a re-uploaded capture reproduces the same wrong clave every time. Any other owner — another link, or a terminal row — still refuses.
- **D9 — The payment page is a public micro-frontend.** `apps/pago` is a lightweight Vite app (no auth, no sessions, mobile-first). It communicates with `apps/api` via public endpoints under `/direct-payments/`. The page has four states: loading debt → showing instructions → validating payment → result (confirmed / pending / failed / no-debt). **Rejected**: embedding in the store PWA (different audience, different auth model), building inside the admin (the customer has no admin access).
- **D10 — The page is in es-MX, uses "pago" not "cobro".** This is the customer-facing surface. The glossary reserves "cobro" for store/admin interfaces and "pago" for end-customer receipts. The payment link page is the customer's interface, so it says "pago", "tu servicio", "transferencia". **Aligned with**: receipt spec which already uses "pago" on the customer-facing text. The page also obeys the FRONTEND laws like any other surface: tokens only, `StatusBadge` as the sole representation of its statuses, icon + text, light + dark.
- **D11 — `valid` is necessary, not sufficient: the CEP must match the debt.** A verdict only proves *a* transfer happened; it doesn't prove it pays *this* debt. On the transfer door the exact amount travels to Banxico as a search criterion, so a wrong amount already comes back `invalid`. On the receipt door apiCEP validates whatever the receipt claims — a real $1.00 transfer validates as a real $1.00 transfer. So on every `valid`, the integration compares the CEP's returned amount against the expected total (mensualidad + cargo) and its date against a 30-day window (measured 2026-08-17: apiCEP treats the claimed date as a hint, not a filter). Mismatch → the direct payment is `invalid` with `AMOUNT_MISMATCH` / `STALE_TRANSFER`, no charge. **Rejected**: trusting the verdict alone (the $1-receipt hole), accepting partial amounts (a debt is paid whole or not at all in v1). *(**Superseded in part, 2026-08-20**: the refusal of partial amounts is reversed by `partial-payment.spec.md` D1 — WispHub carries a remainder natively, and by the time we know the transfer fell short the money has already reached the ISP. The rest of D11 stands: an amount **above** the debt is still a mismatch, and the $1-receipt hole is still guarded.)*
- **D12 — Proof uploads are token-bound and ephemeral.** There is no anonymous upload endpoint. The proof is uploaded through the link itself (`POST /direct-payments/links/:token/proof`), capped at 1 MB (apiCEP's own limit). Accepted types are **what the provider can read**, not "images": any `image/*` plus `application/pdf` (apiCEP's list, checked 2026-08-18: JPEG, PNG, PDF, GIF, WebP, BMP, TIFF, HEIC). The first implementation took image types only, which shut out the several Mexican banks that issue the comprobante as a PDF and pushed those customers to the manual door for no reason — HEIC, the format an iPhone photo actually is, only passed by accident of starting with `image/`. It lands in a private R2 bucket `devolada-transfer-proofs`; what Consta receives is a short-lived signed URL (HMAC over key+expiry, served by the API itself at `GET /direct-payments/proofs/:linkId/:file` — R2 bindings don't presign, and a 15-minute single-purpose URL doesn't need S3 credentials), and a lifecycle rule deletes objects after 15 days (the same horizon as the provider's own download links). Proof keys are namespaced by link id, so a pay request can only reference proofs uploaded through its own link, and pay verifies the object exists before spending a provider call. **Rejected**: a public upload endpoint returning public URLs (free anonymous file hosting under the product's domain), keeping proofs forever (they are evidence for a dispute window, not an archive). Named "proof", not "receipt" — the glossary reserves receipt/comprobante for the folio we issue.
- **D13 — Validation attempts have a budget, because each one costs money — and so do uploads, in a different currency.** Every proof submission triggers a paid provider call, on a public endpoint. Per link: at most 5 submissions per hour → 429 `TOO_MANY_ATTEMPTS` with honest es-MX copy. Uploading carries **its own cap of 20 per hour per link**, because it creates no `direct_payments` row: counting only submissions left the upload endpoint effectively uncapped, and a leaked link was free 1 MB-at-a-time hosting under our own domain until the 15-day lifecycle swept it. The cap is 4× the submission budget — an upload is cheap and a customer may retake a photo — and the hour rides in the object key (`<linkId>/<hour>-<uuid>`) so counting one hour is two bounded listings rather than a scan of every proof the link still has. The public routes additionally sit behind Cloudflare rate limiting. **Rejected**: unlimited attempts (a hostile visitor with a leaked link drains apiCEP credits at $0.25 a call); one shared counter (the two doors fail differently — one spends money, the other spends storage).
- **D14 — A validated transfer with nothing left to pay becomes `unapplied`, never silent.** Between submission and confirmation (up to 6 h pending) the debt can be settled elsewhere — typically cash at a store. The money has already moved to the ISP's CLABE, so the system neither registers a second WispHub payment nor discards the proof: the direct payment ends as `unapplied`, visible to the ISP in the feed ("pago validado sin adeudo — resolver con el cliente"), and no charge is created. **Rejected**: silently registering anyway (double payment in WispHub), silently dropping (the customer's money vanishes from every screen).
- **D15 — One invoice at a time, oldest first.** A customer can owe several months. The page shows and charges exactly one pending invoice per cycle — the oldest — same as the store flow; after a confirmed payment the page re-reads WispHub and, if debt remains, shows the next one. **Rejected**: a combined multi-month total (one CEP would have to match a sum WispHub never invoiced, and partial matching contradicts D11). *(**Superseded 2026-08-20 by D21**: measured, WispHub applies a payment to the customer and not to the invoice, so the sum this decision feared is the number the payer must actually transfer.)*
- **D16 — The bank is picked from the provider's vocabulary, never typed.** Measured 2026-08-19 against one real settled transfer, changing only `sender.bank`: `NUBANK` → `valid` in 7.0 s, `Nu` → `valid` (apiCEP aliased it), **`HSBC` → `invalid`, no `cepDetails`, no `cepStatus`, in 1.3 s**. apiCEP never answers an error for a bank name it does not know — it answers the same faceless `invalid` a transfer that never happened returns, so no status code will ever tell a caller its picker is wrong. Both surfaces that produce a bank name now choose from apiCEP's 97 published names: the payer's `senderBank` and the ISP's `speiBank`, the latter more dangerous because it travels as `beneficiary.bank` on **every** validation that ISP ever runs. Both fields were free text seeded with wrong examples — `"BBVA, Nu, Banorte…"` on the payment page, `"STP, BBVA, Banorte…"` in settings — so the product was teaching people to type values it could not validate (BUG-007). The list is **generated** from `docs/integrations/apicep.md` into one constant per app by `scripts/gen-banks.mjs`, and CI fails on drift: three copies of a vocabulary that fails silently is three chances to be wrong. `trackingKey` is bounded in the same breath — `^[A-Za-z0-9]{6,30}$` after trimming (BUG-006). A **range**, not Nu's 28: apiCEP's own example carries ten characters, and Devolada's payers bank anywhere. **Rejected**: trusting apiCEP's aliasing (undocumented, measured once, and silent when it runs out); a shared runtime endpoint for the list (the payer's form must render before anything else can fail); the catalogue's Radix `Select` on the payment page — right for the admin's short lists on a desktop, wrong for 97 options filled once on a phone, where the native control brings the OS picker, type-ahead and the payer's own assistive settings, and costs the public page no new dependency.
- **D17 — A `not_found` is not a refusal; only a contradicted CEP is.** Consta's `invalid` splits in two (its D11), and only one half is a verdict. `contradicted` means a CEP came back and disagrees — the payment ends there, `invalid`, with `TRANSFER_CONTRADICTED` on the row. `not_found` means nothing came back at all: no `cepDetails`, no `cepStatus`, nothing to disagree with. That answer covers a CEP Banxico has not published yet, a receipt captured before the bank accepted the transfer, a misread clave and a wrong sender bank, and **nothing on the wire separates them** — so it rides the D7 schedule like a `pending`, carrying `TRANSFER_NOT_FOUND` as `lastError`, and the honest terminal state when the schedule runs out is `expired`, never `invalid`. A missing `reason` is read as `not_found` for the same reason: a Consta that predates D11 must not be able to turn silence back into an accusation. This was BUG-003 — six live submissions across two customers and three receipts, each a real payment declared `invalid` on the first attempt. The copy follows the same split: the page says *"todavía no aparece en Banxico"* while it waits, and *"no encontramos tu transferencia"* when it gives up, and it never again says *"revisa los datos"* to somebody who did nothing wrong. **What this costs, knowingly**: a transfer that genuinely never happened now burns the whole schedule before expiring instead of ending on the first call. That is the price of not being able to tell it apart from a real one, and it is the right way round — the schedule is bounded and paid in credits, while the alternative is paid by customers who did pay. Shortening it needs D9's `retryable`, not a guess. **Rejected**: mapping `not_found` to `pending` inside Consta (it would hide from every integrator that the provider actually answered); keeping `invalid` terminal and only softening the copy (the payment would still be dead, and the CEP that appears at T+20 min would never be seen).

- **D18 — The machine reads, the machine tries once, the human is asked only when there is something to decide.** Uploading a receipt sends it to Consta's `/extract` (proof-extraction D6), which spends a Workers AI call and **no provider credit**. What happens next depends on what came back, and the ordering is the whole decision:

  | what the reading says | what happens | credits |
  |---|---|---|
  | not a receipt, or a field failed the gate — an unread **date** included (validation-status-ux D6) | **the payer is asked immediately**, with that field empty | 0 |
  | the gate passed | **one silent attempt** through the transfer door | 1 |
  | → `valid` | confirmed; the payer never saw a form | 1 |
  | → `not_found`, receipt `Estatus` says *"En proceso"* | told their bank has not released it yet; **no form**, the schedule keeps trying | 1 |
  | → `not_found`, `Estatus` *"Aceptada"* or unreadable | asked to confirm **now**, framed as a wait, schedule still running | 1 |
  | → `contradicted` | terminal, with D17's honest copy | 1 |

  **Why a silent attempt at all, when the gate already passed.** Asking every payer to confirm 28 characters on a phone is friction they will click through, and a confirmation nobody reads is neither usability nor safety. If the reading is right, nobody should be asked anything.

  **Why the human is still asked, and asked *early*.** `not_found` is ambiguous by construction (D17): the CEP may simply not be published — measured at more than 49 and 62 minutes on two real transfers with the money already delivered — or the clave or bank may be wrong. Nothing on the wire separates them. Waiting for the schedule to exhaust before asking would rebuild the six-hour silence this whole line of work exists to remove, so the question is asked on the **first** `not_found` while the schedule keeps running underneath. Whichever resolves first wins. **Amended 2026-08-26 (validation-status-ux D1–D3)**: *early* is no longer *first*. On attempt one the overwhelming prior is CEP latency, and an open form at minute two reads as an accusation — so the calm phase holds through the 20-minute slot (the data one tap away, the correction door open from the start) and the form takes the foreground from the 45-minute attempt. The payer who already doubts their data can still correct from minute two, through the door.

  **The receipt's own `Estatus` is the one discriminator we have**, and it is why the two `not_found` rows above differ. *"En proceso"* means the bank has not released the transfer, so there is nothing for the payer to correct and asking them to would invite them to break a correct reading. Anything else leaves the ambiguity intact, and then the payer is the fastest way through it.

  **Confirming without changing anything must not cost anything.** If the three fields come back identical, the existing row and its schedule are kept and no second call is made. This is not an edge case: if CEP latency really is the dominant cause, it is the *common* path, and creating a second row would collide with the first at D8's unique index and answer `TRANSFER_ALREADY_USED` to a payer racing nobody but themselves.

  **A correction supersedes, it does not overwrite.** The silent attempt writes a row, and that row claims `(isp_id, tracking_key)` for up to six hours (D8) — so a misread clave that happens to belong to *another customer of the same ISP* would block a payment that customer really made. Their pool is exactly the collision pool: same beneficiary CLABE, same mensualidad, same day. So the old row moves to a new terminal status **`superseded`**, which releases the index, and the corrected submission is a new row carrying `supersedes_id` back to it. `superseded` is deliberately not `invalid`: that word already means *"your transfer does not exist"* in the copy and in the ISP's feed, and this is the opposite — it is us being wrong, not the payer. The pair `(what was read, what was confirmed)` is the measurement that will say whether the reader earns its keep.

  **`cep_sender_name` is recorded from the CEP but acts on nothing yet.** Banxico names the account holder who sent the money, and a name with no relation to the WispHub subscriber is the only signal available that a misread clave matched *somebody else's* real transfer. It can never be a rule — people pay for relatives, and the subscriber is not always the payer — so it is stored for a future ISP-facing alert and for support (*"who paid this?"*). **Today nothing displays it**, because `apps/admin` has no direct-payment view at all; that is a gap this decision does not close and does not pretend to.

  **Rejected**: confirmation on every payment (friction on everyone to catch a rate nobody has measured, and a confirmation people click through is theatre); silent-only with the human asked when the schedule expires (that *is* the six-hour wait); overwriting `tracking_key` in place on a correction (loses the read-versus-confirmed pair, the only thing that measures the reader); rejecting a payment on a `senderName` mismatch (false rejections for anyone paying for a relative); asking the payer to confirm the amount (it is server-supplied on this channel, D2, and inviting confirmation of a number we already know teaches clicking through). *(**Superseded in part, 2026-08-26**: the amount rejection is reversed by `claimed-amount.spec.md` D3 — its premise died with `partial-payment` D1: the system knows what the payer *should* have sent, but the lookup needs what they *did* send, and on the manual door only the payer has it. The field arrives pre-filled with the expected total, so the no-ritual concern is preserved: the exact payer confirms without touching it.)*

- **D19 — The page is two steps, and it remembers which one the payer is on.** The payment has an interruption at its centre: the transfer happens in the bank app, not here. Until now one scroll held both moments at once, so a payer who had not transferred yet was shown a proof form for a payment that did not exist, and a payer coming back from their bank had to scroll past a CLABE they no longer needed. The page is cut in two. **Step 1 (`transfer`)** shows only what is needed to move money, and ends in one `--size-touch-lg` action: *"Ya hice mi transferencia"*. **Step 2 (`proof`)** shows only the proof, and carries *"Ver los datos otra vez"* back to step 1 as its first element. The step is stored per token in `localStorage` under `devolada-pago-step`, so the app switch — or the next morning — returns the payer where they were. **Rejected**: keeping one scroll and collapsing the sections into an accordion (it is the same page with less of it visible, and it still forgets the moment on the reload that an app switch often causes on iOS); the step in the URL as `?paso=2` (it survives a reload but not the way people actually come back — tapping the ISP's original WhatsApp link again, which carries the bare `/p/<token>`); any server-side notion of where the payer is (D9 keeps this app session-less, and the device already knows).

  **The step is a hint, never a gate.** Step 1 does not check that a transfer happened before letting the payer through — it cannot, and a payer who transferred yesterday from the CLABE the ISP sent by WhatsApp arrives at step 1 for the first time with their receipt already in hand. The button is the way forward, not a claim being verified. In the same spirit step 2 is never a trap: the way back is its first element, because a payer who tapped too early must not have to reload to see the CLABE again. **Rejected**: a progress bar that cannot be walked backwards.

  **Step 1 ranks two actions above three facts.** The amount and the CLABE are what gets typed into the bank app; beneficiario, banco and concepto are what the payer checks once, if at all. The first two are the only copy targets shown by default; the rest sit behind *"Ver los demás datos"* (shadcn Collapsible). **Rejected**: five copy rows of equal weight — that is the shape that made the payer read the whole card to find the two lines that matter.

  **The upload is the door of record; the manual form is the fallback.** D18 earned that: the machine reads the receipt and, when the reading passes the gate, nobody is asked anything. The manual form asks somebody on a phone to type a 28-character clave, and exists for the payer whose receipt is not on this device. So step 2 opens on the upload, and the form arrives through *"No tengo el comprobante a la mano"*. **Rejected**: the two doors as tabs (`Tabs` went out with this decision) — equal weight invited the harder path, and a tab strip spends the top of the screen naming a choice that is not really a choice.

  **A finished payment clears the step.** The link is permanent (D1) and the customer returns next month; the step is cleared when a payment confirms and when the link answers `no_debt`, so the next visit starts where the next payment starts. A `validating` payment does not clear it — that payer has not finished.

- **D19 — Who pays the service fee is a per-ISP switch, and the default is that the ISP absorbs it.** `spei_fee_payer` (`'customer' | 'isp'`, default `'isp'`) joins the SPEI settings. With `'isp'`, the payer is asked for **the WispHub debt alone**; the charge still records `service_fee_cents`, so `settlement` D1's derivation keeps working untouched — only the payer-facing total moves. Three things decided this. **The legal footing** (owner, 2026-08-20, per PROFECO): charging the fee is a private agreement, and if the ISP pays it, it is an operating cost — the simplest scenario there is. **The product consequence, which is larger than the legal one**: the number on the page becomes exactly the number WispHub says is owed, so a payer transferring from memory or from their ISP's WhatsApp message lands on the right amount, and the whole class of mismatch-caused-by-our-own-fee disappears — the problem this line of work opened with. **And it makes the threshold honest**: `partial-payment` D3 measures the ISP's debt, which is now the same number the payer sees in their bank. **The switch is SPEI-only.** In stores the customer always pays the fee, because the shopkeeper's commission is funded from it out of the cash in hand (`apps/api/src/ledger/index.ts:74`); moving it to the ISP would leave the commission unfunded at the counter and break the product's core promise of earning with zero investment. **Rejected**: hardcoding either side (ISPs differ, and one of them is legally simpler); one switch across both channels (it silently defunds the store's commission); charging the ISP by default *without* saying what it costs — see the paragraph below, which is part of this decision, not a footnote.

  **What this costs, knowingly.** With the ISP absorbing the fee, Devolada's revenue on this channel becomes **credit against the ISP**: it accrues per charge and appears in the monthly statement, and `settlement` D3 deliberately has **no collection mechanism** — that waits on Consta. The spike recommended defaulting to `'customer'` for exactly this reason and the owner overrode it on the legal argument. The override is recorded, and with it the consequence: the larger this number grows, the more Consta stops being "the natural next step" and becomes the thing holding up the channel's revenue.

- **D20 — Wherever the customer pays the fee, the free alternative must exist and be findable.** PROFECO's other half: if the customer absorbs the charge it has to be **broken out clearly** and a free way to pay has to remain available. Breaking it out is already the rule (`charges/debt-truth` D11 gives every amount its own line). The free way is paying the ISP directly, outside Devolada, and this decision makes it an obligation rather than an assumption: with `spei_fee_payer = 'customer'`, the payment page names it in plain es-MX, and the store's receipt does the same. It is uncomfortable to tell a payer how to avoid our fee on our own page, and it is the price of charging them at all — a fee that is only viable while the alternative is hidden is not viable. **Rejected**: relying on the alternative merely existing in the world (an obligation nobody can point at is not met); burying it in a legal footer (findable is the requirement, not present).

- **D21 — D15 is superseded: the page shows the whole debt, not one invoice.** D15 chose "one invoice at a time, oldest first" because a CEP has to match an amount WispHub actually invoiced. The measurement removes its ground: **WispHub applies a payment to the customer, not to the invoice** — the invoice id in the URL does not decide where the money goes (`charges/debt-truth` D7, `.design/devolada/PARTIAL_PAYMENT_SPIKE.md` F18). Showing one invoice therefore describes a model the provider does not have, and it does it in the direction that hurts: a suspended customer with two months owing is shown one of them, transfers exactly that, and is not reconnected — with everything having worked as designed. The page shows the debt as `charges/debt-truth` D7 defines it, broken out by line (D11 there). **Rejected**: keeping D15 and adding "y otro adeudo" as a note (the payer still transfers the wrong number, which is the whole failure).

## Schema

### New table: `payment_links`

| Column                | Type    | Notes                                         |
|-----------------------|---------|-----------------------------------------------|
| `id`                  | TEXT PK | UUID                                          |
| `isp_id`              | TEXT FK | → `isps.id`, NOT NULL                         |
| `token`               | TEXT    | NOT NULL, UNIQUE — opaque, ~12 chars (nanoid) |
| `wisphub_customer_id` | TEXT    | NOT NULL — numeric ID from WispHub            |
| `customer_usuario`    | TEXT    | NOT NULL                                      |
| `created_at`          | INTEGER | NOT NULL, ms epoch                            |

Unique constraint: `(isp_id, wisphub_customer_id)` — one link per customer per ISP.

### New table: `direct_payments`

| Column                 | Type    | Notes                                                           |
|------------------------|---------|-----------------------------------------------------------------|
| `id`                   | TEXT PK | UUID                                                            |
| `payment_link_id`      | TEXT FK | → `payment_links.id`, NOT NULL                                  |
| `isp_id`               | TEXT FK | → `isps.id`, NOT NULL                                           |
| `amount_cents`         | INTEGER | NOT NULL                                                        |
| `monthly_fee_cents`    | INTEGER | NOT NULL                                                        |
| `service_fee_cents`    | INTEGER | NOT NULL                                                        |
| `status`               | TEXT    | NOT NULL DEFAULT `'validating'` — validating / confirmed / invalid / expired / unapplied (D14) |
| `proof_mode`           | TEXT    | NOT NULL — `'receipt'` / `'transfer'`                           |
| `tracking_key`         | TEXT    | from customer input or CEP                                      |
| `sender_bank`          | TEXT    |                                                                 |
| `transfer_date`        | TEXT    |                                                                 |
| `proof_key`            | TEXT    | private R2 object key if screenshot uploaded (D12) — a key, not a URL, so the column is named for what it holds |
| `consta_validation_id` | TEXT    |                                                                 |
| `consta_status`        | TEXT    | valid / pending / invalid                                       |
| `charge_id`            | TEXT FK | → `charges.id` — set when confirmed and charge created          |
| `validation_attempts`  | INTEGER | NOT NULL DEFAULT 0                                              |
| `next_validation_at`   | INTEGER | ms epoch — for pending re-validation cron (D7)                  |
| `last_error`           | TEXT    |                                                                 |
| `confirmed_at`         | INTEGER | ms epoch                                                        |
| `created_at`           | INTEGER | NOT NULL, ms epoch                                              |

Partial unique index (D8): `(isp_id, tracking_key)` WHERE `status NOT IN ('invalid', 'expired')` — the database, not the provider, is what makes one transfer pay once.

### Alter `charges`

- ADD `channel` TEXT NOT NULL DEFAULT `'store'` — `'store'` | `'spei'`
- ADD `direct_payment_id` TEXT REFERENCES `direct_payments(id)`
- `store_id` becomes nullable (NULL for `channel = 'spei'`)

### Alter `isps`

- ADD `spei_fee_payer` TEXT NOT NULL DEFAULT `'isp'` — `'customer'` | `'isp'` (D19)
- ADD `spei_clabe` TEXT
- ADD `spei_bank` TEXT — receiving institution by name (D4)
- ADD `spei_beneficiary_name` TEXT
- ADD `spei_service_fee_cents` INTEGER — NULL → falls back to `service_fee_cents` (D3)

## Contract

### Public endpoints (no auth)

`GET /direct-payments/links/:token` (US-D01)

Returns the customer's current debt status and SPEI instructions, or the no-debt state. The API resolves the token to a `payment_links` row, fetches current debt from WispHub, and computes the total (monthly fee + SPEI service fee).

```
200 { ispName, customerName?, status: "debt" | "no_debt" | "unavailable",
      monthlyFeeCents?, serviceFeeCents?, totalCents?,
      speiClabe?, speiBank?, speiBeneficiaryName?, reference? }
```

- `status: "no_debt"` → only `ispName` and `customerName`; the page shows "Sin adeudo"
- `status: "unavailable"` → the ISP hasn't configured SPEI (D4); the page says the
  channel isn't available yet and points at the store network — the GET already
  knows, the customer never transfers into the void
- Debt shown is the oldest pending invoice only (D15)
- Unknown token → 404

`POST /direct-payments/links/:token/pay` (US-D02)

Submit proof of SPEI transfer. Exactly one proof door (same principle as Consta D1):

```
{ proofId: "…" }                                            // from the proof upload (D12)
{ transfer: { trackingKey, senderBank, date: "YYYY-MM-DD" } }
```

Amount, beneficiary CLABE, and beneficiary name are server-side (D1 principle: the server computes, the client never sends its own amount).

A refusal *before* a row exists is an envelope error; a verdict on a created
payment travels in the 201 body (decided during development — the split is
whether there is something for the ISP to see in the feed):

```
201 { directPaymentId, status: "validating" | "confirmed" | "invalid" | "unapplied",
      error: "TRANSFER_ALREADY_USED" | "AMOUNT_MISMATCH" | "STALE_TRANSFER" | null }
```

- `TRANSFER_ALREADY_USED` in the 201 body → Consta's `alreadyValidated` with
  no local record (D8); the row exists as `invalid`, visible in the feed
- `AMOUNT_MISMATCH` / `STALE_TRANSFER` → the CEP is real but doesn't match the
  debt (D11)
- `unapplied` can happen inline too (D14): the verdict landed after the debt did
- Envelope errors (no row created): 409 `TRANSFER_ALREADY_USED` (our own
  unique index refused a live duplicate, racing ones included — D8),
  409 `NOTHING_DUE` (no pending invoice at submission), 409
  `SPEI_NOT_CONFIGURED` (D4), 429 `TOO_MANY_ATTEMPTS` (D13), 400
  `VALIDATION_ERROR`, 404 unknown token or foreign/missing `proofId`,
  503 `WISPHUB_UNAVAILABLE` (pre-payment failure, debt-truth posture)
- Internal retryable codes (Consta down, WispHub down mid-validation) never
  reach the public wire: the payment stays `validating` and rides D7

`GET /direct-payments/:id/status` (US-D03, US-D04)

Poll the validation lifecycle and reconnection status:

```
200 { status: "validating" | "confirmed" | "invalid" | "expired" | "unapplied",
      reconnectionStatus?: "queued" | "reconnected" | "failed",
      folio?, validationAttempts, error? }
```

- `confirmed` with `reconnected` is the green moment (US-D03)
- `validating` means a pending CEP re-check is scheduled (D7, US-D04)
- Unknown id → 404

`POST /direct-payments/links/:token/proof` (US-D02, D12)

Upload the proof through the link itself — no anonymous uploads exist.
1 MB max, `image/*` or `application/pdf` (D12); stored in the private
`devolada-transfer-proofs` bucket with a 15-day lifecycle. Returns the object
reference to use in the `receiptUrl` door (the server resolves it to a
short-lived presigned URL when calling Consta).

```
multipart/form-data { file }
→ 200 { proofId }
- 413 over 1 MB · 415 PROOF_UNSUPPORTED_TYPE · 404 unknown token
- 429 over either budget (D13): 5 submissions or 20 uploads per hour
```

### ISP session endpoints (admin)

`GET /direct-payments/links` — list all payment links for the ISP (US-D05, D5).
Listing IS what generates them: the handler syncs the WispHub customer list
(up to 1000) and inserts a link for every customer that lacks one, so nobody
creates links by hand. Cursor pagination by `customerUsuario`:

```
200 { links: [{ token, usuario, url }], nextCursor }   // ?cursor=<usuario>, 50 per page
```

ISP settings endpoints already exist; extended with a `spei` block —
`{ clabe, bank, beneficiaryName, serviceFeeCents, effectiveServiceFeeCents,
configured }` on the response, and `speiClabe` (18 digits), `speiBank`,
`speiBeneficiaryName`, `speiServiceFeeCents` on the PATCH, each nullable to
clear (US-D05).

The admin charges feed (`GET /charges/feed`) now returns `channel` on every
charge and a nullable `storeName` (the store join became a leftJoin — a spei
charge has no store to join); the feed row names the channel instead of a
store (US-D06).

## Consta integration

`apps/api` calls Consta as an HTTP client with a `ck_…` API key stored as a worker secret (`CONSTA_API_KEY`), at `CONSTA_BASE_URL` — today `https://consta.dev.devoladapago.com`; Consta has no prod env yet by its own decision (validation spec D8), so the base is env config, never hardcoded. The integration module lives at `src/consta/client.ts`.

- **Receipt door**: the proof lives in the private `devolada-transfer-proofs` bucket (D12); the server resolves `proofId` to a short-lived presigned URL and passes it as `receiptUrl`. The ISP's beneficiary is sent as `beneficiary` (CLABE + name from ISP config).
- **Transfer door**: the system pre-fills `amountCents` and `beneficiary` (from ISP config) and sends the customer-provided `trackingKey`, `senderBank`, and `date`.
- **Verdict mapping**: Consta `valid` → check the CEP against the debt (amount and date, D11); on match, re-check the pending invoice (debt truth, US-C06) — still due → confirm, create the charge, trigger reconnection; no longer due → `unapplied` (D14). Consta `pending` → schedule re-validation with backoff (D7). Consta `invalid` → mark direct payment `invalid`. `alreadyValidated: true` → apply D8's carve-outs before rejecting.

### Re-validation sweep (D7)

The api's existing every-minute scheduled handler (the reconnection sweep's home) also selects `direct_payments` rows where `status = 'validating'` and `next_validation_at <= now()`. For each, it re-calls Consta with the same proof data — ignoring `alreadyValidated` for the row's own retries (D8 carve-out a). Max window: 6 hours from `created_at`; after that, `status → 'expired'`. On `valid`, D11's match and D14's debt re-check run before the charge is created. On `pending`, `next_validation_at` advances along the D7 schedule (+2, +8, +20, +45 min, +2 h, +6 h from `created_at`) and `validation_attempts` increments.

## UI Contract

`apps/pago` — public Vite micro-frontend, mobile-first, es-MX (D9, D10).

### States

1. **Cargando** — skeleton while `GET /direct-payments/links/:token` resolves.
2. **Sin adeudo** — customer owes nothing. "Tu servicio está al corriente. No tienes pagos pendientes."
3. **Instrucciones de pago** — two steps, and the page remembers which one the payer is on (D19). Both carry the step indicator ("Paso 1 de 2").
   - **3a. Paso 1 — Haz tu transferencia.** The breakdown (mensualidad, cargo por servicio, total) and the SPEI data. Monto and CLABE are the only copy targets shown; beneficiario, banco and concepto sit behind "Ver los demás datos" (Collapsible). Ends in one `--size-touch-lg` action: "Ya hice mi transferencia".
   - **3b. Paso 2 — Envía tu comprobante.** Opens with "Ver los datos otra vez" back to 3a, then the upload. The manual transfer form arrives through "No tengo el comprobante a la mano" and stays open once revealed.
4. **Verificando tu pago** — spinner + "Estamos verificando tu transferencia. Esto puede tomar unos minutos." Polls `GET /direct-payments/:id/status` every 5 s.
5. **Pago confirmado** — green check. "Tu pago fue registrado. Tu servicio se reactivará en unos minutos." Shows folio. If `reconnected`, "Tu servicio ya está activo."
6. **Pago no válido** — red. "No pudimos verificar tu transferencia. Revisa los datos e intenta de nuevo." Or if `TRANSFER_ALREADY_USED`: "Esta transferencia ya fue utilizada para otro pago."
7. **Verificación expirada** — amber. "No pudimos confirmar tu pago. Contacta a tu proveedor de internet."
8. **Pago por transferencia no disponible** — the ISP hasn't configured SPEI (`unavailable`). "Por ahora paga en tu punto de cobro más cercano." — the channel degrades into the store network, never into a transfer with nowhere to land.
9. **Pago sin adeudo** (`unapplied`, D14) — "Tu transferencia fue validada, pero tu cuenta ya estaba al corriente. Tu proveedor te contactará para resolverlo."

Statuses render through `StatusBadge` with icon + text, like every other surface (D10).

### Copy

- Plain es-MX: "pago", "transferencia", "tu servicio", never "cobro" (D10).
- Money rendered with `formatMoney` / `<Amount>` from `packages/ui`.

## Scenarios

1. Customer opens a valid payment link with debt → sees the total, SPEI instructions with the ISP's CLABE and beneficiary (US-D01, D1, D4)
2. Customer opens a valid payment link without debt → "Sin adeudo", no SPEI data (US-D01, D1)
3. Unknown token → 404 (D1)
4. ISP has not configured SPEI → `SPEI_NOT_CONFIGURED` on pay attempt (D4)
5. Customer submits a receipt screenshot → direct payment created with `proof_mode = 'receipt'`, image uploaded to R2, Consta called with `receiptUrl` door (US-D02, D2)
6. Customer submits manual transfer data → direct payment created with `proof_mode = 'transfer'`, Consta called with `transfer` door; amount and beneficiary are server-supplied (US-D02, D2)
7. Consta returns `valid` → direct payment `confirmed`, a charge is created with `channel = 'spei'` and `storeId = NULL`, reconnection starts; no ledger entries for commission (US-D03, D6)
8. Consta returns `pending` → direct payment stays `validating`, `next_validation_at` set at the first D7 slot (+2 min from submission) (US-D04, D7)
9. Re-validation cron picks up a pending direct payment and Consta now returns `valid` → same as scenario 7 (D7)
10. Re-validation cron: still `pending` after 6 h → `status = 'expired'` (D7)
11. Consta returns `alreadyValidated: true` → rejected with `TRANSFER_ALREADY_USED`, no charge created (D8)
12. Charge created by direct payment goes through the same reconnection flow as store charges; `reconnected` status is polled by the payment page (US-D03)
13. ISP configures `speiClabe`, `speiBeneficiaryName`, and `speiServiceFeeCents` from Admin settings; the SPEI fee defaults to `serviceFeeCents` when null (US-D05, D3, D4)
14. Admin charges feed includes direct charges with `channel = 'spei'`, visually distinct from store charges (US-D06, D6)
15. UI: payment page renders the four main flows — loading, instructions, verifying, result — in es-MX with "pago" copy (US-D01, US-D03, D9, D10)
16. Receipt door with a real CEP whose amount doesn't match the debt → `invalid` with `AMOUNT_MISMATCH`, no charge (D11)
17. A CEP older than the 30-day window → `STALE_TRANSFER` (D11)
18. Two concurrent submissions of the same tracking key → exactly one survives the unique index; the other attaches to it when it is the same link's live row, and gets `TRANSFER_ALREADY_USED` from any other owner (D8, amended by validation-status-ux D9)
19. A re-validation retry of the same direct payment where Consta now sets `alreadyValidated: true` → NOT rejected; the retry confirms normally (D8 carve-out a)
20. Consta `valid` but the invoice was paid at a store meanwhile → `unapplied`, visible in the admin feed, no charge, no WispHub payment (D14)
21. A confirmed `spei` charge accrues its full service fee to the platform's settlement statement — the commission leftJoin finds nothing to subtract (US-L01 interplay, D6)
22. Sixth proof submission on one link within an hour → 429 `TOO_MANY_ATTEMPTS`, no provider call (D13)
23. Link of an ISP without SPEI configured → GET answers `unavailable`; the page points at the store network (D4)
24. Customer owing two months sees only the oldest invoice; after confirming, the page shows the next one (D15)
25. A PDF comprobante uploads and pays like a screenshot; an unreadable type (zip) → 415 `PROOF_UNSUPPORTED_TYPE` (D12)
26. Twenty-first upload on one link within an hour → 429, with no submission behind any of them (D13)
27. A submission carries a `next_validation_at` before any verdict exists, so an interrupted attempt is still swept (D7)
28. A re-validation whose earlier attempt never returned a verdict still counts as our own retry, and confirms instead of rejecting (D8 carve-out a)
29. A provider failure leaves `validation_attempts = 1` and a scheduled slot: the attempt is recorded before the call (D7, D8)
30. A `senderBank` outside the vocabulary — `Nu`, `BBVA`, `Banorte`, the three the old placeholder taught — → 400 before WispHub or the provider is touched, and no `direct_payments` row (D16, BUG-007)
31. `BBVA MEXICO`, the spelling apiCEP does accept, goes through and is stored (D16)
32. A `trackingKey` carrying a receipt's two-line wrap — a space, a newline, or the live 29-character one with a Cyrillic З — → 400, no paid call (D16, BUG-006)
33. A ten-character key (`HSBC712057`, apiCEP's own example) is accepted: the bound is a range, not Nu's 28 (D16, BUG-006)
34. The payment page offers the bank as a list, not a text field, and the button stays disabled until one is chosen (D16)
35. An ISP whose stored `speiBank` is outside the vocabulary shows the page as `unavailable`, and the exact spelling keeps it open — the data D16 could not reach (D4, D16, BUG-008)
36. Consta answers `invalid` with `reason: "not_found"` → the payment stays `validating`, `last_error = TRANSFER_NOT_FOUND`, the next D7 slot is booked, and no charge exists (D17, BUG-003)
37. The CEP appears between two slots → the very next sweep confirms the same row, and `last_error` is cleared (D17, BUG-003)
38. `not_found` all the way to the end of the schedule → `expired` with `TRANSFER_NOT_FOUND` visible on the status endpoint, never `invalid` (D17, BUG-003)
39. Consta answers `invalid` with `reason: "contradicted"` → terminal on the first attempt, `TRANSFER_CONTRADICTED`, no charge (D17)
40. Consta answers `invalid` with no `reason` at all → read as `not_found`, the payment survives (D17)
41. While waiting on a `not_found`, the page says the transfer has not appeared in Banxico yet — and never shows "no válido" or "revisa los datos" (D17, US-D03)
42. An `expired` verification names which wall it hit instead of blaming the payer (D17, US-D04)
43. A reading that passes the gate is submitted **silently** and confirms without the payer ever seeing a form (US-D09, D18)
44. A field the gate refused stops the silent attempt: the payer is asked immediately, that field arrives **empty**, and no provider call was spent (US-D09, D18)
45. An image that is not a receipt is caught before any submission — no `direct_payments` row, no paid call. The case measured live at up to 7 calls over 6 h (US-D09, D18)
46. `POST /links/:token/read` returns the reading, spends no provider credit, creates no payment, and reaches Consta through a signed, expiring proof URL (US-D09, D18, D12)
47. A malformed clave or an unresolved bank comes back null with the gate saying why, never as a confirmable guess (US-D09, D18)
48. A proof belonging to another link, and a key that was never uploaded, both read as 404 (US-D09, D18, D12)
49. A silent attempt pays through the transfer door: the receipt never reaches the provider, `proof_mode` is `transfer`, and `proof_key` is still set (US-D09, D18)
50. With Consta's reader unreachable, the upload still pays through the provider's OCR door exactly as before (US-D09, D18)
51. `not_found` on a receipt whose `Estatus` reads *"En proceso"* shows the wait, never the form — there is nothing for the payer to correct (US-D09, D18)
52. `not_found` on an *"Aceptada"* or unreadable `Estatus` opens the confirmation on the **first** attempt, and the row's schedule keeps running underneath (US-D09, D18, D17)
53. Confirming the same three values keeps the existing row, its schedule and its attempt count, and spends **no** second credit — the collision that would otherwise answer `TRANSFER_ALREADY_USED` to the payer's own retry (US-D09, D18, D8)
54. A corrected confirmation moves the first row to `superseded` — releasing `(isp_id, tracking_key)` so the real owner of the misread clave is not blocked — and the new row carries `supersedes_id` back to it (US-D09, D18, D8)
55. A `superseded` row is not selected by the sweep and never reaches a customer-facing status (US-D09, D18, D7)
56. `cep_sender_name` is recorded from the CEP on a confirmed payment, and acts on nothing (US-D09, D18)

57. A reading whose amount is not the debt is refused by the page before any credit is spent, and both numbers are named (US-D09, D18, D11)
58. The server refuses the same mismatch with `AMOUNT_MISMATCH` and writes no row; the matching amount goes through, and omitting the field changes nothing (US-D09, D18, D11)
59. A payer who taps "Ya hice mi transferencia" and reloads the page lands on step 2, not back on the CLABE (D19)
60. Step 2's first element walks back to step 1, and the payer who does so is not sent forward again (D19)
61. Step 1 shows monto and CLABE as copy targets; beneficiario, banco and concepto are reachable but not shown by default (D19)
62. Step 2 opens on the upload; the manual form exists but is one deliberate tap away, and there is no tab strip (D19)
63. A confirmed payment clears the remembered step, so the next visit starts on step 1 (D19)
64. A link that answers `no_debt` clears the remembered step; a `validating` payment does not (D19)

## Definition of Done

- [x] Scenarios 36–40 automated (`test/direct-payment.test.ts`, describe "D17"), 41–42 in `apps/pago/test/pago.test.tsx` — the regression suite for BUG-003
- [x] Scenarios 46–49 and 53–56 automated (`test/direct-payment.test.ts`, two "D18" describes); 43–45 and 50–53 in `apps/pago/test/pago.test.tsx`
- [x] Migration `0009`: D8's partial unique index recreated to exclude `superseded`, plus `receipt_status`, `cep_sender_name` and `supersedes_id`. No table recreate, so none of the D1 foreign-key trouble migration `0007` hit
- [x] Scenario 41 of D17 retired: its copy ("todavía no aparece en Banxico", after two attempts) is replaced by D18's confirmation, which says the same thing and offers something to do about it
- [ ] **The reader has never run against a real receipt.** Every test stubs it with shapes the model was measured producing; `AI.run` itself is only exercised on dev
- [x] **Measured 2026-08-19: `sender.amount` is a FILTER in apiCEP's direct mode** (`docs/integrations/apicep.md`). A known-good clave re-sent with a wrong amount comes back byte-identical to a transfer that never happened, so a mismatch is invisible on this door and both the page and the server now refuse it up front (scenarios 57–58). The original question, kept because it is what the answer means: The claimed *date* is documented as a hint. The amount is untested, and it decides how a $1 receipt against a $514 debt fails on this path: as `AMOUNT_MISMATCH` in seconds if it is a hint, or as a faceless `not_found` and a six-hour wait if it is a filter. This is not a new risk — the transfer door has always sent the expected amount — but D18 routes far more traffic through it. One deliberate call with a wrong amount against a known-good transfer answers it
- [x] Scenarios 1–4, 7–11, 16–26 automated in the API layer (`test/direct-payment.test.ts`; Consta and WispHub fetch-mocked respecting their contracts)
- [x] Scenarios 5–6 automated with Consta fetch-mocked (`test/direct-payment.test.ts` — asserts the door and the server-supplied amount/beneficiary)
- [x] Scenario 12 automated in `test/direct-payment.test.ts` (a queued spei charge converts through `sweepReconnections`)
- [x] Scenarios 13–14 automated in admin API tests (`test/settings.test.ts`, `test/charge-feed.test.ts` — the files that already owned those endpoints)
- [x] Scenario 15 automated with Testing Library + MSW (`apps/pago/test/pago.test.tsx`, 7 tests)
- [x] Schema migration written and applied locally (`0007_icy_talisman.sql`): `payment_links` and `direct_payments` tables (with the D8 partial unique index) created; `charges` and `isps` altered. Hand-adjusted after generation: D1 rejects `PRAGMA foreign_keys`, and under the allowed `defer_foreign_keys` drizzle's drop-and-rename recreate cannot commit with live `ledger_entries` rows — SQLite's deferred-violation counter only decrements when the missing parent keys are *inserted*, which a rename never does (found live: the first remote apply rolled back the dev DB). The recreate therefore copies `charges` into an FK-free holding table, drops it, recreates it under its real name, and copies back — verified against a seeded local D1 and in plain SQLite. drizzle-kit's copy-INSERT also selected the two brand-new columns from the old table
- [x] Re-validation rides the existing api scheduled sweep (no new trigger); `POST /dev/direct-payment-sweep` is the manual escape hatch
- [ ] `apps/pago` deployed to `link.dev.devoladapago.com` (wired into ci/deploy-dev/deploy-prod; happens on merge). One-time infra per env: create the R2 bucket (`devolada-transfer-proofs-dev` / `-prod`) with the 15-day lifecycle rule, and set the `CONSTA_API_KEY` environment secret
- [x] Manual check on deployed dev, receipt door (2026-08-18): two real Nubank SPEI transfers to the ISP's Klar CLABE. The **$1.00 receipt against a $2.00 debt came back `AMOUNT_MISMATCH`** — Consta `valid`, our own D11 check refusing it — which is scenario 16 verified against Banxico instead of a mock, and D11's `$1-receipt hole` closed on real evidence. Round trip 13.5 s. apiCEP read the amount, sender bank, date and the full 28-character clave de rastreo correctly (consta spec, provider notes)
- [x] Manual check on deployed dev, **confirm path — verified end to end** (2026-08-18): a real $2.00 SPEI transfer against a $2.00 debt produced charge `DV-8O8OHA` with `channel = 'spei'` and `store_id = NULL`, the payment registered in WispHub (invoice 14), `reconnection_status = 'reconnected'` against the CHR lab router, and **zero `ledger_entries`** — scenarios 7 and 12, and D6's "no store, no commission", confirmed against the real providers rather than mocks. It went through the **transfer door**: the receipt door had refused the same transfer twice (see the OCR finding below)
- [x] **Round two, 2026-08-18: a forged receipt, an unreadable image, and a real one.** Three findings, each recorded in the consta spec's provider notes:
  - **A forged receipt cannot work.** One character of the clave de rastreo was changed; apiCEP returned Banxico's *real* key with the true amount, and D8 refused it as `TRANSFER_ALREADY_USED`. Had the transfer been fresh, D11 would have caught the amount. The defence is not that we detect the edit — it is that the verdict never comes from the image
  - **The receipt door produces false negatives.** A genuine, unspent comprobante was `invalid` twice with no CEP data at all, and the same transfer confirmed through the transfer door in 12.5 s. One in three real receipts. On the wire this is indistinguishable from a transfer that never happened, so a customer who really paid is told their payment could not be verified
    - **Reading corrected 2026-08-19 (D17).** "The receipt door produces false negatives" assumed OCR misread the image. It may instead have been CEP latency: the transfer-door success happened *later in time* than the two receipt-door refusals, so a CEP that simply had not been published yet fits the same evidence. Two transfers watched from authorisation on 2026-08-19 had no CEP at T+62 min (12 samples) and T+49 min (18 samples) with the money already delivered, which makes latency the likelier reading — and makes the distinction untestable from our side, which is the whole argument for D17
  - **An unreadable image costs far more than one call** — see the open question below
- [ ] **Open question for D7/D13: a `PROVIDER_ERROR` on an image that can never be read is retried like an outage.** A screenshot containing no receipt makes apiCEP error rather than answer `invalid`; that maps to a retryable failure, so the payment rides the full D7 schedule — up to **7 paid provider calls over 6 hours**, ending in `expired`, with the customer watching a spinner the whole time. Retrying is right for a provider that is down and wrong for an image that has no receipt in it, and today nothing distinguishes them. Options, none chosen: treat a provider error on the *first* attempt of a receipt-door payment as terminal; cap receipt-door retries below the transfer door's; or refuse unreadable images before they reach the provider at all (the case the AI pre-filter proposal is strongest on). Measured live: `a5b6fe52`, blank screenshot
- [x] **Fixed — the inline attempt is now crash-safe** (scenarios 27–29). Three changes, each pinned by a test that fails without it: the row is born with its first D7 slot so the sweep owns it from birth; the attempt counter is written before the provider call so a lost response still counts as our own retry (D8 carve-out a); and the Consta call has a deadline like every other provider call (provider-latency D1), so a stall becomes a retryable failure instead of a hang. Original defect, for the record:
- [x] **Found by the 2026-08-18 spike: the inline attempt was not crash-safe, and a stalled one bricked the payment.** `runValidation` runs apiCEP (~14 s), then claims the CEP's tracking key in its own committed write, then makes two WispHub calls, creates the charge, attempts reconnection, and only then writes the final status. The first real submission stalled in the WispHub section after the claim had committed. The result is a row stranded in `validating` with `next_validation_at = NULL` — and `sweepDirectPayments` selects on `isNotNull(nextValidationAt)`, so the sweep can neither retry it nor ever expire it (D7's 6-hour window only exists inside the sweep). Worse, the CEP is validated at apiCEP by then, so the customer's retry arrives as a fresh row whose `constaStatus` is `null`, D8 carve-out (a) does not apply, and they are told `TRANSFER_ALREADY_USED` — for a transfer they really made, permanently. Reproduced live: rows `8b6bbc6c` (stranded, tracking key claimed) and `533cefc1` (`TRANSFER_ALREADY_USED` on the honest retry). Fix direction: give the row its first D7 slot at INSERT so the sweep owns it from birth regardless of what the inline attempt does, and treat "a live row on this link already holds this tracking key" as our own retry rather than a foreign validation
- [x] ~~Dependency: Consta running on a permanent apiCEP `sk_live_` key~~ — **not a dependency.** The `apicep_` token Consta runs on is already permanent, and no `sk_live_` key was ever on offer (consta validation spec, provider notes). What did make the e2e check meaningless was a **revoked** token in the GitHub environment secret, reinstated by every deploy — now caught by the post-deploy credential probe (CICD D6).

---
status: in-development
stories: [US-D01, US-D02, US-D03, US-D04, US-D05, US-D06]
domain: direct-payment
updated: 2026-08-17
debt: [TD-013]
---

# Spec: Direct SPEI payment channel (Link de pago)

Devolada's store network serves unbanked customers who pay cash at a corner store. This spec adds a second, parallel channel for banked customers: a permanent payment link the ISP shares once, which the customer bookmarks and opens whenever they owe. The page shows the current debt (live from WispHub), SPEI instructions pointing at the ISP's own CLABE, and two ways to submit proof — a screenshot (Consta receipt-URL door) or manual transfer data (Consta transfer door). On validation, the system records a `channel = 'spei'` charge with no store involvement, triggers the same reconnection flow as store charges, and the customer sees the result live. The money flows directly from customer to ISP; Devolada validates but never custodies funds.

## Decisions

- **D1 — Permanent link with opaque token per customer.** The link is `pago.devoladapago.com/p/<token>` where `<token>` is a non-guessable, unique, permanent token per customer (per ISP). The link never expires. Each time the customer opens it, the page queries WispHub for current debt. If the customer owes nothing, shows "Sin adeudo". If they owe, shows SPEI payment instructions. The ISP shares the link once and the customer bookmarks it. **Rejected**: per-transaction links with expiration (unnecessary complexity; the customer's debt status is always fresh from WispHub), readable `usuario` in URL (privacy: anyone who guesses it sees debt status).
- **D2 — Both proof doors: screenshot or manual data.** The customer can submit proof via: (a) uploading a screenshot of their bank transfer (Consta's `receiptUrl` door → apiCEP OCR), or (b) entering transfer details manually (tracking key, sender bank, date — Consta's `transfer` door). Amount and beneficiary are pre-filled (the system knows them). **Rejected**: only manual data (many customers don't know what a tracking key is), only screenshot (OCR can fail, manual is the reliable fallback). **Measured 2026-08-18, and the margin is wider than assumed**: of three real Nubank transfers, the receipt door read two and failed the third outright — `invalid` with no CEP data, twice — while the transfer door validated that same transfer in 12.5 s and has not missed one yet. So the doors are not equals with different ergonomics: the screenshot door is the convenient one and the manual door is the *correct* one, and dropping the manual fallback would strand one payer in three. It also sets the shape of anything built on top — extraction should aim the screenshot at the transfer door, not add a second reader in front of the receipt door.
- **D3 — Service fee configurable per ISP.** The ISP configures the service fee for direct SPEI payments separately from the store service fee, from the Admin settings page. A new column `speiServiceFeeCents` on the `isps` table (default: `NULL` → falls back to `serviceFeeCents`). This allows the ISP to incentivize or disincentivize SPEI payments relative to store payments. **Rejected**: hardcoded same fee (ISPs have different strategies), no service fee (Devolada still provides value in validation and reconnection).
- **D4 — The CLABE is the ISP's, never Devolada's.** The ISP configures their own CLABE, bank and beneficiary name in Admin settings (`speiClabe`, `speiBank`, `speiBeneficiaryName` on `isps` table — the bank name landed during development: Consta's transfer door requires the receiving institution by name, and deriving it from the CLABE prefix would mean maintaining a bank catalog). The money flows directly from customer to ISP. Devolada validates but never custodies funds — no fintech license required. "Available" additionally requires Consta's env config (`CONSTA_BASE_URL` + `CONSTA_API_KEY`): a CLABE nothing can validate must not be shown, so prod answers `unavailable` until Consta has a prod env. **Rejected**: Devolada concentrator CLABE (requires fintech licensing, fund custody, and dispersion — regulatory burden incompatible with the current model).
- **D5 — Automatic link generation for all WispHub customers.** Payment links are generated automatically — every customer in the ISP's WispHub tenant gets a permanent link. The `payment_links` table maps `token → (ispId, wisphubCustomerId, customerUsuario)`. Links are created lazily (on first access or on ISP request) or in batch. No manual per-customer creation needed. **Rejected**: manual per-customer link creation from Admin (too much friction for ISPs with hundreds/thousands of customers).
- **D6 — Direct charges bypass stores entirely.** A direct SPEI payment creates a `charge` with `channel = 'spei'` and `storeId = NULL`. No store commission, no store balance impact, no ledger entries for commission. The charge still goes through the same reconnection flow (inline attempt + queue). The admin feed shows both channels with visual distinction. **Rejected**: attributing direct payments to a "virtual store" (breaks the ledger model; a store that doesn't hold cash shouldn't have a balance).
- **D7 — Pending CEP re-validates on a front-loaded schedule, riding the existing cron.** When Consta returns `pending`, the system stores the attempt and re-validates riding the api's existing every-minute scheduled sweep (no new Worker trigger). The cadence follows where CEPs actually appear (researched 2026-08-17): Banxico makes the CEP available at most ~30 minutes after the transfer, and apiCEP's own docs say "normalmente se genera segundos después… pero puede tardar horas". So the schedule is dense inside that first half hour and sparse in the anomaly tail: **+2, +8, +20, +45 min, +2 h, +6 h** — the typical customer confirms in 2–8 minutes, the 30-minute rule is covered with margin, and the worst case stays at ~7 paid calls (≈$1.75) instead of the 72 ($18 — more than the fee itself) a flat 5-minute loop would burn. After 6 h, status becomes `expired` and the customer is told to contact their ISP. **The row is born with its first slot already set, at INSERT** — the inline attempt is an optimisation, not the mechanism. A validation takes ~15 s (consta spec, provider notes), and anything can end a worker inside that window: an eviction, a deploy, a provider stalling past its deadline. Rows used to be inserted with `next_validation_at = NULL` and depend on the inline attempt to schedule themselves, so an interrupted attempt left a row that `sweepDirectPayments` — which selects on `isNotNull(next_validation_at)` — could neither retry nor expire, since the 6 h window only exists inside the sweep. The customer's money had moved and nothing would ever look at the payment again (found live 2026-08-18, first real submission). The log (`created_at`, `confirmed_at`, `validation_attempts`, receiving bank) accumulates our own latency distribution, so the schedule can later be tuned per receiving bank on real evidence. Open dependency: apiCEP hasn't answered whether pending re-checks consume credits (pending email); if they don't, the early cadence can densify. **Rejected**: flat 5-minute polling (cost kills the margin), pure exponential from 5 min (back-loaded: it makes the common seconds-to-minutes case wait longest exactly where the probability mass lives), requiring the customer to re-submit (bad UX).
- **D8 — One transfer pays once, and Devolada keeps that book itself.** The primary defense is ours: a partial unique index on `(isp_id, tracking_key)` over non-`invalid`/non-`expired` `direct_payments` rows makes a second submission of the same transfer — including two racing concurrent ones — fail at the database, with `TRANSFER_ALREADY_USED`. Consta's `alreadyValidated` flag is the secondary signal, with two carve-outs learned from its semantics: (a) re-validations of the *same* `direct_payments` row ignore the flag — our own earlier attempt may have set it (a lost `valid` response would otherwise brick a legitimate payment on retry). **"Attempt", not "verdict": the attempt counter is written *before* the provider call, and the carve-out keys on it.** It first keyed on `consta_status`, which is only written when a call comes *back* — so a call that never returned left no trace, and the retry read as a stranger's validation. Live on 2026-08-18: apiCEP validated the CEP, the worker died before recording it, and the honest retry was answered `TRANSFER_ALREADY_USED` for a transfer the customer had really made, with the money already in the ISP's account. Whether a call *may have landed* is knowable only in advance, so it is recorded in advance; (b) the flag with no local record (someone validated this CEP outside Devolada — e.g. the ISP checked it by hand in apiCEP's web) still rejects, but the rejection is surfaced in the admin feed so the ISP can resolve it with the customer. **Rejected**: trusting the provider flag alone (false rejects on our own retries, and blind to same-instant races it hasn't recorded yet).
- **D9 — The payment page is a public micro-frontend.** `apps/pago` is a lightweight Vite app (no auth, no sessions, mobile-first). It communicates with `apps/api` via public endpoints under `/direct-payments/`. The page has four states: loading debt → showing instructions → validating payment → result (confirmed / pending / failed / no-debt). **Rejected**: embedding in the store PWA (different audience, different auth model), building inside the admin (the customer has no admin access).
- **D10 — The page is in es-MX, uses "pago" not "cobro".** This is the customer-facing surface. The glossary reserves "cobro" for store/admin interfaces and "pago" for end-customer receipts. The payment link page is the customer's interface, so it says "pago", "tu servicio", "transferencia". **Aligned with**: receipt spec which already uses "pago" on the customer-facing text. The page also obeys the FRONTEND laws like any other surface: tokens only, `StatusBadge` as the sole representation of its statuses, icon + text, light + dark.
- **D11 — `valid` is necessary, not sufficient: the CEP must match the debt.** A verdict only proves *a* transfer happened; it doesn't prove it pays *this* debt. On the transfer door the exact amount travels to Banxico as a search criterion, so a wrong amount already comes back `invalid`. On the receipt door apiCEP validates whatever the receipt claims — a real $1.00 transfer validates as a real $1.00 transfer. So on every `valid`, the integration compares the CEP's returned amount against the expected total (mensualidad + cargo) and its date against a 30-day window (measured 2026-08-17: apiCEP treats the claimed date as a hint, not a filter). Mismatch → the direct payment is `invalid` with `AMOUNT_MISMATCH` / `STALE_TRANSFER`, no charge. **Rejected**: trusting the verdict alone (the $1-receipt hole), accepting partial amounts (a debt is paid whole or not at all in v1).
- **D12 — Proof uploads are token-bound and ephemeral.** There is no anonymous upload endpoint. The proof is uploaded through the link itself (`POST /direct-payments/links/:token/proof`), capped at 1 MB (apiCEP's own limit). Accepted types are **what the provider can read**, not "images": any `image/*` plus `application/pdf` (apiCEP's list, checked 2026-08-18: JPEG, PNG, PDF, GIF, WebP, BMP, TIFF, HEIC). The first implementation took image types only, which shut out the several Mexican banks that issue the comprobante as a PDF and pushed those customers to the manual door for no reason — HEIC, the format an iPhone photo actually is, only passed by accident of starting with `image/`. It lands in a private R2 bucket `devolada-transfer-proofs`; what Consta receives is a short-lived signed URL (HMAC over key+expiry, served by the API itself at `GET /direct-payments/proofs/:linkId/:file` — R2 bindings don't presign, and a 15-minute single-purpose URL doesn't need S3 credentials), and a lifecycle rule deletes objects after 15 days (the same horizon as the provider's own download links). Proof keys are namespaced by link id, so a pay request can only reference proofs uploaded through its own link, and pay verifies the object exists before spending a provider call. **Rejected**: a public upload endpoint returning public URLs (free anonymous file hosting under the product's domain), keeping proofs forever (they are evidence for a dispute window, not an archive). Named "proof", not "receipt" — the glossary reserves receipt/comprobante for the folio we issue.
- **D13 — Validation attempts have a budget, because each one costs money — and so do uploads, in a different currency.** Every proof submission triggers a paid provider call, on a public endpoint. Per link: at most 5 submissions per hour → 429 `TOO_MANY_ATTEMPTS` with honest es-MX copy. Uploading carries **its own cap of 20 per hour per link**, because it creates no `direct_payments` row: counting only submissions left the upload endpoint effectively uncapped, and a leaked link was free 1 MB-at-a-time hosting under our own domain until the 15-day lifecycle swept it. The cap is 4× the submission budget — an upload is cheap and a customer may retake a photo — and the hour rides in the object key (`<linkId>/<hour>-<uuid>`) so counting one hour is two bounded listings rather than a scan of every proof the link still has. The public routes additionally sit behind Cloudflare rate limiting. **Rejected**: unlimited attempts (a hostile visitor with a leaked link drains apiCEP credits at $0.25 a call); one shared counter (the two doors fail differently — one spends money, the other spends storage).
- **D14 — A validated transfer with nothing left to pay becomes `unapplied`, never silent.** Between submission and confirmation (up to 6 h pending) the debt can be settled elsewhere — typically cash at a store. The money has already moved to the ISP's CLABE, so the system neither registers a second WispHub payment nor discards the proof: the direct payment ends as `unapplied`, visible to the ISP in the feed ("pago validado sin adeudo — resolver con el cliente"), and no charge is created. **Rejected**: silently registering anyway (double payment in WispHub), silently dropping (the customer's money vanishes from every screen).
- **D15 — One invoice at a time, oldest first.** A customer can owe several months. The page shows and charges exactly one pending invoice per cycle — the oldest — same as the store flow; after a confirmed payment the page re-reads WispHub and, if debt remains, shows the next one. **Rejected**: a combined multi-month total (one CEP would have to match a sum WispHub never invoiced, and partial matching contradicts D11).

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
3. **Instrucciones de pago** — shows the breakdown (mensualidad, cargo por servicio, total), SPEI data (CLABE, beneficiario, monto, referencia), and two proof submission options: "Subir comprobante" (screenshot) / "Ingresa los datos de tu transferencia" (manual form). A copy button on each SPEI field.
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
18. Two concurrent submissions of the same tracking key → exactly one survives the unique index; the other gets `TRANSFER_ALREADY_USED` (D8)
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

## Definition of Done

- [x] Scenarios 1–4, 7–11, 16–26 automated in the API layer (`test/direct-payment.test.ts`; Consta and WispHub fetch-mocked respecting their contracts)
- [x] Scenarios 5–6 automated with Consta fetch-mocked (`test/direct-payment.test.ts` — asserts the door and the server-supplied amount/beneficiary)
- [x] Scenario 12 automated in `test/direct-payment.test.ts` (a queued spei charge converts through `sweepReconnections`)
- [x] Scenarios 13–14 automated in admin API tests (`test/settings.test.ts`, `test/charge-feed.test.ts` — the files that already owned those endpoints)
- [x] Scenario 15 automated with Testing Library + MSW (`apps/pago/test/pago.test.tsx`, 7 tests)
- [x] Schema migration written and applied locally (`0007_icy_talisman.sql`): `payment_links` and `direct_payments` tables (with the D8 partial unique index) created; `charges` and `isps` altered. Hand-adjusted after generation: D1 rejects `PRAGMA foreign_keys`, and under the allowed `defer_foreign_keys` drizzle's drop-and-rename recreate cannot commit with live `ledger_entries` rows — SQLite's deferred-violation counter only decrements when the missing parent keys are *inserted*, which a rename never does (found live: the first remote apply rolled back the dev DB). The recreate therefore copies `charges` into an FK-free holding table, drops it, recreates it under its real name, and copies back — verified against a seeded local D1 and in plain SQLite. drizzle-kit's copy-INSERT also selected the two brand-new columns from the old table
- [x] Re-validation rides the existing api scheduled sweep (no new trigger); `POST /dev/direct-payment-sweep` is the manual escape hatch
- [ ] `apps/pago` deployed to `pago.dev.devoladapago.com` (wired into ci/deploy-dev/deploy-prod; happens on merge). One-time infra per env: create the R2 bucket (`devolada-transfer-proofs-dev` / `-prod`) with the 15-day lifecycle rule, and set the `CONSTA_API_KEY` environment secret
- [x] Manual check on deployed dev, receipt door (2026-08-18): two real Nubank SPEI transfers to the ISP's Klar CLABE. The **$1.00 receipt against a $2.00 debt came back `AMOUNT_MISMATCH`** — Consta `valid`, our own D11 check refusing it — which is scenario 16 verified against Banxico instead of a mock, and D11's `$1-receipt hole` closed on real evidence. Round trip 13.5 s. apiCEP read the amount, sender bank, date and the full 28-character clave de rastreo correctly (consta spec, provider notes)
- [x] Manual check on deployed dev, **confirm path — verified end to end** (2026-08-18): a real $2.00 SPEI transfer against a $2.00 debt produced charge `DV-8O8OHA` with `channel = 'spei'` and `store_id = NULL`, the payment registered in WispHub (invoice 14), `reconnection_status = 'reconnected'` against the CHR lab router, and **zero `ledger_entries`** — scenarios 7 and 12, and D6's "no store, no commission", confirmed against the real providers rather than mocks. It went through the **transfer door**: the receipt door had refused the same transfer twice (see the OCR finding below)
- [x] **Round two, 2026-08-18: a forged receipt, an unreadable image, and a real one.** Three findings, each recorded in the consta spec's provider notes:
  - **A forged receipt cannot work.** One character of the clave de rastreo was changed; apiCEP returned Banxico's *real* key with the true amount, and D8 refused it as `TRANSFER_ALREADY_USED`. Had the transfer been fresh, D11 would have caught the amount. The defence is not that we detect the edit — it is that the verdict never comes from the image
  - **The receipt door produces false negatives.** A genuine, unspent comprobante was `invalid` twice with no CEP data at all, and the same transfer confirmed through the transfer door in 12.5 s. One in three real receipts. On the wire this is indistinguishable from a transfer that never happened, so a customer who really paid is told their payment could not be verified
  - **An unreadable image costs far more than one call** — see the open question below
- [ ] **Open question for D7/D13: a `PROVIDER_ERROR` on an image that can never be read is retried like an outage.** A screenshot containing no receipt makes apiCEP error rather than answer `invalid`; that maps to a retryable failure, so the payment rides the full D7 schedule — up to **7 paid provider calls over 6 hours**, ending in `expired`, with the customer watching a spinner the whole time. Retrying is right for a provider that is down and wrong for an image that has no receipt in it, and today nothing distinguishes them. Options, none chosen: treat a provider error on the *first* attempt of a receipt-door payment as terminal; cap receipt-door retries below the transfer door's; or refuse unreadable images before they reach the provider at all (the case the AI pre-filter proposal is strongest on). Measured live: `a5b6fe52`, blank screenshot
- [x] **Fixed — the inline attempt is now crash-safe** (scenarios 27–29). Three changes, each pinned by a test that fails without it: the row is born with its first D7 slot so the sweep owns it from birth; the attempt counter is written before the provider call so a lost response still counts as our own retry (D8 carve-out a); and the Consta call has a deadline like every other provider call (provider-latency D1), so a stall becomes a retryable failure instead of a hang. Original defect, for the record:
- [x] **Found by the 2026-08-18 spike: the inline attempt was not crash-safe, and a stalled one bricked the payment.** `runValidation` runs apiCEP (~14 s), then claims the CEP's tracking key in its own committed write, then makes two WispHub calls, creates the charge, attempts reconnection, and only then writes the final status. The first real submission stalled in the WispHub section after the claim had committed. The result is a row stranded in `validating` with `next_validation_at = NULL` — and `sweepDirectPayments` selects on `isNotNull(nextValidationAt)`, so the sweep can neither retry it nor ever expire it (D7's 6-hour window only exists inside the sweep). Worse, the CEP is validated at apiCEP by then, so the customer's retry arrives as a fresh row whose `constaStatus` is `null`, D8 carve-out (a) does not apply, and they are told `TRANSFER_ALREADY_USED` — for a transfer they really made, permanently. Reproduced live: rows `8b6bbc6c` (stranded, tracking key claimed) and `533cefc1` (`TRANSFER_ALREADY_USED` on the honest retry). Fix direction: give the row its first D7 slot at INSERT so the sweep owns it from birth regardless of what the inline attempt does, and treat "a live row on this link already holds this tracking key" as our own retry rather than a foreign validation
- [x] ~~Dependency: Consta running on a permanent apiCEP `sk_live_` key~~ — **not a dependency.** The `apicep_` token it runs on is permanent (measured 2026-08-18/19: unaffected by two hours' age or by minting a replacement), and the `sk_live_` key it was meant to become traces to a 401 hint rather than to anything apiCEP offers us. What did make the e2e check meaningless was a bad secret reinstated by every deploy — now caught by the post-deploy credential probe (CICD D6).

---
status: in-development
stories: [US-D01, US-D02, US-D03, US-D04, US-D05, US-D06]
domain: direct-payment
updated: 2026-08-17
debt: []
---

# Spec: Direct SPEI payment channel (Link de pago)

Devolada's store network serves unbanked customers who pay cash at a corner store. This spec adds a second, parallel channel for banked customers: a permanent payment link the ISP shares once, which the customer bookmarks and opens whenever they owe. The page shows the current debt (live from WispHub), SPEI instructions pointing at the ISP's own CLABE, and two ways to submit proof — a screenshot (Consta receipt-URL door) or manual transfer data (Consta transfer door). On validation, the system records a `channel = 'spei'` charge with no store involvement, triggers the same reconnection flow as store charges, and the customer sees the result live. The money flows directly from customer to ISP; Devolada validates but never custodies funds.

## Decisions

- **D1 — Permanent link with opaque token per customer.** The link is `pago.devoladapago.com/p/<token>` where `<token>` is a non-guessable, unique, permanent token per customer (per ISP). The link never expires. Each time the customer opens it, the page queries WispHub for current debt. If the customer owes nothing, shows "Sin adeudo". If they owe, shows SPEI payment instructions. The ISP shares the link once and the customer bookmarks it. **Rejected**: per-transaction links with expiration (unnecessary complexity; the customer's debt status is always fresh from WispHub), readable `usuario` in URL (privacy: anyone who guesses it sees debt status).
- **D2 — Both proof doors: screenshot or manual data.** The customer can submit proof via: (a) uploading a screenshot of their bank transfer (Consta's `receiptUrl` door → apiCEP OCR), or (b) entering transfer details manually (tracking key, sender bank, date — Consta's `transfer` door). Amount and beneficiary are pre-filled (the system knows them). **Rejected**: only manual data (many customers don't know what a tracking key is), only screenshot (OCR can fail, manual is the reliable fallback).
- **D3 — Service fee configurable per ISP.** The ISP configures the service fee for direct SPEI payments separately from the store service fee, from the Admin settings page. A new column `speiServiceFeeCents` on the `isps` table (default: `NULL` → falls back to `serviceFeeCents`). This allows the ISP to incentivize or disincentivize SPEI payments relative to store payments. **Rejected**: hardcoded same fee (ISPs have different strategies), no service fee (Devolada still provides value in validation and reconnection).
- **D4 — The CLABE is the ISP's, never Devolada's.** The ISP configures their own CLABE and beneficiary name in Admin settings (`speiClabe`, `speiBeneficiaryName` on `isps` table). The money flows directly from customer to ISP. Devolada validates but never custodies funds — no fintech license required. **Rejected**: Devolada concentrator CLABE (requires fintech licensing, fund custody, and dispersion — regulatory burden incompatible with the current model).
- **D5 — Automatic link generation for all WispHub customers.** Payment links are generated automatically — every customer in the ISP's WispHub tenant gets a permanent link. The `payment_links` table maps `token → (ispId, wisphubCustomerId, customerUsuario)`. Links are created lazily (on first access or on ISP request) or in batch. No manual per-customer creation needed. **Rejected**: manual per-customer link creation from Admin (too much friction for ISPs with hundreds/thousands of customers).
- **D6 — Direct charges bypass stores entirely.** A direct SPEI payment creates a `charge` with `channel = 'spei'` and `storeId = NULL`. No store commission, no store balance impact, no ledger entries for commission. The charge still goes through the same reconnection flow (inline attempt + queue). The admin feed shows both channels with visual distinction. **Rejected**: attributing direct payments to a "virtual store" (breaks the ledger model; a store that doesn't hold cash shouldn't have a balance).
- **D7 — Pending CEP re-validates on a front-loaded schedule, riding the existing cron.** When Consta returns `pending`, the system stores the attempt and re-validates riding the api's existing every-minute scheduled sweep (no new Worker trigger). The cadence follows where CEPs actually appear (researched 2026-08-17): Banxico makes the CEP available at most ~30 minutes after the transfer, and apiCEP's own docs say "normalmente se genera segundos después… pero puede tardar horas". So the schedule is dense inside that first half hour and sparse in the anomaly tail: **+2, +8, +20, +45 min, +2 h, +6 h** — the typical customer confirms in 2–8 minutes, the 30-minute rule is covered with margin, and the worst case stays at ~7 paid calls (≈$1.75) instead of the 72 ($18 — more than the fee itself) a flat 5-minute loop would burn. After 6 h, status becomes `expired` and the customer is told to contact their ISP. The log (`created_at`, `confirmed_at`, `validation_attempts`, receiving bank) accumulates our own latency distribution, so the schedule can later be tuned per receiving bank on real evidence. Open dependency: apiCEP hasn't answered whether pending re-checks consume credits (pending email); if they don't, the early cadence can densify. **Rejected**: flat 5-minute polling (cost kills the margin), pure exponential from 5 min (back-loaded: it makes the common seconds-to-minutes case wait longest exactly where the probability mass lives), requiring the customer to re-submit (bad UX).
- **D8 — One transfer pays once, and Devolada keeps that book itself.** The primary defense is ours: a partial unique index on `(isp_id, tracking_key)` over non-`invalid`/non-`expired` `direct_payments` rows makes a second submission of the same transfer — including two racing concurrent ones — fail at the database, with `TRANSFER_ALREADY_USED`. Consta's `alreadyValidated` flag is the secondary signal, with two carve-outs learned from its semantics: (a) re-validations of the *same* `direct_payments` row ignore the flag — our own earlier attempt may have set it (a lost `valid` response would otherwise brick a legitimate payment on retry); (b) the flag with no local record (someone validated this CEP outside Devolada — e.g. the ISP checked it by hand in apiCEP's web) still rejects, but the rejection is surfaced in the admin feed so the ISP can resolve it with the customer. **Rejected**: trusting the provider flag alone (false rejects on our own retries, and blind to same-instant races it hasn't recorded yet).
- **D9 — The payment page is a public micro-frontend.** `apps/pago` is a lightweight Vite app (no auth, no sessions, mobile-first). It communicates with `apps/api` via public endpoints under `/direct-payments/`. The page has four states: loading debt → showing instructions → validating payment → result (confirmed / pending / failed / no-debt). **Rejected**: embedding in the store PWA (different audience, different auth model), building inside the admin (the customer has no admin access).
- **D10 — The page is in es-MX, uses "pago" not "cobro".** This is the customer-facing surface. The glossary reserves "cobro" for store/admin interfaces and "pago" for end-customer receipts. The payment link page is the customer's interface, so it says "pago", "tu servicio", "transferencia". **Aligned with**: receipt spec which already uses "pago" on the customer-facing text. The page also obeys the FRONTEND laws like any other surface: tokens only, `StatusBadge` as the sole representation of its statuses, icon + text, light + dark.
- **D11 — `valid` is necessary, not sufficient: the CEP must match the debt.** A verdict only proves *a* transfer happened; it doesn't prove it pays *this* debt. On the transfer door the exact amount travels to Banxico as a search criterion, so a wrong amount already comes back `invalid`. On the receipt door apiCEP validates whatever the receipt claims — a real $1.00 transfer validates as a real $1.00 transfer. So on every `valid`, the integration compares the CEP's returned amount against the expected total (mensualidad + cargo) and its date against a 30-day window (measured 2026-08-17: apiCEP treats the claimed date as a hint, not a filter). Mismatch → the direct payment is `invalid` with `AMOUNT_MISMATCH` / `STALE_TRANSFER`, no charge. **Rejected**: trusting the verdict alone (the $1-receipt hole), accepting partial amounts (a debt is paid whole or not at all in v1).
- **D12 — Proof uploads are token-bound and ephemeral.** There is no anonymous upload endpoint. The proof image is uploaded through the link itself (`POST /direct-payments/links/:token/proof`), capped at 1 MB (apiCEP's own limit) and image types only. It lands in a private R2 bucket `devolada-transfer-proofs`; what Consta receives is a short-lived presigned URL, and a lifecycle rule deletes objects after 15 days (the same horizon as the provider's own download links). **Rejected**: a public upload endpoint returning public URLs (free anonymous file hosting under the product's domain), keeping proofs forever (they are evidence for a dispute window, not an archive). Named "proof", not "receipt" — the glossary reserves receipt/comprobante for the folio we issue.
- **D13 — Validation attempts have a budget, because each one costs money.** Every proof submission triggers a paid provider call, on a public endpoint. Per link: at most 5 submissions per hour → 429 `TOO_MANY_ATTEMPTS` with honest es-MX copy. The public routes additionally sit behind Cloudflare rate limiting. **Rejected**: unlimited attempts (a hostile visitor with a leaked link drains apiCEP credits at $0.25 a call).
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
| `proof_url`            | TEXT    | private R2 object key if screenshot uploaded (D12)              |
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
- ADD `spei_beneficiary_name` TEXT
- ADD `spei_service_fee_cents` INTEGER — NULL → falls back to `service_fee_cents` (D3)

## Contract

### Public endpoints (no auth)

`GET /direct-payments/links/:token` (US-D01)

Returns the customer's current debt status and SPEI instructions, or the no-debt state. The API resolves the token to a `payment_links` row, fetches current debt from WispHub, and computes the total (monthly fee + SPEI service fee).

```
200 { ispName, customerName, status: "debt" | "no_debt" | "unavailable",
      monthlyFeeCents?, serviceFeeCents?, totalCents?,
      speiClabe?, speiBeneficiaryName?, reference? }
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

```
201 { directPaymentId, status: "validating" | "confirmed" | "invalid",
      error?: "TRANSFER_ALREADY_USED" | "AMOUNT_MISMATCH" | "STALE_TRANSFER"
            | "NOTHING_DUE" | "SPEI_NOT_CONFIGURED" }
```

- `TRANSFER_ALREADY_USED` → our own unique index hit, or Consta's
  `alreadyValidated` with no local record (D8)
- `AMOUNT_MISMATCH` / `STALE_TRANSFER` → the CEP is real but doesn't match the
  debt (D11)
- `NOTHING_DUE` → customer has no pending invoice at submission time
- `SPEI_NOT_CONFIGURED` → ISP has not set `speiClabe` (D4)
- 429 `TOO_MANY_ATTEMPTS` → the per-link budget ran out (D13)
- Unknown token → 404

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

Upload the proof image through the link itself — no anonymous uploads exist.
1 MB max, image types only; stored in the private `devolada-transfer-proofs`
bucket with a 15-day lifecycle. Returns the object reference to use in the
`receiptUrl` door (the server resolves it to a short-lived presigned URL when
calling Consta).

```
multipart/form-data { file }
→ 200 { proofId }
- 413 over 1 MB · 415 not an image · 404 unknown token · 429 over budget (D13)
```

### ISP session endpoints (admin)

`GET /direct-payments/links` — list all payment links for the ISP (paginated, US-D06).

ISP settings endpoints already exist; extend to include `speiClabe`, `speiBeneficiaryName`, and `speiServiceFeeCents` (US-D05).

The admin charges feed (`GET /charges`) already returns charges; `channel` is now part of the response shape for visual distinction (US-D06).

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
8. Consta returns `pending` → direct payment stays `validating`, `next_validation_at` set 5 min ahead (US-D04, D7)
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

## Definition of Done

- [ ] Scenarios 1–4, 7–11, 16–24 automated in the API layer (`test/direct-payment.test.ts`)
- [ ] Scenarios 5–6 automated with Consta client mocked (`test/direct-payment.test.ts`)
- [ ] Scenario 12 covered by existing reconnection tests extended for `channel = 'spei'`
- [ ] Scenarios 13–14 automated in admin API tests (`test/admin-settings.test.ts`, `test/charges-feed.test.ts`)
- [ ] Scenario 15 automated with Testing Library + MSW (`apps/pago/test/`)
- [ ] Schema migration applied: `payment_links` and `direct_payments` tables (with the D8 partial unique index) created; `charges` and `isps` altered
- [ ] Re-validation rides the existing api scheduled sweep (no new trigger)
- [ ] `apps/pago` deployed to `pago.dev.devoladapago.com`
- [ ] Manual check on deployed dev: end-to-end flow with a real SPEI transfer against the dev WispHub tenant
- [ ] Dependency: Consta running on a permanent apiCEP `sk_live_` key — today it runs on a short-lived `apicep_` user token (consta validation spec, provider notes); the e2e check is meaningless until the stable key lands

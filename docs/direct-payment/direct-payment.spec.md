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
- **D7 — Pending CEP triggers re-validation cron.** When Consta returns `pending`, the system stores the validation attempt and a cron job re-validates every 5 minutes for up to 6 hours. If still pending after 6 h, status becomes `expired` and the customer is told to contact their ISP. The customer sees real-time status on the payment page. **Rejected**: requiring the customer to come back and re-submit (bad UX; the system should keep trying).
- **D8 — Already-validated transfers are rejected.** If Consta returns `alreadyValidated: true`, the direct payment is rejected with a clear error (`TRANSFER_ALREADY_USED`). Unlike Consta's own design (which flags but doesn't block, per validation spec D4), the Devolada integration makes the business decision: one proof of payment = one charge. **Rejected**: allowing reuse (obvious fraud vector for the ISP's money).
- **D9 — The payment page is a public micro-frontend.** `apps/pago` is a lightweight Vite app (no auth, no sessions, mobile-first). It communicates with `apps/api` via public endpoints under `/direct-payments/`. The page has four states: loading debt → showing instructions → validating payment → result (confirmed / pending / failed / no-debt). **Rejected**: embedding in the store PWA (different audience, different auth model), building inside the admin (the customer has no admin access).
- **D10 — The page is in es-MX, uses "pago" not "cobro".** This is the customer-facing surface. The glossary reserves "cobro" for store/admin interfaces and "pago" for end-customer receipts. The payment link page is the customer's interface, so it says "pago", "tu servicio", "transferencia". **Aligned with**: receipt spec which already uses "pago" on the customer-facing text.

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
| `status`               | TEXT    | NOT NULL DEFAULT `'validating'` — validating / confirmed / invalid / expired |
| `proof_mode`           | TEXT    | NOT NULL — `'receipt'` / `'transfer'`                           |
| `tracking_key`         | TEXT    | from customer input or CEP                                      |
| `sender_bank`          | TEXT    |                                                                 |
| `transfer_date`        | TEXT    |                                                                 |
| `receipt_url`          | TEXT    | R2 URL if screenshot uploaded                                   |
| `consta_validation_id` | TEXT    |                                                                 |
| `consta_status`        | TEXT    | valid / pending / invalid                                       |
| `charge_id`            | TEXT FK | → `charges.id` — set when confirmed and charge created          |
| `validation_attempts`  | INTEGER | NOT NULL DEFAULT 0                                              |
| `next_validation_at`   | INTEGER | ms epoch — for pending re-validation cron (D7)                  |
| `last_error`           | TEXT    |                                                                 |
| `confirmed_at`         | INTEGER | ms epoch                                                        |
| `created_at`           | INTEGER | NOT NULL, ms epoch                                              |

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
200 { ispName, customerName, status: "debt" | "no_debt",
      monthlyFeeCents?, serviceFeeCents?, totalCents?,
      speiClabe?, speiBeneficiaryName?, reference? }
```

- `status: "no_debt"` → only `ispName` and `customerName`; the page shows "Sin adeudo"
- Unknown token → 404

`POST /direct-payments/links/:token/pay` (US-D02)

Submit proof of SPEI transfer. Exactly one proof door (same principle as Consta D1):

```
{ receiptUrl: "https://…" }
{ transfer: { trackingKey, senderBank, date: "YYYY-MM-DD" } }
```

Amount, beneficiary CLABE, and beneficiary name are server-side (D1 principle: the server computes, the client never sends its own amount).

```
201 { directPaymentId, status: "validating" | "confirmed" | "invalid",
      error?: "TRANSFER_ALREADY_USED" | "NOTHING_DUE" | "SPEI_NOT_CONFIGURED" }
```

- `TRANSFER_ALREADY_USED` → Consta's `alreadyValidated` was `true` (D8)
- `NOTHING_DUE` → customer has no pending invoice at submission time
- `SPEI_NOT_CONFIGURED` → ISP has not set `speiClabe` (D4)
- Unknown token → 404

`GET /direct-payments/:id/status` (US-D03, US-D04)

Poll the validation lifecycle and reconnection status:

```
200 { status: "validating" | "confirmed" | "invalid" | "expired",
      reconnectionStatus?: "queued" | "reconnected" | "failed",
      folio?, validationAttempts, error? }
```

- `confirmed` with `reconnected` is the green moment (US-D03)
- `validating` means a pending CEP re-check is scheduled (D7, US-D04)
- Unknown id → 404

`POST /direct-payments/upload` (US-D02)

Upload a receipt image. Returns the R2 URL to use in the `receiptUrl` door.

```
multipart/form-data { file }
→ 200 { url: "https://…" }
```

### ISP session endpoints (admin)

`GET /direct-payments/links` — list all payment links for the ISP (paginated, US-D06).

ISP settings endpoints already exist; extend to include `speiClabe`, `speiBeneficiaryName`, and `speiServiceFeeCents` (US-D05).

The admin charges feed (`GET /charges`) already returns charges; `channel` is now part of the response shape for visual distinction (US-D06).

## Consta integration

`apps/api` calls Consta (`consta.devoladapago.com`) as an HTTP client with a `ck_…` API key stored as a worker secret (`CONSTA_API_KEY`). The integration module lives at `src/consta/client.ts`.

- **Receipt door**: the image is first uploaded to an R2 bucket (`devolada-receipts`) via `POST /direct-payments/upload` and the public URL is passed as `receiptUrl`. The ISP's beneficiary is sent as `beneficiary` (CLABE + name from ISP config).
- **Transfer door**: the system pre-fills `amountCents` and `beneficiary` (from ISP config) and sends the customer-provided `trackingKey`, `senderBank`, and `date`.
- **Verdict mapping**: Consta `valid` → confirm the direct payment, create the charge, trigger reconnection. Consta `pending` → schedule re-validation (D7). Consta `invalid` → mark direct payment `invalid`. `alreadyValidated: true` on any verdict → reject with `TRANSFER_ALREADY_USED` (D8).

### Re-validation cron (D7)

A Cloudflare Worker scheduled trigger runs every 5 minutes. It selects `direct_payments` rows where `status = 'validating'` and `next_validation_at <= now()`. For each, it re-calls Consta with the same proof data. Max window: 6 hours from `created_at`; after that, `status → 'expired'`. On `valid`, the charge is created and reconnection starts. On `pending`, `next_validation_at` advances 5 minutes and `validation_attempts` increments.

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

## Definition of Done

- [ ] Scenarios 1–4, 7–11 automated in the API layer (`test/direct-payment.test.ts`)
- [ ] Scenarios 5–6 automated with Consta client mocked (`test/direct-payment.test.ts`)
- [ ] Scenario 12 covered by existing reconnection tests extended for `channel = 'spei'`
- [ ] Scenarios 13–14 automated in admin API tests (`test/admin-settings.test.ts`, `test/charges-feed.test.ts`)
- [ ] Scenario 15 automated with Testing Library + MSW (`apps/pago/test/`)
- [ ] Schema migration applied: `payment_links` and `direct_payments` tables created; `charges` and `isps` altered
- [ ] Re-validation cron deployed as a Cloudflare Worker scheduled trigger
- [ ] `apps/pago` deployed to `pago.devoladapago.com`
- [ ] Manual check on deployed dev: end-to-end flow with a real SPEI transfer against the dev WispHub tenant

---
status: in-development
stories: [US-C03, US-C04]
domain: charges
updated: 2026-08-14
debt: [TD-008]
pays: [TD-009]
---

# Spec: Reconnection queue

The charge is already safe in the ledger the moment the store records it (charge-record D2). This spec is about the other half of US-C04: when the first reconnection attempt does not succeed, something has to keep trying, with a schedule the store and the ISP can see. It opens by paying **TD-009**, the condition we recorded before retries could ship.

## Decisions

- **D1 — Pay a pending invoice; never create a second one (pays TD-009).** Before creating, the adapter lists WispHub invoices with `estado=1` (Pendiente) over a window of the last 45 days and matches `cliente.usuario` in our own code — **the list endpoint has no customer filter** (verified against the live API, OPTIONS documents `desde`, `hasta`, `tipo_fecha`, `estado`, `forma_pago`, `zona`, `cajero`). The invoice id we used is then stored on the charge, so a retry pays the same invoice even if the list lies: the spike warns that its default date range is the current month, and an empty answer is not proof of absence. Today's sandbox still holds the evidence of the bug — three invoices for one customer, one of them flipped to "Se Transfirio".
- **D2 — The charge row is the queue.** A cron trigger sweeps `charges` where `reconnection_status = 'queued'` and `next_attempt_at <= now`. **Rejected**: Cloudflare Queues — it needs the paid plan, and it would keep retry state somewhere the admin feed cannot read. The same rule that governs the ledger applies here: the state the UI shows lives in the table the UI reads.
- **D3 — Backoff 1, 5, 15, 60, 240 minutes, then `failed`.** Five retries across about five hours. WispHub applies the payment through its own async task and the spike measured the customer list lagging ~40s behind a paid invoice, so the first retry is the one most likely to convert; the long tail exists for outages. After the last one the charge is `failed` — a human problem, and the ISP already has the failed strip that demands attention (charge-feed D3).
- **D4 — A lease, not a lock.** Claiming a charge writes `next_attempt_at = now + 2 min` **before** the attempt runs. D1 has no row locks, so two overlapping sweeps could otherwise pay twice; and a sweep that dies mid-attempt leaves the charge retryable two minutes later instead of stuck forever. At-least-once, which D1 makes safe: the invoice is reused, not recreated.
- **D5 — A rejected key does not burn the budget.** `WISPHUB_AUTH_FAILED` means the ISP must fix its key in Configuración; retrying cannot help and spending the five attempts would bury the charge in `failed` for a reason the store cannot act on. Those attempts reschedule (30 min) without counting. Outages (`WISPHUB_UNAVAILABLE`) do count: they are what the backoff is for.
- **D6 — Verify, never assume** (charge-record D3, unchanged). Only a customer read that comes back `active` marks `reconnected`. A paid invoice with a still-suspended service stays `queued` — that is the exact case the retries exist for.
- **D7 — The sweep is triggerable by hand in dev.** `POST /dev/reconnect-sweep` runs one pass and answers with what it did. Waiting a minute for cron while checking a real reconnection with a pilot ISP is a bad way to spend a visit.

## Contract

Cron: `* * * * *` (one sweep per minute), handled by the worker's `scheduled` export. One sweep claims at most 20 due charges.

Per charge, one attempt is:

1. find a pending invoice for the customer (or reuse `wisphub_invoice_id`) → create one only if there is none (D1)
2. `registrar-pago` with the ISP's cash payment method
3. read the customer back; `active` → `reconnected` (D6)

State on `charges` (all new columns nullable, additive):

- `wisphub_invoice_id` — the invoice this charge is paying (D1)
- `next_attempt_at` — when the queue may touch it again; `null` once terminal
- `last_error` — the last failure code, for the ISP's detail view

Terminal states: `reconnected` (with `reconnected_at`) or `failed` after 5 counted attempts.

`POST /dev/reconnect-sweep` (dev only) → `{ claimed, reconnected, stillQueued, failed }`.

## UI Contract

- Nothing new to build: the store PWA already polls its charge and the admin feed already shows `queued`/`failed` with the attempt count. The queue makes those numbers move on their own.
- The admin's expanded row adds the plain reason when `last_error` is set: "WispHub rechazó la llave" or "WispHub no respondió".

## Scenarios

1. A queued charge with a pending invoice in WispHub pays **that** invoice and creates none (US-C04, D1, TD-009)
2. With no pending invoice, one is created, its id is stored, and a later retry reuses it (D1)
3. Backoff walks 1 → 5 → 15 → 60 → 240 minutes and then marks `failed` (US-C04, D3)
4. A rejected key reschedules without counting an attempt; an outage counts (D5)
5. The sweep claims only due charges, leases them for 2 minutes, and ignores terminal ones (D2, D4)
6. A verified active customer sets `reconnected` and stops the retries (US-C03, D6)

## Definition of Done

- [x] Scenarios 1–6 automated in the API layer (`test/reconnection-queue.test.ts`, 5 tests)
- [x] Cron trigger configured in `wrangler.jsonc` for dev and prod
- [ ] Real check with the pilot ISP: a charge whose first attempt fails reconnects on a retry, with the physical MikroTik flip observed

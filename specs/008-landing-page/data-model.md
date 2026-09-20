# Data Model: Landing Page

**Feature**: 008-landing-page · **Date**: 2026-09-19, amended 2026-09-20 (design session: D22, D23)

Two new tables, both owned by the platform (no `business_id`, like
`platform_settings`); one typed list compiled into the page; one rule for the
channel tag that every writer shares. No existing table changes.

---

## `access_requests` (table)

What a prospect typed, plus what the page knew (spec: *Access request*).
Append-only: a row is never edited after the notice outcome is written.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | the workspace's `id()` helper |
| `whatsapp` | text, not null | the number as typed, 10–20 characters of digits, spaces, `+ ( ) -` (`WHATSAPP_PATTERN`); the one required answer (FR-015, D23) |
| `name` | text, null | 2–80 characters, trimmed; asked only by the closing form |
| `billing_system` | text enum, null | `wisphub` · `own_software` · `other` · `none` — the answer that decides which door step 3 of the workflow opens (spec Clarifications 2026-09-20); asked only by the closing form |
| `form` | text enum, not null | `hero` (the one-field form in the first screen) · `full` (the closing form) — which form converts (D23) |
| `channel` | text, not null, default `direct` | the tag as typed (rule below) |
| `created_at` | integer ms, not null | the workspace's `createdAt()` helper |
| `notified_at` | integer ms, null | set when the operator notice was accepted by the provider (D10) |
| `notify_error` | text, null | why the notice did not go: `NO_RESEND_KEY`, `NO_OPERATOR_EMAILS`, or `RESEND_<status>`; shown on the operator list (FR-018) |

Indexes: `access_requests_created_idx (created_at)` — the list reads newest
first with a cursor on `(created_at, id)`.

Invariants, enforced by the schema in `routes/landing/schema.ts` and
narrowed nowhere else:

- `whatsapp` matches `WHATSAPP_PATTERN`
- `billing_system`, when present, and `form` are members of their enums
- a `hero` row has `name` and `billing_system` null; a `full` row may carry either
- `channel` matches the tag rule or is `direct`
- the honeypot field (`website`) is **never** a column: a request that
  carried one was refused and not stored (D9)

States: none. A request is received once; the only thing that changes after
insertion is the notice outcome, written by the same request's `waitUntil`.

---

## `landing_counts` (table)

The step counts (spec: *Step count*). Holds no person.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | |
| `day` | text, not null | `YYYY-MM-DD` in `America/Mexico_City` (D8) |
| `channel` | text, not null | the tag or `direct` |
| `step` | text enum, not null | `visit` · `began` · `sent` |
| `count` | integer, not null, default 0 | |

Unique index `landing_counts_day_channel_step_idx (day, channel, step)`; an
event is `INSERT … ON CONFLICT DO UPDATE SET count = count + 1` — one
statement, no read-modify-write.

Who writes which step:

| step | written by | meaning |
| --- | --- | --- |
| `visit` | the page's script, once the page has loaded | a page load — not a person, not a device; the operator screen says so |
| `began` | the page's script, on the first focus inside either form, once per page load | the request was begun (spec FR-023) |
| `sent` | the API, when it stores a request | exact by construction |

Shares shown to the operator are each step over `visit` for the same
channel and period (FR-024).

---

## Claim (compiled-in list, not a table)

`apps/landing/src/content/claims.ts` — frozen, typed, imported by the page's
components and by the tests (D11).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string, unique | how a component asks for it, e.g. `money-never-touches` |
| `text` | string (es-MX) | the sentence exactly as the page says it |
| `basis` | string, non-empty | what makes it true: a decision (`direct-payment D3`), a requirement (`payments-and-classes FR-…`), a file (`apps/api/src/reconnection/queue.ts`), or a measured date |

Rules: every claim has a non-empty `basis` (unit test); every claim's `text`
appears on the page (browser test); the list is reviewed by a person before
each publication (quickstart, *Pre-flight*). The entries follow the canvas
(v8) and are listed with their bases in research D11 (amended 2026-09-20);
the pricing model sentence — *Prepago. Por pago verificado. Sin mensualidad
ni contrato. Los primeros pagos son gratis.* — is one of them, with
`prepaid-credit D2/D4` and `platform/settings.ts` as its basis.

---

## Legal identity (compiled-in, not a table)

`apps/landing/src/content/legal.ts` — `RESPONSABLE` and `DOMICILIO`, the
legal person and address the privacy notice names (D20). Born as
`{{RESPONSABLE}}` / `{{DOMICILIO}}`; `content.test.ts` fails while either
placeholder remains, so the page cannot publish without them.

---

## The channel tag (a rule, shared)

`CHANNEL_PATTERN = /^[A-Za-z0-9_-]{1,32}$/`, exported from
`@devolada/api/landing-schema` and imported by the Worker, the page's
script and the API (D4).

| Input | Stored / injected as |
| --- | --- |
| absent | `direct` |
| matches the pattern | as typed, case kept |
| anything else | `direct` |

The tag travels: `?ch=` on the page's address → the hidden `channel` input
of each form (injected by the Worker) → the beacon's `channel` field →
`landing_counts.channel` and `access_requests.channel`.

---

## Bindings

| Binding | Where | Unset means |
| --- | --- | --- |
| `LANDING_BASE_URL` | `apps/api/src/env.ts`, `wrangler.jsonc` per env | a plain form post is answered with the envelope instead of a redirect (D6) |
| `ALLOWED_ORIGINS` | existing; gains the landing origins per env | the page's script cannot read the API's answer; the beacon (no-cors) still counts |
| `API_ORIGIN` | `apps/landing/wrangler.jsonc`, birth value `http://localhost:8787`, one per env | never unset by config; the CSP's `connect-src` and `form-action` (D12) |
| `PUBLIC_API_URL` | build-time, the landing | falls back to `http://localhost:8787` like the admin (D14) |

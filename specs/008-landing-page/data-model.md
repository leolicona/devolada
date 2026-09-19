# Data Model: Landing Page

**Feature**: 008-landing-page · **Date**: 2026-09-19

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
| `name` | text, not null | 2–80 characters, trimmed |
| `business_name` | text, not null | 2–120 characters, trimmed |
| `phone` | text, null | messaging phone as typed, 10–20 characters of digits, spaces, `+ ( ) -`; **at least one of** `phone` / `email` |
| `email` | text, null | a valid address, ≤ 120 |
| `customer_band` | text enum, not null | `under_100` · `100_500` · `500_2000` · `over_2000` — a band, never a number (FR-015) |
| `billing_system` | text enum, not null | `wisphub` · `own_software` · `other` · `none` — the answer that tells a request served end to end from one served through the API (spec Clarifications) |
| `note` | text, null | ≤ 500 characters |
| `channel` | text, not null, default `direct` | the tag as typed (rule below) |
| `created_at` | integer ms, not null | the workspace's `createdAt()` helper |
| `notified_at` | integer ms, null | set when the operator notice was accepted by the provider (D10) |
| `notify_error` | text, null | why the notice did not go: `NO_RESEND_KEY`, `NO_OPERATOR_EMAILS`, or `RESEND_<status>`; shown on the operator list (FR-018) |

Indexes: `access_requests_created_idx (created_at)` — the list reads newest
first with a cursor on `(created_at, id)`.

Invariants, enforced by the schema in `routes/landing/schema.ts` and
narrowed nowhere else:

- `phone IS NOT NULL OR email IS NOT NULL`
- `customer_band` and `billing_system` are members of their enums
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
| `step` | text enum, not null | `visit` · `began` · `sent` · `signup` |
| `count` | integer, not null, default 0 | |

Unique index `landing_counts_day_channel_step_idx (day, channel, step)`; an
event is `INSERT … ON CONFLICT DO UPDATE SET count = count + 1` — one
statement, no read-modify-write.

Who writes which step:

| step | written by | meaning |
| --- | --- | --- |
| `visit` | the page's script, once the page has loaded | a page load — not a person, not a device; the operator screen says so |
| `began` | the page's script, on the first focus inside the form | the request was begun (spec FR-023) |
| `sent` | the API, when it stores a request | exact by construction |
| `signup` | the page's script, when the secondary link is followed | a departure to the product's sign-up |

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
each publication (quickstart, *Pre-flight*). The pricing model sentence —
prepaid, per verified payment, no monthly fee, no contract, the first
payments free — is one entry, with `prepaid-credit D2/D4` and
`platform/settings.ts` as its basis.

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
and the sign-up link's `?ch=` (injected by the Worker) → the beacon's
`channel` field → `landing_counts.channel` and `access_requests.channel`.

---

## Bindings

| Binding | Where | Unset means |
| --- | --- | --- |
| `LANDING_BASE_URL` | `apps/api/src/env.ts`, `wrangler.jsonc` per env | a plain form post is answered with the envelope instead of a redirect (D6) |
| `ALLOWED_ORIGINS` | existing; gains the landing origins per env | the page's script cannot read the API's answer; the beacon (no-cors) still counts |
| `API_ORIGIN` | `apps/landing/wrangler.jsonc`, birth value `http://localhost:8787`, one per env | never unset by config; the CSP's `connect-src` and `form-action` (D12) |
| `PUBLIC_API_URL` | build-time, the landing | falls back to `http://localhost:8787` like the admin (D14) |

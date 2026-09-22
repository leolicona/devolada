# Data Model: Links On-Demand Search

**Feature**: [spec.md](./spec.md) · **Decisions**: [research.md](./research.md)

The headline of this feature is what it does **not** store. Only one table is
added, and it exists to let a one-shot deletion run once and be reported once.

---

## `payment_links` — unchanged in shape, narrowed in meaning

No column is added, changed or dropped. FR-010 is a decision not to store, so
the schema stays exactly as `apps/api/src/db/schema.ts` has it.

What changes is the set of rows that may exist and who may write them.

| Field | Meaning after this feature |
| --- | --- |
| `customer_usuario` | **The whole of what a panel link knows about the person.** The identity, and the only key any lookup uses. |
| `wisphub_customer_id` | Still a cache of the provider's numeric id, refreshed on sight, keying nothing (`direct-payment D5`). |
| `customer_ref`, `ask_cents`, `label`, `concept` | API links only. Untouched. |
| `token`, `source`, `mode`, `expires_at`, `closed_at`, `is_test`, `created_at` | Untouched. `created_at` gains a second job: it is what the prune's cutover compares against (D13). |

**Invariants added by this feature:**

- A panel row is written **only** by `ensureLink`, and `ensureLink` is called
  **only** from `POST /direct-payments/links`, which only an operator's act
  reaches (FR-008, D8). No background pass, no list read, no sweep writes one.
  This is what SC-009 measures.
- An existing panel row for a `(business_id, customer_usuario)` is **returned,
  never replaced** (FR-005, FR-009). The partial unique index
  `payment_links_panel_usuario_idx` already enforces it.
- A deleted row is never reissued. A customer whose link the prune removed gets
  a **new** row with a **new** token on the next act (FR-024).

**Invariants removed:** "every customer of the roster has a link"
(`direct-payment D5`, `admin-links-view D5`) no longer holds, and the comment
that states it goes with `ensureLinks`.

---

## `link_prunes` — new, one row per business, written once

```
link_prunes
  business_id   text  PK, → businesses.id
  ran_at        integer (ms)   when the pass finished for this business
  deleted_count integer        how many panel links it removed
  notice_seen   integer (bool) whether the business has been shown the count
```

| Rule | Why |
| --- | --- |
| The primary key is `business_id` alone | The pass runs **once** per business. The row's existence is what stops it running again (D13). |
| `deleted_count` may be `0` | A business that had no pre-cutover links is pruned too — a row is written, nothing is deleted, and no notice is shown. |
| `notice_seen` starts false and is set through `POST /direct-payments/prune-notice/dismiss` | FR-023's "the business MUST be told". A count nobody saw is not a telling, so the count needs a door out of this table — see [contracts/links-api.md](./contracts/links-api.md). |
| Nothing else joins this table | It is a ledger of a one-time event, not a relationship. |

**Lifecycle**: absent → written by the cron pass (`ran_at`, `deleted_count`) →
`notice_seen` set when an operator dismisses the notice. There is no second
transition and no deletion.

---

## What the prune deletes

A row of `payment_links` is deleted when **all** of these hold:

1. `business_id` is the business being pruned;
2. `source = 'panel'` — an API link is never touched, whatever its age
   (Edge Cases);
3. `created_at < PRUNE_CUTOVER_MS` — the feature's ship timestamp, a constant in
   code (D13). This is what makes a second run a no-op and what protects every
   link FR-008 creates;
4. no row of `payments` references it;
5. no row of the clave-attempt table references it.

Conditions 4 and 5 are the two foreign keys that point at `payment_links.id`.
They are the only durable evidence a link was used, and the spec says plainly
what that means: **a link an operator sent, whose customer has not paid yet,
satisfies all five conditions and is deleted.** Its copy stops working
(FR-024, D13).

The same pass deletes the orphaned `wisphub_sweeps` and `wisphub_pages` rows of
kind `roster`, which nothing reads once D12 lands. The `sweep_kind` enum keeps
both values; `KINDS` is what decides what runs.

---

## Customer (WispHub) — read, never stored

| Field | Source | Notes |
| --- | --- | --- |
| `usuario` | `/clientes/` list item | Shape `texto@slug-empresa`. A customer without one cannot have a link and does not appear (Edge Cases). |
| `wisphubId` | `id_servicio` | Cached on the link, keys nothing. |
| `name` | `nombre` | This ISP writes the full name here; `apellido` exists and is searched (D4). |
| `phone` | `telefono` | May be absent; WhatsApp then opens its own picker (FR-019). |
| `estado` | service state | Read but **not used** by this feature. `estado=2` (suspended) is a filter the page does not offer yet (spec, Assumptions). |

Devolada holds none of it. Every row shown is from the answer that rendered it,
or — only when the provider did not answer — from the browser's cache (FR-021).

---

## Customer row — the contract's shape, derived per request

One row shape serves browsing and searching, panel and API (D1, D7):

```
channel      "panel" | "api"
usuario      string | null        panel: the identity; null on an API row
wisphubId    number | null
customerRef  string | null        API: the caller's reference
label        string | null
askCents     integer | null       API only; integer cents (constitution II)
linkState    "open"|"paid"|"expired" | null
name         string | null        live from the provider, or the cache
phone        string | null
hasLink      boolean              NEW — the row's link exists or does not
url          string | null        null when hasLink is false (D7)
waLink       string | null        null when hasLink is false
```

`url` and `waLink` becoming nullable is the contract change that carries
FR-008: a null URL means *no link yet*, and it no longer means *hide the
buttons* (FR-026).

---

## Search — a request, not a record

Nothing about a search is stored server-side. Its parts:

- the trimmed text (≥ 3 characters, FR-002);
- the four provider filters it was put to and the D1 read of API links (D4);
- the merged, deduped rows (FR-005, D6);
- `matched`, a floor rather than a total (D5);
- `wisphub`: `"ok" | "unavailable" | "not_configured"` (D10).

---

## Browser-held state (D11)

None of this reaches Devolada, and nothing depends on it being there.

| What | Where | Lifetime |
| --- | --- | --- |
| The search text | the URL (`?q=`) | as long as the address does (FR-011) |
| Search results | `sessionStorage`, keyed by normalised text | 2 minutes (FR-012) |
| Recently seen names and phones | `sessionStorage` | short window; a live answer always overwrites it (FR-021) |
| Copied / sent marks | `sessionStorage` | the session, for the operator who acted (FR-022) |
| The prune notice's dismissal | `link_prunes.notice_seen`, through the dismiss door | permanent, and server-side — it is a telling, not a per-browser preference |

# Data Model: Provider Address per ISP

**Feature**: 007-provider-address-per-isp · **Date**: 2026-09-18

One new column, one new compiled-in catalogue, one resolution rule. No new
table.

---

## Installation (compiled-in catalogue, not a table)

`apps/api/src/wisphub/installations.ts` — pure data, no server imports (D3),
exported from `@devolada/api` as `./installations`.

| Field | Type | Notes |
| --- | --- | --- |
| `key` | `"wisphub_net" \| "wisphub_io" \| "wisphub_sandbox"` | what a business row stores. Stable forever: renaming one is a data migration, so it is chosen once. |
| `label` | string (es-MX) | what the ISP recognises — where they sign in, e.g. "wisphub.net". Never an endpoint. |
| `host` | string | the API base the adapter calls. Resolved, never stored on a row. |
| `kind` | `"real" \| "test"` | FR-007. The sandbox is marked so a live business cannot choose it blind. |
| `isDefault` | boolean | exactly one entry. The answer for a business that recorded nothing and an environment that names nothing. |

Birth values, from the DNS measurement of 2026-09-18:

| key | label | host | kind |
| --- | --- | --- | --- |
| `wisphub_net` | wisphub.net | `https://api.wisphub.net/api` | real (default) |
| `wisphub_io` | wisphub.io | `https://api.wisphub.io/api` | real |
| `wisphub_sandbox` | Pruebas (sandbox) | `https://sandbox-api.wisphub.net/api` | test |

**Invariants**, asserted by a unit test rather than a generator (D2):

- `key` unique across entries.
- `host` starts `https://`, and its hostname ends in a domain the provider is
  known to operate. A catalogue entry pointing anywhere else fails the test.
- exactly one `isDefault: true`.
- `kind` set on every entry.
- `wisphub_io` carries a comment recording that its host is DNS-confirmed
  only, until one real call retires the note.

---

## Business connection (`integrations`) — one column added

Existing row, unchanged except for one nullable column (D6).

| Column | Type | Null? | Meaning |
| --- | --- | --- | --- |
| `installation` | text | **yes** | the catalogue `key` this business's credential belongs to. Null means "not chosen" and resolves to the default — which is every row that exists today (FR-002). |

Everything else on the row — `api_key`, the three action mappings,
`threshold_percent`, `floor_cents`, `provisional_release_enabled`,
`actions_enabled` — is untouched.

**Validation**: a value that is not a catalogue key is rejected at the write
path. It cannot be reached through the panel, which offers a closed choice
(FR-005); the check exists because the column is text and a future writer is
not the panel.

**Migration**: `ALTER TABLE integrations ADD COLUMN installation TEXT`.
Additive, no default, no backfill (D6).

---

## The resolution rule

One function, one place (D4). Every provider client in the codebase is built
through it:

```
wisphubFor(integration, env)
  ├─ integration.installation  → catalogue host      (the business's own)
  ├─ env.WISPHUB_BASE_URL      → that value          (the platform default)
  └─ neither                   → DEFAULT_BASE_URL    (wisphub.net)
```

The middle rung is what changes meaning: `WISPHUB_BASE_URL` stops being an
override that every business inherits and becomes the fallback for rows that
chose nothing (D5). A business that chose is never overridden by config again.

**Invariant the factory exists to hold**: no `new WispHub(...)` outside
`wisphubFor`. Eleven call sites move; a test asserts the twelfth cannot
appear.

---

## What a failed connection now distinguishes

Not stored — computed by the connection test and returned to the panel
(FR-010). Today all three arrive as one code.

| Outcome | Meaning | What the ISP should do |
| --- | --- | --- |
| `INSTALLATION_UNREACHABLE` | no answer from the host | wait, or tell Devolada the installation is down |
| `KEY_REJECTED` | the host answered and refused the key | check the installation first — the key is probably for another one |
| `PERMISSION_MISSING` | the key works, a permission Devolada needs is absent | add the permission to that staff user in the provider's panel |
| `OK` | every verifiable read passed | nothing; the writes are first exercised by a real payment (D7) |

Each carries the installation `label` that was tried. None ever carries the
key (FR-013).

---

## What this model deliberately does not hold

Nothing records that a business *changed* installation, and no state exists
for a link whose customer is absent from the new one. That is the deferred
scope in `spec.md`; a plan that adds a column for it is out of bounds here.

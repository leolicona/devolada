# Data Model: The Payer's Doorway

**Feature**: `specs/008-payer-doorway` | **Date**: 2026-09-18

**This feature adds no table, no column and no migration.** It reads links that
already exist. The only durable state it changes lives on the payer's own
device, and the only new shape it defines is a projection of an answer the
product already computes.

That is worth stating first, because it is the reason this feature can ship
against what exists.

## 1. What the device keeps

`apps/pago/src/links.ts`, in `localStorage` under `devolada-pago-links`.

### Today

```
SavedLink = { token: string, name: string }
```

`name` is `customerName ?? ispName` — on a panel link that is the *payer's own
name*, which is why two links at two businesses can read identically (FR-002).

### After this feature

```
SavedLink = {
  token:    string   // unchanged — the way back
  name:     string   // who the payment is for, as the last live read named them
  business?: string  // the business's name, as the last live read named it
}
```

**Rules**

| Rule | Why |
| --- | --- |
| No amount is ever stored | FR-016 — a remembered figure must never be presented as current (research R5) |
| No state is ever stored | Same reason; `paid`, `expired` and `no_debt` are read, never recalled |
| `business` is optional on read | Real devices already hold the old two-field shape; an entry without it renders with `name` alone until the first live read fills it in |
| Anything unparseable counts as nothing saved | The existing rule (FR-022), unchanged — this screen must never fail on a stale key |
| Newest first | `rememberLink` appends today, so the list runs least-recently-opened first — backwards for a chooser (D6, research R6) |

**Migration**: none, and none is possible — this is the payer's device, not a
database. The reader tolerates both shapes; a device holding the old one
upgrades itself the first time each link resolves.

`apps/pago/src/step.ts` (`devolada-pago-step`) is untouched.

## 2. What a row is, while the screen is open

A **doorway row** exists only in memory. It is one saved link joined to one live
read, and it is a *reading* — never the figure a transfer is built on (FR-007).

```
DoorwayRow = {
  token:    string
  business: string          // always present once resolved (FR-002)
  name:     string          // who the payment is for
  state:    RowState
  totalCents?: number       // present only when state = "debt" (D7, research R4)
}

RowState = "debt" | "no_debt" | "unavailable" | "closed" | "unknown"
```

### The states, and where each comes from

| State | Meaning to the payer | Source |
| --- | --- | --- |
| `debt` | owes `totalCents` right now | the live read said `debt` |
| `no_debt` | nothing to pay | the live read said `no_debt` |
| `unavailable` | this business cannot take a payment right now | the live read said `unavailable` — no account set, suspended, or no provider credential (FR-005) |
| `closed` | paid or past its deadline | the live read said `closed`; the row is then **dropped from the device** rather than rendered (FR-013) |
| `unknown` | we could not read it | the request failed or was refused; the row still opens (FR-018, D10) |

The first four are exactly the four `status` values the payment page already
receives. `unknown` is the one this feature adds, and it belongs to the *device*,
not to the answer: no route ever returns it. That is what keeps a failure from
having to be modelled as a success.

### Ordering (FR-006, D6)

`debt` → `unknown` → `no_debt` → `unavailable`; within a group, most recently
opened first. A row still resolving sorts where its last known state puts it,
and moves when it lands — it never jumps to the top mid-read.

### Removal (FR-013, FR-014)

| Trigger | What happens |
| --- | --- |
| The read says `closed` | the entry is dropped from the device |
| The read says the link is gone (404) | the entry is dropped — the existing rule, unchanged |
| The payer says "este no es mi servicio" | the entry is dropped |
| Any other failure | **nothing is dropped** — a bad connection must never erase the way back into a live account |

That last line is already the rule on the payment page and is the one thing in
this section that must not be simplified.

## 3. What is read, and from where

Nothing new is stored server-side. For completeness, what each row's answer is
built from:

| Channel | The amount comes from |
| --- | --- |
| API link | `payment_links.ask_cents` on the row, plus the business's service fee |
| Panel link | the business's provider, live — the customer's debt plus pending invoices, plus the service fee |

Both go through the **same resolver the payment page uses** (D3). There is no
second place where "what is owed" is computed, which is what makes SC-002 true
by construction instead of by discipline.

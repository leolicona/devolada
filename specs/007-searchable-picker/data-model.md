# Data Model: searchable-picker

**Date**: 2026-09-18 | **Plan**: [plan.md](./plan.md)

**No persisted model changes.** No table, column, migration or API shape moves.
The bank a business has chosen is saved where it was already saved, by the routes
that already save it. What this feature has is a *field with states*, and getting
those states wrong is how a wrong bank name gets saved — so they are written down.

## Entities

### Bank vocabulary

The names the payment provider recognises. Generated from one documented source
and identical everywhere (`scripts/gen-banks.mjs`, constitution III).

| Attribute | Value |
|---|---|
| Size | 97 names |
| Order as stored | the provider's own |
| Order as offered | sorted for reading, es-MX collation, derived once |
| Mutability | read-only to this feature — no name added, renamed or dropped |

### Chosen bank

The one name saved for a business. Travels as the beneficiary's bank on every
validation that business asks for.

| Attribute | Value |
|---|---|
| Permitted values | a name from the vocabulary, or none |
| Set by | the ISP choosing one, or the account number's first three digits |
| Precedence | a name chosen by hand wins over the account number from then on |
| Cleared by | nothing — see research D10 |

## Field states

The field is always in exactly one of these. The rule that matters is the last
column: what leaving the state saves.

| State | What the field shows | What the list shows | Leaving saves |
|---|---|---|---|
| **Resting** | the chosen name, or the placeholder if none | closed | nothing changes |
| **Browsing** | the chosen name | the whole vocabulary (D4) | nothing changes |
| **Searching** | what has been typed | the names that match, ranked (D2) | nothing changes |
| **No match** | what has been typed | "Sin resultados", no options | nothing changes |
| **Chosen** | the name just chosen | closed | the chosen name |

## Transitions

```text
Resting ──click / ArrowDown / ArrowUp──────────────► Browsing
Resting ──types──────────────────────────────────►  Searching
Browsing ─types──────────────────────────────────►  Searching
Searching ─matches drop to zero──────────────────►  No match
No match ─backspace, matches return───────────────► Searching

Browsing / Searching / No match
   ├─ Enter on a highlighted name ───────────────►  Chosen
   ├─ click on a name ───────────────────────────►  Chosen
   ├─ Escape ────────────────────────────────────►  Resting   (text restored)
   ├─ Tab ───────────────────────────────────────►  Resting   (text restored)
   └─ focus leaves the field ────────────────────►  Resting   (text restored)

Resting ──the account number names a bank, and no
           name has been chosen by hand yet──────►  Resting   (field shows it)
```

**The invariant.** Only the `Chosen` transition writes. Every other way out of an
open list restores the text to the name last chosen (D3), so the field can never
come to rest holding something that was not chosen. This is the whole reason the
states are enumerated: a field that rests on a typed fragment is
indistinguishable, to the person looking at it, from a field that rests on a real
bank — and the provider will not tell them apart either.

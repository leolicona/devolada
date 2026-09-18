# Contract: the bank field

**Date**: 2026-09-18 | **Plan**: [../plan.md](../plan.md)

The panel has no external interface here — no route, no wire format. What it does
have is a control that three screens depend on, and whose guarantees they rely on
without re-checking. That is the contract.

## What a screen gives the field

| Input | Meaning | Required |
|---|---|---|
| accessible name | what the field is called, for the label and for the list | yes |
| chosen value | the name currently saved, or empty for none | yes |
| on-change | called with a name from the vocabulary, and never with anything else | yes |
| options | the names to offer, in reading order | yes |
| placeholder | what an empty field says (es-MX) | no |
| empty message | what "nothing matches" says (es-MX); defaults to `Sin resultados` | no |
| id | so a label can point at it | no |
| disabled | the field does not open or accept typing | no |

## What the field guarantees in return

1. **It never reports a value outside `options`.** However the field is typed
   into, closed or left, on-change is called only with a name that was offered.
   (spec FR-004, research D3)
2. **It never comes to rest on unchosen text.** Cancelling, leaving, or moving to
   the next field restores the chosen value. (FR-007, D3)
3. **It follows a value it did not choose.** When the screen changes the chosen
   value — the account number naming a bank — the field shows it. (FR-008)
4. **Everything is reachable from the keyboard**: open, move, choose, cancel,
   leave. (FR-005)
5. **It says what it is doing**: that it is a field with a list, whether the list
   is open, and which name is highlighted — and the layer around the list
   announces nothing of its own. (FR-010, D6)
6. **It adds no visual values.** Colour, size, spacing, radius and motion all come
   from the shared tokens. (FR-012)

## Keyboard contract

| Key | Closed | Open |
|---|---|---|
| typing | opens the list, filters | filters |
| `↓` / `↑` | opens the list | moves the highlight, wrapping |
| `Home` / `End` | — | first / last offered name |
| `Enter` | passes through to the form | chooses the highlighted name |
| `Escape` | — | closes, restores the chosen name |
| `Tab` | moves on | closes, restores the chosen name, moves on |

`Enter` deliberately passes through when the list is closed: the field sits
inside a form that is submitted that way, and a picker must not swallow it.

## Consumers

| Screen | Field | Notes |
|---|---|---|
| `/settings/direct-payment` | the business's own bank | seeded by the account number's prefix |
| `/settings/credit` → Recargar | the bank a top-up was sent from | inside a form; `Enter` must still submit |
| `/operador` | the platform's own bank | same control, operator's area |

A fourth consumer is explicitly **not** offered: the payer's public page keeps
the phone's native picker (research D8).

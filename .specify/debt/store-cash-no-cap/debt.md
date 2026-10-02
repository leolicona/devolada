---
slug: store-cash-no-cap
status: open
kind: deliberate
severity: high
effort: days
opened: 2026-10-01
---

# Technical Debt: a store may hold any amount of a business's cash

## What was traded

The pilot of `specs/018-cash-at-stores` records cash collections at a store
with no ceiling on what that store may hold for a business. A cap per store
— a warning before it, collections blocked at it — was given up to start the
pilot sooner with one business and one or two stores. The creator chose it on
2026-09-30: "Not in the pilot. The cost was named and accepted: the
business's exposure has no ceiling. Only the Puntos de pago page bounds it,
by showing it" (spec, Clarifications; FR-040; research D30).

## Where it lives

- `specs/018-cash-at-stores/spec.md` — FR-040: "A store MUST be able to hold
  any amount of a business's cash in this feature (no cap)". The decision,
  written before its code (research D30, T003).
- `apps/api/src/store-ledger/index.ts::recordCollection` — writes the
  `collection` movement without reading `heldCents` first. Nothing compares
  the store's balance to a limit.
- `apps/api/src/routes/store/handler.ts::recordStoreCollection` — the counter's
  record (`POST /store/collections`) refuses a changed debt, a changed fee and
  an amount above the debt, and nothing else about the amount.
- `apps/api/src/platform/settings.ts::SETTINGS` — no cap setting beside
  `store_fee_cents`; the operator has nothing to set.

## Interest

- The business's exposure has no ceiling: a store that keeps the cash costs
  the business everything it collected since the last confirmed hand-over.
  Recovering it is outside the software (spec Assumptions).
- The only bound is a person reading *Puntos de pago* and asking for a
  hand-over. Nothing warns the business, the operator or the store as the
  amount grows.
- Every store added, and every business switched on, multiplies the
  unbounded amount; the agreements signed for the pilot name one business.

## Paying it

A cap per store and business, set by the operator:

- a platform setting (or a per-store value) for the cap, in cents, with
  author and date like every setting;
- `recordStoreCollection` reads `heldCents(store, business)` and refuses a
  collection that would cross the cap, with a code the store app shows;
- *Mi caja* and *Puntos de pago* warn before the cap is reached;
- the operator's Tiendas list shows each store's distance to its cap.

It is a feature of its own and starts at `/speckit-specify`.

Confirm on the tree:
- `grep -rn "cap" apps/api/src/store-ledger/index.ts apps/api/src/routes/store/handler.ts`
  finds the check;
- an API test under `apps/api/test/` records collections up to the cap and
  sees the next one refused.

**Trigger**: before a second store or a second business joins the channel
(the one-business guard of FR-006 being lifted is the same moment), or the
first time a store holds more than the pilot's agreement names.

## Notes

- Registered the day the shortcut was taken, before its code lands, as the
  constitution's Development Workflow asks (018 T003, research D30). The two
  code anchors name the functions 018 creates; they exist once
  `specs/018-cash-at-stores` T022 and T027 land.
- Related: FR-006's deferred decision (which stores serve which business)
  is lifted by the same future spec's moment.
- *2026-10-01:* the code landed. Both anchors exist as named —
  `store-ledger/index.ts::recordCollection` and
  `routes/store/handler.ts::recordStoreCollection` — and neither reads a
  limit; the settings anchor is `platform/settings.ts::SETTINGS` (it was
  written `DEFINITIONS` before the code existed).

# Bug Assessment: the payer page sends the payer to store points that may not exist

- **Slug**: payer-copy-store-points
- **Created**: 2026-10-01
- **Source**: pasted text (`specs/018-cash-at-stores` /speckit-analyze L6, task T069)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

> When the SPEI channel is unavailable, the payer page
> (`apps/pago/src/features/pago/PaymentPage.tsx` ~line 2114) says "El pago
> por transferencia no está disponible por ahora. Paga en tu punto de cobro
> más cercano". Spec 018 FR-041 keeps the payer page silent about stores,
> and the business may have no store points at all (cash at stores is off
> for almost every business), so the copy promises payment points that may
> not exist. Raised by /speckit-analyze L6 on specs/018-cash-at-stores
> (task T069); independent of 018's code, must land before the pilot.

## Symptom

A payer who opens a payment link while the business's SPEI channel is
closed reads that transfer is unavailable and is told to pay "en tu punto de
cobro más cercano", under a store icon. Expected: the page says transfer is
unavailable and tells the payer what they can actually do, without
promising a place to pay that the business may not have.

## Reproduction

1. Have a business whose SPEI channel is closed — any one of: no CLABE or
   bank configured (`businessConfigured`), no provider credential
   (`validationAvailable`, `APICEP_TOKEN` unset), or a panel link whose ask
   cannot be read (`askAvailable`).
2. Open one of its payment links on the payer page (`/p/<token>`).
3. `GET /direct-payments/links/:token` answers
   `{ ispName, status: "unavailable" }`, and the page renders state 8
   ("Canal no disponible") with the store copy.

Locally this is the state of any link while `APICEP_TOKEN` is unset
(CLAUDE.md's `.dev.vars` table).

## Suspected Code Paths

- `apps/pago/src/features/pago/PaymentPage.tsx:2108-2119` — state 8 renders
  `<Store aria-hidden />` and "Paga en tu punto de cobro más cercano.": the
  copy and the icon both name a store network.
- `apps/api/src/routes/direct-payments/handler.ts:461-466` — `getLinkStatus`
  answers `status: "unavailable"` when `channelOpen` is false; its comment
  ("the page degrades into the store network instead of showing a CLABE
  nothing can validate") records the assumption the copy was written
  under.
- `apps/api/src/routes/direct-payments/handler.ts:356-363` — `channelOpen`,
  the three conditions that close the channel; none of them is about
  stores.
- `apps/pago/test/pago.test.tsx:91-97` — "degrades into the store network
  when SPEI is not configured (D4)" pins the current copy
  (`/punto de cobro más cercano/`).

## Root Cause Hypothesis

The copy dates from the store-network era (the `devolada-red` product,
before the pivot to SPEI), when every business collected through store
points and "unavailable" meant "use the other channel". The pivot kept the
state and its words. Today a closed SPEI channel has nothing to do with
stores: almost no business has *Efectivo en tiendas* on, and spec 018
FR-041 forbids the payer page from announcing stores or cash at all — even
for a business that has them. Confidence: high (the copy, its test and the
API comment all say "store network"; `channelOpen` never reads the store
channel).

## Proposed Remediation

**Preferred**: replace state 8's copy with words that are true for every
business, and drop the store icon. Say that transfer is not available right
now and send the payer to the business by its name — for example
*"Por ahora no puedes pagar por transferencia. Pregunta a {ispName} cómo
pagar."* — under a neutral icon (`Info` or `Clock`), never `Store`. The
heading keeps the business's name. Keep the payer's vocabulary (*pago*,
never *cobro*; no "Banxico", no "ISP"/"proveedor", per spec 017 US4). The
exact sentence is product copy: the creator picks it before the fix.

Update the API comment in `getLinkStatus` so it no longer says the page
degrades into the store network.

**Alternatives**:
- *Say only that transfer is unavailable, with no next step.* Smallest
  change, but leaves the payer at a dead end.
- *Point to the business's contact (WhatsApp or email).* The most useful
  next step, but `LinkStatusResponse` carries only `ispName` for this
  state, so it widens the public contract and needs the business's contact
  to exist; a feature, not this fix.

**Files likely to change**:
- `apps/pago/src/features/pago/PaymentPage.tsx` (state 8's copy and icon)
- `apps/api/src/routes/direct-payments/handler.ts` (the comment only)
- `apps/pago/test/pago.test.tsx` (the pinned copy)

**Tests to add or update**:
- `apps/pago/test/pago.test.tsx`: the unavailable state shows the new
  sentence with the business's name, and never "punto de cobro", "tienda"
  or "efectivo" (FR-041); axe stays clean. Cite `bug: payer-copy-store-points`.
- Optional: the browser layer's contrast list gains the unavailable state
  if its new icon/tone differs from the closed-link alert already measured.

## Risks & Considerations

- Copy-only on a public page: no API, schema or data change.
- The payer page's words were reviewed by spec 017 (US4, design E); the new
  sentence should be checked against that review's rules.
- The pilot business *will* have stores — FR-041 still says the payer page
  does not mention them; the fix must not special-case a business with the
  store channel on.

## Open Questions

- [NEEDS CLARIFICATION: the exact sentence — "Pregunta a {negocio} cómo
  pagar", or a different next step — is the creator's call.]

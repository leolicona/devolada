---
status: in-development
stories: [US-P05, US-P03, US-P04, US-P02, US-R03]
domain: polish
updated: 2026-09-02
debt: []
---

# Spec: What the design review found

> **2026-08-31, retirement PR**: the store-era capture harness (`tests/design/screenshots.spec.ts`) and its screenshots left with `devolada-red`; later per-PR review specs remain, writing to `.design/screenshots/`.

`.design/devolada/DESIGN_REVIEW.md` judged the built product against the brief with
42 browser captures. Fifteen findings survived; this spec is the decision record for
the ones that change shared rules, and the contract for the harness gap that let
three of them ship.

The review's own summary: the charge path delivers the brief, and two themes ran
through everything else — **a list row can render correctly and say nothing**, and
**one colour was carrying two meanings**.

## Decisions

- **D1 — A row's identity is an assertion, not a screenshot.** `responsive.spec.md`
  proved that no page scrolls sideways and every control clears 44px. *(Corrected
  2026-09-02: the second half was never true. `expectTouchTargets` existed in
  `tests/e2e/responsive.spec.ts` and was never called — see D10.)* Three rows
  passed both and still showed nothing: the Tiendas row printed a chip, a badge and
  an amount but not the store; the Entregas history row printed `A..` and `1...`.
  A `min-w-0 flex-1` column beside fixed-width siblings collapses to zero and
  `truncate` hides the collapse. The suite now asserts that each list's identifying
  text has a non-zero box at the 360px floor. (Amended 2026-08-25 by the PRs
  #81–#83 review, finding 7: the same walk now flags any leaf whose text contains
  `NaN` — a stub that drifts from the wire shape makes `formatMoney(undefined)`
  render `$NaN` without throwing, and every geometry assertion passes over it.)
- **D2 — `StatusBadge` gets store statuses of its own.** `active`/`suspended` served
  both the subscriber's internet and the store's account, so a corner store read
  "Servicio activo" under a Wi-Fi icon, and a suspended *store* would have told the
  ISP its shop's internet was down. `storeActive`/`storeSuspended` say "Tienda
  activa" / "Tienda suspendida" with a `Store` icon. The glossary rule in
  `CLAUDE.md` — one word per concept — applies to the badge's words too.
- **D3 — Green is a status colour; the sign carries direction.** The brief assigns
  green to charged/reconnected. Amounts were also green for "money in", which is a
  second meaning on the same ink and, since the `+`/`−` is already there, a
  redundant one. Amounts are ink; `text-success` is left to statuses. This is the
  colour-is-never-alone law read the other way round: if the sign already says it,
  colour must not say something else.
- **D4 — "Comisión" says what it does.** Caja shows "Tu comisión ganada $18.00" and
  Movimientos showed "Comisión −$9.00" one tap apart: same word, opposite sign. The
  ledger entry is now "Comisión ganada" with the sentence that reconciles the two —
  the store earns it, and it comes out of the ISP cash the store holds.
- **D5 — The admin caps its content width.** Only Settings had a `max-w`; the feed,
  the lists and the store detail ran edge to edge, so on a wide monitor a row's name
  and its amount sat a screen apart. The cap lives once in `Shell`, not per screen.
- **D6 — Disabled is a different fill, not a lower opacity.** `disabled:opacity-50`
  on a filled accent button produces a washed accent that reads as a low-contrast
  enabled button, worst of all in dark. The admin button now matches the shared one:
  a neutral fill with faint ink, so the difference is a shape, not a dimmer.
- **D7 — The clear button is ours.** `type="search"` hands Chromium's
  `::-webkit-search-cancel-button` the job: it paints in the browser's accent — blue
  in both themes, the only non-palette colour in the product — at roughly 13px, on
  the store's most-used control, inside UA shadow DOM where our `target-size`
  assertion cannot reach it. We hide it and render a 48px button with a name.
- **D8 — Money fields carry the sign.** Every displayed amount is `$1,234.00`; the
  fields that take one showed `910.00`. `Input` gains a `prefix`, used by the three
  money fields.
- **D9 — The live region is the list, not the page.** `aria-live` wrapped the whole
  `<main>`, so switching a filter chip re-announced the heading, the alert and the
  chips. `charge-feed.spec.md` asked for the feed to announce, and the feed is the
  list.

- **D11 — One archetype, one answer (2026-09-05).** The
  espaciado-y-tipografía review
  (`.design/devolada/DESIGN_REVIEW-espaciado-y-tipografia.md`) measured
  Pagos, Cobros and Links and found the same page drawn three times: 16 /
  16 / 24px under the title, a search field 44 / 40 / 40px tall and 384 /
  256 / 448px wide, a list card that clipped on one page of three, and a
  `padding-bottom: 0` on two of them. The answer is a frame, not a rule to
  copy: `PageFrame` owns the padding and the ladder, `ListSkeleton` owns
  the placeholder's geometry (FRONTEND.md). Two things follow from the
  round and generalise past it: **a skeleton is the list's geometry or it
  is a layout shift** — three 60px rows standing in for 72px ones move
  every row 12px on load, and no assertion here could see it — and **a
  colour utility that names no token is invisible to every check we
  have**, which is BUG-018 and now a `contrast-lint.mjs` rule. In Cuenta
  the same review set the sub-page title rule (account-hub D11) and made
  the icon size one number, 16px, in every button.
  The heights of the three search fields are deliberately *not* settled
  here: they are the density decision TD-019 owns.

- **D10 — A spec claim is a call site, not a sentence.** The pagos-filtros
  review (2026-09-02, `.design/devolada/DESIGN_REVIEW-pagos-filtros.md`) found
  `expectTouchTargets` defined and never invoked, while D1 above and
  `responsive.spec.md` scenario 2 both reported the 44px floor as proven. That is
  how 36px chips and 40px inputs shipped for weeks. The assertion is now wired
  for the Pagos filter bar (`section[aria-label="Filtros"]`, at the 360 floor)
  together with a measurement that a focused chip keeps its 3px ring inside the
  rail — the visible-focus gap SPEC.md admits — and the rest of the admin is
  **TD-019**, which also carries the one decision this round refused to take in
  passing: whether `Button`'s default `h-10` becomes `h-11` app-wide. Rule going
  forward: a DoD line that says "every X clears Y" names the test that walks X.

## Rejected

- **Screenshot diffing.** The three defects would have shown up in a pixel diff, but
  only against a baseline someone approved — and the baseline would have been
  approved with the bug in it. The assertion in D1 is true without a reference.
- **A wider phone floor.** 360px is what `FRONTEND.md` set and what a cheap Android
  gives; the rows were wrong, not the floor.

## Scenarios

1. Every list row shows what it is about at 360px: store, customer, entry (US-P03, D1)
2. A store's badge says "Tienda activa", never "Servicio activo" (US-P04, D2)
3. A ledger amount is ink; only statuses are green (US-P02, D3)
4. The ledger names the commission and explains where it comes from (US-K03, D4)
5. The admin's content stops widening past its cap (US-P03, D5)
6. A disabled action is neutral, not a faded accent (US-P04, D6)
7. Clearing the search is a 48px control with a name, in our palette (US-P03, D7)
8. Money fields show `$` (US-P04, D8)
9. Changing a filter does not re-announce the page (US-P04, D9)

## Definition of Done

- [x] Scenarios 1–9 covered by tests that failed first
- [x] `tests/e2e/responsive.spec.ts` asserts row identity for all six lists
- [x] `.design/devolada/DESIGN_REVIEW.md` and its 42 captures committed
- [x] `pnpm exec playwright test --config playwright.review.config.ts` regenerates them
- [ ] Re-run the review against the fixed build before the pilot

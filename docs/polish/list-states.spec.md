---
status: in-development
stories: [US-P01]
domain: polish
updated: 2026-09-03
debt: []
---

# Spec: List states — the failed request

> **2026-08-31, retirement PR**: the tienda and store-list scenarios left with `devolada-red`; the rule (a failed list never claims to be empty) stays law on every surviving list.

> **2026-09-03, ui-refactor**: D3 predicted the recipe would be repeated seven times, and after the pivot it was — six SaaS-era read screens had grown their own `<Alert>` with an underlined "Reintentar" instead of the atom. They now all call `ListError`. The screen list below is the post-pivot one.

Both apps already show a skeleton while data loads and an honest sentence when there is none. The third state was missing: **when the request fails, every list currently renders its empty state.** "Todavía no tienes movimientos" is what a shopkeeper sees when the network dropped — and the reasonable thing for them to conclude is that the charge they just made did not record. This spec is about never telling that lie again.

## Decisions

- **D1 — An error is never dressed as an empty state.** `error` is checked before `length === 0`, in every list. The two look nothing alike now: empty is a quiet muted note, failure is an `error`-toned block with a retry. The old behaviour was not a missing state, it was a wrong statement — the screens had the information and threw it away.
- **D2 — Retry refetches; it never reloads the page.** One tap calls the query's `refetch()`. A reload on a corner-store phone costs a full app boot on a connection that just failed, and it drops the session cache the rest of the app is using.
- **D3 — One atom for both apps: `ListError` in `@devolada/ui`.** Repeating a Tailwind recipe per screen is drift (ARCHITECTURE law), and this recipe is about to be repeated seven times. It carries icon + text + button, because status is never colour alone (FRONTEND law).
- **D4 — The copy names what failed, not what broke.** "No pudimos cargar tus movimientos" — never a status code, never "error 500". The shopkeeper's next action is the same whatever the cause: tap again. The one exception is the offline case, which the PWA already owns.
- **D5 — A failed page-two keeps page one on screen.** Infinite lists (feed, ledger) only show the block when the *first* page failed; a failed "Cargar más" leaves the rows in place and shows the error under them. Throwing away rows the user is reading to report a failed pagination is worse than the failure.
- **D6 — Mutations keep their inline errors.** Confirming a cash drop, saving settings and recording a charge already report next to their button, where the eye is. This spec is only about the read path.

## Contract

No API change. The states come from what TanStack Query already exposes: `isPending` → skeleton, `isError` → `ListError`, empty array → the honest sentence.

## UI Contract

Screens covered, every admin read path: **Pagos** (feed), **Enlaces**, **Cobros** (WispHub), **Saldo y recargas**, **Usuarios**, **Integraciones**, **WispHub**, **Elegir negocio**. (The store-era screens — Tiendas, Entregas, PWA Caja and Movimientos — left with `devolada-red`.)

- `ListError`: alert-triangle icon, one sentence naming the list, "Reintentar" button. Error tone from tokens (`bg-error-soft`, `border-error-line`, `text-error`), `role="alert"` so it is announced.
- Retry shows its pending state on the button while the refetch runs, so a slow connection does not read as a dead tap.
- Plain es-MX, one sentence, no codes.

## Scenarios

1. A failed feed shows the error with a retry, not "sin cobros" (US-P01, D1)
2. Tapping "Reintentar" refetches and the rows appear, with no navigation (D2)
3. A failed Movimientos shows the error; an empty Movimientos still shows its own sentence (D1)
4. A failed second page keeps the first page's rows on screen (D5)

## Definition of Done

- [x] Scenarios 1–2 automated in the admin (`apps/admin/test/list-states.test.tsx`, 8 tests)
- [x] Scenarios 3–4 automated in the PWA — left with `devolada-red` (2026-08-31)
- [x] Every screen above checks `isError` before emptiness
- [x] Every screen above renders the failure through `ListError`, not its own
      recipe (2026-09-03) — the four that had the state but no test now have one

# Design Review: Links de pago (US-D07)

Reviewed against: `.design/devolada/DESIGN_BRIEF.md`, `docs/direct-payment/admin-links-view.spec.md` (US-D07), `docs/FRONTEND.md`
Philosophy: Functionalist (Dieter Rams) with a warm accent — "less but better"
Date: 2026-08-26
Scope: `apps/admin/src/features/links/LinksScreen.tsx` — the admin screen that searches WispHub customers and shares their permanent SPEI payment links.

> The previous review (PR #94, zero defects) lives in git history at
> `.design/devolada/DESIGN_REVIEW.md` before this commit.

## Screenshots Captured

Captured by `tests/design/review-links.spec.ts` (the e2e stub harness).
Primary width carries light + dark.

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-admin-links-inicial-1280[-dark].png` | 1280×800 | Resting state: search bar + the sentence that says what the screen is for |
| `screenshots/review-admin-links-inicial-375.png` | 375×812 | Same at the mobile floor, bottom bar with "Links" active |
| `screenshots/review-admin-links-resultados-1280[-dark].png` | 1280×800 | Three results, one phoneless (D3's picker fallback) |
| `screenshots/review-admin-links-resultados-768.png` | 768×900 | Results at tablet |
| `screenshots/review-admin-links-resultados-375.png` | 375×812 | Results stacked: text row, buttons row below |
| `screenshots/review-admin-links-copiado-1280[-dark].png` | 1280×800 | Post-fix: Copiar answering with check + "Copiado" |
| `screenshots/review-admin-links-sin-resultados-1280[-dark].png` | 1280×800 | "No se encontraron clientes con \"zzz\"." |
| `screenshots/review-admin-links-sin-resultados-375.png` | 375×812 | Same at mobile |
| `screenshots/review-admin-links-sin-conexion-1280[-dark].png` | 1280×800 | 503 wall: missing WispHub key, pointing at Configuración |
| `screenshots/review-admin-links-sin-conexion-375.png` | 375×812 | Same at mobile |

> All screenshots are in `.design/devolada/screenshots/`.

## Summary

The screen honors the spec's hardest-won decision — the API-built
`waLink` that keeps Brazil out of the ISP's WhatsApp (D3) — and reads
as a sibling of `StoresScreen` at every breakpoint, dark included. But
the secondary action breaks the brief's first principle: **Copiar gives
no feedback at all**, so the admin cannot know whether the link is on
the clipboard — on the one screen whose whole job is handing that link
to someone. Two regressions of already-settled decisions also slipped
in: the search input resurrects the browser's blue native ✕ that a
previous review had banished (the shared `Input`'s D7 comment), and it
ships with no accessible name while the tienda's twin search carries
one. Both Must fixes and the native ✕ were applied on this branch
(marked below); the remaining Should items stay open.

## Must Fix

1. **Copiar copies in silence** (`LinksScreen.tsx:122-132`): the click
   calls `navigator.clipboard.writeText` with no await, no error path
   and no visible change — the brief demands visual feedback for every
   user action, and "certainty over speed" is the first principle. If
   the promise rejects (it can), the admin pastes nothing into a
   customer chat and never knows. _Fix: a transient confirmed state —
   icon swaps to a check plus a "Copiado" label (icon + text, never
   color alone), reverting after ~2s; on rejection, say it failed._
   **Fixed in this branch** — "Copiado" / "No se copió" for 2s, both
   paths tested (`apps/admin/test/links.test.tsx`); see
   `review-admin-links-copiado-1280.png`.
2. **The search input has no accessible name**
   (`LinksScreen.tsx:48-54`): placeholder-only, so a screen reader
   announces an unnamed search box. The tienda's equivalent search
   (`apps/tienda/src/features/charge/SearchScreen.tsx`) wraps the same
   pattern in a `sr-only` label ("Buscar cliente"). _Fix: the same
   sr-only label here — "Buscar cliente" keeps the two searches one
   concept._ **Fixed in this branch** — same sr-only label, tested.

## Should Fix

1. **The browser's blue ✕ is back**
   (`review-admin-links-resultados-1280.png`, both themes): the native
   `::-webkit-search-cancel-button` paints in the UA's accent — a color
   outside the token system — because the screen uses the admin's local
   `Input` plus a hand-positioned icon instead of the shared
   `@devolada/ui` Input, whose D7 comment records this exact defect
   being fixed once already. _Fix: hide the cancel button in
   `apps/admin/src/components/ui/input.tsx` (one class, same as
   `packages/ui/src/components/input.tsx:24`) and, if a clear action is
   wanted, the tienda's own tokened "Limpiar búsqueda" button is the
   established shape._ **Fixed in this branch** — the cancel button is
   hidden in the admin's `input.tsx`; the regenerated captures carry no
   blue ✕.
2. **A one-character search is answered with a failure screen**
   (`LinksScreen.tsx:26`): the query fires at length > 0 but the
   contract 400s under 2 characters (spec, Contract section), so typing
   "j" shows "No pudimos cargar los enlaces" with a Reintentar that can
   never succeed — an error state for a normal typing moment.
   _Fix: `enabled` at `>= 2` trimmed characters; below that, keep the
   instruction sentence on screen._
3. **Rows glow on hover but do nothing** (`LinksScreen.tsx:112`):
   `hover:bg-muted` is copied from `StoresScreen`, where the whole row
   is a link — here only the two buttons act, so the row promises an
   affordance it doesn't have, and similar components stop behaving
   similarly. _Fix: drop the row hover; the buttons carry their own._
4. **Results appear unannounced** (`LinksScreen.tsx:108`): the feed's
   list carries `aria-live="polite"` (`FeedScreen.tsx:266`); the search
   results — which appear, change and empty while focus stays in the
   input — carry nothing, so a screen-reader user types into silence.
   _Fix: `aria-live="polite"` on the results region, covering the
   no-results sentence too._

## Could Improve

1. **The phoneless customer shares blind**
   (`review-admin-links-resultados-1280.png`, second row): for Mario
   Reyes Flores the share button opens WhatsApp's contact picker (D3's
   deliberate fallback), but nothing on the row says so — the admin
   finds out inside WhatsApp. _Suggestion: a muted "Sin teléfono —
   elegirás el chat en WhatsApp" line where the phone would sit._
2. **The 503 alert runs the full content width**
   (`review-admin-links-sin-conexion-1280.png`): a one-sentence band
   stretching ~1250px, while every sibling message box (`no-results`,
   `StoresScreen` empty state) caps at `max-w-lg` next to a `max-w-md`
   search bar. _Suggestion: same cap; and "Configuración" is named but
   not a link — a router `Link` would close the loop it opens._
3. **The skeleton promises a different row** (`LinksScreen.tsx:80-92`):
   one `h-9` button placeholder where two `h-10` buttons arrive.
   _Suggestion: two placeholders at the real height._
4. **Copiar is an icon-only button at text-button proportions**
   (`LinksScreen.tsx:122`): default size gives it `px-5` around a lone
   icon, and its only name for sighted users is a `title` tooltip.
   _Suggestion: `size="icon"`; at mobile widths the pair sits at 40px —
   the checklist's 44px floor for touch is worth a `sm:` bump if the
   admin-on-phone use grows._

## What Works Well

- **D3 survived into the pixels and the comment explains why**
  (`LinksScreen.tsx:30-31`): the frontend opens a finished `waLink` and
  the comment records where the 52 was lost — the next reader cannot
  reintroduce the Brazil bug innocently.
- **Every state exists and speaks es-MX plainly**: resting instruction,
  skeleton, no-results quoting the query, the 503 wall that names the
  fix's location ("Revisa tu llave de API en Configuración"), and the
  generic retry — nothing dead-ends silently (the 1-char case above is
  the one wrong door, not a missing one).
- **The error is redundant by channel**
  (`review-admin-links-sin-conexion-1280.png`): icon + bold lead + text
  on the semantic red — status never rides on color alone.
- **It reads as a sibling**: same `text-xl` heading, same card-and-
  divider list as `StoresScreen`, same two-line row anatomy, and the
  grid-to-flex collapse keeps name and buttons whole at 375px
  (`review-admin-links-resultados-375.png`).
- **Dark is its own palette** (`review-admin-links-resultados-1280-dark.png`):
  warm charcoal, recalibrated teal, readable secondary text — not an
  inversion.
- **D1's nav decision holds at the floor**
  (`review-admin-links-sin-resultados-375.png`): "Links" fits the
  bottom bar on one line, the full term "Links de pago" heads the
  screen.

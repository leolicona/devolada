# Design review: spacing on Pagos · Cobros · Links, and type/icon size in Cuenta

Reviewed against: `.design/devolada/DESIGN_BRIEF.md` (pivot phase 2) and `docs/FRONTEND.md`
Philosophy: functionalist (Rams), tokens are law, subtle borders over shadows
Date: 2026-09-03 · Status: **findings only — no code changed; decisions pending the owner**
Code: `apps/admin/src/features/{feed,cobros,links}/*`, `apps/admin/src/features/{account,settings,auth}/*`, `packages/ui/src/styles/index.css`
Owning specs: `docs/admin/charge-feed.spec.md`, `docs/reconciliation/payments-and-classes.spec.md` (D4), `docs/admin/settings.spec.md` (D9–D11), `docs/admin/account-hub.spec.md` (D4–D6). Everything here amends existing decisions; no new US-ID.

Two questions were asked: **how the three list pages space their components**, and **what size the type and the icons are in Cuenta**. Both were measured in a real browser rather than read off the JSX, because a Tailwind class is a promise and `getComputedStyle` is the answer — one of the findings below (T9) is a class that compiles to nothing, which no amount of reading the JSX would have caught.

## Summary

The three list pages are the same page drawn three times, and they disagree on almost every number: the gap under the title is **16 / 16 / 24px**, the search field is **44 / 40 / 40px** tall at the 360 floor and **384 / 256 / 448px** wide at 1280, the card that holds the rows clips its corners on **one** of the three, and only **Links** has any padding at the bottom of the page — Pagos and Cobros end with `padding-bottom: 0`, so on a desktop the last row's border is the last pixel of the viewport. None of this is a broken layout; all of it is the same screen archetype re-decided three times.

In Cuenta the type ramp is sound (24 / 20 / 16 / 14 / 12) but **the section title and the sub-page title are the same 24px**, so the hub's `h1` and the page's `h2` compete instead of nesting; and **three of the five sub-pages have no title at all**, which makes the right column start 49px higher on some rows of the rail than on others. The icons are 16px everywhere with exactly two exceptions, and both are the *same concept at two sizes on adjacent screens*: the observation `Eye` is 16px in the sidebar and 12px in the hub's row, and the `Fingerprint` is 20px in the button and 16px in the row that leads to it.

The decisive finding is structural: **the spacing and letter-spacing tokens are declared in `tokens.css` and never mapped into Tailwind** (E10). Every `p-*`, `m-*`, `gap-*` and `tracking-*` in the product resolves against Tailwind's own ladder, which agrees with the token ladder up to index 4 and diverges after it — `p-6` is 24px while `--space-6` is 32px. Nothing on these five screens is off-scale in practice, but "tokens are law, zero hardcoded values" is unenforced for space, and that is why three pages could each pick a different rhythm without anything failing.

Method: the review harness — the admin built and previewed, the API stubbed at the network edge (`tests/e2e/stubs.ts`), Chromium, locale `es-MX`, tz `America/Mexico_City`, at 360 / 768 / 1280. Every number below was measured with `getComputedStyle` and `getBoundingClientRect` unless marked *est.*, and every one of them is reproducible: `pnpm exec playwright test --config playwright.review.config.ts tests/design/review-espaciado.spec.ts`.

## Screenshots captured

| Screenshot | Breakpoint | What it shows |
|---|---|---|
| `review-espaciado-pagos-desktop-1280.png` | Desktop 1280 | Title 16px above the alert, 16px to the chips; list ends at the viewport with no bottom padding |
| `review-espaciado-cobros-desktop-1280.png` | Desktop 1280 | Same 16px rhythm, chips and search on one row, no bottom padding |
| `review-espaciado-links-desktop-1280.png` | Desktop 1280 | 24px rhythm; the WhatsApp button's 16px icon gap is visible against Actualizar's 8px |
| `review-espaciado-pagos-mobile-360.png` | Mobile 360 | 44px chips and search; the alert sits 12px above the rail |
| `review-espaciado-cobros-mobile-360.png` | Mobile 360 | 40px search under 44px chips |
| `review-espaciado-links-mobile-360.png` | Mobile 360 | 40px search, 40px buttons, 32px of page bottom |
| `review-espaciado-pagos-expandido-desktop-1280.png` | Desktop 1280 | Pagos' expansion: 16px on four sides, 24px between columns, `sm:pl-20` alignment |
| `review-espaciado-cobros-expandido-desktop-1280.png` | Desktop 1280 | Cobros' expansion: 12px above the buttons, 0 below them, 8px of bottom |
| `review-espaciado-links-copiado-desktop-1280.png` | Desktop 1280 | The copy button after the click — 128px where it was 58px |
| `review-espaciado-pagos-skeleton-desktop-1280.png` | Desktop 1280 | The skeleton's 60px rows against the list's 72px |
| `review-tipografia-hub-desktop-1280.png` | Desktop 1280 | The hub: 24px Cuenta, 14px rail labels, 12px details, 16px icons |
| `review-tipografia-pago-directo-desktop-1280.png` | Desktop 1280 | `h1` Cuenta and `h2` Pago directo y conciliación at the same 24px; columns 49px out of alignment |
| `review-tipografia-pago-directo-mobile-360.png` | Mobile 360 | A sub-page **with** a title |
| `review-tipografia-usuarios-mobile-360.png` | Mobile 360 | A sub-page **without** one — and the 14px card radius |
| `review-tipografia-seguridad-desktop-1280.png` | Desktop 1280 | The 20px `Fingerprint`, the only non-16px icon in the area |
| `review-tipografia-hub-observando-desktop-1280.png` | Desktop 1280 | "Modo observación" at 16px in the sidebar and 12px in the rail row |

> All in `.design/devolada/screenshots/`. The capture spec writes the full 360 / 768 / 1280 grid for all nine routes; the table above is the curated set the findings cite.

---

## Part 1 — Spacing on Pagos, Cobros and Links

### The three pages, side by side

| | Pagos (`FeedScreen`) | Cobros (`CobrosScreen`) | Links (`LinksScreen`) |
|---|---|---|---|
| `main` padding (1280) | `32 / 0 / 32 / 32` | `32 / **0** / 32 / 32` | `32 / **32** / 32 / 32` |
| Title → first block | **16px** | **16px** | **24px** |
| Between page blocks | `mt-4`, except the empty state at `mt-6` | `mt-4` throughout | `mt-6` throughout |
| "Mostrar/Cargar más" | `mt-4 pb-6` | `mt-3` | `mt-4` |
| List card | `rounded-md`, `overflow: visible` | `rounded-md`, `overflow: hidden` | `rounded-md`, `overflow: visible` |
| Row padding | `p-4` | `p-4` | `p-4` |
| Expansion padding | `16px` on four sides, `gap-6` | `12/16/0` then `8/16` | — |
| Search height @360 | **44px** | **40px** | **40px** |
| Search width @1280 | 384 (`sm:max-w-sm`) | 256 (`sm:w-64`) | 448 (`max-w-md`) |
| Search icon | `Input icon={Search}` | none | hand-rolled absolute `Search` |
| Chevron position | between the badges and the amount | last in the row | — |
| Icon→label in buttons | 8px | 8px | **16px** |

### E1 — Pagos and Cobros have no bottom padding *(must fix)*

`main` computes `padding-bottom: 0` on Pagos and Cobros at 360 and at 1280; Links computes `32px`. The shell's column is `pb-20 lg:pb-0`, so on a phone the bottom bar's 80px hides it and on a desktop nothing does: as soon as the list is long enough to fill the screen, the last row's bottom border is the last pixel of the viewport, with no air under it.

Pagos disguises this — its "Cargar más" block carries `pb-6`, but that block renders only while `hasNextPage`, so the page has breathing room exactly when there is more content and none when the list ends. Cobros has nothing at all.

The fix belongs to the page frame, once, not to a conditional child: `pb-8` on all three `main`s (or the frame itself becomes a shared component — see the Open questions).

### E2 — Three pages, three vertical rhythms *(should fix)*

Measured gaps under the page title: **16px** (Pagos), **16px** (Cobros), **24px** (Links). Between the page's own blocks the ladders are `mt-4` / `mt-4` / `mt-6`, and the "load more" control below the list is `mt-3` / `mt-4` / `mt-4`. These are the same three regions of the same screen, drawn at three cadences a reader crosses in two clicks.

Pagos also disagrees with itself: its skeleton and its list are `mt-4`, its empty state is `mt-6` (`FeedScreen.tsx:544`), so the content shifts 8px depending on whether there is anything to show — the one place a stable rhythm matters most, because the reader is comparing "before" with "after a filter".

A single ladder for the archetype (title → filters → list → pagination) is the cheapest thing in this review, and it is what stops the next list page from inventing a fourth.

### E3 — The card clips its corners on one page out of three *(must fix on Pagos)*

`overflow` on the card that wraps the list: **hidden** in Cobros, **visible** in Pagos and Links. Pagos' rows carry `hover:bg-muted` (`FeedScreen.tsx:242`), so hovering the first or last row paints a square fill over the card's 10px radius and the corner disappears for as long as the pointer is there. Links' rows have no hover today, so the same omission is latent rather than visible.

Cobros already has the answer on line 308 (`overflow-hidden p-0`) — and the `p-0` half of it is a no-op, since the `Card` atom carries no padding of its own.

### E4 — The skeleton is a different shape from the list it stands in for *(should fix)*

| | Skeleton row | Real row |
|---|---|---|
| Pagos | 60px | **72–73px** |
| Cobros | 60px | **72–73px** |
| Links | 60px | **72px** |

All three skeletons are a `Card p-4` holding `py-3` rows; all three real lists are a `Card` with no padding holding `p-4` rows separated by dividers. So the placeholder is 16px of padding wider and 12px per row shorter than the thing it promises — three rows of skeleton (212px) become three rows of list (216px) with every row landing 12px from where it was drawn.

Links adds a second jump of its own: its "Actualizar" button is gated on `roster.data` (`LinksScreen.tsx:147`), so the header row grows from 34px to 40px when the roster lands and the search field, the list and everything under it slide **6px** down. Cobros gates the same control on `query.dataUpdatedAt > 0` and does not move.

A skeleton is a promise about layout. Matching the row's real padding and height costs one class each.

### E5 — Cobros' expansion is padded on three sides *(should fix)*

Measured on the open row: the action block computes `padding: 12px 16px 0px` and the invoice list under it `8px 16px`. So a 40px button has 12px above it and **0** below; the first invoice line sits 8px under it; and the expansion's own bottom edge is 8px, where the collapsed row it grew out of is 16px on every side.

Pagos' expansion is `16px` on four sides with a 24px column gap (`FeedScreen.tsx:270`). Same interaction, same component pair, two paddings — and the tighter one is the one holding the two buttons an ISP presses all day.

### E6 — The same two buttons are spaced differently on Cobros and Links *(must fix)*

Measured icon→label distance inside "WhatsApp": **8px in Cobros, 16px in Links**. `LinksScreen` writes `className="mr-2 size-4"` on the icons inside a `Button` whose base class already sets `gap-2` (`button.tsx:10`), so the two spacings add up. It is the same button, offering the same action on the same customer, one section apart.

`Check` and `AlertCircle` in the same component carry the same `mr-2`. The `Button` owns the gap; the icon should pass nothing.

### E7 — Links' copy button is an icon in a text button's box, and it jumps 70px when pressed *(should fix)*

Measured before and after the click: **58px → 128px**, and because the group is right-aligned the button's left edge moves 70px into the customer's column and stays there for two seconds while "Copiado" is shown. Cobros' equivalent keeps its label at every state ("Copiar link", 133px) and barely moves.

Two things collide here. The idle state is icon-only but uses the default `Button` size (`h-10 px-5`) instead of `size="icon"` (`h-10 w-10`), so a 16px glyph sits in a 58px box; and the feedback state adds a word the idle state does not reserve room for. Either keep the label at every state (Cobros' shape) or keep the box (a fixed width, or `size="icon"` with the confirmation as an icon swap).

### E8 — The search field is a different control on each page *(should fix — TD-019's scope)*

At the 360px floor: Pagos **44px**, Cobros **40px**, Links **40px**. At 1280: 384px, 256px, 448px wide. Only Pagos carries the magnifier, through the `Input` atom's `icon` prop added by the 2026-09-02 round; Links hand-rolls the identical magnifier with an absolutely positioned `Search` and `pl-9` (`LinksScreen.tsx:165-181`) — the prop was added the day before and this call site never learned about it; Cobros has no icon and leans on a 2.19:1 placeholder, which the pagos-filtros review already recorded (F3 there).

The heights are exactly **TD-019**: the 44px floor is asserted on `section[aria-label="Filtros"]` and nowhere else, so Cobros' and Links' controls are unmeasured and under it. This review adds two data points to that debt rather than a new one.

### E9 — The chevron sits in a different place on the two twin rows *(polish)*

In Pagos the amount carries `sm:order-last` (`FeedScreen.tsx:253`), so from `sm` up the row reads *time · name · badges · **chevron** · amount*. In Cobros the chevron is the last thing in the row. Two identical disclosure rows, two positions for the affordance that opens them — and in Pagos the amount, which is what the eye scans down the right edge, is separated from that edge by the chevron's 16px.

### E10 — The spacing tokens are declared and never mapped *(the structural one)*

`tokens.css` declares `--space-0…10`, `--letter-spacing-*`, `--line-height-*` and `--font-weight-*`. `packages/ui/src/styles/index.css`'s `@theme inline` block maps fonts, colours, radii, shadows, container widths and **font sizes** — and none of the four above. Tailwind therefore falls back to its own defaults for every one of them, and the two ladders agree only up to index 4:

| Utility | Tailwind (in force) | Token of the same name |
|---|---|---|
| `p-4` | 16px | `--space-4` 16px ✅ |
| `p-5` | 20px | `--space-5` **24px** |
| `p-6` | **24px** | `--space-6` **32px** |
| `p-8` | 32px | `--space-8` **64px** |

In practice nothing on these five screens is off the token *scale* — the values used are 4, 8, 12, 16, 24 and 32px, and all six exist in both ladders — so this is not a rendering defect. It is why `--card-padding: var(--space-5)` (24px) and the cards' `p-6` (24px) can agree by coincidence while reading as a contradiction, and it is the reason nothing failed when three pages picked three rhythms: **there is no spacing law to break.** FRONTEND.md's "every space comes from `tokens.css`, zero hardcoded values" is, for space, aspirational.

Two ways out, and they are the owner's call (see Open questions): map `--spacing` and let the token ladder win (renumbering every `p-*`/`m-*`/`gap-*` in the product), or accept Tailwind's ladder as the space scale and rewrite the `--space-*` block to match it so the names stop colliding. Either way it is a debt entry, not a side effect of this review.

---

## Part 2 — Type and icon size in Cuenta

### The measured ramp

Everything the settings area renders, at 1280:

| Size | Weight | Where |
|---|---|---|
| 38px | 600 | The credit balance (`text-3xl`, `--font-size-3xl`) |
| **24px** | 600 | `h1` "Cuenta" **and** the sub-page `h2` (both `text-xl`) |
| 20px | 600 | "Devolada" in the sidebar; the hub avatar's initials |
| 16px | 600 | Every card heading (`text-base`); the person's name |
| 14px | 400/500 | Every label, value, helper and button (`text-sm`) |
| 12px | 400 | The rail's detail line; the role under the business name |
| 12px | 600 | The rail's group eyebrows, uppercase |

Icons: **16×16 everywhere**, with two exceptions (T3, T4).

### T1 — The section title and the sub-page title are the same size *(should fix)*

`AccountLayout`'s `h1` "Cuenta" and `SubPage`'s `h2` are both `text-xl font-semibold` — measured **24px / 600** for both. On a desktop they render side by side, in two columns, at the same weight and size, and the `h2` is the longer string, so it reads as the page's title and the `h1` reads as a label above a menu.

The token ramp already answers this: `--font-size-lg` (20px) is annotated *"section titles"* and `--font-size-xl` (24px) *"screen titles"*. The screen is Cuenta; the section is the sub-page. `text-lg` on `SubPage`'s heading restores the nesting the DOM already claims.

### T2 — Three of the five sub-pages have no title, and the columns stop aligning *(should fix)*

`SubPage`'s `title` is optional, and only two callers pass one:

| Sub-page | Title | First card's top (desktop) |
|---|---|---|
| `/settings/direct-payment` | "Pago directo y conciliación" | **131px** |
| `/settings/preferences` | "Preferencias" | **131px** |
| `/settings/credit` | — | **82px** |
| `/settings/users` | — | **82px** |
| `/settings/security` | — | **82px** |

So the same gesture — tap a row of the rail — lands on a page whose content starts at the rail's top edge, or 49px below it, depending on which row was tapped. On a phone the difference is starker: `/settings/direct-payment` opens under a 24px title, `/settings/users` opens straight onto a card whose own 16px `h2` is the only heading on the screen (`review-tipografia-usuarios-mobile-360.png`).

The three untitled pages are the ones whose single card already carries the row's exact words, which is why they were left without one — but the cost is that the hub has two shapes, and `account-hub.spec.md`'s UI contract ("Each sub-page's `h1` is the row's label") describes neither: the code renders an `h2` for two of them and nothing for three.

Either every sub-page gets the title and the cards drop their duplicate heading, or none does and the two that have one lose it. The first is the safer read on a phone, where the back link is the only other text above the fold.

### T3 — One state, two icon sizes, one screen apart *(must fix)*

"Modo observación" renders an `Eye` at **16px** in the sidebar chip (`ObservationChip.tsx`) and at **12px** in the hub's Integraciones row (`AccountHub.tsx:137`) — measured, both visible at once on `/settings` while observing (`review-tipografia-hub-observando-desktop-1280.png`).

`size-3` appears in exactly two places in the admin: here, and the avatar's step glyph, where it is a badge on a 24px circle and has a reason. Every icon in the rail — including the row's own `Plug`, 8px to its left — is 16px. The 12px eye is the only sub-16px icon sitting in a line of text in the whole area.

### T4 — The `Fingerprint` is 20px in the button and 16px in the row that opens it *(should fix)*

`PasskeyCard`'s enrolment button carries `size-5` (measured **20×20**); it is the only non-16px icon on any settings page. The rail row that leads to that button carries the same `Fingerprint` at 16px, and every other button in the admin — Cerrar sesión, Actualizar, WhatsApp, Copiar — pairs a 14px label with a 16px icon. `apps/admin/src/features/auth/pages.tsx:150` carries the same `size-5` on the login screen's fingerprint, so the pair is at least self-consistent; the settings area is not.

### T5 — Two hand-rolled cards, one radius off *(should fix)*

Measured `border-radius`: **14px** on `UsersCard`'s `<section className="rounded-lg …">` and on the hub's identity card (`AccountHub.tsx:166`); **10px** on every card built from the `Card` atom — SPEI, Política, Saldo, Passkeys, Tu cuenta. `--border-radius-lg` (14px) is the modal-and-sheet radius; `md` (10px) is the card radius, and `--card-radius` says so.

FRONTEND.md makes `Card` "the panel both surfaces build with", and the search order puts the shared atom first. Two panels rebuild it by hand and pick the wrong step of the radius scale; on `/settings/users` the two shapes are never seen together, but on `/settings` the 14px identity card sits directly above a 10px one.

### T6 — The rail's detail line is the only 12px body text in the area *(polish)*

Rail rows are a 14px/500 label over a **12px**/400 detail; everything else in the same column and on every sub-page — the identity card's email, every helper under every field, every value — is 14px. `--font-size-xs` is annotated *"metadata, timestamps"*, and these details are neither: "CLABE, cargo por servicio y tolerancia" and "$100.00 · Saldo" are the row's content, and they are what a reader scans to choose a row.

Two rows at 14px/12px are 46px tall; at 14px/14px they would be ~50px. The rail has the room.

### T7 — The eyebrows' tracking is not the token's *(polish)*

`RailGroup`'s "NEGOCIO" / "TU CUENTA" use `tracking-wide`, which measures **0.3px** — Tailwind's 0.025em, not our `--letter-spacing-wide: 0.06em` (0.72px at 12px), because letter-spacing is one of the token groups never mapped (E10). The design system's own playground writes the same eyebrow as `tracking-[0.06em]` (`Showcase.tsx:32`). So the token, the playground and the product give three answers for one label style, and only two of them agree.

### T8 — Two aliases for one ink, inside one file *(polish)*

`SettingsScreen.tsx` writes the card description as `text-muted-foreground` (line 98) and the field helper as `text-ink-soft` (line 129). Both resolve to `--color-text-secondary`; both are 14px; they are the same role, twelve lines apart. The same mix runs through the area — `AccountHub` uses `text-ink-soft`, `PasskeyCard` uses `text-muted-foreground`.

FRONTEND.md draws the line between the layers (the package writes token utilities, the apps may use the shadcn aliases), not inside a file. One alias per app, chosen once, would make the next helper line unambiguous.

### T9 — `text-danger` does not exist, so the bank warning renders in body ink *(must fix — defect)*

`SettingsScreen.tsx:139` styles BUG-008's warning — *"El banco guardado (…) ya no está en la lista, así que los pagos por transferencia están desactivados"* — with `text-sm text-danger`. There is no `--color-danger` anywhere in `tokens.css` or in either app's stylesheet; the token is `error`. Verified against the built bundle: `.text-error` is present in `apps/admin/dist/assets/*.css`, **`.text-danger` is not**.

So the class is inert: the sentence and its `TriangleAlert` inherit the card's charcoal, and the one notice that tells an owner their SPEI channel is closed looks like helper text. `contrast-lint.mjs` cannot catch it (there is no colour to measure) and no test asserts a colour on it. It is the exact failure mode FRONTEND.md's `@source "../"` note describes — a class that compiles to nothing, with no build error and no failing test — this time from a typo'd token name rather than a missed source path.

This is a defect in shipped code, not a design opinion: **BUG-018**, fixable in one character-run (`text-danger` → `text-error`), with a regression test that asserts the class rather than the pixel.

---

## Ranked

**Must fix** — defects, not preferences:

1. **T9** — `text-danger` is inert; the bank-unknown warning has no error ink. (BUG-018)
2. **E1** — Pagos and Cobros end at `padding-bottom: 0`.
3. **E3** — Pagos' list card does not clip; its hover fill squares the corners.
4. **E6** — `mr-2` on icons inside a `gap-2` button doubles the gap on Links.
5. **T3** — one state, an `Eye` at 16px and at 12px, both on `/settings`.

**Should fix** — one archetype, one answer:

6. **E2** — one vertical ladder for the three pages (and Pagos' empty state stops moving 8px).
7. **E4** — skeletons take the row's real padding and height; Links' header stops growing on load.
8. **E5** — the expansion is padded like the row it grew from.
9. **E7** — the copy button keeps either its label or its box.
10. **E8** — one search control: same height (≥44 at the floor), same icon, one width rule. Lands inside **TD-019**.
11. **T1** — `SubPage`'s heading drops to `text-lg`.
12. **T2** — every sub-page has a title, or none does.
13. **T4** — the `Fingerprint` in the button becomes `size-4`.
14. **T5** — `UsersCard` and the identity card are built from `Card`.

**Polish** — worth a line in whatever PR passes nearby:

15. **E9** — the chevron ends the row on Pagos as it does on Cobros.
16. **T6** — the rail's detail line at 14px.
17. **T7** — the eyebrow's tracking from the token, once it is mapped.
18. **T8** — one secondary-ink alias per app.

**Debt** — bigger than any of the above:

19. **E10** — map the spacing / tracking / leading / weight tokens, or renumber `--space-*` to Tailwind's ladder. Proposed as **TD-020**; it is what would keep findings 6–10 from coming back on the sixth list page.

## Open questions for the owner

1. **One page frame, or three?** Every finding in E1, E2 and E4 is a consequence of `main className="px-4 pt-4 lg:px-8 lg:pt-8"` being retyped per page. A `ListPage` frame (title slot, filter slot, list slot) would hold the ladder in one place, at the cost of a component the three screens do not otherwise need. The alternative is to write the ladder into FRONTEND.md and keep copying it.
2. **E10's direction** — token ladder wins (rename every utility) or Tailwind's ladder wins (rewrite the `--space-*` block). The second is a one-file change and makes the tokens honest; the first is what "tokens are law" literally says.
3. **T2's direction** — titles on all five sub-pages (and the cards lose their duplicated heading), or on none.
4. **Does any of this ride the same PR as TD-019?** E8 and the 44px floor are the same measurement on the same controls; splitting them means measuring Cobros and Links twice.
5. **BUGS.md for T9** — recorded as BUG-018 when it is fixed, or folded into whichever PR takes it (the lite path asks for the entry *and* a test).

## What works well

- **The row is the same object on both list pages**: `p-4`, a `divide-y` of `line-soft`, a `Collapsible` trigger, identity wrapping instead of truncating. The 2026-08-25 "a row can render correctly and say nothing" lesson held — every row measured at 360 keeps its name at full width.
- **The card is one shape**: 10px radius, 1px `line` border, no shadow, 24px of padding, everywhere it is the atom. The two exceptions (T5) are the only ones in five screens.
- **The type ramp is small and it holds**: five sizes carry the entire settings area, and 14px does the work — no page invents a size to make something fit.
- **Icons are one size**: 16px, in buttons, in rows, in chips, in alerts, with two exceptions in five screens. That is a high bar already met.
- **Pagos' filter bar is measurably the best of the three** — 44px controls, the magnifier, the edge-bleeding rail, the ring room. The finding in E2/E8 is not that Pagos is wrong; it is that Cobros and Links never received what that round decided.

## How this was measured

`tests/design/review-espaciado.spec.ts`, run with the review config:

```sh
pnpm exec playwright test --config playwright.review.config.ts tests/design/review-espaciado.spec.ts
```

It reuses the e2e harness (the built-and-previewed admin plus `tests/e2e/stubs.ts`) and adds stubs for `/settings`, `/businesses/members`, `/credit*` and the passkey list. For each of `/payments`, `/payment-requests`, `/links` and the five Cuenta routes, at 360 / 768 / 1280, it records `main`'s computed padding, every top-level block's box and the gap between consecutive ones, the type ramp (one row per distinct size / weight / tracking / colour), every `<svg>`'s rendered box, every control's height, and every bordered panel's radius, overflow and padding. Five targeted tests measure the open expansions, the icon→label distance inside buttons, the copy button before and after its click, the skeleton against the loaded list with the stubs delayed 2.5s, and the observation `Eye` at both of its sizes at once.

Unlike the other specs under `tests/design/`, this one **measures as well as captures** — it prints a table per route and asserts nothing beyond the screen having rendered, because the numbers are the finding. That is deliberate: four of the findings here (E1, E3, E4, T9) are invisible to every assertion the suite makes today, which is the same gap `design-review.spec.md` D1 and D10 were written about. Whichever PR takes the fixes is the one that should turn the numbers it settles into assertions.

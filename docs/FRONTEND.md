# Frontend laws

Cross-cutting UI rules. Each `.spec.md` additionally includes its own **UI Contract** section (states, responsive, accessibility, which components it reuses vs creates, microcopy). These laws are not re-decided per feature.

## Single visual source

- **Tokens are law**: every color, space, radius, shadow and size comes from `packages/ui/src/styles/tokens.css`. Zero hardcoded values.
- **A token that is not mapped is not law.** The `@theme inline` block in `src/styles/index.css` is what makes a token reach a utility; anything declared in `tokens.css` and missing there is decoration, and Tailwind's own default wins silently. Found 2026-09-05 (espaciado review E10, TD-020): `--space-*`, `--letter-spacing-*` and `--line-height-*` had never been mapped, so every `p-*`/`gap-*`/`tracking-*` in both apps resolved against Tailwind's ladder — which agreed with the token ladder only up to index 4 (`--space-6` said 32px while `p-6` rendered 24). Adding a group to `tokens.css` means adding it to `index.css` in the same commit.
- **Space is one unit, not a ladder of names**: `--space-base` (4px) is mapped to Tailwind's `--spacing`, so `p-N` is `--space-base × N` by construction and the two scales cannot drift. Write the utility (`p-4`, `gap-3`), never a hand-picked pixel.
- **A colour utility must name a token that exists.** `scripts/contrast-lint.mjs` fails on any `text-*`/`bg-*`/`border-*` whose name is neither a `--color-*` in an `@theme` block nor a size/side keyword. Born from BUG-018: `text-danger` (the token is `error`) compiled to nothing for weeks, so the notice that says SPEI transfers are off rendered in body ink — no build error, no failing test, and no colour for the contrast lint to measure.
- **`packages/ui` is declared to Tailwind with `@source "../"`** in `src/styles/index.css`, and the line must stay. Both apps resolve `@devolada/ui` through node_modules, which Tailwind v4's automatic source detection skips — so without it, a utility used *only* inside an atom compiles to nothing and fails silently, with no build error and no failing test. Found 2026-08-14: `pl-12` (the search input's icon gap), `hover:bg-accent-hover`, `active:bg-accent-active` and `animate-pulse` had never reached either stylesheet. A new class in an atom is verified in the built CSS, not in the JSX.
- **`StatusBadge` is the only representation of domain statuses** (reconnection, payments, service). Re-creating status pills per screen is forbidden; if a status is missing, it is added to the atom.
- **`Amount` / `AmountBreakdown` / `formatMoney`** for all visible money. A breakdown's total is always computed, never passed by hand.
- Philosophy: functionalist (Rams) with a warm accent. Color = information (green charged / amber queued / red failed); nothing decorative without function; no bounce.

## Component sourcing

- **Frontend work starts with the `/shadcn` skill.** Before writing a component by hand, check the shadcn catalog. If the primitive exists there (Tabs, Collapsible, Dialog, Skeleton, Select, Table…), copy it into the app's `src/components/ui/` and theme it with our tokens. A hand-rolled filter chip, accordion or spinner is drift, not a shortcut.
- Search order for any piece of UI: domain atom in `@devolada/ui` → shadcn primitive → new component (and if two surfaces need it, it becomes a shared atom).
- **shadcn is the recipe; the tokens stay the law** (`admin/shell.spec.md` D1). Copy the code into the repo — never add a component library as a dependency.
- Not every primitive fits: pick the one the UI Contract needs, and write down what you rejected and why (`charge-feed.spec.md` D7 refuses `Table` because rows expand and must become cards on mobile).
- **Primitives both surfaces use live in `@devolada/ui`** — today `Alert`, `Card` and `Skeleton` alongside the domain atoms (a law born in the store-era shell spec, archived in `devolada-red`). They are written in token utilities (`bg-well`, `border-line`), not shadcn's semantic aliases, because the package is the layer that owns the tokens.
- Primitives only one surface uses stay in that app's `src/components/ui/`: the admin keeps Tabs, Select, Collapsible, AlertDialog, Textarea, Label, Button, Input, Popover, Sheet and Calendar there, mapped through the alias layer in `apps/admin/src/styles.css` (`admin/shell.spec.md` D1). The second surface to need one is what promotes it.
- **Class names merge with `cn()`** (clsx + tailwind-merge), never with template concatenation: `"h-12" + "h-14"` leaves the winner to stylesheet order instead of the caller (same origin, same archive). Variants past two options use `cva`.
- Both apps carry a `components.json`, so `pnpm dlx shadcn@latest add <primitive>` lands the code in the right folder with the right alias.

## Payment page (`apps/pago`)

- Mobile-first with a real floor of **360px**; touch targets ≥ 48px (`--size-touch`); zero technical jargon; plain es-MX ("pago", never "cobro" — glossary).

## Admin

- Desktop-first but usable on mobile: tables collapse to cards, sidebar to a bottom menu.
- Single-level navigation: **at most 5 sections**, detail lives inside each one. Five is the ceiling, not a target: below `lg` the sidebar becomes a bottom bar, and five items at the 360px floor leave ~71px each — enough for a one-word label and nothing more (measured 2026-08-17, when "Enlaces SPEI" wrapped onto a second line and broke the row's baseline). A section whose name does not fit in one word belongs inside another one, and a sixth section needs a different pattern, not a thinner bar.

- **The three list pages share one frame.** `PageFrame` (`features/shell/PageFrame.tsx`) owns `main`'s padding — the bottom included — the title row and the one vertical ladder between a page's blocks (24px, `PAGE_STACK`, which a Tabs panel continues rather than inventing a fourth number). Filters and list stay each page's own. Born 2026-09-05 (espaciado review D1): retyped per page, the frame had produced 16/16/24px under the title, three "load more" gaps, and a `padding-bottom: 0` on Pagos and Cobros that ended a full list on the viewport's last pixel. `ListSkeleton` is the same law for the placeholder: a skeleton is the list's geometry or it is a layout shift (three 60px rows standing in for 72px ones).
- **A list card clips** (`overflow-hidden`): a row's hover fill is painted over the card's 10px corner and squares it off otherwise.
- **An icon inside a button is `size-4`**, next to a 14px label, everywhere in the admin — including the fingerprint on the login screen and in the passkey card, which were the two exceptions.
- **One secondary-ink alias per file.** The admin maps the shadcn aliases (`text-muted-foreground`, `bg-muted`) and may speak them; `packages/ui` and `apps/pago` write token utilities (`text-ink-soft`, `bg-well`). What no file does is use both for one role, twelve lines apart, as `SettingsScreen` did.
- **No in-page anchor indexes.** A row of links that jumps to sections of the page you are already on is a fourth navigation layer under the nav, the sub-page rail and the page title, and it earns its place only on a page too long to read — which is the thing to fix. A page that wants a table of contents is split into rail rows instead (`admin/settings.spec.md` D10, born 2026-09-03 when the index outlived the 3,000px page it was drawn for). **Ids stay**: a card's `id` is the deep-link contract for banners, wizards and legacy hashes, and it is what lets the visible index go without breaking a single link.

## Both surfaces

- Light + dark via tokens (`[data-theme]` + `prefers-color-scheme`); dark is recalibrated warm charcoal, never inversion.
- Minimum AA contrast; AAA target on amounts and statuses. Color never travels alone: always icon + text. **Enforced**: `scripts/contrast-lint.mjs` measures every rendered pair in both themes on each CI run, and fails on a hardcoded color anywhere outside `tokens.css` (`docs/polish/dark-and-contrast.spec.md`).
- `aria-live` on feeds and status transitions; keyboard + visible focus in the admin; `prefers-reduced-motion` respected (already in the base stylesheet).
- No "session expired" screen during normal operation (US-S02); only a failed refresh returns to login.

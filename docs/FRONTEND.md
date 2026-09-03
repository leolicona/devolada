# Frontend laws

Cross-cutting UI rules. Each `.spec.md` additionally includes its own **UI Contract** section (states, responsive, accessibility, which components it reuses vs creates, microcopy). These laws are not re-decided per feature.

## Single visual source

- **Tokens are law**: every color, space, radius, shadow and size comes from `packages/ui/src/styles/tokens.css`. Zero hardcoded values.
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

## Both surfaces

- Light + dark via tokens (`[data-theme]` + `prefers-color-scheme`); dark is recalibrated warm charcoal, never inversion.
- Minimum AA contrast; AAA target on amounts and statuses. Color never travels alone: always icon + text. **Enforced**: `scripts/contrast-lint.mjs` measures every rendered pair in both themes on each CI run, and fails on a hardcoded color anywhere outside `tokens.css` (`docs/polish/dark-and-contrast.spec.md`).
- `aria-live` on feeds and status transitions; keyboard + visible focus in the admin; `prefers-reduced-motion` respected (already in the base stylesheet).
- No "session expired" screen during normal operation (US-S02); only a failed refresh returns to login.

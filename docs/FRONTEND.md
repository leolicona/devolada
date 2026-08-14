# Frontend laws

Cross-cutting UI rules. Each `.spec.md` additionally includes its own **UI Contract** section (states, responsive, accessibility, which components it reuses vs creates, microcopy). These laws are not re-decided per feature.

## Single visual source

- **Tokens are law**: every color, space, radius, shadow and size comes from `packages/ui/src/styles/tokens.css`. Zero hardcoded values. (The design mirror in `.design/devolada/DESIGN_TOKENS.css` syncs from the live file.)
- **`StatusBadge` is the only representation of domain statuses** (reconnection, cash drops, service). Re-creating status pills per screen is forbidden; if a status is missing, it is added to the atom.
- **`Amount` / `AmountBreakdown` / `formatMoney`** for all visible money. A breakdown's total is always computed, never passed by hand.
- Philosophy: functionalist (Rams) with a warm accent. Color = information (green charged / amber queued / red failed); nothing decorative without function; no bounce.

## Component sourcing

- **Frontend work starts with the `/shadcn` skill.** Before writing a component by hand, check the shadcn catalog. If the primitive exists there (Tabs, Collapsible, Dialog, Skeleton, Select, Table…), copy it into the app's `src/components/ui/` and theme it with our tokens. A hand-rolled filter chip, accordion or spinner is drift, not a shortcut.
- Search order for any piece of UI: domain atom in `@devolada/ui` → shadcn primitive → new component (and if two surfaces need it, it becomes a shared atom).
- **shadcn is the recipe; the tokens stay the law** (`admin/shell.spec.md` D1). Copy the code into the repo — never add a component library as a dependency.
- Not every primitive fits: pick the one the UI Contract needs, and write down what you rejected and why (`charge-feed.spec.md` D7 refuses `Table` because rows expand and must become cards on mobile).
- Today the catalog lives in `apps/admin/src/components/ui/`. The store PWA builds on `@devolada/ui` atoms; when it needs a primitive those atoms don't cover, it copies from shadcn as well.

## Store PWA

- Mobile-first with a real floor of **360px**; content centered at `--max-width-content` on large screens.
- Touch targets ≥ 48px (`--size-touch`); critical charge actions at 64px (`--size-touch-lg`) anchored to the thumb zone.
- At most 3 steps per charge; zero technical jargon; plain es-MX.
- Mandatory states: suspended account (full screen, can appear mid-shift), offline, WispHub queued.

## Admin

- Desktop-first but usable on mobile: tables collapse to cards, sidebar to a bottom menu; confirming a cash drop from a phone takes two taps.
- Single-level navigation: 4 sections, detail lives inside each one.

## Both surfaces

- Light + dark via tokens (`[data-theme]` + `prefers-color-scheme`); dark is recalibrated warm charcoal, never inversion.
- Minimum AA contrast; AAA target on amounts and statuses. Color never travels alone: always icon + text.
- `aria-live` on feeds and status transitions; keyboard + visible focus in the admin; `prefers-reduced-motion` respected (already in the base stylesheet).
- No "session expired" screen during normal operation (US-S02); only a failed refresh returns to login.

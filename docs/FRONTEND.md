# Frontend laws

Cross-cutting UI rules. Each `.spec.md` additionally includes its own **UI Contract** section (states, responsive, accessibility, which components it reuses vs creates, microcopy). These laws are not re-decided per feature.

## Single visual source

- **Tokens are law**: every color, space, radius, shadow and size comes from `packages/ui/src/styles/tokens.css`. Zero hardcoded values. (The design mirror in `.design/devolada/DESIGN_TOKENS.css` syncs from the live file.)
- **`StatusBadge` is the only representation of domain statuses** (reconnection, cash drops, service). Re-creating status pills per screen is forbidden; if a status is missing, it is added to the atom.
- **`Amount` / `AmountBreakdown` / `formatMoney`** for all visible money. A breakdown's total is always computed, never passed by hand.
- Philosophy: functionalist (Rams) with a warm accent. Color = information (green charged / amber queued / red failed); nothing decorative without function; no bounce.

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

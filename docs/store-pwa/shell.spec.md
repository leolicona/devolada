---
status: in-development
stories: [US-S01, US-S02, US-S03]
domain: store-pwa
updated: 2026-08-14
debt: [TD-007]
---

# Spec: Store PWA shell

The installable shell of `apps/tienda`: login, session guard, bottom-tab navigation and the suspended-account state. Implements the UI Contract of `auth/sessions.spec.md` for the store side. The three tab screens ship as placeholders — their features have their own specs.

## Decisions

- **D1 — Code-based TanStack Router.** Five routes don't justify the file-based plugin's build magic; the tree is explicit in `src/router.tsx`. Revisited if routes multiply.
- **D2 — Same-origin dev proxy for cookies.** Vite proxies `/auth` and `/dev` to `wrangler dev` (8787), so HTTP-only cookies work with zero CORS in development. The deployed PWA runs cross-origin against the API and needs a CORS + credentials allowlist on `apps/api` — deliberately not built yet (TD-007) since the PWA has no deploy step.
- **D3 — Guard by asking, not by assuming.** The shell calls `/auth/me` on load: 200 → app, 401 → `/login`, 403 `ACCOUNT_SUSPENDED` → full-screen suspended state. No client-side session storage; the cookie is the session (sessions spec D1).
- **D4 — Suspension is a screen, not a toast.** A 403 replaces the entire app with the suspended screen (it can appear mid-shift, sessions spec) with the ISP contact placeholder. No navigation escape hatches.
- **D5 — The primitives the PWA needs are shared atoms, not app-local copies (2026-08-14).** The PWA was built before the `/shadcn` law landed (`FRONTEND.md`, "Component sourcing"), so it retyped the same Tailwind recipes on every screen: the alert box 15 times, the card 6, the loading line 6. `Alert`, `Card` and `Skeleton` move into `@devolada/ui` because **both** surfaces need them, which is the sharing clause of that law, and the admin drops its local copies. **Rejected**: copying the admin's three files into `apps/tienda/src/components/ui/`, which would have fixed the repetition inside the PWA by repeating it one level up. The move is visually inert — the admin's shadcn aliases and our native utilities already resolve to the same tokens (`bg-muted`/`bg-well` → `--color-bg-tertiary`, `border-border`/`border-line` → `--color-border-primary`), so the shared atoms speak the token vocabulary and the alias layer stays behind in `apps/admin/src/styles.css` for the primitives only the admin uses. One deliberate deviation from the catalog: shadcn's `Alert` sets `role="alert"` on every variant, and ours sets it only on `destructive` (`warning` gets the polite `role="status"`, neutral and success get none). An assertive live region on a sentence that renders with the page interrupts a screen reader for nothing, and `list-states.spec.md` D1 depends on the difference — "no movements yet" must not read as a failure. `ListError` builds on `Alert` for the same reason: it was restating the destructive recipe by hand.
- **D6 — Classes merge, they do not concatenate.** The atoms in `@devolada/ui` built their class strings with template literals, so a caller passing `h-14` to `Input` produced `h-12 h-14` and the winner was decided by stylesheet order, not by the caller. No call site hit it, which is exactly why it was worth fixing before one did. `cn()` (clsx + tailwind-merge) now resolves conflicts in the caller's favour, and variants that grow past two options use `cva` — the same recipe the admin already runs.
- **D7 — Loading is the shape of the screen, not the word "Cargando…".** Each screen's pending state renders skeletons in the layout the data will occupy, so the page does not jump when it arrives. The cash box and the confirm screen carry the most weight here: the shopkeeper is holding the customer's money while they wait. **Rejected**: a shared full-screen spinner — it throws away the layout the screen already knows and reads as "broken" on a slow connection at the counter. The one exception is the session guard in `AppShell`: while `/auth/me` is in flight it does not yet know whether the answer is the app, the login or the suspended screen, so it keeps a plain centred line rather than drawing the skeleton of a screen the shopkeeper may never see.

## Contract (UI)

- `/login`: phone + password, 48px targets, plain es-MX errors ("Teléfono o contraseña incorrectos"), no account-existence hints. Success → `/`.
- Authenticated layout: 3 fixed bottom tabs at 64px — **Cobrar** (`/`) · **Caja** (`/cashbox`) · **Movimientos** (`/ledger`) — active tab marked by more than color.
- Suspended screen: full-screen, "Cuenta suspendida" + instruction to contact the ISP; shown on any 403 `ACCOUNT_SUSPENDED`.
- Installable PWA: manifest (name, theme `#0f766e`, standalone display, icon), es-MX `lang`, theme script identical to the playground's.
- Placeholders state their pending feature honestly (no fake functionality).
- Everything themed by `@devolada/ui` tokens; light + dark work from day one.
- Notices use `Alert` with the variant that matches the meaning (`warning` for the cash cap and WispHub delays, `destructive` for a failed action, `success` for nothing due, `default` for a neutral explanation). A notice is never a bare `<p>` with border classes.
- Panels use `Card`. Content is centred at `max-w-content` — the token utility, never `max-w-[40rem]`.
- Every screen that waits on the network renders `Skeleton` in the shape of its result.

## Scenarios

1. Login form submits phone + password and reports the session on success (US-S01)
2. Login shows the generic error on 401 without hinting account existence (US-S01)
3. Without a session, the guard redirects to `/login` (US-S02)
4. With a session, the shell renders the three tabs (US-S01)
5. On 403 `ACCOUNT_SUSPENDED` the suspended screen takes over the app (US-S03)
6. A pending screen shows skeletons, and they are replaced by the data (D7)
7. `cn()` lets a caller override an atom's own utility (D6)

## Definition of Done

- [x] Scenarios automated with Testing Library + MSW (`apps/tienda/test/shell.test.tsx`, 5 tests)
- [x] Scenarios 6–7 automated (`apps/tienda/test/loading-states.test.tsx` 2 tests, `packages/ui/test/atoms.test.tsx` 8 tests)
- [x] `Alert` / `Card` / `Skeleton` shared in `@devolada/ui`, consumed by both apps (D5)
- [x] Zero repeated alert or card recipes in `apps/tienda/src` (D5)
- [ ] Installable shell verified in a browser (manifest + icon)
- [ ] Light/dark verified against tokens
- [ ] CORS for the deployed PWA (TD-007; blocked by: PWA deploy step)

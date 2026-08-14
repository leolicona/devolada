---
status: in-development
stories: [US-S01, US-S02, US-S03]
domain: store-pwa
updated: 2026-08-13
debt: [TD-007]
---

# Spec: Store PWA shell

The installable shell of `apps/tienda`: login, session guard, bottom-tab navigation and the suspended-account state. Implements the UI Contract of `auth/sessions.spec.md` for the store side. The three tab screens ship as placeholders — their features have their own specs.

## Decisions

- **D1 — Code-based TanStack Router.** Five routes don't justify the file-based plugin's build magic; the tree is explicit in `src/router.tsx`. Revisited if routes multiply.
- **D2 — Same-origin dev proxy for cookies.** Vite proxies `/auth` and `/dev` to `wrangler dev` (8787), so HTTP-only cookies work with zero CORS in development. The deployed PWA runs cross-origin against the API and needs a CORS + credentials allowlist on `apps/api` — deliberately not built yet (TD-007) since the PWA has no deploy step.
- **D3 — Guard by asking, not by assuming.** The shell calls `/auth/me` on load: 200 → app, 401 → `/login`, 403 `ACCOUNT_SUSPENDED` → full-screen suspended state. No client-side session storage; the cookie is the session (sessions spec D1).
- **D4 — Suspension is a screen, not a toast.** A 403 replaces the entire app with the suspended screen (it can appear mid-shift, sessions spec) with the ISP contact placeholder. No navigation escape hatches.

## Contract (UI)

- `/login`: phone + password, 48px targets, plain es-MX errors ("Teléfono o contraseña incorrectos"), no account-existence hints. Success → `/`.
- Authenticated layout: 3 fixed bottom tabs at 64px — **Cobrar** (`/`) · **Caja** (`/cashbox`) · **Movimientos** (`/ledger`) — active tab marked by more than color.
- Suspended screen: full-screen, "Cuenta suspendida" + instruction to contact the ISP; shown on any 403 `ACCOUNT_SUSPENDED`.
- Installable PWA: manifest (name, theme `#0f766e`, standalone display, icon), es-MX `lang`, theme script identical to the playground's.
- Placeholders state their pending feature honestly (no fake functionality).
- Everything themed by `@devolada/ui` tokens; light + dark work from day one.

## Scenarios

1. Login form submits phone + password and reports the session on success (US-S01)
2. Login shows the generic error on 401 without hinting account existence (US-S01)
3. Without a session, the guard redirects to `/login` (US-S02)
4. With a session, the shell renders the three tabs (US-S01)
5. On 403 `ACCOUNT_SUSPENDED` the suspended screen takes over the app (US-S03)

## Definition of Done

- [x] Scenarios automated with Testing Library + MSW (`apps/tienda/test/shell.test.tsx`, 5 tests)
- [ ] Installable shell verified in a browser (manifest + icon)
- [ ] Light/dark verified against tokens
- [ ] CORS for the deployed PWA (TD-007; blocked by: PWA deploy step)

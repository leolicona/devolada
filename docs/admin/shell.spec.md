---
status: in-development
stories: [US-S04, US-S06]
domain: admin
updated: 2026-08-14
debt: []
---

# Spec: Admin dashboard shell

> **2026-08-31, retirement PR**: the Tiendas and Entregas sections (and the pending-drops badge) retired with the store network; the nav is Cobros · Links · Configuración. The ≤5-section law (FRONTEND.md) stands.
>
> **Phase 2 (business-and-memberships)**: the shell gained the business switcher (sidebar on desktop, a `<header>` strip on phones — a plain label with one business), and three session outcomes the guard routes: `NO_BUSINESS` → the onboarding wizard, `NO_ACTIVE_BUSINESS` / `MEMBERSHIP_REVOKED` → the chooser. Roles hide by area (brief law).

`apps/admin` is born: the ISP's dashboard shell with the four-section sidebar, and the full access flow — login, signup, email verification, password recovery. This closes the UI half of `auth/isp-signup.spec.md` (its endpoints have waited since Phase 1).

## Decisions

- **D1 — shadcn primitives, themed by our tokens.** The admin uses shadcn/ui's copy-into-the-app model (per the project's shadcn skill): components live in `src/components/ui/`, and shadcn's semantic variables (`--primary`, `--background`, …) map to our design tokens in the app stylesheet. The tokens stay the law; shadcn is the component recipe. Domain atoms (`StatusBadge`, `Amount`) still come from `@devolada/ui`.
- **D2 — Desktop-first shell, bottom menu on mobile.** Sidebar with Cobros · Tiendas · Entregas · Configuración and the account at the foot; under `lg` it collapses to a 4-icon bottom bar. Confirming a cash drop from a phone must stay comfortable (IA rule).
- **D3 — The guard accepts only ISP actors.** A store session on the admin gets sent to the admin login. Suspended ISP → the same suspended treatment as the PWA.
- **D4 — The verify page redeems on load.** `/verify?token=` calls the API immediately — the user's job was clicking the link. Success shows a short confirmation and continues into the dashboard.
- **D5 — Unverified ISPs see a persistent banner.** "Confirma tu correo" with a re-send action, until `emailVerified` is true. The actor now carries `emailVerified` so the shell knows.

## Contract (consumes, does not add)

Endpoints from `auth/sessions.spec.md` and `auth/isp-signup.spec.md`. One addition to an existing shape: the ISP actor from `/auth/me` now includes `emailVerified` (D5).

## UI Contract

- `/login` (email + password, generic errors) · `/signup` (name, email, password → lands signed-in with the verify banner) · `/verify?token=` (auto-redeem, D4) · `/recover` (always the same confirmation — no existence leak) · `/reset?token=` (new password twice).
- Shell: four sections as honest placeholders; account block with the ISP email and "Cerrar sesión".
- Copy in plain es-MX. Light + dark from the tokens.

## Scenarios

1. API: `/auth/me` for an ISP includes `emailVerified` (D5)
2. UI: login lands on the dashboard shell with the four sections (US-S04)
3. UI: signup lands signed-in and shows the verify banner; the banner offers re-send (US-S04, D5)
4. UI: `/verify?token=` redeems on load and confirms (D4)
5. UI: recover shows the same confirmation for any email (US-S06)
6. UI: a session-less visit to a section redirects to `/login` (D3)

## Definition of Done

- [x] Scenario 1 automated in the API layer (`test/sessions.test.ts`)
- [x] Scenarios 2–6 automated with Testing Library + MSW (`apps/admin/test/shell.test.tsx`, 5 tests)
- [x] Admin deployed (dev + per-PR previews) with CORS + magic links pointing at it
- [ ] Manual check on the deployed admin

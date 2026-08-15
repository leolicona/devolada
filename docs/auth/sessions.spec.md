---
status: current
stories: [US-S01, US-S02, US-S03]
domain: auth
updated: 2026-08-13
debt: [TD-001, TD-005]
---

# Spec: Sessions (login, transparent refresh, revocation)

> **Contract superseded 2026-08-15**: the auth implementation moved to
> Better Auth and [better-auth.spec.md](better-auth.spec.md) owns the
> contract now. This spec keeps its history and its scenario numbering,
> which the new spec and tests still cite.

Cookie-based authentication for stores (phone) and admins (email), with invisible renewal and immediate revocation on suspension. Implemented in `apps/api` (routes `src/routes/auth.ts`, middleware `src/auth/middleware.ts`).

## Decisions

- **D1 — HTTP-only cookies, not bearer tokens.** Discarded alternative: JWTs in localStorage/Authorization (exposed to XSS, requires token handling in every app). The `gm_access` (15 min) + `gm_refresh` (30 days) cookies keep JWTs out of JS reach.
- **D2 — DB status check on every request.** Discarded alternative: trusting JWT validity alone (a suspended store could operate up to 15 more minutes). Cost: one SELECT per request; benefit: US-S03 literally.
- **D3 — Generic, indistinguishable 401.** Discarded alternative: specific messages ("phone not registered"), which leak which accounts exist.
- **D4 — IdP configuration errors are not disguised as 401s.** An unregistered `appId` or broken contract returns 500 and gets logged; a fake 401 would have hidden the real problem (it happened during development).

## Contract

| Route | Input (Zod) | Success | Failures |
|-------|-------------|---------|----------|
| `POST /auth/store/login` | `{phone: 10-15, password: ≥8}` | `{type, id, name}` + cookies | 401 credentials · 403 `ACCOUNT_SUSPENDED` · 400 validation |
| `POST /auth/admin/login` | `{email: email, password: ≥8}` | same | same |
| `POST /auth/logout` | — (cookie) | `{}` + cookies cleared; best-effort revoke | — |
| `GET /auth/me` | — (cookie) | actor `{type, id, name, status, …}` | 401 no session · 403 suspended |

`requireSession` middleware: validates `gm_access`; if expired and `gm_refresh` is valid → renews against the IdP, updates cookies and **the original request continues** (US-S02). Payload identity (`identity ?? sub`) → actor in DB (store by phone, ISP by email) → status check (US-S03).

## Business rules

1. A store in `invited` status (no password) cannot log in: generic 401.
2. Suspension (store or ISP) → 403 `ACCOUNT_SUSPENDED` on the next request, with cookies cleared.
3. Store sessions are long by design (the counter device); no inactivity expiry in the MVP.

## UI Contract

- No "session expired" screen during normal operation; a 401 after a failed refresh → redirect to `/login` without an alarming error message.
- 403 `ACCOUNT_SUSPENDED` in the PWA → full-screen suspended-account state with the ISP's contact info (component from the brief's inventory); it can appear mid-shift.
- Login forms: store (phone + password) and admin (email + password) share a visual base (`packages/ui`); touch targets ≥48px; errors in plain es-MX ("Teléfono o contraseña incorrectos").

## Scenarios (verified with curl, 2026-08-13)

1. ✅ Valid store login → 200 + `gm_access` + `gm_refresh`
2. ✅ Valid admin login → 200 + cookies
3. ✅ Wrong password → generic 401
4. ✅ `/auth/me` with session → actor; without → 401
5. ✅ `gm_refresh` only (access expired/missing) → 200 + cookies renewed within the same request
6. ✅ Suspended store with a live session → immediate 403 `ACCOUNT_SUSPENDED`
7. ✅ Logout → revoke + cookies cleared
8. ✅ Malformed payload → 400 (Zod)

## Definition of Done

- [x] Contract implemented and scenarios 1–8 verified
- [x] IdP discrepancies documented in `integrations/agnostic-auth.md`
- [x] Scenarios automated (`test/sessions.test.ts`, TD-005 paid)
- [ ] JWT signature verification in dev and prod (TD-001)

---
status: in-development
stories: [US-S05]
domain: auth
updated: 2026-08-14
debt: []
---

# Spec: Store invitation redemption

> **Contract superseded 2026-08-15**: the auth implementation moved to
> Better Auth and [better-auth.spec.md](better-auth.spec.md) owns the
> contract now. This spec keeps its history and its scenario numbering,
> which the new spec and tests still cite.

The shopkeeper receives a WhatsApp/SMS link, opens `/invitation/$token`, sets their password, and lands ready to charge. This spec covers the **redemption half**; creating and sending invitations ships with the admin Stores task (US-A02), which will reference this contract.

## Decisions

- **D1 — Redemption is one screen, one step.** Token in the URL, new password, done — the user is signed in and lands on Cobrar. Discarded option: redeem first, then a separate login (an extra step for a user who just proved who they are).
- **D2 — Accepting also activates.** The store moves `invited → active` and the invitation `sent → accepted` in the same call. A store that set its password is operational; no separate activation step exists.
- **D3 — One generic failure.** Unknown token, already-accepted invitation, or IdP rejection all answer 400 `INVALID_TOKEN`. The screen says the same plain thing: ask your ISP to re-send the invitation. Detail would help an attacker more than a shopkeeper.
- **D4 — The offline notice ships here.** A banner in the tab layout when the browser loses connection ("Sin conexión…"). Counter reality: mobile data drops mid-shift; the shopkeeper must know why nothing loads.
- **D5 — The suspended screen keeps generic contact copy.** The schema has no ISP contact info yet; when the admin Settings task adds it, the screen upgrades.

## Contract

`POST /auth/store/accept-invitation` — body `{ token, password: ≥8 }` (no session)

- 200: `{ type: "store", id, name }` + session cookies (signed in, D1)
- Effects: store gets the password hash and `status: active`; the invitation flips to `accepted` (D2)
- 400 `INVALID_TOKEN` for every failure shape (D3) · 400 validation

Flow: `token` → IdP `/auth/verify` → identity (phone) → invitation row by token in `sent` → its store → `/auth/hash` the new password → updates → cookies.

## UI Contract

- `/invitation/$token` lives outside the session guard (like `/login`). Password + confirmation, plain es-MX copy, 48px targets.
- Success → straight to `/` (Cobrar), signed in.
- `INVALID_TOKEN` → "Este enlace ya no sirve. Pídele a tu ISP que te envíe una invitación nueva."
- Offline banner: visible in the tab layout whenever the browser reports no connection; disappears on reconnect.

## Scenarios

1. Valid token + password → store active with the new hash, invitation accepted, session cookies (US-S05)
2. Unknown token, accepted invitation, or IdP rejection → 400 `INVALID_TOKEN` (D3)
3. Short password → 400 validation
4. UI: the form submits and lands on Cobrar, signed in (US-S05)
5. UI: `INVALID_TOKEN` shows the plain re-send message
6. UI: the offline banner appears when the connection drops and leaves when it returns (D4)

## Definition of Done

- [x] Scenarios 1–3 automated in the API layer (`test/store-invitation.test.ts`, 3 tests)
- [x] Scenarios 4–6 automated with Testing Library + MSW (`test/special-states.test.tsx`, 3 tests)
- [ ] Real end-to-end (create → send → redeem). No longer blocked — US-A02
      shipped and both apps deploy to dev; this now waits on someone running it
      against the deployed pair with a real phone (`admin/stores.spec.md` has
      the same check from the other side).

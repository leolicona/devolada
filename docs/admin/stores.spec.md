---
status: in-development
stories: [US-A02, US-A03]
domain: admin
updated: 2026-08-14
debt: [TD-003]
---

# Spec: Stores management

The Tiendas section: register stores, send invitations, watch balances with cap alerts, and manage each store — commission, cap, suspend, ledger. This closes the invitation loop that `auth/store-invitation.spec.md` left open, and it applies the owner's configuration notes recorded in the build plan.

## Decisions

- **D1 — Registering a store requires a verified email.** `POST /stores` answers 403 `EMAIL_NOT_VERIFIED` for unverified ISPs — this enforces isp-signup's D3 ("verification gates operation") at its first real gate.
- **D2 — The invitation link is the product until TD-003 is paid.** Creation returns a copyable link (`<tienda>/invitation/<token>`); the ISP sends it by WhatsApp themselves. No fake "sent" state for a message nobody sent.
- **D3 — Re-send rotates the token in place.** One invitation row per store; re-sending replaces its token. After acceptance → 409 `ALREADY_ACCEPTED`. Two live tokens for one store is a door nobody needs open.
- **D4 — Balances arrive with the list, in one grouped query.** The table shows every store's balance (ledger SUM) with the cap booleans, same 80% rule as the cashbox — computed server-side, one owner.
- **D5 — `invited` joins the StatusBadge atom.** The store list needs "Invitación enviada" as a status; per the frontend law, missing statuses are added to the atom, never improvised per screen.
- **D6a — shadcn catalog usage** (refactor 2026-08-14): loading states are `Skeleton`; the list stays a list of link rows — rows navigate, and must collapse to cards on mobile (same reasoning as charge-feed D7).
- **D6 — Suspension is one switch on the detail.** `PATCH /stores/:id { status }` — the emergency stop from the owner's notes. The session middleware already makes it bite immediately (US-S03).

## Contract (ISP session only; tenant-scoped by `ispId`)

- `GET /stores` → `{ stores: [ { id, name, contactName, phone, zone, status, invitationStatus: "sent"|"accepted"|null, balanceCents, cap: { capCents, approaching, blocked } } ] }`
- `POST /stores` — `{ name, contactName, phone, zone?, commissionCents?, balanceCapCents? }` → 201 `{ store, invitationLink }` · 403 `EMAIL_NOT_VERIFIED` (D1) · 409 `PHONE_TAKEN`
- `GET /stores/:id` → the list shape + `commissionCents` (null = inherits the ISP base)
- `PATCH /stores/:id` — any of `{ commissionCents: number|null, balanceCapCents, status: "active"|"suspended" }`
- `POST /stores/:id/resend-invitation` → `{ invitationLink }` (rotated token, D3) · 409 `ALREADY_ACCEPTED`
- `GET /stores/:id/ledger?cursor=` → the same shape as the store's own `/ledger`
- Foreign store ids → 404. Store sessions → 403.

## UI Contract

- Tiendas list: name/zone/phone, `StatusBadge` (active / suspended / invitación enviada), balance with amber cap alert. "Nueva tienda" → `/stores/new`.
- `/stores/new`: form (name, contact, phone, zone, commission optional, cap with default) → success shows the **copyable invitation link** with the WhatsApp note (D2).
- `/stores/$storeId`: header with badges and balance · config card (commission with "hereda la base" hint, cap) · suspend/reactivate button · re-send invitation (while not accepted) · the store's ledger.
- Plain es-MX everywhere.

## Scenarios

1. POST creates an invited store with its link; unverified ISP → 403; duplicate phone → 409 (US-A02, D1)
2. GET lists stores with grouped balances and cap booleans; tenant isolation holds (D4)
3. PATCH edits commission/cap and suspends; re-send rotates the token; after acceptance → 409 (US-A03, D3, D6)
4. UI: the list shows a store with balance and status badge (US-A03)
5. UI: creating a store travels to the link screen with the copyable invitation (US-A02, D2)
6. UI: the detail suspends a store and re-sends an invitation (US-A03)

## Definition of Done

- [x] Scenarios 1–3 automated in the API layer (`test/stores.test.ts`, 4 tests)
- [x] Scenarios 4–6 automated with Testing Library + MSW (`apps/admin/test/stores.test.tsx`, 3 tests)
- [ ] Real invitation loop on the deployed apps: create → copy link → open on a phone → set password → charge

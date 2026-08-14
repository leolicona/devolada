# Architectural rules

Global rules no spec re-decides. Changing them requires updating this file in the same PR.

## Monorepo

```
apps/tienda   → Store mobile PWA (React + Vite + TanStack Router/Query, mobile-first)
apps/admin    → ISP dashboard (same stack, desktop-first)
apps/api      → Hono + Drizzle + Zod on Cloudflare Workers + D1
packages/ui   → Shared tokens and components (single visual source)
```

- pnpm workspaces. Frontend apps live on subdomains (`tienda.` / `admin.` / `api.devolada.app`).
- Code identifiers, docs and commits are written in English; **user-facing copy is es-MX** per the SPEC glossary.

## Money

- **Always integer cents** (`totalCents: 41500`). Floats never touch amounts.
- A single visible format via `formatMoney` / `<Amount>` from `packages/ui` (es-MX, `$1,234.00`, tabular-nums).

## Ledger (continuous cash box)

- The `ledger_entries` table is **append-only**: never UPDATE or DELETE. Corrections = counter-entries.
- A store's balance = `SUM(cents)`. No balance is ever stored; it is always derived.
- Entry types: `charge` (+total), `commission` (−store share), `cash_drop` (−amount handed over). No operating expenses (product decision).
- Cash drops are bilateral: the entry stays `pending` until the ISP confirms.

## Sessions & auth

- **Auth follows the Backend-for-Frontend (BFF) pattern — this is a law, not a preference.** `apps/api` is the BFF for both frontends: it alone talks to the IdP (Agnostic Auth), holds and refreshes tokens, and translates them into HTTP-only cookies. Frontends never store tokens, never call the IdP, never attach `Authorization` headers — they send cookies to the BFF and receive envelopes. Any future auth feature (invitations, OAuth, whatever) goes through the BFF or it's wrong.
- HTTP-only cookies `gm_access` (15 min) + `gm_refresh` (30 days); the browser never sees JWTs.
- `apps/api` is the only party that talks to Agnostic Auth (see `integrations/agnostic-auth.md`).
- The middleware checks **status in the DB on every request** — a suspended store or ISP loses access immediately (US-S03).
- Transparent refresh: if `gm_access` expired and `gm_refresh` is valid, tokens renew and the original request continues.
- Identical 401 whether the account exists or not: no leaking which phones/emails are registered.
- IdP configuration errors are never disguised as 401s.

## API

- Uniform envelope: `{ success: true, data }` | `{ success: false, error: { code } }`.
- Input validation with Zod at the edge (`@hono/zod-validator`); the Zod schemas are the contract.
- Latent multi-tenancy: `ispId` on every business table; the MVP UI does not expose it.
- `/dev/*` routes exist only with `ENVIRONMENT=dev`.

## Resilience

- A charge is **never rejected** because of WispHub failures (US-C04): it is recorded and the reconnection is queued with idempotent retries per charge.
- Reconnection statuses: `queued → reconnected | failed`. Failed ones demand visible intervention in the admin.

# Architectural rules

Global rules no spec re-decides. Changing them requires updating this file in the same PR.

## Monorepo

```
apps/admin    → ISP dashboard (React + Vite + TanStack Router/Query, desktop-first)
apps/pago     → Public payment page (no sessions, mobile-first)
apps/api      → Hono + Drizzle + Zod on Cloudflare Workers + D1
apps/consta   → Consta: SPEI validation engine — own Worker + D1
packages/ui   → Shared tokens and components (single visual source)
```

- pnpm workspaces. Surfaces live on subdomains of `devoladapago.com` (`admin.` / `pago.` / `api.` / `consta.`; the subdomain map is pivot D19). The store PWA (`apps/tienda`) was extracted to `devolada-red` (pivot D15, 2026-08-31).
- Code identifiers, docs and commits are written in English; **user-facing copy is es-MX** per the SPEC glossary.

## Code organization

Adopted 2026-08-14 (critical evaluation of FSD + resource-routes). New code is born with this shape; existing code migrates **lazily** — when a file is next touched, never as a big-bang.

### Backend (`apps/api`)

- **Resource routes**: `src/routes/<resource>/` with `index.ts` (pure router), `schema.ts` (Zod in/out), `handler.ts` (logic) — **when the resource has real logic**. Trivial routers (e.g. `dev`) stay single-file; the three-file split is a tool, not a dogma.
- **`schema.ts` is the shareable contract**: frontends derive types from it and MSW handlers validate against it (TESTING.md rule 5 becomes mechanical).
- **Adapters own the outside world**: `src/auth/` (IdP), `src/email/`, `src/integrations/<provider>/` — handlers orchestrate, adapters talk to third parties. No fetch to an external service outside an adapter. Operated systems sit behind the **provider port** (`docs/integrations/provider-port.spec.md`): an adapter implements `ProviderSource` (reads, synchronous in the reconciliation path) and `ProviderActions` (writes, through the dispatch ledger) and declares a static capability sheet; `providerFor(integration, env)` is the only way to obtain one, and the null provider is what a business with no integration gets. Nothing outside the adapter speaks a provider's API or vocabulary — rows, envelope and copy say `PROVIDER_*`.
- **Cross-resource invariants get their own module**: an invariant more than one resource writes lives in one module, never inline in handlers (the retired store ledger set the pattern: every write went through `src/ledger/`). Duplicated invariants are dead invariants.

### Frontend (`apps/admin`, `apps/pago`)

- **FSD-lite, not orthodox FSD**: one folder per route domain (`src/features/feed/`, `links/`, `settings/`, `auth/`) encapsulating screens + hooks + local components, plus `src/shared/` (API client, cross-feature utilities). No `entities/widgets` taxonomy — it breeds arbitration nobody performs solo.
- **Route files are dumb**: `router.tsx` wires params → feature components. No logic in routes.
- **Server state lives in TanStack Query only.** The cookie is the session; nobody mirrors it in memory.
- **Client-state manager: pre-approved, not installed.** When a *second* consumer of shared UI state appears, the tool is Zustand — until then the dependency does not exist. Server state never migrates into it.
- Import direction: features may import from `shared/` and `@devolada/ui`; never from another feature. Documented boundary (the AI reads this); lint enforcement only if drift appears.

### Design system (`packages/ui`)

- Primitives (`Button`, `Input`, `Field`) and domain atoms (`StatusBadge`, `Amount…`) are the only place visual patterns live; repeating a Tailwind recipe across surfaces instead of extracting it is drift.
- A component enters `packages/ui` when two surfaces need it; until then it lives in its feature.

## Money

- **Always integer cents** (`totalCents: 41500`). Floats never touch amounts.
- A single visible format via `formatMoney` / `<Amount>` from `packages/ui` (es-MX, `$1,234.00`, tabular-nums).

## Append-only money history (house rule)

- Any table that records money history is **append-only**: never UPDATE or DELETE. Corrections = counter-entries; balances are always derived with `SUM`, never stored.
- The rule was born with the store ledger (now in `devolada-red`) and stays the law here: the pivot's `credit_entries` and `platform_settings` (pivot spec, schema sketch) are its next instances.

## Sessions & auth

- **Auth follows the Backend-for-Frontend (BFF) pattern — this is a law, not a preference.** `apps/api` is the BFF for both frontends: it alone talks to the IdP (Agnostic Auth), holds and refreshes tokens, and translates them into HTTP-only cookies. Frontends never store tokens, never call the IdP, never attach `Authorization` headers — they send cookies to the BFF and receive envelopes. Any future auth feature (invitations, OAuth, whatever) goes through the BFF or it's wrong.
- HTTP-only cookies `gm_access` (15 min) + `gm_refresh` (30 days); the browser never sees JWTs.
- `apps/api` is the only party that talks to Agnostic Auth (see `integrations/agnostic-auth.md`).
- The middleware checks **status in the DB on every request** — a suspended ISP loses access immediately (sessions spec D2).
- Transparent refresh: if `gm_access` expired and `gm_refresh` is valid, tokens renew and the original request continues.
- Identical 401 whether the account exists or not: no leaking which phones/emails are registered.
- IdP configuration errors are never disguised as 401s.

## API

- Uniform envelope: `{ success: true, data }` | `{ success: false, error: { code } }`.
- Input validation with Zod at the edge (`@hono/zod-validator`); the Zod schemas are the contract.
- Latent multi-tenancy: `ispId` on every business table; the MVP UI does not expose it.
- `/dev/*` routes exist only with `ENVIRONMENT=dev`.

## Resilience

- A payment is **never rejected** because of WispHub failures (born as US-C04; the direct channel carries it): it is recorded and the reconnection is queued with idempotent retries per charge.
- Reconnection statuses: `queued → reconnected | failed`. Failed ones demand visible intervention in the admin.

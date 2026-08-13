# Information Architecture: Devolada

Two separate apps in the pnpm monorepo, with shared packages. Route paths are code and therefore English; visible labels are product copy in es-MX.

```
apps/tienda   → Store mobile PWA (TanStack Router, mobile-first)
apps/admin    → ISP dashboard (TanStack Router, desktop-first)
apps/api      → Hono + Drizzle + Zod API (Cloudflare Workers); integrates WispHub,
                Resend and Agnostic Auth (service binding)
packages/ui   → Shared components and tokens (shadcn/ui + Tailwind)
```

## Site Map

### apps/tienda (PWA)

- Charge (home) `/` — customer search; the initial screen IS the primary action ("Cobrar")
- Confirm & charge `/charge/$customerId` — minimum identity card + breakdown + charge button
- Charge result `/charges/$chargeId` — live status: reconnected / queued / failed
- Cash box `/cashbox` — current balance, accumulated commission, balance-cap notice ("Caja")
  - Record cash drop `/cashbox/drop` — suggested amount = full balance
- Ledger `/ledger` — the store's entries (charges, commissions, cash drops) ("Movimientos")
  - Entry detail `/ledger/$entryId`
- Login `/login` — phone + password (outside the tab layout)
- Accept invitation `/invitation/$token` — the shopkeeper sets their password arriving from the WhatsApp/SMS link

### apps/admin (ISP dashboard)

- Charges (home) `/` — live charge feed with reconnection status ("Cobros")
  - Charge detail `/charges/$chargeId` — customer, store, breakdown, folio, reconnection timeline
- Stores `/stores` — table with balances, cap alerts, status ("Tiendas")
  - New store `/stores/new`
  - Store detail `/stores/$storeId` — full ledger, balance, commission, cap, suspend
- Cash drops `/cash-drops` — pending confirmations (top) + history ("Entregas")
  - Drop detail `/cash-drops/$dropId` — confirm or dispute
- Settings `/settings` — WispHub API Key, service fee, commission split ("Configuración")
- Login `/login` — email + password
- ISP signup `/signup` — email + password; email verification via Resend
- Password recovery `/recover` — reset link via Resend

## Navigation Model

- **Primary navigation (store)**: 3 fixed bottom tabs — **Cobrar · Caja · Movimientos**. Never more than 3; the primary action always one tap away in the thumb zone.
- **Primary navigation (admin)**: sidebar with 4 sections — **Cobros · Tiendas · Entregas · Configuración**. A single level of depth; detail opens inside its section.
- **Secondary navigation**: none in the store. In the admin, contextual tabs inside the store detail (Ledger / Details) if content demands it; no third level.
- **Utility navigation**: store — store name and logout inside Caja (doesn't steal a tab). Admin — account and logout at the sidebar's foot.
- **Mobile navigation (admin)**: the sidebar collapses to a 4-icon bottom menu; tables collapse into cards. Confirming a cash drop from a phone must take two taps.
- **Badges**: the Caja tab shows a notice as the balance approaches the cap; the Entregas section shows a pending-count badge.

## Content Hierarchy

### Charge (store, home)
1. Search field (ID / phone / name) with keyboard open — the customer is queuing right there; zero taps before searching
2. Results with minimum identity data (name, zone, service status) — confirm verbally before charging
3. Balance-cap notice if applicable — the only allowed interruption, because it can block charges
4. Connection status (subtle) — if WispHub is down, note that charges will queue

### Confirm & charge (store)
1. Giant total amount ($415) — what the shopkeeper says out loud
2. Breakdown: monthly fee + service fee — transparency in front of the customer
3. Customer identity (name, zone, status) — last check before the money
4. Wide "Cobrar $415" button anchored at the bottom — impossible to miss; disabled if the cap blocks

### Cash box (store)
1. Current balance (the ISP's cash in the store) — the number that defines their responsibility
2. Accumulated commission — their earnings, reinforcing the model
3. "Registrar entrega" button + last drop status (pending/confirmed)
4. Balance-cap notices

### Charges (admin, home)
1. Live feed — the core promise to the ISP: watch the money come in in real time
2. Reconnection statuses highlighted (queued/failed on top or filterable) — what demands action or attention
3. Today's totals (charged, # transactions) — quick context
4. Filters by store/date/status

### Stores (admin)
1. Balance per store with visual cap alert — cash exposure is the risk datum
2. Status and recent activity per store
3. Actions: view detail, edit, suspend
4. New store creation

## User Flows

### Charge with reconnection (critical path)
1. Shopkeeper opens the PWA → Charge home with the search focused
2. Types ID, phone or name → results with minimum identity
3. Taps the customer → confirmation screen with amount and breakdown
   - If the service is active with no balance due → "Sin adeudo" notice, no charge button
   - If the balance cap blocks → disabled button + "Registra una entrega para seguir cobrando"
4. Confirms verbally with the customer → taps "Cobrar $415"
5. Result screen with live status:
   - WispHub responds → green "Pagado y reconectado" + folio; WhatsApp/SMS receipt sends itself
   - WispHub doesn't respond → amber "Pagado — reconexión en cola"; the ledger entry is created regardless
6. Taps "Nuevo cobro" → back to a clean search

### Queued reconnection (automatic recovery)
1. Backend retries against WispHub with backoff
2. On success → the charge's status flips to "Reconectado" in PWA and admin with no human action; receipt is sent/updated
3. If retries are exhausted → red "Fallido"; in the admin it surfaces at the top of the feed for manual ISP intervention

### Bilateral cash drop
1. Shopkeeper in Caja → "Registrar entrega" → suggested amount = full balance (editable downward)
2. Confirms → "pending" entry visible on both surfaces; the balance shows the committed amount
3. Physical cash handover (outside the system)
4. Admin in Entregas → reviews the amount → "Confirmar recepción"
   - If it doesn't match → "Disputar" with a note; the entry goes into dispute and both see the same ledger to resolve it
5. Confirmed → the store's balance goes down; the entry stays immutable in both histories

### ISP signup (admin)
1. ISP lands on `/signup` → email + password
2. Receives verification email (Resend) → confirms
3. First login → Settings asks for the WispHub API Key before operating
4. With the API Key validated → can register stores

### Store creation by invitation (admin)
1. Admin → Stores → "Nueva tienda"
2. Captures: name, contact, phone, zone, per-charge commission, balance cap
3. Saves → invitation is sent via WhatsApp/SMS to the store's phone
4. Shopkeeper opens the link → sets their password → ready to charge
5. Re-send invitation available on the store detail while it hasn't been accepted

### Store login
1. Opens PWA → with a valid (long) session → straight to Charge
2. No session → `/login` phone + password
3. Forgotten → the admin re-sends the invitation from the store detail to set a new password (no self-service in MVP)

## Auth & Session Model

Authentication is handled entirely with secure HTTP-only cookies issued by `apps/api`; the browser never sees a JWT. The API is the only party talking to **Agnostic Auth** (stateless IdP on Cloudflare Workers, via service binding).

- **Cookies**: `gm_access` (short-lived HS256 JWT, fast validations) + `gm_refresh` (long-lived, keeps the session alive). `Secure`, `HttpOnly`, `SameSite` — protected against session theft via XSS.
- **Middleware on every request**: verifies the token **and** the user's status in the database — a suspended store or admin loses access immediately even with a valid token.
- **Transparent refresh**: if `gm_access` expired but `gm_refresh` is valid, the API intercepts the request, mints new tokens with `/auth/refresh`, updates cookies and lets the original request continue. The user never sees an interruption.

Flow mapping to Agnostic Auth:

| Flow | Endpoints |
|------|-----------|
| Login (store and admin) | credentials → API reads hash+salt from DB → `/auth/verify-password` → cookies |
| ISP signup | `/auth/hash` stores hash+salt; email verification with `/auth/initiate` → magicLink sent via Resend → `/auth/verify` |
| Store invitation | `/auth/initiate` (identity = phone) → magicLink via WhatsApp/SMS → `/auth/verify` on open → password set with `/auth/hash` |
| Admin password recovery | `/auth/initiate` → link via Resend → `/auth/verify` → new password |
| Logout / revoke | `/auth/token/revoke` + cookie cleanup |

UX implications the design must honor:

- There is no "session expired" screen in normal operation; only if `gm_refresh` expires or is revoked does the user return to `/login`.
- The PWA needs a **suspended account** state (full screen, with the ISP's contact) — it can appear mid-shift if the admin suspends the store.
- Invitation and email verification share the same magicLink pattern: the `/invitation/$token` screen and the ISP's verification are variants of the same token-redemption component.

## Naming Conventions

| Concept | UI label (es-MX) | Notes |
|---------|------------------|-------|
| Customer payment transaction | **Cobro** | The store charges; "pago" only on the end-customer receipt ("Tu pago fue recibido") |
| Store's continuous balance | **Caja** / **Balance** | "Caja" names the section; "balance" the number. Never "corte" |
| Cash drop to the ISP | **Entrega** | Familiar, no anglicism in UI. Statuses: pendiente / confirmada / en disputa |
| Fee the end customer pays | **Cargo por servicio** | Visible in breakdown and receipt |
| Store's earnings | **Comisión** | Only in store/admin contexts, never shown to the end customer |
| Ledger entry | **Movimiento** | Types: cobro, comisión, entrega |
| ISP's customer | **Cliente** | The shopkeeper is **la tienda**; the ISP is **admin** internally |
| MikroTik reactivation | **Reconexión** | Statuses: reconectado / en cola / fallido |
| Receipt | **Comprobante** | With a unique **folio**; never "ticket" or "recibo" |
| Store's initial access | **Invitación** | WhatsApp/SMS link to the phone; statuses: enviada / aceptada |

## Component Reuse Map

| Component | Used on | Behavior differences |
|-----------|---------|---------------------|
| Bottom-tab layout | store: Charge, Cash box, Ledger | Login sits outside the layout |
| Sidebar layout | admin: the 4 sections | Collapses to a bottom menu on mobile |
| Charge status badge | Result (store), Ledger, feed and detail (admin) | Same `packages/ui` component: color + icon + text |
| Ledger entry list | Ledger (store), store detail (admin) | Admin adds filters and export; same base row |
| Customer identity card | Search results and confirmation (store), charge detail (admin) | Admin may show more fields than the shopkeeper |
| Amount breakdown | Charge confirmation, result, receipt, detail (admin) | Single source of amount formatting |
| Cash drop card/row | Cash box (last drop), Cash drops (admin) | Admin adds confirm/dispute actions |
| Access form | Both logins, admin signup, store invitation | Store: phone + password; admin: email + password; same visual base |

## Content Growth Plan

- **Charge feed (admin)**: grows without bound → cursor pagination, filters by store/status/date range. Post-MVP: search by customer/folio.
- **Ledger (store)**: grows per store → infinite scroll grouped by day; the balance lives in Cash box and doesn't depend on loading full history.
- **Stores (admin)**: dozens in the pilot → simple table without pagination; the design must not break at 200 rows (future multi-tenancy).
- **Cash drops**: pendings always on top and bounded; history paginated.
- **Settings**: fixed in MVP; grows with multi-tenancy (would become per-ISP settings) — which is why it's its own section, not a modal.

## URL Strategy

- Pattern: `/section/$id` — flat, at most two segments; details use IDs, not slugs (operational data, not content)
- Dynamic segments: `$customerId` (WispHub ID), `$chargeId`, `$storeId`, `$dropId`, `$entryId` (own IDs)
- Query parameters: admin lists only — `?store=`, `?status=`, `?from=&to=`, `?cursor=` (URL-shareable filters)
- The two apps live on separate subdomains (e.g. `tienda.devolada.app` and `admin.devolada.app`); routes carry no role prefix

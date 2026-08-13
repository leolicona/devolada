# Design Brief: Devolada

A network of payment points in neighborhood corner stores for ISPs running WispHub. MVP with one pilot ISP and two surfaces: a **mobile PWA for the store** (charging) and a **web dashboard for the ISP/admin** (oversight and reconciliation).

## Problem

**For the ISP's customer:** their internet was cut off for non-payment and there is nowhere nearby to pay. Paying means waiting for the collector or traveling, and even after paying, reconnection depends on someone at the ISP touching the MikroTik.

**For the shopkeeper:** they want extra income without investing or learning a complicated system. They charge with customers queuing at the counter; any confusing screen or extra step costs them time and credibility with their neighbor.

**For the ISP:** they lose customers and person-hours on field collection and manual reconnections. They don't know in real time who paid or how much of their cash is out on the street.

## Solution

A counter charging experience in three steps —find the customer, confirm identity and amount, charge— where reconnection happens on its own within seconds and the receipt arrives via WhatsApp/SMS. The store operates a **continuous cash box**: it sees how much of the ISP's cash it holds, how much commission it has earned, and records cash drops whenever convenient. The ISP watches every charge appear live, confirms cash drops and manages its stores without touching the database or the router.

## Experience Principles

1. **Certainty over speed** — Never leave doubt about what happened to the money. Every transaction ends in an unambiguous state (charged + reconnected, charged + reconnection queued, failed) with redundant color, icon and text. A charge is never rejected because of WispHub failures: it is recorded and the reconnection retries with visible status.
2. **Counter first** — The PWA is designed for a cheap Android, sunlight, hurry and a queue of customers. Giant amounts, large touch targets, at most 3 steps per charge, zero technical jargon. If the shopkeeper needs training, we failed.
3. **The ledger is the truth** — Every money movement (charge, self-collected commission, cash drop) is an immutable entry visible to both sides. The interface never shows a number that can't be explained by tapping it: every balance breaks down into its entries.

## Aesthetic Direction

- **Philosophy**: Functionalist (Dieter Rams) with a warm accent. "Less but better": color as information —green = charged/reconnected, amber = queued/pending, red = suspended/failed—, nothing decorative without function. Clinical coldness avoided through a warm accent and plain Mexican Spanish copy.
- **Tone**: Serene confidence. Solid and unambiguous, yet approachable for a non-technical user. Statuses are understood at a glance.
- **Reference points**: Clip and Mercado Pago Point for the charge flow (protagonist amounts, unambiguous confirmations, 2–3 steps); Stripe Dashboard for the ISP side (transaction feed, clean tables, impeccable data hierarchy).
- **Anti-references**: WispHub and traditional ERPs (dense forms, endless menus, administrative-system aesthetics); corporate banking apps (coldness, legal language, security friction that gets in the way at the counter).

## Existing Patterns

New project, no prior code. There are no tokens, components or conventions to respect. Tokens are created in phase 4 of this flow.

- Typography: defined in tokens (clean sans-serif, strict scale, tabular numerals for amounts)
- Colors: defined in tokens (neutrals + one functional accent + green/amber/red semantics)
- Spacing: defined in tokens (4px/8px base scale)
- Components: shadcn/ui base over Tailwind; every domain component is new

## Component Inventory

| Component | Status | Notes |
| --------- | ------ | ----- |
| Customer search | New | Single input (ID/phone/name) with minimum-identity results |
| Customer confirmation card | New | Name, zone, service status, monthly fee + service fee breakdown |
| Charge screen | New | Giant amount, large confirm button, fee breakdown |
| Transaction status | New | Charged/reconnecting/queued/failed; redundant color + icon + text |
| Cash box balance (store) | New | Current balance, accumulated commission, record-cash-drop button |
| Ledger entry list | New | Immutable entries: charge, commission, cash drop; shared between PWA and dashboard |
| Cash drop record/confirmation | New | Bilateral: store records, admin confirms; pending state in between |
| Live charge feed (ISP) | New | Real-time transactions with reconnection status |
| Store table with balances (ISP) | New | Balance per store, balance-cap alert, actions |
| Store creation/editing (ISP) | New | Details, phone, agreed commission, balance cap |
| Store login (phone + password) | New | Long device session; initial access via WhatsApp/SMS invitation where the password is set |
| Admin signup/login (email + password) | New | Self-service ISP signup; verification and recovery by email via Resend |
| Receipt (WhatsApp/SMS template) | New | Unique folio, breakdown, reconnection status |
| Suspended account screen | New | Full-screen state in the PWA with the ISP's contact info; can appear mid-shift |
| Magic-token redemption | New | Shared base: store invitation, email verification and password recovery |

## Key Interactions

- **Charge (critical path)**: search → tap result → verbally confirm identity and amount → "Cobrar $415" button → result screen with live reconnection status (spinner → green "Reconectado" or amber "En cola, se reconectará automáticamente"). The receipt sends itself; the shopkeeper decides nothing extra.
- **Queued reconnection**: if WispHub doesn't respond, the charge is recorded anyway and the status is visible in the PWA and dashboard; once resolved, the status transitions to green with no user action.
- **Bilateral cash drop**: store records a drop (suggested amount = balance) → "pending" entry visible to both → admin confirms on receipt → balance goes down. Disputes are resolved by looking at the same ledger.
- **Balance cap**: approaching the cap, the PWA shows a persistent notice ("Registra una entrega pronto"); once exceeded, the admin is alerted and, per configuration, new charges are blocked with a clear explanation.
- **Live feed (ISP)**: charges appear without refreshing; each row expands into detail (customer, store, breakdown, reconnection status, folio).

## Responsive Behavior

- **Store PWA**: mobile-first (360px floor). Single column, actions anchored to the bottom (thumb zone). On tablet/desktop it simply centers content at a max width; there is no alternate layout.
- **ISP dashboard**: desktop-first (tables and feed), but usable on mobile: tables collapse into stacked cards, the sidebar becomes a bottom/hamburger menu. Confirming a cash drop from a phone must be comfortable.
- Both surfaces: light + dark. Dark is not color inversion: warm charcoal backgrounds, semantics recalibrated for contrast.

## Accessibility Requirements

- Minimum AA contrast (4.5:1 normal text, 3:1 large text) in both themes; amounts and statuses target AAA.
- Color is never the only channel: every status carries icon + text.
- Touch targets ≥ 48px in the PWA; critical charge-path buttons larger.
- Full keyboard navigation and visible focus in the dashboard.
- `aria-live` for the live feed and reconnection status transitions.
- es-MX language, plain wording; amounts formatted `$1,234.00` with tabular typography.

## Out of Scope

- Multi-tenancy (multiple-ISP onboarding, data isolation): the schema leaves room, the UI doesn't expose it.
- Operating expenses in the store ledger.
- Partial amounts or advance-month payments: exact monthly fee + service fee only.
- Bank integration to verify cash-drop transfers (confirmation is manual and bilateral).
- ISP reports and analytics (trends, comparisons): post-MVP.
- Thermal ticket printing.
- Automatic invoicing of the platform's commission to the ISP (settled monthly outside the system, with the ledger as the source).
- End-customer app or portal: their experience is in-person + WhatsApp/SMS receipt.
- Self-service password recovery for stores: the admin re-sends the invitation from the store detail.

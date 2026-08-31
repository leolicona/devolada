# Design brief — the SaaS (pivot phase 2)

Second design cycle. The first one (store network) left with `devolada-red`;
this brief covers the surfaces the pivot builds (platform/pivot.spec.md).
The tokens in `packages/ui/src/styles/tokens.css` are inherited unchanged —
they were product-agnostic on purpose — and FRONTEND.md remains law.

## The product, in one line

The oracle of truth for SPEI payments: a business shares a permanent payment
link, the customer transfers to the business's own CLABE, the platform proves
the transfer against Banxico and reconciles it — and, through an integration,
the business's own system acts on the verdict.

## Who uses it

| Person | Surface | What they need from the design |
|---|---|---|
| **Payer** (end customer) | `pago.` | Already designed and shipped (US-D01–D15 cycle). Untouched by this brief except where Cobros appear on the link page (US-R04). |
| **Owner** | `app.` | Sets up the business in minutes (US-B01), sees money arriving with proof behind every row, trusts the oracle enough to hand it the keys (observation mode is the ramp). |
| **Admin** | `app.` | Everything the owner sees minus bank/credit controls (US-B03). |
| **Operator** | `app.` | The daily screen: payments, customers, proofs, retrying a failed action. No settings. |
| **Viewer** | `app.` | Read-only; exports. Never sees the API key or full bank data. |
| **Platform operator** (us) | `app.…/operador` | Edits global rules without a deploy; every change keeps author and date (US-L02). |

## Design principles (inherited + new)

1. **Tokens are law; functionalist with a warm accent** — unchanged
   (FRONTEND.md). Color = information; status is never color alone.
2. **Evidence-first.** The product's whole promise is proof. Every confirmed
   payment shows *why* it is confirmed (CEP data, one tap away — US-R03);
   every class (exacto/corto/excedente) shows the two numbers that produced
   it. A verdict without its evidence is decoration.
3. **Calm by default, loud only for money at risk.** The pago page's D12
   philosophy (the wait is normal until it is not) extends to the dashboard:
   credit warnings escalate in two steps (20% → 0 → paused), never a wall of
   red.
4. **The blame lands on the right desk.** When validation pauses for lack of
   credit, the payer-facing copy says the business must act, never that the
   payer failed (pivot D6). When an integration action fails, the payment is
   still confirmed — the action row says what failed, separately.
5. **Roles hide, never tease.** A control the role cannot use does not render
   disabled — it does not render (US-B03). A viewer's screen is complete for
   a viewer.
6. **es-MX, glossary words only**: Pago (arrived), Cobro (expected), Saldo
   (prepaid credit), Recarga, Integración, Modo observación. "Cobro" for
   money already received is a bug.

## Tone of voice

Same voice as the pago page: plain, concrete, in pesos, no jargon. The
dashboard may use slightly more technical vocabulary than the payer page
(CLABE, CEP) because its user chose this tool — but "clave de rastreo" is the
ceiling; "tracking key", never.

## Constraints

- Desktop-first for `app.`, usable on a phone (FRONTEND.md Admin section
  stands: tables → cards, sidebar → bottom bar, ≤5 nav sections).
- `pago.` keeps its 360px floor and stays out of this cycle's scope.
- Light + dark from day one; contrast-lint and the axe pass keep running.
- Every new screen ships with its states: loading, error-with-retry, empty
  (US-P01 rule — a failed list never claims to be empty).

## What is deliberately NOT designed yet

Manual Cobros / CSV / API (pivot D2, deferred) · one-off links (D3) ·
webhooks panel (D17) · the brand rename (none — the SaaS keeps Devolada,
D19) · bank-statement import (D16). The IA leaves room for them; no screen
speculates about them.

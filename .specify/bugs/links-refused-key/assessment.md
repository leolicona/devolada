# Bug Assessment: the Links roster says "No pudimos cargar los links" for a key WispHub rejected — and offers a retry that cannot help

- **Slug**: links-refused-key
- **Created**: 2026-09-19
- **Source**: pasted text — carried out of `cobros-installation-fallback` ("Risks & Considerations", first item) at the product creator's request. No URL, so nothing was fetched and the URL trust policy did not apply.
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim)

> Path: /links (Links de pago). For the same cause as
> cobros-installation-fallback (the pilot's wisphub.io key refused by
> wisphub.net), the roster shows "No pudimos cargar los links" with a
> Reintentar that cannot help. `routes/direct-payments/handler.ts`
> `wisphubFailure` folds WISPHUB_AUTH_FAILED into WISPHUB_UNAVAILABLE, and
> LinksScreen.tsx:176 says the only 503 left is a stalled provider.

## Symptom

The ISP opens **Links de pago** and sees the failed-read block — *No pudimos
cargar los links* with **Reintentar** — for a key their WispHub installation
refused. Retrying re-sends the same key to the same installation.

Expected: the same door Cobros now shows — *WispHub rechazó la conexión…* with
a button to Integraciones and no retry — so the two daily screens tell one
story for one cause.

## Reproduction

The cause is the one measured in `cobros-installation-fallback` (row with
`installation = NULL` on dev, the dev-wide `WISPHUB_BASE_URL` gone in
`b0889e2`, the `.io` key refused by `.net`). From the refusal on:

1. `GET /direct-payments/links/roster` → `linksRoster`
   (`apps/api/src/routes/direct-payments/handler.ts:1088`) →
   `rosterForDisplay(actor.id, wisphubFor(integration, c.env), now)` →
   `listCustomersFull` → 401/403 → `WispHubError("WISPHUB_AUTH_FAILED")`.
2. `catch (e) { return wisphubFailure(c, e); }` (line 1138) — the helper at
   line 177 logs `e.code, e.message` and answers **`WISPHUB_UNAVAILABLE`** 503
   for every `WispHubError`.
3. `LinksScreen.tsx:173-176` documents the belief that the only 503 left is a
   stalled provider, and renders `ListError what="los links"` with Reintentar
   (line 229) for any error with no data.

Severity is **medium**, not high: the roster is a sharing convenience with a
CLABE-gated action, whereas Cobros is the daily "who owes me" answer; and
the wording defect is now the only defect — the data cause is the same row,
fixed once.

## Suspected Code Paths

- `apps/api/src/routes/direct-payments/handler.ts:177` — `wisphubFailure`,
  one helper for **four** call sites with two audiences:
  - `getLinkStatus` (~318) and the pay/proof path (~474) answer the **payer**;
  - `listLinks` (~1041) and `linksRoster` (~1138) answer the **panel**.
  The collapse is right for the payer — the rule two lines below
  ("only the enumerated codes travel to the customer") says an ISP's setup
  gap is not the payer's business — and wrong for the panel.
- `apps/admin/src/features/links/LinksScreen.tsx:173-176, 218-234` — the
  stale comment and the single failure branch. Note the roster's other setup
  state is already special: a business with **no** key gets its API links
  and no refusal (automated-collections-api FR-011, handler line ~1125), so
  "no key" and "refused key" will read differently here, and that is fine —
  one is "nothing to read", the other is "the read was refused".
- `apps/admin/src/features/cobros/CobrosScreen.tsx:239-290` — the recipe to
  mirror (already merged on this branch, commit `2bdc2c6`).

## Root Cause Hypothesis

**Confidence: high** — same chain as `cobros-installation-fallback`, traced to
the line. The one design point is the shared helper: the payer must keep
hearing one word, so the fix cannot simply change what `wisphubFailure`
returns.

## Proposed Remediation

**Preferred**:

1. *API*: give `wisphubFailure` an audience. `wisphubFailure(c, e, "panel")`
   answers `{ code: e.code }` (still 503); the default stays `"payer"` and
   keeps `WISPHUB_UNAVAILABLE`. The two panel call sites (`listLinks`,
   `linksRoster`) pass `"panel"`; the two payer sites are untouched. The
   comment on the helper states the split and cites this bug and the
   enumerated-codes rule. The log line already exists here.
2. *Admin*: in `LinksScreen`, when `roster.error?.code === "WISPHUB_AUTH_FAILED"`
   render the Cobros door — same `Alert variant="warning"` recipe, same
   sentence, same `/integrations/wisphub` button — in place of `ListError`,
   and above the rows if any are on screen (a refused key voids the "Sin
   conexión … última lectura" promise, as on Cobros). Fix the comment at
   173-176. Keep the search box and the header as they are.
3. *No data step*: the same row as the Cobros entry; setting it once fixes both.

**Alternatives**:
- *Two helpers* (`wisphubFailure` / `panelWisphubFailure`) instead of a
  parameter. Equivalent; the parameter keeps one log line and one place.
- *Also answer the API-channel links on a refusal*, as the no-key branch does.
  Tempting, but it changes what a failure shows, not only how it is worded —
  a product decision for its own spec, not a bug fix.

**Files likely to change**:
- `apps/api/src/routes/direct-payments/handler.ts`
- `apps/admin/src/features/links/LinksScreen.tsx`
- `apps/api/test/direct-payments-links.test.ts`
- `apps/admin/test/links.test.tsx`

**Tests to add or update**:
- API: roster with a 403 from `/api/clientes/` → 503 `WISPHUB_AUTH_FAILED`;
  the key absent from the body. And the payer side unchanged: a 403 on
  `GET /direct-payments/links/:token` still answers `WISPHUB_UNAVAILABLE`
  (pin the audience split so nobody "fixes" it later).
- Admin: `WISPHUB_AUTH_FAILED` on the roster → the door, no Reintentar, no
  "No pudimos cargar"; `WISPHUB_UNAVAILABLE` keeps the existing test.

## Risks & Considerations

- The payer routes go through the same helper; the default audience must be
  the payer so an omitted argument can never leak an ISP's setup state to a
  customer. The new API test on `GET /links/:token` is the guard.
- `listLinks` (`GET /direct-payments/links`) is not called by the admin today
  (grep); it is switched with the roster for consistency, at no risk.
- No schema, no migration, no new code on the wire — `WISPHUB_AUTH_FAILED`
  already exists in the adapter and in the feed's vocabulary.

## Open Questions

- none

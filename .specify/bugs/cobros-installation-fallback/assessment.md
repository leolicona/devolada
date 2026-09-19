# Bug Assessment: Cobros says "No pudimos cargar tus cobros en WispHub" for a key WispHub rejected — and offers a retry that cannot help

- **Slug**: cobros-installation-fallback
- **Created**: 2026-09-19
- **Source**: pasted text — `Path: /cobros`, message `"No pudimos cargar tus cobros en WispHub."` No URL supplied, so nothing was fetched and the URL trust policy did not apply.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim)

> Path: /cobros
> message: "No pudimos cargar tus cobros en WispHub."
> Task: Research and fix.

The section is the one the nav labels **Cobros**; its route is
`/payment-requests` (`apps/admin/src/router.tsx:90`) and its screen is
`apps/admin/src/features/cobros/CobrosScreen.tsx`.

## Symptom

The ISP opens Cobros and, instead of the list of who owes what, sees the
failed-read block — *No pudimos cargar tus cobros en WispHub* with a
**Reintentar** button. Pressing Reintentar shows the same block again.

Expected: the list, read live from WispHub. When it cannot be read, the screen
says *why* in a way the ISP can act on — a stalled provider is worth a retry; a
rejected key or a wrong installation is not, and needs a trip to Integraciones.

## Reproduction

Measured on the deployed **dev** environment (the one the connected ISP uses):

1. `integrations` on `devolada-db-dev` holds exactly one connected row. Its
   `installation` column is **NULL** (queried 2026-09-19, read-only, key not
   read). This is the ISP recorded in memory on 2026-09-18: 6,509 customers,
   signed in at **wisphub.io**.
2. Until 2026-09-18 that row worked because `apps/api/wrangler.jsonc` set
   `env.dev.vars.WISPHUB_BASE_URL = "https://api.wisphub.io/api"` — the
   "TEMPORARY" stopgap that pointed the whole dev platform at the pilot's
   installation.
3. Commit `b0889e2` (PR #215, *feat(007): the WispHub address belongs to the
   ISP, not to the platform*, merged 2026-09-18 13:12) **removed that binding
   from both `dev` and `prod`**. Merge to `main` deploys dev
   (`.github/workflows/deploy-dev.yml:65`, `wrangler deploy --env dev`), and
   PR #216 merged after it, so the running dev API has no `WISPHUB_BASE_URL`.
4. `wisphubFor(integration, env)` → `hostFor(null, env)`
   (`apps/api/src/wisphub/factory.ts:45`): no row choice, no env default →
   the catalogue default, **`https://api.wisphub.net/api`**.
5. A `.io` key is refused by `.net` — the very premise of feature 007. The
   adapter maps 401/403 to `WispHubError("WISPHUB_AUTH_FAILED")`
   (`apps/api/src/wisphub/client.ts:185`).
6. `listPaymentRequests` catches every `WispHubError` and answers
   `WISPHUB_UNAVAILABLE` 503, without logging what it caught
   (`apps/api/src/routes/payment-requests/handler.ts:92-96`).
7. The screen has one branch for anything that is not `NOT_CONFIGURED`:
   `ListError` with Reintentar (`CobrosScreen.tsx:281-287`). Retry re-runs
   steps 4–6.

The migration that added the column backfilled nothing, by design
(`apps/api/migrations/0031_integration_installation.sql`, schema comment
"null is a meaning, not a gap … resolves to the platform default"). The
feature's own payment record foresaw this exact coupling and left it open:
*"the binding leaving and the pilot's row being set must ship together"* …
*"The pilot's row has not been set"* — verdict **partial**
(`.specify/debt/wisphub-host-is-platform-wide/payment.md`). Its justification —
"production carries zero connected integrations, so nothing regressed by the
binding leaving first" — is true of prod and false of dev, where the pilot is
connected and the dev binding left in the same commit.

`[NEEDS CLARIFICATION: none — the chain is measured end to end except the
final 401/403 from api.wisphub.net, which is the documented premise of 007
and cannot be probed from this session (the pilot's key is not available to
it, nor should it be).]`

## Suspected Code Paths

- `apps/api/wrangler.jsonc` (commit `b0889e2`) — the dev `WISPHUB_BASE_URL`
  stopgap was removed in the same change that made the address per-row, with
  no row yet carrying one. **Root cause, operational**: the connected row's
  `installation` is NULL.
- `apps/api/src/wisphub/factory.ts:45-51` — `hostFor` resolves NULL + unset
  env to wisphub.net. Correct per 007 D5; it is doing what it says.
- `apps/api/src/routes/payment-requests/handler.ts:92-96` — collapses
  `WISPHUB_AUTH_FAILED` into `WISPHUB_UNAVAILABLE` and logs nothing. The
  sibling `wisphubFailure` in `routes/direct-payments/handler.ts:177` at least
  logs `e.code, e.message` first. **Code defect 1** (wire loses the
  distinction; **defect 2**: no log line to diagnose from).
- `apps/admin/src/features/cobros/CobrosScreen.tsx:239-254, 279-287` — one
  setup branch (`NOT_CONFIGURED` → "Conecta WispHub", linking to
  `/settings/direct-payment` with a comment that says the key lives in
  Configuración "today"; it lives at `/integrations/wisphub` since the
  integrations hub) and one catch-all failure branch with Reintentar.
  **Code defect 3**: a rejected key/installation gets the retry copy;
  **defect 4**: the connect link points at the wrong page.
- `apps/admin/src/features/feed/FeedScreen.tsx:56-60` — the panel already has
  the sentence for this case: *"WispHub rechazó la llave. Revísala en
  Integraciones."* Cobros does not use it.

## Root Cause Hypothesis

**Confidence: high.** Two things, in layers.

The *event* is operational: the pilot's integration row never chose an
installation, and the platform default it was silently riding moved from
wisphub.io (env binding) to wisphub.net (catalogue default) when 007 deployed
to dev. Their key is now sent to the wrong WispHub and refused. Fixing the row
— picking **wisphub.io** at `/integrations/wisphub` — restores Cobros without
any code change; 007's own task list names this as T036 and says it must be
done through the panel.

The *bug in the code* is that the product hid this from the ISP and from us.
An auth failure is a setup problem (client.ts:183 says so), yet Cobros words
it as an outage and offers a retry that can never succeed, while the API
throws the distinction away and writes no log line. 007 built a screen that
tells a valid-key-wrong-installation apart from a bad key; Cobros, the daily
screen, still cannot say "go there".

## Proposed Remediation

**Preferred** — two halves, one code and one data, and the code half is what
`/speckit-bug-fix` delivers:

1. *API*: let `WISPHUB_AUTH_FAILED` travel. In `listPaymentRequests`, answer
   `{ code: e.code }` — `WISPHUB_AUTH_FAILED` for a refusal, `WISPHUB_UNAVAILABLE`
   for everything else — keeping 503, and log `console.error("wisphub
   failure:", e.code, e.message)` before answering, as the direct-payments
   handler does. The message carries `status 401/403` or a timeout, never the
   key (FR-013 already holds this in the adapter).
2. *Admin*: give Cobros a second setup branch. On `WISPHUB_AUTH_FAILED` render
   a card in the shape of the `NOT_CONFIGURED` one — *WispHub rechazó la
   conexión. Revisa la instalación y la llave en Integraciones.* — with a
   button to `/integrations/wisphub`, and **no Reintentar**. The address goes
   before the credential in the sentence, as 007's screen does, because in
   the case at hand the key is fine. Move the `NOT_CONFIGURED` link to
   `/integrations/wisphub` too and drop the "phase 5" comment; the page exists.
   A background refetch that starts failing with `WISPHUB_AUTH_FAILED` while
   rows are on screen should show the setup card, not the quiet "Sin
   conexión" note — the note promises the last reading is still being
   refreshed, which a refused key makes untrue.
3. *Data, by the product creator*: open `/integrations/wisphub` on dev as the
   pilot business, pick **wisphub.io**, save. The PATCH re-tests against the
   installation being saved (`integrations/handler.ts`, FR-009) and the
   screen reports it. This also retires the "DNS-confirmed only" note on
   `wisphub_io` in `installations.ts` once the test answers — that edit is a
   one-line follow-up, not this fix.

**Alternatives**:
- *Backfill `installation = 'wisphub_io'` on the row by migration or a
  one-off SQL.* Immediate, but it writes a business's choice for them from
  outside the panel — 007 D6 chose no backfill on purpose, and T036 wants the
  panel path proven by the pilot. Reject unless the creator cannot reach the
  panel.
- *Restore the dev `WISPHUB_BASE_URL` binding.* Reopens the debt 007 just
  paid and breaks the demo tenant again. Reject.

**Files likely to change**:
- `apps/api/src/routes/payment-requests/handler.ts`
- `apps/admin/src/features/cobros/CobrosScreen.tsx`
- `apps/api/test/payment-requests.test.ts`
- `apps/admin/test/cobros.test.tsx`

**Tests to add or update**:
- API: a 403 from the facturas endpoint answers 503 with
  `WISPHUB_AUTH_FAILED` (`bug: cobros-installation-fallback`); scenario 7's
  500 keeps `WISPHUB_UNAVAILABLE`.
- Admin: `WISPHUB_AUTH_FAILED` renders the Integraciones card, with the link
  to `/integrations/wisphub` and without Reintentar; `NOT_CONFIGURED` now
  links to `/integrations/wisphub`; a background `WISPHUB_AUTH_FAILED` with
  rows loaded shows the card, not the "Sin conexión" note. Existing scenario 7
  (`WISPHUB_UNAVAILABLE` → Reintentar) stays.
- MSW/e2e stubs: none reference `/payment-requests` failure codes beyond the
  tests above (checked `tests/e2e/stubs.ts` by grep during assessment; verify
  in fix).

## Risks & Considerations

- **Same collapse elsewhere.** `routes/direct-payments/handler.ts:177`
  (`wisphubFailure`, serving the Links roster among others) also folds
  `WISPHUB_AUTH_FAILED` into `WISPHUB_UNAVAILABLE`, and `LinksScreen.tsx:176`
  states "the only 503 left is a provider that stalled". The pilot's `/links`
  is wrong in the same way today. Out of this bug's scope (the report is
  Cobros); log it as a follow-up or widen the fix if the creator prefers one
  vocabulary across both screens.
- **Prod is untouched**: zero integrations there (measured 2026-09-18), and
  the prod binding left in the same commit — the first prod ISP will choose
  their installation on connect, where the picker now lives.
- **The demo tenant (FastIsp, a `.net` key) on dev** should have come back to
  life with the binding gone (007 payment, "What remains" item 2). Not
  verified here.
- No migration, no schema change, no new error code — `WISPHUB_AUTH_FAILED`
  already exists on the adapter and in the feed's vocabulary.
- Nothing in the fix puts a key in a log line or on the wire.

## Open Questions

- [NEEDS CLARIFICATION: should the Links roster get the same "rechazó la
  conexión → Integraciones" branch in this fix, or as a separate entry?]

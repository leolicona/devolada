# Bug Assessment: a production store invitation points at a store app that was never deployed

- **Slug**: red-prod-not-deployed
- **Created**: 2026-10-03
- **Source**: pasted text from the product creator (quoted below). The URL in
  it is not a bug report but the failing link itself, on the product's own
  production host `red.devoladapago.com`. It was **not** fetched: the URL
  trust policy has no branch for it (host not on the safe list), and the
  evidence below made opening it unnecessary. Only a DNS lookup of the host
  was made — no HTTP request.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim)

> Al entrar a la URL
> https://red.devoladapago.com/invitacion/Hg6NJaP9ELXuXyc9DgAlQXS1iiTqy8r-RWwil0jraGg
> para aceptar la invitación de tienda falla.

- URL: `https://red.devoladapago.com/invitacion/<token>`
- Host: `red.devoladapago.com`
- Policy branch: not fetched (unrecognized host; the cause was found without it)

## Symptom

A shopkeeper who opens a store invitation issued in production never reaches
the store app: the browser cannot find the site, because
`red.devoladapago.com` has no DNS record and no Worker behind it. Expected:
the invitation screen (*"Bienvenido a Devolada, <tienda>"*) with the email and
password form.

## Reproduction

1. In the production panel (`app.devoladapago.com`), as a platform operator,
   create a store or send it a new invitation (*Puntos de pago* / operator's
   stores, spec 018 FR-004).
2. The API answers with
   `https://red.devoladapago.com/invitacion/<token>` — prod `RED_BASE_URL`,
   `apps/api/wrangler.jsonc:140`.
3. Open the link on any device: the browser reports the site cannot be
   reached (DNS name not resolved).

Measured 2026-10-03:

- `dig +short red.devoladapago.com` → empty (no record);
  `red.dev.devoladapago.com` and `app.devoladapago.com` resolve to Cloudflare.
- The account the deploys target — the repo variable
  `CLOUDFLARE_ACCOUNT_ID` = `devoladapago` (`714b01a4…`, set 2026-09-01;
  no environment overrides it) — holds `devolada-api`, `devolada-admin`,
  `devolada-pago`, `devolada-landing` and their `-dev` twins, plus
  `devolada-red-dev` (created 2026-10-01). **No `devolada-red`.** The
  account Devolada deployed to before 2026-09-01 (`liconadev`) has none
  either: only the old repo's `devolada-tienda-dev`, last deployed
  2026-08-31.
- The latest release, `v1.5.0` (2026-10-02, commit `1057c41`), deployed the
  prod API at 2026-10-03 00:22 UTC — the API that issues these links.

## Suspected Code Paths

- `.github/workflows/deploy-prod.yml:296-322` — the release builds and
  deploys admin, pago and landing (and the API above them). There is no build
  or deploy step for `apps/red`, so the `devolada-red` Worker, and with it
  the `red.devoladapago.com` custom domain (created by
  `custom_domain: true` on the first deploy, `apps/red/wrangler.jsonc`),
  never exist.
- `.github/workflows/deploy-prod.yml:335` — "What landed" loops over
  `api admin pago landing`: a release never reports red's version id, so a
  rollback would have nothing to point at.
- `.github/workflows/deploy-prod.yml:343-377` — the smoke test probes four
  hosts; `PROD_RED_URL` (already set in the repo variables, 2026-10-01) is
  never probed, so the release went green with the store app missing.
- `.github/workflows/rollback-prod.yml:36` — `options: [api, admin, pago, landing]`:
  red cannot be rolled back.
- `apps/api/wrangler.jsonc:140,146` — prod `RED_BASE_URL` and
  `ALLOWED_ORIGINS` already name `red.devoladapago.com`. The API side is
  ready; only the Worker is missing.
- `specs/018-cash-at-stores/tasks.md` **T066** (unchecked) — "Wire red into
  production": exactly the three workflow edits above, plus `PROD_RED_URL`
  (done). It carries a gate: *"Release only after T065's walk is clean"*,
  and **T065** (the walk of quickstart §3 on `red.dev.devoladapago.com`) is
  also unchecked.
- `CLAUDE.md:124` — says a `v*` tag deploys prod after stating that `main`
  deploys "all five Workers"; prod in fact deploys four. The doc is not
  wrong about dev, but it reads as if prod matched.

Not involved: `apps/red/src/features/auth/InvitationScreen.tsx` and
`apps/api/src/routes/store/handler.ts` (`previewInvitation`,
`acceptInvitation`). The request never reaches them.

## Root Cause Hypothesis

**Confidence: high.** Spec 018 shipped in two halves. The API half reached
production with `v1.5.0`: the operator can create stores and the API issues
invitation links on `red.devoladapago.com`. The store app half did not:
T066, the task that adds red to `deploy-prod.yml` and `rollback-prod.yml`,
is still open, on purpose — it waits for T065, the walk on dev. Nothing in
the product stops an operator from issuing a production invitation in the
meantime, so the first one sent points at a host that does not exist.

## Proposed Remediation

**Preferred**: close T065, then T066, then release.

1. T065 — walk quickstart §3 on `red.dev.devoladapago.com` (invitation →
   código → search → record → folio → reconnection) and record it in
   `specs/018-cash-at-stores/quickstart.md`.
2. T066 — in `deploy-prod.yml`, a "Build red (prod API baked in)" step with
   `VITE_API_URL="${{ vars.PROD_API_URL }}"` and a "Deploy prod red" step
   with `--config ../red/wrangler.jsonc --env prod`, logged with `tee` to
   `$RUNNER_TEMP/deploy-red.log`; `red` in the "What landed" loop; a
   `probe red "${PROD_RED_URL}"` line in the smoke test (the "four services"
   comment becomes five). In `rollback-prod.yml`, `red` in `options` and in
   the `case` that maps a service to its config.
3. A new `v*` tag on a green Deploy Dev commit. The first deploy creates the
   custom domain and its certificate; the smoke's 5-minute retry covers the
   race (production-launch D6).

The token in the report keeps working after the deploy if it is still
`sent` and younger than seven days (`INVITATION_DAYS`); otherwise the
operator re-sends the invitation, which replaces it (FR-004).

**Alternatives**:

- *Wire red now, walk after.* Do T066 without T065 because a shopkeeper is
  waiting. Cost: the first real shopkeeper becomes the walk; anything T065
  would have caught they meet first. This is the creator's call — the gate
  in T066 is theirs.
- *Stop the panel from issuing prod invitations until the app exists.* Not
  recommended: it adds a code path that only matters for a few days and
  disappears with T066.

**Files likely to change**:

- `.github/workflows/deploy-prod.yml`
- `.github/workflows/rollback-prod.yml`
- `specs/018-cash-at-stores/tasks.md` (T065, T066 checked with dates)
- `specs/018-cash-at-stores/quickstart.md` (T065's record)

**Tests to add or update**:

- The smoke probe on `PROD_RED_URL` *is* the test: the release fails red if
  the store app does not answer. No unit test can cover a missing Worker.
- `/speckit-bug-test` evidence: `dig +short red.devoladapago.com` resolves,
  `https://red.devoladapago.com/` answers 200, and an invitation link opens
  the invitation screen (the GET preview does not consume the token; only
  *Continuar* does).

## Risks & Considerations

- **Name collision with the old repo (T067) — low, after the account
  move.** `leolicona/devolada-red` still has its `Deploy Dev` and
  `Deploy Prod` workflows active (checked 2026-10-03; last run 2026-08-31),
  and they deploy Workers named like this repo's (`devolada-api`,
  `devolada-admin`, `devolada-pago`). But Devolada now deploys to a
  different Cloudflare account (the creator, 2026-10-03; the repo variable
  confirms it), the old repo shows no secrets — no token for that account —
  and its Workers live in the old one. A deploy from it cannot overwrite
  the store app. Turning the workflows off (T067) stays tidy, not urgent.
- **First custom-domain deploy** races certificate issuance; the smoke
  retries for 5 minutes, as with the other hosts.
- **Session cookies across subdomains**: red calls `api.devoladapago.com`
  from `red.devoladapago.com`; dev proves the same arrangement on
  `*.dev.devoladapago.com`, and prod `ALLOWED_ORIGINS` already lists red.
  T065's walk is where this is confirmed, not assumed.
- **Release scope**: the next tag also ships everything merged since
  `v1.5.0` (e.g. spec 019 Phase 8 work, if merged by then).

## Open Questions

- [NEEDS CLARIFICATION: is the invitation in the report still `sent` and
  inside its seven days? A read of `store_invitations` in production
  (by the token's SHA-256) would answer it; that read was not run.]
- [NEEDS CLARIFICATION: does the creator keep T066's gate (walk on dev
  first), or wire production now because this shopkeeper is waiting?]

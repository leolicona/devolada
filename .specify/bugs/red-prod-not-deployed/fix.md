# Bug Fix: a production store invitation points at a store app that was never deployed

- **Slug**: red-prod-not-deployed
- **Fixed**: 2026-10-03
- **Assessment**: ./assessment.md
- **Status**: applied — it takes effect on the next `v*` tag, which is the
  creator's act (production-launch D3)

## Summary

The release now builds and deploys the store app (`devolada-red` on
`red.devoladapago.com`), reports its version id, probes it in the smoke
test, and can roll it back. This is spec 018's T066. Its gate, T065's walk
on dev, was cleared by the creator on 2026-10-03.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `.github/workflows/deploy-prod.yml` | modified | *Build store app (prod API baked in)* with `vars.PROD_API_URL`; *Deploy prod store app* with `--config ../red/wrangler.jsonc --env prod`, logged with `tee` to `deploy-red.log`; `red` in *What landed*; a `probe red` line in the smoke test; "four services" becomes five |
| `.github/workflows/rollback-prod.yml` | modified | `red` in `options` and in the `case` (`--config ../red/wrangler.jsonc`); the header names `devolada-red`; "three assets Workers" becomes four |
| `specs/018-cash-at-stores/tasks.md` | modified | T065 and T066 checked, with date and findings |
| `specs/018-cash-at-stores/quickstart.md` | modified | §3 records the 2026-10-03 walk and its two findings |

## Diff Highlights

```yaml
- name: Build store app (prod API baked in)
  working-directory: apps/red
  run: VITE_API_URL="${{ vars.PROD_API_URL }}" pnpm build
- name: Deploy prod store app
  working-directory: apps/red
  shell: bash
  run: pnpm --filter @devolada/api exec wrangler deploy --config ../red/wrangler.jsonc --env prod 2>&1 | tee "$RUNNER_TEMP/deploy-red.log"
```

```sh
RED="${{ vars.PROD_RED_URL }}"
probe red   "${RED%/}"                     "/"       || failed=1
```

`PROD_RED_URL` was set as `https://red.devoladapago.com/`, with a trailing
slash; the other `PROD_*_URL` have none. It is trimmed so the probe asks
for `/`, not `//`.

## Tests Added or Updated

- None at the unit layer: a missing Worker cannot be seen from a test
  suite. The smoke probe on `PROD_RED_URL` is the guard: from the next
  release on, a store app that does not answer turns the release red.

## Local Verification

- `ruby -ryaml -e 'YAML.load_file(…)'` on both workflows → both parse; the
  `deploy` job lists *Build store app*, *Deploy prod store app*, *What
  landed* and *Smoke test* in that order.
- `bash -c 'RED="https://red.devoladapago.com/"; echo "${RED%/}/"'` →
  `https://red.devoladapago.com/`; with no slash, the same; empty stays
  empty, so the probe's "not set" warning still fires.
- Not run: the workflows themselves. Never deploy from a local machine; the
  proof is the next tag's run.

## Deviations from Assessment

- The trailing-slash trim on `PROD_RED_URL` was not foreseen by the
  assessment. It was found while wiring the probe.

## Follow-ups

- **Release**: `git tag vX.Y.Z origin/main && git push origin vX.Y.Z` once
  this is merged and Deploy Dev is green on that commit. The first run
  creates the custom domain; the smoke's 5-minute retry covers the
  certificate race.
- **The invitation in the report**: after the release it opens if it is
  still unused and under seven days old. Otherwise re-send it from
  *Tiendas* (FR-004), which issues a new link.
- **T065's two times** (SC-001, SC-002) were not taken. Take them on the
  first real collection, or on a second walk.
- **T067** (old repo's workflows off): no longer urgent. Devolada deploys to
  another Cloudflare account, and the old repo has no secrets (see the
  assessment's risks).
- `/speckit-bug-test slug=red-prod-not-deployed` after the release:
  `dig +short red.devoladapago.com` resolves, `/` answers 200, and an
  invitation link opens the invitation screen.

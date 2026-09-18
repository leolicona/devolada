# Bug Verification: the bank picker cannot be scrolled, so most banks are unreachable

- **Slug**: bank-picker-unreachable
- **Tested**: 2026-09-18
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The reproduction was exercised in a real browser, before and after: with the fix
reverted the popup opened 3,134px above the top of the window and had no scroll
container at all; with it applied the popup sits inside the window, scrolls, and
every name is reachable — by scrolling and, in three keystrokes, by typing. No
regression: 727 unit/component/API tests, 64 browser tests, every lint gate and
the build all pass.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix) | `git stash push SettingsScreen.tsx select.tsx && playwright test tests/e2e/bank-picker.spec.ts` | fail (as expected) | 3/3 failed — the defect, measured |
| Reproduction (post-fix) | `playwright test tests/e2e/bank-picker.spec.ts` | pass | 3/3 |
| New tests (component) | `pnpm --filter @devolada/admin test -- test/bank-picker.test.tsx` | pass | 9/9 |
| Regression: admin | `pnpm --filter @devolada/admin test` | pass | 190 tests, 21 files |
| Regression: every workspace | `pnpm -r --if-present test` | pass | 727 tests (api 436, admin 190, pago 51, ui 50) |
| Regression: browser layer | `pnpm exec playwright test` | pass | 64 tests |
| Passkey ceremony | `pnpm e2e:passkey` | not-run | needs a real wrangler API, D1 and the IdP; its one assertion on the picker was updated with the others and is covered by the browser layer's equivalent |
| Lint gates | `spec-lint`, `gen-banks --check`, `contrast-lint`, `pending-lint` | pass | CI order |
| Type-check | `pnpm -r --if-present typecheck` | pass | four workspaces |
| Build | `pnpm -r --if-present build` | pass | |

## Output Excerpts

Before the fix — the popup's own geometry, the defect stated as a number:

```
✘ the bank list is bounded by the window
    Expected: >= 0
    Received:    -3134          ← the list opens 3,134px above the window
✘ the list scrolls, and the end of the alphabet is reachable
    scrollHeight > clientHeight → false   ← nothing to scroll
✘ typing reaches a bank without scrolling at all
    locator.fill: Test timeout   ← the old control was not a field
```

After:

```
✓ the bank list is bounded by the window (805ms)
✓ the list scrolls, and the end of the alphabet is reachable (910ms)
✓ typing reaches a bank without scrolling at all (778ms)
  3 passed
```

Component layer:

```
✓ test/bank-picker.test.tsx (9 tests) 2551ms
  Tests  190 passed (190)
```

## Residual Risks

- The passkey journey (`pnpm e2e:passkey`) was not run here: it boots a real
  wrangler API, D1 and Chromium's virtual authenticator. Its single assertion on
  this picker moved from `toHaveText` to `toHaveValue` along with the component
  test that proves the same thing, and the browser layer exercises the same
  screen. It runs on merge to `main`, before the dev deploy.
- Only Chromium, as the browser layer is configured. The popup's height comes
  from Radix's collision handling, which is the same code path on every engine.
- `axe` in the component layer cannot answer contrast or target size on the new
  popup (happy-dom reports no layout, constitution IV). `contrast-lint` measures
  the palette and the picker introduces no colour of its own — it consumes
  `bg-well`, `text-ink` and `text-link` like every other surface.

## Recommendation

Close the bug — verified in a browser, before and after, with the failure
measured rather than assumed.

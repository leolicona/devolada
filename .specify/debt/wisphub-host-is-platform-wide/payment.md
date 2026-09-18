# Debt Payment: one WispHub address for every ISP at once

- **Slug**: wisphub-host-is-platform-wide
- **Checked**: 2026-09-18
- **Verdict**: partial
- **Paid by**: `specs/007-provider-address-per-isp/` (branch `claude/wisphub-production-requirements-tzycck`)

## Anchors

- `apps/api/wrangler.jsonc` — `env.prod.vars.WISPHUB_BASE_URL` — **gone**, with its comment.
  `env.dev.vars.WISPHUB_BASE_URL` — **gone** too, with the "TEMPORARY" comment that carried the
  dev half of the bill.
- `apps/api/src/env.ts` — the declaration is **present, deliberately**, and its warning is gone.
  FR-008 requires the platform to keep a *way* to name a default for businesses that record none;
  what it forbade was the override, and that is what left. The comment now reads as the second
  rung of `integration.installation` → this → wisphub.net, and says the intended state of both
  remote environments is unset.
- `apps/api/src/wisphub/client.ts` — `DEFAULT_BASE_URL` — **present, deliberately**, and no longer
  loose: it is exported and `test/installations.test.ts` asserts the catalogue's default entry
  equals it, so the two copies of that host cannot drift apart.
- The 11 construction sites of the shape `new WispHub(integration.apiKey, env.WISPHUB_BASE_URL)` —
  **gone**. All 11 go through `wisphubFor(integration, env)` (or, for the connection test alone,
  `wisphubAt(key, installation, env)`), both in `apps/api/src/wisphub/factory.ts`.
- `WispHubScreen.tsx` — *"WispHub rechazó esta llave. Revísala en tu panel."*, which the entry's
  Notes asked whoever paid this to reword — **gone**. Replaced by four outcomes that name the
  installation tried and, on a rejection, raise the address before the credential.

## Exit condition

> Confirmed paid when all three hold on the tree:
>
> ```
> grep -n "installation" apps/api/src/db/schema.ts                      # the column is declared
> grep -rn "new WispHub(" apps/api/src | grep -v wisphub/factory.ts     # no output
> grep -n "WISPHUB_BASE_URL" apps/api/wrangler.jsonc                    # no output
> ```

All three hold (output below).

The entry's fuller description of paying it has four steps, and the fourth is two things:
*"The prod binding comes back out of `wrangler.jsonc`, **and the pilot's address moves onto their
row**."* The binding is out. **The pilot's row has not been set** — that is a data action in the
deployed panel, not a change to this tree, and it could not be performed from the implementing
session. That is the one reason this verdict is `partial` rather than `verified`.

## Evidence

```
$ grep -n "installation" apps/api/src/db/schema.ts
406:    /* Which WispHub installation this business's key belongs to
417:    installation: text("installation"),

$ grep -rn "new WispHub(" apps/api/src | grep -v wisphub/factory.ts
(no output)

$ grep -n "WISPHUB_BASE_URL" apps/api/wrangler.jsonc
(no output)

$ grep -rn "WISPHUB_BASE_URL" apps/api/src | grep -v "src/env.ts"
apps/api/src/wisphub/factory.ts:30,35,50,61,72,73   — the resolution rule, and only there
apps/api/src/db/schema.ts:415                       — the column comment naming the fallback
```

The structural half of the debt is now enforced by a test rather than by discipline:

```
$ pnpm --filter @devolada/api exec vitest run \
    test/installation-isolation.test.ts test/installations.test.ts test/integrations-installation.test.ts
 ✓ test/integrations-installation.test.ts (11 tests) 1583ms
 ✓ test/installation-isolation.test.ts (4 tests) 551ms
 ✓ test/installations.test.ts (8 tests) 94ms
 Test Files  3 passed (3)
      Tests  23 passed (23)
```

- `installation-isolation.test.ts` — "no `new WispHub(` outside wisphub/factory.ts" reads the API's
  own sources and fails naming the file. It was checked against a deliberate regression
  (`new WispHub(...)` re-introduced in `routes/payments/handler.ts`) and failed as
  `expected [ '../src/routes/payments/handler.ts' ] to deeply equal []` before being reverted — so
  the guard is not vacuous.
- The same file drives two businesses on two intercepted origins through one reconnection sweep and
  asserts that neither installation was asked for anything belonging to the other. That is the
  behaviour the debt said was impossible while unpaid.

Whole gate, on the tree: `spec-lint` (66 files), `gen-banks --check`, `contrast-lint`,
`pending-lint`, workspace typecheck, workspace tests (751 passing), `pnpm e2e` (67 passing).

## What remains

Two operational steps, neither of them a change to this tree, and neither performable from the
implementing session:

1. **The pilot's row.** Their business must pick `wisphub.io` at `/integrations/wisphub` — through
   the panel, so the path an ISP uses is the path that gets proven
   (`specs/007-provider-address-per-isp/tasks.md` T036). Production carries zero connected
   integrations (measured 2026-09-18), so nothing regressed by the binding leaving first; the row
   is set when the pilot connects.
2. **FastIsp on dev.** The demo tenant has been failing by design since the dev stopgap landed.
   Removing it should restore them, and nobody has confirmed it against the deployed dev API (T038).

One thing the entry flagged is also still open and belongs to whoever performs step 1:
`api.wisphub.io` remains **DNS-confirmed only**. The probe that would retire the note could not be
made — this session's egress refuses `CONNECT` to both provider hosts with a `403`, and no pilot
key was available (`specs/007-provider-address-per-isp/research.md`, "T001 / T002"). The catalogue
entry ships carrying that note. One call with the pilot's real key answers it, and it should be made
before their row is pointed there.

The entry's closing advice stands: have the ISP regenerate their WispHub key once the test is done.

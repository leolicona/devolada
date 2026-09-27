---
slug: provider-url-defaults
status: open
kind: deliberate
severity: low
effort: hours
opened: 2026-09-27
---

# Technical Debt: apiCEP's address is written in code as its default

## What was traded

`APICEP_BASE_URL` is optional, and when it is unset the adapter falls back
to a URL written in code, `https://api.apicep.cloud`. The choice is
recorded on purpose — `env.ts`: "Overridable so the local sandbox … can
stand in for the provider. Unset → the real apiCEP." — and it kept the
deploy config short. What it gives up is constitution VIII's rule: "Base
URLs, model ids and feature switches are `vars`, never literals".

## Where it lives

- `apps/api/src/consta/provider/apicep.ts:15` — `const DEFAULT_BASE_URL =
  "https://api.apicep.cloud";`, the literal.
- `apps/api/src/consta/provider/apicep.ts::apiCepProvider` — `fetch(\`${env.APICEP_BASE_URL
  ?? DEFAULT_BASE_URL}/validate-transfer\`` falls back to it.
- `apps/api/src/env.ts:71` — `APICEP_BASE_URL?: string;`, whose comment
  says unset means the real provider.
- `apps/api/wrangler.jsonc` — no `APICEP_BASE_URL` in any `vars` block
  (local, `env.dev`, `env.production`).

## Interest

- The deploy config never says which provider an environment talks to: a
  reader of `wrangler.jsonc` cannot tell, and has to read the adapter.
- A new environment — a staging, or a preview that should never spend
  real credits — talks to the real provider unless someone remembers to
  set the var; with a real token planted, it spends the monthly quota.
- The code and the constitution disagree, which Governance says is never
  tolerated silently. The pattern also gets copied: spec 013's plan first
  gave its new `APICEP_STORAGE_ORIGIN` the same code default, and
  `/speckit-analyze` caught it (finding C2, 2026-09-27).

## Paying it

Set `APICEP_BASE_URL` = `https://api.apicep.cloud` in the `vars` of
`apps/api/wrangler.jsonc` (top level, `env.dev`, `env.production`), delete
`DEFAULT_BASE_URL` from `apps/api/src/consta/provider/apicep.ts`, and let
`env.ts` say what unset means the way VIII asks: no provider address → the
SPEI channel is unavailable, exactly as with no `APICEP_TOKEN` (the
adapter throws `PROVIDER_UNAVAILABLE` before any fetch, nothing billed).
Tests already pin the var (`apps/api/vitest.config.ts`). The other way to
pay it is to amend VIII so a provider's documented address may be a code
default — a decision, not a code change.

Confirm on the tree:

- `grep -n "DEFAULT_BASE_URL" apps/api/src/consta/provider/apicep.ts`
  finds nothing;
- `grep -n "APICEP_BASE_URL" apps/api/wrangler.jsonc` finds it once in
  each of the three `vars` blocks;
- `pnpm --filter @devolada/api test` is green.

**Trigger**: an environment beside local, dev and prod (a staging, a
preview that must not spend real credits), a second validation provider,
or the next amendment of Principle VIII — whichever comes first.

## Notes

- **WispHub is not the same case**, though the request named it: its
  `DEFAULT_BASE_URL` (`apps/api/src/wisphub/client.ts:10`) is the default
  entry of a compiled catalogue of WispHub installations, and the host is
  a per-business choice (spec `007-provider-address-per-isp`);
  `WISPHUB_BASE_URL` is local-only by design and both remote environments
  are meant to carry no value (`env.ts`). Its own open debt is
  `wisphub-host-is-platform-wide`. Recorded as found in the code, not as
  described.
- Found by `/speckit-analyze` of spec 013 (finding C2); spec 013 declares
  `APICEP_STORAGE_ORIGIN` in `wrangler.jsonc` instead and does not repeat
  the gap (`specs/013-cep-bundle-match/research.md` R16).

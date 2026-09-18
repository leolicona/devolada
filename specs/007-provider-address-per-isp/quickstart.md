# Quickstart: Provider Address per ISP

**Feature**: 007-provider-address-per-isp · **Date**: 2026-09-18

How to prove the feature works. Three stories, three checks, plus the release
step that pays the debt this feature was written to remove.

---

## Prerequisites

```sh
pnpm install
pnpm --filter @devolada/api db:migrate:local   # picks up the new column
pnpm --filter @devolada/api dev                # 8787
pnpm --filter @devolada/admin dev              # 5174
```

Seed a business: `curl -X POST localhost:8787/dev/seed` →
`demo@devolada.app` / `devolada123`.

**Note before you start**: local `wrangler dev` cannot reach the provider at
all — every fetch fails with workerd's opaque `internal error`
(archive, 2026-08-14). The local run proves the *screen*: the picker renders,
the choice saves, the resolved installation shows. Anything that must actually
reach the provider is proven by the suite (below) or against the deployed dev
API with a real key.

---

## US1 — An ISP connects on their own installation

1. Sign in, open `/integrations/wisphub`.
2. The screen offers a closed list: **wisphub.net**, **wisphub.io**, and
   **Pruebas (sandbox)** marked as a test.
3. Pick `wisphub.io`, paste a key, save.

**Expect**: the saved installation is shown beside the key's tail, with the
same prominence. The connection test reports against `wisphub.io` — it names
that label, whatever it found.

4. Now clear the choice (or check a business seeded before this feature).

**Expect**: the screen still says which installation is in use, and says it
was **assumed** rather than chosen. Nothing about the business changed.

**The zero-touch check** (FR-002, SC-006), the one worth doing on real data:

```sh
# every existing row reads null and resolves to the default
pnpm --filter @devolada/api db:migrate:local
sqlite3 "$(ls -t .wrangler/state/v3/d1/**/*.sqlite | head -1)" \
  "SELECT count(*), count(installation) FROM integrations;"
# expect: <n>, 0   — n rows, none with an installation, all still working
```

---

## US2 — A failed connection says which thing is wrong

Three failures, three different messages, each naming the installation tried.
Run them in the suite — they need a controlled provider:

```sh
pnpm --filter @devolada/api test -- test/integrations-installation.test.ts
```

**Expect** three distinct outcomes:

| Seeded | `outcome` | The screen must NOT say |
| --- | --- | --- |
| host does not answer | `INSTALLATION_UNREACHABLE` | anything about the key |
| host answers 403 | `KEY_REJECTED` | "revisa tu llave" as the only advice — it must raise the installation |
| reads pass, a permission is refused | `PERMISSION_MISSING` | that the connection is healthy |

And on success: `outcome: "OK"` with `verified` carrying the three reads and
`unverified` carrying the four writes (research D7). The screen states both —
a connection is not claimed to prove more than it proved.

**Always**: no response, no log line and no stored row contains the key
(FR-013). `grep` the test output for the fixture key; it must not appear.

---

## US3 — Two ISPs, two installations, at once

The check that matters is the **negative** one.

```sh
pnpm --filter @devolada/api test -- test/installation-isolation.test.ts
```

Two businesses, one on each of two intercepted origins. Confirm a payment for
each.

**Expect**:

- Each payment is registered on its own business's origin.
- The other origin receives **nothing at all** for that business — this is
  what catches a `new WispHub(...)` that escaped the factory.
- One origin failing queues only its own business's action; the other collects
  and reconnects normally.

**The structural check** behind it (research D4), cheap and worth keeping:

```sh
grep -rn "new WispHub(" apps/api/src | grep -v "wisphub/factory.ts"
# expect: no output
```

---

## Release: paying the stopgap

This feature exists to remove
`.specify/debt/wisphub-host-is-platform-wide`. It is not paid until the
bindings come out — **in the same release**, or the platform default silently
keeps overriding businesses that recorded nothing (research D5).

1. Set the pilot's row to its installation, in the panel or by one update.
2. Remove `WISPHUB_BASE_URL` from `env.dev.vars` and `env.prod.vars` in
   `apps/api/wrangler.jsonc`.
3. Confirm the demo tenant (`FastIsp`, a `wisphub.net` key) works on dev again
   — it has been failing by design since the stopgap landed.
4. Close the debt with `/speckit-debt-pay`, whose exit condition is already
   written:

```sh
grep -n "baseUrl\|installation" apps/api/src/db/schema.ts      # the column is declared
grep -rn "env.WISPHUB_BASE_URL" apps/api/src | grep -v env.ts  # only the factory
grep -n "WISPHUB_BASE_URL" apps/api/wrangler.jsonc             # no output
```

---

## Before implementing: one call nobody has made

The catalogue's `wisphub_io` host is **DNS-confirmed only**. No HTTP request
has verified that it serves the provider's API — this session's egress policy
blocks both hosts.

```sh
curl -i -H "Authorization: Api-Key <the pilot's key>" \
  "https://api.wisphub.io/api/clientes/?limit=1"
```

A `200` retires the note on that catalogue entry. Anything else and the entry
is wrong before it ships, and the pilot is no better off than today.

Worth the same trip (research D7): whether `OPTIONS /facturas/` differs for a
key with and without the invoice permission. If it does, three of the four
writes become verifiable and FR-011 can keep more of its original wording.

---

## Full gate, before the PR

```sh
node scripts/spec-lint.mjs
node scripts/gen-banks.mjs --check
node scripts/contrast-lint.mjs
node scripts/pending-lint.mjs
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm e2e
```

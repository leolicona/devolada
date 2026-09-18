---
slug: wisphub-host-is-platform-wide
status: open
kind: deliberate
severity: medium
effort: hours
opened: 2026-09-18
---

# Technical Debt: one WispHub address for every ISP at once

## What was traded

WispHub runs more than one installation. A tenant's API key is valid
only on its own: the pilot ISP signs in at `wisphub.io`, and
`api.wisphub.io` resolves to a different server (104.131.178.56) than
`api.wisphub.net` (192.241.208.217), which is what
`wisphub/client.ts` defaults to. The key is rejected on the wrong host
with a 401/403 — indistinguishable, to the adapter and to the panel,
from a key the ISP typed wrong.

The fix shipped here sets `WISPHUB_BASE_URL` in the **prod** wrangler
environment. That binding is platform-wide: it names one installation
for every production ISP simultaneously. It is correct today only
because production carries **zero** connected integrations (measured
2026-09-18: `businesses` 2, `integrations` 0), so it points nobody
anywhere they were not already going.

The cost while unpaid: the second ISP on a different installation cannot
be onboarded at all — not by a setting, not by a support call, only by
a deploy that moves the first ISP off their own host. Onboarding is also
a lie in the runbook: "paste your key" is really "paste your key **and**
your address", and only one of the two has a field.

**That cost is already being paid, on dev.** Dev names the pilot's host
too, so the pilot's key can be tried before a release tag carries the
same address to prod. The demo tenant FastIsp holds a wisphub.net key
and therefore fails there by design for as long as it lasts:
`WISPHUB_AUTH_FAILED` in the panel, and the every-minute sweep logging
the same against its queue. Every manual WispHub check on dev is
unavailable meanwhile. This is the debt with its bill visible rather
than deferred, and the strongest argument for paying it: with
`integrations.base_url` in place, both installations answer at once and
the swap never happens again.

The pilot's key is also a live credential — it creates invoices and
registers payments on their real billing system — and while dev is
flipped it is typed into an environment whose D1 the PR previews share.
Have the ISP regenerate their key in WispHub once the test is done.

## Where it lives

- `apps/api/wrangler.jsonc` — `env.prod.vars.WISPHUB_BASE_URL`, with the
  comment that explains why it is here rather than on the row.
- `apps/api/src/env.ts` — the binding's declaration and the same warning.
- `apps/api/src/wisphub/client.ts` — `DEFAULT_BASE_URL`, the fallback
  every caller gets when the binding is unset.
- Every construction site passes the env binding, never a per-business
  value: `git grep -n "new WispHub(" apps/api/src` — 9 call sites, all
  of the shape `new WispHub(integration.apiKey, env.WISPHUB_BASE_URL)`.

## What paying it looks like

The address moves next to the key, on the row that already holds it:

1. `integrations.base_url` (nullable text; null keeps `DEFAULT_BASE_URL`,
   so every existing row keeps its behavior with no backfill).
2. The 9 `new WispHub(...)` call sites read
   `integration.baseUrl ?? env.WISPHUB_BASE_URL`, so the binding degrades
   into a platform default rather than a platform override.
3. `/integrations/wisphub` grows the field beside the key, and
   `testKey()` uses the address being saved — a key tested against the
   wrong host is the exact failure this debt describes.
4. The prod binding comes back out of `wrangler.jsonc`, and the pilot's
   address moves onto their row.

Confirmed paid when all three hold on the tree:

```
grep -n "baseUrl" apps/api/src/db/schema.ts                    # the column is declared
grep -rn "env.WISPHUB_BASE_URL" apps/api/src | grep -v env.ts  # no bare binding at a call site
grep -n "WISPHUB_BASE_URL" apps/api/wrangler.jsonc             # no output
```

**Trigger**: the second ISP, or any ISP not on the installation the
prod binding names — whichever arrives first. Until then the shortcut
costs nothing that a single pilot can feel.

## Notes

- The panel's copy compounds this: a 401/403 renders as *"WispHub
  rechazó esta llave. Revísala en tu panel."*
  (`WispHubScreen.tsx:125`), which sends the ISP to check a key that is
  fine. Whoever pays this debt should reword that line — the address is
  now a second thing that can be wrong.
- `api.wisphub.io` was confirmed by DNS only; the session that logged
  this could not reach either host over HTTP (egress policy). The host
  string in `wrangler.jsonc` is unverified against a live call.
- Related: the connection test exercises `GET /clientes/` alone, so it
  proves one of the seven permissions the integration needs. Different
  problem, same screen, not logged here.

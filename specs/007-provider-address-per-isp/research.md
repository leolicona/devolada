# Research: Provider Address per ISP

**Feature**: 007-provider-address-per-isp · **Date**: 2026-09-18

Eight decisions. Each names what was chosen, why, and what was rejected.

---

## D1 — The row stores an installation **key**, never a URL

**Decision**: `integrations.installation` holds a short stable key
(`wisphub_net`, `wisphub_io`, `wisphub_sandbox`). The address is resolved from
a compiled-in catalogue. No URL is ever written to the database.

**Rationale**: three things fall out of it that a stored URL would cost.

1. **FR-005 becomes structural, not a validation rule.** A business row cannot
   name a destination outside the catalogue, because a key that is not in the
   catalogue resolves to nothing. There is no string to sanitise and no
   allow-list check to forget at one of the call sites.
2. **Constitution IV survives.** `vitest.config.ts` pins `WISPHUB_BASE_URL` and
   `test/setup.ts` throws if it moves, so that a developer's `.dev.vars` can
   never redirect a suite. A per-business *URL* would reopen exactly that hole
   through the database instead of through config. A per-business *key* keeps
   the set of reachable origins finite and compiled in.
3. **A wrong address is fixed by a deploy, not a data migration.** If the
   provider changes an installation's host, one catalogue line changes and
   every business on it follows.

**Alternatives rejected**:

- *Store the URL on the row.* Simplest to write, and it makes every one of the
  three points above someone's discipline rather than the shape of the data.
- *Store the URL but validate against an allow-list on write.* Same protection
  at write time, none at read time: a row written before the list tightened
  still resolves.

---

## D2 — The catalogue is a plain typed constant, not a generator

**Decision**: `apps/api/src/wisphub/installations.ts` — a frozen array of
`{ key, label, host, kind: "real" | "test" }`, hand-maintained, guarded by a
unit test rather than by a code generator.

**Rationale**: the obvious precedent is `banks.ts`, generated from
`scripts/banks.data.md` by `gen-banks.mjs` with a `--check` gate in CI. That
machinery exists because there are 97 banks from an external source that
changes without us. There are **three** installations, they change when the
provider adds a deployment, and the change is a one-line review either way.
A generator for three rows is ceremony that makes the feature look bigger than
it is.

FR-006 asks that the list "be verified automatically so it cannot drift
unnoticed". A test answers that as well as a generator does, and more
precisely: every key unique, every host `https` and inside the provider's
domain family, exactly one entry marked default, every `kind` set.

**Alternatives rejected**:

- *Mirror the banks generator.* Consistent with an existing pattern, but the
  pattern's reason (a large external dataset) does not apply. Revisit if the
  list passes roughly a dozen entries.
- *Put the catalogue in the database.* Makes it editable without a deploy,
  which is precisely what the closed-list clarification decided against.

---

## D3 — The catalogue is importable by the admin, so it imports no server code

**Decision**: `installations.ts` is pure data and pure functions. It is
exported from `@devolada/api` as `./installations` and imported by the admin
to render the picker. It imports nothing from `src/db`, `src/auth`, Hono or
Drizzle.

**Rationale**: the same rule `auth/role-matrix.ts` lives under, and for the
same reason — constitution V states it explicitly, because the admin imports
it. The picker needs the label and the `kind` badge; those are the catalogue's
job, and duplicating them in the frontend is the drift the architecture rule
exists to prevent.

**Alternatives rejected**:

- *Serve the catalogue from an endpoint.* A network round trip and a loading
  state for data that is compiled into both sides already, and it would let a
  stale client render a key the server no longer knows.

---

## D4 — One factory, so the rule is greppable

**Decision**: add `wisphubFor(integration, env)` in `apps/api/src/wisphub/`.
Every one of the 11 `new WispHub(...)` call sites goes through it. The
constructor stops being called directly outside that factory, and a test
asserts it (`grep`-shaped, like the role-matrix audit).

**Rationale**: FR-003 says every provider exchange is addressed to that
business's own installation. Eleven call sites each doing
`integration.baseUrl ?? env.WISPHUB_BASE_URL` is eleven chances to miss one,
and a missed one is a payment registered on the wrong ISP's system — the
failure SC-007 exists to make impossible. Constitution V asks that tenant
isolation be "auditable with grep"; one factory is what makes that true here.

**Alternatives rejected**:

- *Change the 11 sites in place.* Smaller diff, no new indirection, and it
  leaves the rule as a convention rather than a structure. The twelfth call
  site, written later, is the one that breaks it.

---

## D5 — The binding stops overriding and becomes the default

**Decision**: resolution order is `integration.installation` →
`env.WISPHUB_BASE_URL` → `DEFAULT_BASE_URL`. A business with no installation
recorded behaves exactly as today (FR-002), with no backfill.

**Rationale**: FR-002 requires zero-touch carry-over, and a nullable column
with this order gives it for free — every existing row reads as it did
yesterday. It also inverts the binding's meaning in the one way the spec asks
for: it stops being a platform override that no business can escape.

**Consequence to carry into tasks**: PR #212 set `WISPHUB_BASE_URL` in both
remote environments to the pilot's host as a stopgap, which is
`.specify/debt/wisphub-host-is-platform-wide`. When this feature lands, both
bindings come out and the pilot's row carries `wisphub_io` instead. That
removal is what pays the debt, and it must happen in the same release or the
default silently keeps overriding businesses that recorded nothing.

---

## D6 — Additive migration only

**Decision**: one migration, `ALTER TABLE integrations ADD COLUMN
installation TEXT` — nullable, no default, no backfill.

**Rationale**: the repo's standing rule, recorded in
`.specify/debt/retired-consta-key-column`: a per-PR preview applies migrations
to the live dev database while the deployed dev Worker keeps serving, and
Drizzle selects every declared column by name. Additive is safe under that;
anything else breaks the running dev API for the life of the PR.

---

## D7 — The connection test can prove the reads and must be honest about the writes

**Decision**: the test probes the three reads Devolada needs — the customer
list, the invoice list and the payment methods — and reports each. It does
**not** attempt the four writes (create invoice, register payment, set the
reactivation flag, create a payment promise), because every one of them has a
side effect on a real ISP's billing. The screen says plainly which permissions
were verified and which will first be exercised when a payment arrives.

**Rationale**: FR-011 as written — "MUST NOT be reported as healthy unless the
credential can perform every action Devolada will later take" — cannot be met
read-only. A write permission can only be proven by writing, and writing into
an ISP's live billing to test a key is worse than the problem.

`OPTIONS` was considered: the archive records it as "the real documentation"
for this provider, and it might reflect the key's permissions. Two things stop
it being the answer here. `OPTIONS /facturas/{id}/registrar-pago/` is recorded
as answering **500**, so the most important write has no OPTIONS to read; and
whether OPTIONS varies by key permission at all is unverified — this session's
egress policy blocks both provider hosts, so it could not be measured.

**This is a spec/plan gap and it is named rather than routed around**, per
governance. FR-011 should be amended to: *a connection is reported healthy only
when every permission that can be verified without a side effect passes, and
the screen states which permissions were not verified.* The verification of the
writes belongs with the first real payment, where the existing queue already
shows the outcome.

**Open, and worth one probe before implementing**: whether `OPTIONS /facturas/`
and `OPTIONS /clientes/` return different bodies for a key with and without the
matching permission. If they do, three of the four writes become verifiable and
FR-011 can stand closer to its original wording.

---

## D8 — Two origins in the suite, to prove the isolation

**Decision**: the API suite intercepts a second provider origin alongside the
pinned one, and US3's test asserts that two businesses on two installations
each reach their own and neither reaches the other's.

**Rationale**: constitution IV intercepts providers at their real origin, and
the pin in `vitest.config.ts` stays exactly as it is — it is the platform
default and D5 keeps it meaningful. A second `fetchMock` origin is additive
and does not weaken the pin: the catalogue (D1) bounds what any row can name,
so the suite still cannot be redirected somewhere unexpected by config or by
data.

The test that matters is the negative one. Asserting business A reaches origin
A is weak; asserting that origin B receives **nothing** for business A is what
would have caught a missed call site from D4.

---

## Carried, not resolved here

- **`getCustomer` resolves an identity through a search heuristic** and can
  read an existing customer as absent, filing the payment as though no debt
  existed. Assessed under `.specify/bugs/customer-lookup-misses/`; it is a
  bug on the lite path, not this feature's work. It touches
  `apps/api/src/wisphub/client.ts`, which this feature also edits, so the two
  should not be in flight in the same week.
- **The pilot's host is DNS-confirmed only.** `api.wisphub.io` exists and is a
  different server from `api.wisphub.net`, but no HTTP call has verified that
  it serves the provider's API. The catalogue's `wisphub_io` entry inherits
  that uncertainty until one request with a real key answers it.

---

## T001 / T002 — the probe, attempted 2026-09-18, **not made**

Both Phase 1 measurements were attempted from the implementation session and
**could not be run**. Recorded here rather than silently skipped, because the
catalogue's `wisphub_io` entry rests on what they would have answered.

```
$ curl -i "https://api.wisphub.io/api/clientes/?limit=1"
curl: (56) CONNECT tunnel failed, response 403

$ curl -o /dev/null -w "%{http_code}" "https://api.wisphub.net/api/clientes/?limit=1"
curl: (56) CONNECT tunnel failed, response 403
```

**Status code: none.** The request never left the session — the egress policy
refuses the CONNECT to both provider hosts, the same block D7 already records.
No pilot key was available here either, so even an open network would have
answered nothing about permissions.

What follows from that:

- **T003 ships the `wisphub_io` entry with its note intact.** The host stays
  DNS-confirmed only. This is not "a non-200" — nothing answered at all, so
  there is no evidence the entry is *wrong*, only none that it is right. The
  note is the honest record of that, and one real call retires it.
- **T002's question stays open**, so FR-011 keeps its amended wording (D7) and
  `testKey` verifies the three reads only. If `OPTIONS /facturas/` later proves
  to discriminate on the invoice permission, three of the four writes become
  verifiable and FR-011 can widen back.
- **The release still needs the call.** `quickstart.md` ("Before implementing")
  carries it, and it must be made with the pilot's real key from a machine with
  egress before T036 points their row at `wisphub_io`. A wrong entry leaves the
  pilot exactly where they are today.

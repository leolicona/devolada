# Research: consta-api-merge

**Feature**: 004 · **Date**: 2026-09-12 · **Phase**: 0

Every finding below was read out of the code on this branch, at `31c4c71`.
Where a number is given, it was counted with a command that can be run again.
The spec's three clarifications (internal only, start empty, able-not-on) are
taken as settled; this document resolves what they leave to the plan.

---

## R1 — The engine keeps its facade, so the callers change one line each

**Decision**: `apps/api/src/consta/` becomes the engine's home. Its entry
point keeps the shape the API already programs against — `validate(request)
→ ConstaVerdict`, `extract(…) → ConstaReading` — but is a function over
`(env, db, owner)` instead of a class over `(baseUrl, apiKey)`. The three
callers — `direct-payments/validation.ts`, `credit/topups.ts`,
`routes/direct-payments/handler.ts` — swap their constructor call and nothing
else.

**Rationale**: `client.ts` (215 lines) is already the seam. Every type the
callers read (`ConstaVerdict`, `ConstaReading`, `ConstaGate`, `ConstaTrust`)
is defined there and mirrors what the engine's route handler returns; the
handler's `data: { … }` object is, field for field, a `ConstaVerdict`. Turning
the route handler body into a function that returns that object, and the
client into the function that calls it, moves ~1,900 lines with their comments
intact and leaves the payment lifecycle untouched. The lifecycle is where the
money decisions live (D8 carve-outs, D17 not-found, the cross-check, the
provisional release); the fewer lines it loses, the fewer decisions can be
dropped by accident.

**Alternatives considered**: calling the engine's Hono app in-process with
`app.request(...)` (rejected — a fake network hop: JSON in, JSON out, an
Authorization header to satisfy, and the API-key table kept alive just to be
consulted by ourselves); rewriting the callers against the engine's internals
(rejected — the callers would then own the log-writing and the trust and
retry wiring that the handler currently owns, three copies of it).

---

## R2 — Attribution is a nullable `business_id`; NULL is the platform

**Decision**: `validations` and `extractions` gain `business_id TEXT NULL
REFERENCES businesses(id)`. A business's calls carry its id; a top-up —
the platform's own transaction (prepaid-credit D6) — carries NULL. Indexes:
`(business_id, created_at)` and `(business_id, customer_ref)`, the same two
the engine keys on today, with the business id in the key's place.

**Rationale**: the engine keys everything on `api_key_id` today, and the
API maps that key to a business by storing the key on the business row
(payments-and-classes D7). With the engine inside, the business *is* the
identity, and the top-up is the one caller that never had a business key —
it always validated under the platform's (topups.ts: "ALWAYS travels under
the platform's key — never the business's"). One nullable column says
exactly that. The trust block filters on it, so a platform row can never
enter a tenant's chains.

**Alternatives considered**: `owner_kind` + `owner_id` (rejected — two
columns and a discriminator for a reader that does not exist; the platform
has no trust block and no per-owner query); a synthetic "platform" business
row (rejected — a fake tenant that would show up in every business listing
and need excluding everywhere).

---

## R3 — Two reads stay cross-tenant, on purpose, and say so

**Decision**: `loadShapeRules` (proof-extraction D14) and `suggestRetryAfter`
(learned-retry D2) keep reading the whole `validations` table, exactly as they
do inside today's engine. Each carries a comment citing `consta-api-merge D4`
and the constitution's Principle V is amended to name them. Every other read —
the trust block, the audit joins — filters by `business_id`.

**Rationale**: both are statistics about *banks*, not about businesses. The
shape rule is derived from `(bank, clave)` pairs Banxico proved valid; the
retry cell is Banxico's publication latency per `(sender, receiver)` bank
pair. Neither returns a row; each returns a rule, and each gets *worse* when
partitioned by tenant — a bank's first customer at a new business would meet
silence for the ten samples the rule needs, when the product has already seen
a hundred. The engine has run them tenant-wide since they were written. What
changes is only that the constitution's "every business query filters by the
actor's business" now covers these tables, so the exception must be written
down rather than left to be discovered by a reviewer.

**Alternatives considered**: partitioning both by business (rejected —
measurably worse suggestions and rules for no tenant benefit; the columns
read are bank names, claves, amounts, dates and timestamps, none of which
identifies a business or a payer); moving the two statistics to a separate
"engine-wide" table (rejected — a second copy of the log to keep in step with
the first, which the engine's own law forbids: "every trust number is a SUM
over these at request time — no aggregate tables, ever").

---

## R4 — The payer's identity in the log is the link's own customer, undisguised

**Decision**: `customerRef` = the link's own customer identity —
`paymentLinks.customerUsuario` for a panel link; the caller's `customer_ref`
for a link created through `003-automated-collections-api`'s API, which makes
`customer_usuario` nullable and adds that column (its data-model, read
2026-09-16) — and `paymentRef` = `payments.id`, sent on every business
validation. No secret, no HMAC.
`consta/refs.ts` and `CUSTOMER_REF_SECRET` are deleted. Top-ups send neither,
as today.

**Rationale**: the HMAC existed for one reason, stated in `refs.ts`: "The
natural identifier … is recognisable, so it never leaves Devolada naked." It
no longer leaves Devolada. The validation row now sits in the same database
as `payment_links.customer_usuario`, three tables away; a disguise inside one
database protects nothing and costs a secret that, when absent, silently
loses history — the exact failure constitution VIII cites (BUG-010, "a
missing HMAC key that lost a month of payer history"). The trust layer's own
guidance (D1: "an identifier that means nothing outside their own database")
is satisfied by the usuario inside ours.

Nothing is migrated (spec Q2), so no old HMAC refs need to join new plain
ones. A caveat is recorded rather than hidden: the trust snapshot the release
shadow stores (`payments.trust_snapshot`, provisional-release D12) echoes
`customerRef` inside its JSON, so it will now hold the usuario. The same row
already holds it in the clear: `payments.customer_usuario` (`schema.ts:235`),
denormalised at confirmation. Nothing new enters the table.

**Alternatives considered**: keep the HMAC keyed on `BETTER_AUTH_SECRET`,
which is required in every environment (rejected — no purpose left to serve,
and rotating that secret would orphan every chain, coupling session signing
to payer history); key on `payment_links.id` (rejected — `003` introduces
one-time links, several per customer, and the chain must follow the person).

---

## R5 — The failure vocabulary on the row becomes the engine's own

**Decision**: `lastError` stops carrying the transport's codes
(`CONSTA_UNAVAILABLE`, `CONSTA_AUTH_FAILED`, `CONSTA_NOT_CONFIGURED`) and
carries the engine's: `PROVIDER_UNAVAILABLE`, `PROVIDER_RATE_LIMITED`,
`PROVIDER_AUTH_FAILED`, `REQUEST_REJECTED`, `RECEIPT_UNREADABLE`,
`READER_UNAVAILABLE`, `READER_UNREADABLE`, `PROOF_NOT_FOUND`,
`PROOF_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, and `PROVIDER_NOT_CONFIGURED`
for the absent credential — eleven, the same list contracts/engine.md carries. **Every one of them still rides the schedule**, exactly as every
Consta failure does today. The `/read` route's 503 becomes `READER_UNAVAILABLE`.

**Rationale**: measured in `client.ts`: the API never reads the engine's
`retryable` flag. Every non-OK answer becomes `CONSTA_UNAVAILABLE` and
`retryLater`; a 401 becomes `CONSTA_AUTH_FAILED` and also `retryLater`. So
"exactly as today" (FR-002, FR-011) means: every engine failure retries on
the schedule. That is preserved. What was lost at the HTTP boundary — *which*
failure it was — is now free to keep, and the row keeps it. No screen reads
`lastError` (grep across `apps/admin` and `apps/pago`: zero matches), and the
payment page ignores the `/read` failure code entirely
(`PaymentPage.tsx:447`: `catch {}` and fall through to the provider door).

**Deliberately not taken here**: honouring `retryable: false` to stop the
schedule early on `REQUEST_REJECTED`, `RECEIPT_UNREADABLE` or
`PROVIDER_AUTH_FAILED`. It would be an improvement — a same-bank transfer
today rides six hours to an honest expiry — but it changes when a payment
dies, which the spec's FR-002 forbids and which is a product decision of its
own. The in-process failure object carries `retryable` so that decision costs
one `if` when it is taken. Recorded, not routed around.

**Alternatives considered**: keeping the three `CONSTA_*` codes as aliases
(rejected — they would describe a hop that no longer exists, and SC-004
counts them to zero).

---

## R6 — The reader takes the file from storage; the provider still gets a link

**Decision**: the engine's receipt input names a proof key, not a URL. The
reader loads bytes from `env.PROOFS` (the R2 bucket both direct payments and
top-ups already upload to), sniffs the magic bytes and applies the 1 MiB
ceiling as today. When the file must go to the provider — a PDF
(proof-extraction D2) or the second-opinion cross with `providerOcr`
(reading-check D1) — the engine builds the short-lived signed URL itself
with `signedProofUrl` (direct-payment D12). The URL fetcher and its
address guard (`extraction/fetch.ts`, `isBlockedHost`, `redirect: "manual"`)
retire with the door they guarded. `GET /direct-payments/proofs/:linkId/:file`
stays, because apiCEP fetches through it.

**Rationale**: today the engine fetches the API's own signed URL over the
public internet to read a file the API already holds — and refuses `http:`,
so on a developer's machine (`API_BASE_URL=http://localhost:8787`) the
receipt door has never worked at all: the engine fetches the bytes *before*
deciding which door a file takes (proof-extraction D7), so a local upload
fails as `URL_NOT_ALLOWED` on the reader route and on the provider route
alike, and the payment rides the schedule to expiry. Reading from the bucket
removes the round trip and the local gap at once. The guard existed because integrators could pass any URL; with
no integrator there is no arbitrary URL. What the guard also did — refuse a
file that is not an image or a PDF, and refuse one over the ceiling — is a
property of the bytes, not of the URL, and stays.

**Alternatives considered**: keep `fetchProof(url)` and let the Worker fetch
itself (rejected — a self-request through the public edge, an `https:`
requirement dev cannot meet, and a test suite that must intercept the API's
own origin to feed it bytes); pass bytes from the caller (rejected — every
caller would re-implement the R2 read and the ceiling).

---

## R7 — The request guard stays, in-process

**Decision**: `validateRequestSchema` (Consta D12, D13, D17: bank vocabulary,
clave shape, same-institution refusal, one door at a time, opaque ref
length) moves as `consta/request.ts` and runs by `safeParse` before any
provider call. A refusal is a `REQUEST_REJECTED` failure carrying the issues,
and — as today's 400 — writes no row.

**Rationale**: the API's own payer schema enforces the clave shape and the
bank vocabulary (direct-payments/schema.ts, D16), but not the same-institution
rule (D17), and the sweep builds requests from stored rows, not from that
schema (`senderBank: payment.senderBank ?? ""`). The guard is the last line
that turns a request apiCEP would bill and answer with a faceless `invalid`
into a free refusal with a reason. It costs nothing to keep and its tests
move with it.

**Alternatives considered**: dropping it and trusting the payer schema
(rejected — two of its rules have no other home).

---

## R8 — Configuration: five secrets and a URL become one secret and a binding

**Decision**: the API gains `APICEP_TOKEN` (secret), `APICEP_BASE_URL` (var,
optional — unset is the real provider; the sandbox sets it),
`APICEP_DEADLINE_MS` (tests only), `EXTRACTION_MODEL` (var), and the `AI`
binding, in every environment block of `wrangler.jsonc`. It loses
`CONSTA_BASE_URL`, `CONSTA_API_KEY`, `CONSTA_ISSUER_TOKEN`,
`CUSTOMER_REF_SECRET`; Consta's own `CONSTA_ADMIN_TOKEN` goes with the
Worker. `speiAvailable` reads `APICEP_TOKEN` where it read the pair
`CONSTA_BASE_URL && CONSTA_API_KEY`.

Production gets the binding and the vars in this feature and **not** the
secret (spec Q3): the deploy-prod workflow gains the same guarded sync step
dev has, which warns and continues when `APICEP_TOKEN` is absent, and the
credential probe, which skips when there is nothing to probe.

**Rationale**: `env.ts` is the contract for "what unset means" (constitution
VIII). Absent `APICEP_TOKEN` → `speiAvailable` false → the link answers
`unavailable` and the page says so — the same wire the prod page shows today
for the absent `CONSTA_BASE_URL`. Absent `AI` → the image route degrades to
the provider's OCR (proof-extraction D5, already written that way). The
`APICEP_TOKEN` GitHub secret already exists in the dev environment (the
Consta sync step plants it); it is re-pointed at the API, not created.

**Alternatives considered**: keeping `CONSTA_API_KEY` as the name of the
provider token to spare the GitHub environment a rename (rejected — the name
would lie, and SC-009 counts it).

---

## R9 — One deadline, the engine's

**Decision**: `CONSTA_TIMEOUT_MS` (30 s, the client's) goes with the client.
The engine's `DEFAULT_DEADLINE_MS` (25 s, Consta D16) is the only deadline a
provider call carries; the reader keeps its own fetch-free path (the R2 read
has no deadline to add). A timed-out call is `PROVIDER_UNAVAILABLE`,
retryable, and rides the schedule (provider-latency D6 kept in spirit).

**Rationale**: the two numbers existed so the engine would always finish
before its caller gave up, and no call could complete and bill after the API
had stopped listening (D16's own words). With one process there is one
listener. Keeping 30 s would re-introduce the gap the smaller number closed.
The inline attempt on `POST /pay` now bounds at 25 s instead of 30 s — the
payer waits less, never more.

---

## R10 — `businesses.consta_api_key` stays in the table, retired

**Decision**: the column is neither read nor written after this feature, and
it is **not dropped**. `schema.ts` keeps it declared with a retirement
comment so `db:generate` does not emit a `DROP COLUMN`. A debt entry
(`retired-consta-key-column`, effort: minutes) names the drop as its exit
condition: one migration, after no deployed version selects the column.

**Rationale**: the per-PR preview applies migrations to the live dev
database while the currently deployed dev Worker keeps serving
(ci.yml: "the preview shares the dev database … migrations here are
additive, so applying them early is safe for the live dev app"). Drizzle
selects every declared column by name; a `DROP COLUMN` applied by a PR would
break the running dev API's `SELECT … consta_api_key …` until the merge
deploys. The history shows drops (0005, 0018), all from before previews shared
the database. Additive is a rule with a reason now, and the reason is the
preview.

**Alternatives considered**: drop it in this feature (rejected — breaks dev
for the life of the PR); drop it in the same PR but "after merge" via a
second migration (rejected — a migration that must not run before a deploy is
a foot-gun the pipeline cannot express).

---

## R11 — The tests move in two shapes

**Decision**:

1. **The engine's 71 tests** (`apps/consta/test/`) move to
   `apps/api/test/consta/` and call the engine in-process against the API's
   D1, the provider intercepted at `https://api.apicep.cloud`, the reader
   stubbed through `env.AI` as today (`aiReturning`), proofs seeded into the
   test R2 bucket instead of served from a mocked origin. **Eight retire with
   the door**, by name: `admin-keys.test.ts` (5: issue, revoke, both tokens,
   404 without a token), `banks.test.ts` (2: served to a key, 401 without
   one), and `validate.test.ts` "scenario 5: a bad key and a revoked key both
   401 without touching the provider". **One is rewritten**: "scenario 9:
   http, a private address and an oversized file are refused before any
   reading" keeps its oversized and unrecognised-bytes halves and loses the
   two URL halves. The 62 others move with their `US-V##` citations intact.
2. **The API's own tests** stop intercepting `https://consta.test` and
   intercept apiCEP instead. `mockConsta(verdict)` — 91 call sites across
   `direct-payment.test.ts` (75), `topups-pause.test.ts` (7),
   `integration-dispatch.test.ts` (6) and `payment-classes.test.ts` (3) —
   becomes `mockApiCep(verdict)`, same vocabulary in, apiCEP's wire shape
   out, so that the engine's own mapping produces the verdict the test named:
   `valid` → `status: "valid"` + `cepDetails`; `pending` → `status:
   "pending"`; `not_found` → `status: "invalid"` with nothing behind it;
   `contradicted` → `status: "invalid"` + `cepStatus: "DEVUELTO"`;
   `alreadyValidated` → `cepPreviouslyValidated: true`. The 18 assertions on
   the captured body assert on what travelled to apiCEP (`sender.amount` in
   pesos, `imageUrl`, `beneficiary`) instead of on the Consta envelope.
   `consta-keys.test.ts` (7) retires whole. The "older Consta predating D11"
   test retires — its subject is a wire that no longer exists. The two
   `customerRef` tests become the attribution test FR-006 asks for.
3. **Trust and retry expectations** stop being injected through the mock.
   The three release-shadow tests that pass `trust: TRUST_BLOCK` seed
   validation rows for the payer (the engine test suite already has the
   helper, `learned-retry.test.ts` seeds distributions the same way) and
   assert the block the engine computed; `historyVouches` stays a pure unit
   test; the two `retryAfter` tests seed thirty measured rows.

**Rationale**: constitution IV — the provider is intercepted at the network
edge, at its real origin, pinned. `https://consta.test` was a provider origin
only because the engine was a provider; it is product code now, and product
code is not mocked. The vocabulary translation is the cheapest path through
91 sites: the tests keep saying `{ status: "invalid", reason: "not_found" }`
and one helper knows what apiCEP would have said to produce that.

`vitest.config.ts` pins `APICEP_BASE_URL` and `APICEP_TOKEN` for the same
reason it pins `WISPHUB_BASE_URL` and empties `RESEND_API_KEY`: a developer
running the sandbox has `APICEP_BASE_URL=http://localhost:8789` in
`.dev.vars`, and without the pin every provider test would go there.
`test/setup.ts` asserts the pin, as it does for WispHub.

**Alternatives considered**: keeping the Consta origin mock by wrapping the
engine in a fetch-shaped adapter (rejected — a mock of our own code);
module-mocking the engine (rejected — same, and it would not run the log
writes the attribution tests need).

---

## R12 — One additive migration, no data, one export

**Decision**: `db:generate` produces one migration creating `validations`
and `extractions` with their indexes. Nothing is copied from the Consta
database (spec Q2). Retirement is a `workflow_dispatch` job in a new
`retire-consta.yml`: export `devolada-consta-db-dev` to an artifact (90-day
retention), then `wrangler delete` the `devolada-consta-dev` Worker, then
`wrangler d1 delete` the database. The creator runs it once from the Actions
tab after the merge that stops calling Consta has deployed; the workflow file
is removed in the last task of the feature, so the tree carries no dead job.

**Rationale**: "Never deploy from a local machine" (CLAUDE.md) reads
naturally as "nothing touches a deployed environment from a laptop", and a
delete is the most irreversible touch there is. A workflow keeps the act in
CI's log, behind the same credentials the deploy uses, with the export
archived where the prod backup is. The eight Consta migrations are not
replayed: their sum is two tables, and the API's D1 has never held either,
so one `CREATE TABLE` pair is the whole history it needs.

**Alternatives considered**: `wrangler delete` from the dev deploy job on
its next run (rejected — a deploy that deletes something every run, or one
that needs a one-time flag, is a trap); leaving the Worker deployed and
unreachable (rejected — FR-013 says retired, and an idle Worker with a live
`APICEP_TOKEN` is a credential nobody is watching).

---

## R13 — The bank vocabulary has one constant now; the report has one database

**Decision**: `gen-banks.mjs` writes one file, `apps/api/src/direct-payments/
banks.ts`; the engine imports it. `banks.data.md` says so. `--check` stays a
CI gate. `cep-latency-report.mjs` reads one D1 and, while it is opened, is
repaired: it joins `direct_payments` to `isps`, two names that migrations
0018 and 0019 retired — the report has not run since.

**Rationale**: constitution III generates a shared vocabulary from one source
and fails on drift; with one consumer there is still one source and one gate,
and the script's "two constants in step" line becomes "one constant in step".
The report is FR-019's subject and is dead code today; leaving it dead while
changing its database would be converging on a corpse.

---

## R14 — The constitution amendment this plan proposes

> Landed 2026-09-16 as v1.3.0 (tasks T002), stacked on PR #197's v1.2.0 in
> PR #199, with one addition from the `/speckit-analyze` run: Principle IV
> names the reader's Workers AI binding as the one binding tests stub. #197's
> Principle III example list was rewritten in the same pass to name `/v1/*`
> alone.

**Decision**: a MINOR bump (v1.1.0 → v1.2.0, or v1.2.0 → v1.3.0 if the
pending `003` amendment lands first) through `/speckit-constitution`, with
these edits and no others:

- **Stack table, API row**: "`apps/api` (product API, the SPEI validation
  engine, and the every-minute cron sweeps)"; the `apps/consta` clause goes.
- **Stack table, Environments row**: the clause "Consta has no prod env
  until its first external consumer" goes; the engine deploys where the API
  deploys, and the provider credential decides whether it validates.
- **Principle III**: "(Consta adds `retryable`)" goes. If v1.2.0 is in
  force, its sentence naming `apps/consta` as a program-facing surface is
  rewritten: the engine is a component, not a surface; the `/v1/*` grant is
  untouched.
- **Principle IV**: "API and Consta tests" → "API tests"; "External providers
  (WispHub, apiCEP, Consta, Resend)" → "(WispHub, apiCEP, Resend)".
- **Principle V**: the bullet "Consta keys are stored as SHA-256 only; the
  issuer token opens ONLY key issuance" is replaced by: "The validation and
  reading records carry `business_id`, NULL for the platform's own top-ups.
  Two derived statistics — bank clave shape and Banxico latency per bank
  pair — read across businesses by decision `consta-api-merge D4`; they
  return rules, never rows."
- **Principle VIII**: the example "no Consta key → the SPEI channel says so"
  → "no provider credential → the SPEI channel says so"; the sentence "the
  Consta base URL is absent in prod by decision, not by accident" goes.

**Rationale**: governance — "Where code and constitution disagree, one of
them is amended". Every line above is a place the constitution would
describe a service that no longer exists. Nothing here changes a
principle's meaning; it is the same law with a smaller stack table.

---

## R15 — What `003-automated-collections-api` needs from this feature

**Decision**: nothing beyond FR-002. Its spec depends on "the existing SPEI
validation path (Consta → Banxico) and the business's validation credential".
The first is kept behaviour-identical; the second — the per-business Consta
key — was never read by anything `003` plans (its data model lists the
column only as evidence that the business row is ISP-agnostic). Whichever
feature lands second rebases: if `003` lands first, its `/v1/*` handlers
call `validateDirectPayment` as the panel does and inherit the engine
through it; if this lands first, `003`'s tasks that would have carried
`CONSTA_*` env into new tests carry `APICEP_*` instead.

**Rationale**: the two features touch the same lifecycle from opposite
sides — `003` changes who asks, this changes how the answer is produced.
Neither reads the other's new columns. Its pending constitution amendment
already describes the engine as "internal, consumed directly by the
`apps/api` Worker and nothing else", which this feature makes literally true.

---

## R16 — The engine's decimals come under the money law as they move

**Decision**: the four places where the engine turns a provider or reader
decimal into cents with `Math.round(x * 100)` — `provider/apicep.ts` (the
CEP amount and the OCR reading), `extraction/gate.ts` (the reader's amount)
and the extraction record's `amountCents` — use the API's `amountToCents`
(`wisphub/money.ts`: `toFixed(2)` then string parsing) once they live in
`apps/api`. The one outbound conversion, `amount: input.amountCents / 100`,
stays: apiCEP takes a JSON number, and an integer divided by 100 serialises
to exactly the two decimals it means.

**Rationale**: constitution II forbids `value * 100` by name and says why —
"a payment platform's one unforgivable bug is being a cent off; the law
removes the class of error rather than testing for it". The engine predates
the constitution and was written under its own spec's D7 ("pesos at the
model's edge, cents at ours"), which named the boundary but not the method.
For every amount a receipt or a CEP actually carries — two decimals — the
two methods agree; the change removes a class of error, not a known
mismatch. Moving code into `apps/api` puts it in the directory the law is
grepped in, so the move is the moment.

**Alternatives considered**: leave the four sites as they are and register
debt (rejected — the fix is four lines and a helper that exists; debt is for
shortcuts, not for work one already has open); string-parse the outbound
value too (rejected — the provider's field is a number, and `toFixed(2)`
followed by `Number(...)` produces the same float by a longer road).

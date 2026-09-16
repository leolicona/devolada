# Feature Specification: consta-api-merge

**Feature Branch**: `claude/speckit-specify-consta-integration-1b39b5`

**Created**: 2026-09-12

**Status**: Draft — clarified, ready for `/speckit-plan`

**Input**: User description: "integrates the consta code into devoladapago API worked." — read as: fold Consta, the SPEI validation engine that runs as a service of its own today, into the product's API, so the product validates its own payments.

## Clarifications

### Session 2026-09-12

- Q: Does the engine keep any door for callers outside the product after the
  merge? → A: No. The engine is internal only. The doors for validating,
  reading, listing banks and issuing keys go with the service, and so do the
  per-business keys and the tokens that minted and revoked them. One
  credential remains: the provider's. The product's own door for other
  companies is `003-automated-collections-api`, which exposes payments, not
  the engine. (FR-003, FR-015, FR-021, SC-003)
- Q: What happens to the engine's existing record? → A: Start empty.
  Production never ran the engine and holds nothing; dev holds the creator's
  own test transfers and the seeded learned-retry cells. Trust history and the
  learned retry cold-start in dev and answer with silence until the record
  refills. The old database is exported before it is retired and kept unread.
  (FR-013, FR-022, SC-008)
- Q: Is switching production on part of this feature? → A: No. The feature
  ends when production is *able* to validate — the API carries the engine and
  the deploy can plant and verify the credential. Planting it spends real
  credits on real transfers and is a separate decision, taken when the creator
  takes it, with no code change needed then. (FR-023, SC-005)

### Amended 2026-09-16

- After `/speckit-analyze` (findings I1, I2, A1, B1, I9) and the reading of
  PR #198: FR-003 names the two statistics that read across businesses;
  FR-010 and FR-011 no longer promise a schedule that stops early — research
  found the product never read the engine's "worth retrying" flag, so "as
  today" means every failure rides the schedule, and stopping early is
  recorded as a decision not taken; FR-006 names both customer identities a
  link can carry once the API of `003-automated-collections-api` exists;
  FR-013 admits the retirement job's lifetime. On the re-run (U3): US1
  scenario 5 now says the failure's reason is *recorded on the payment* — no
  screen shows it today and this feature changes no screen.

## Summary

Today the product is two services that talk over the network. The API takes
the payer's transfer and asks Consta to check it against Banxico; Consta
answers, writes its own log in its own database, and bills the call to a key
it minted for that business. Consta was built that way so it could one day
serve other companies. That day never came, and the constitution records the
cost: Consta has no production environment, so **in production the SPEI
channel says "unavailable"** and no payment can be validated at all. Two
services, two databases, two sets of secrets, a key-issuance handshake between
them, and a network hop inside every validation — all to keep a door open
that nobody has walked through.

This feature closes the door and brings the engine home. Validation becomes a
part of the product: same verdicts, same wording, same schedule, no second
service. The product deploys as one API, migrates one database, and keeps one
credential for the provider. Production becomes able to validate the moment
that credential is planted. Every record the engine writes — a provider call,
a reading of a receipt — lands beside the payment it describes, attributed to
the business it served.

Nothing the payer or the operator sees changes. What changes is what the
product is made of.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The product validates its own payments (Priority: P1)

A payer transfers to the ISP's CLABE, opens the link and enters the transfer
data — or uploads the receipt. The product checks the transfer against Banxico
itself, through the provider, in the same service that took the payment. The
payer sees exactly what they see today: the same "verificando", the same
outcome, the same wording. The operator sees the same status with the same
reason. There is no second service to reach, no key to present, and one fewer
thing that can fail between the payer and the answer.

**Why this priority**: it is the feature. Everything else here is what
becomes possible once validation is inside the product.

**Independent Test**: submit a payment against an intercepted provider and
walk it through every outcome — confirmed, still pending, not found,
contradicted, already used, provider down — and compare each outcome, its
wording and its next step against today's. Then do the same with a receipt
image and a receipt PDF. Needs nothing from the other three stories.

**Acceptance Scenarios**:

1. **Given** a link whose business has SPEI configured and the provider
   credential set, **When** a payer submits transfer data, **Then** the payment
   reaches the same status it reaches today, with the same words on the page
   and in the back office.
2. **Given** a receipt image, **When** the payer uploads it, **Then** it is
   read inside the product, the payer is shown the same draft to confirm, and
   no provider credit is spent for the reading.
3. **Given** a receipt the provider must read itself (a PDF, or the second
   opinion on a transfer that was not found), **When** the attempt runs,
   **Then** the provider receives a short-lived link to the file, exactly as
   today, and nothing else about the file leaves the product.
4. **Given** Banxico has not published the record yet, **When** the schedule
   re-validates, **Then** the retry follows the same schedule and carries the
   same learned suggestion as today.
5. **Given** the provider cannot be reached or does not answer in time,
   **When** an attempt runs, **Then** the payment stays "validating", rides the
   schedule, and the reason is recorded on the payment — a payment is never
   rejected because the product could not ask.
6. **Given** a payment that was already validating when this feature shipped,
   with attempts made by the old service, **When** its next attempt runs,
   **Then** it is treated as a retry and reaches the outcome it would have
   reached — the earlier attempts are not forgotten.
7. **Given** the provider credential is absent in an environment, **When** a
   payer opens a link, **Then** the page says the channel is unavailable, as it
   does today; it never shows a void.

---

### User Story 2 - One product to deploy, one credential to keep (Priority: P2)

The person running the platform merges to `main` and one API deploys, one
database migrates, and one provider credential is planted and verified where
it will actually be used. There is no second service to deploy, no second
database to migrate, no key to mint for each business, no token that one
service presents and the other accepts. When the creator decides production
should validate, planting the credential there is the whole act.

**Why this priority**: it is what the merge buys the platform. The dev
pipeline deploys and verifies two services today; production deploys one and
cannot validate at all. After this story the two environments differ by a
secret, not by a service.

**Independent Test**: run the deploy on a branch and count what it deploys,
migrates and verifies. Then start the product locally and validate a payment
against the provider sandbox with a single process running. Needs nothing from
the other stories.

**Acceptance Scenarios**:

1. **Given** a merge to `main`, **When** the deploy runs, **Then** it deploys
   exactly three services — the API, the panel and the payment page — and
   migrates exactly one database.
2. **Given** the provider credential is planted for the API, **When** the
   deploy finishes, **Then** it has verified that credential against the
   provider, reading the answer's body and not only its status — the check the
   Consta deploy performs today, moved to where the credential now lives.
3. **Given** the production environment, **When** the provider credential is
   planted there, **Then** the SPEI channel becomes available with no further
   code change and no further deploy.
4. **Given** a developer working locally, **When** they start the API, **Then**
   a payment validates against the provider sandbox with no second process.
5. **Given** the old validation service, **When** the cut-over is complete,
   **Then** its deployment, its database and its domain are retired, its data was
   exported before the database went, and nothing in the product references
   any of the three.

---

### User Story 3 - The validation record lives beside the payment (Priority: P3)

Every provider call the product pays for, and every receipt it reads, is
recorded in the product's own database, attributed to the business it served
— or to the platform, when the transaction was the platform's own top-up. The
record is append-only and never holds the image. Cost per business, a payer's
measured history, the learned retry moment and the Banxico latency report all
read one place instead of joining two databases by a tracking key.

**Why this priority**: it is what makes the engine's evidence part of the
product's evidence. Today the two logs are joined by hand, across two
databases, in a script. Nobody is blocked by that, so it waits behind the two
stories that change what the platform runs.

**Independent Test**: validate a payment for one business and a top-up for
the platform, then read the records: one row per provider response, each
attributed correctly, none visible to another business. Run the latency
report and confirm it reads one database. Needs nothing from the other
stories.

**Acceptance Scenarios**:

1. **Given** a business's payment validated, **When** the record is read,
   **Then** one row exists per provider call that returned an answer — a
   rejected-but-billed call included — attributed to that business.
2. **Given** a top-up, **When** it validates, **Then** its record is
   attributed to the platform and never to a business.
3. **Given** a payer with earlier payments, **When** a "not yet" verdict
   arrives, **Then** the payer's measured history is computed from the
   product's own record, scoped to that business, with the payment in flight
   excluded from its own evidence — as today.
4. **Given** a reading of a receipt, **When** the record is read, **Then** it
   holds what was read and a fingerprint of the file, never the file.
5. **Given** two businesses, **When** either reads its validation records,
   **Then** none of the other's are visible.
6. **Given** the latency report, **When** it runs, **Then** it reads one
   database and joins nothing across services.

---

### User Story 4 - The standalone identity is retired cleanly (Priority: P4)

The things that existed only because Consta was a separate service go with
it: the key minted per business, the door that minted it, the door that
revoked it, the sweep that filled the gaps, the six secrets and the base URL,
and the secret that disguised the payer's identity before it crossed the
network. What stays is every decision the engine carries — each still cited,
each still resolving — and every promise its tests made, proven again in its
new home. The constitution describes the product as it is now built.

**Why this priority**: nothing a user can see depends on it, so it waits
behind the three stories that change something. It belongs here all the same:
a merge that leaves the old service's plumbing behind is a merge that will be
finished twice.

**Independent Test**: read the configuration, the deploy pipeline and the
every-minute sweep and find no trace of a Consta URL, key, issuer or admin
token; read the moved code and find every decision citation intact; run the
test suite and find every behaviour the engine's tests proved still proven
and cited. Needs nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** the product after this feature, **When** its configuration and
   pipeline are searched, **Then** no Consta base URL, API key, issuer token or
   admin token is read anywhere — citations of the read-only archive excepted.
2. **Given** the every-minute sweep, **When** it runs, **Then** it no longer
   mints keys and still runs everything else it runs today, on the same single
   trigger.
3. **Given** the engine's decisions — validation, proof extraction, the trust
   layer, the learned retry — **When** the code is read in its new home,
   **Then** every citation is present and unchanged.
4. **Given** the behaviours the engine's own tests prove today, **When** the
   suite runs after the move, **Then** each one is proven again by a cited
   test at the layer that can answer it.
5. **Given** the constitution, **When** it is read after this feature,
   **Then** its stack table and its principles describe one API that validates,
   not two services and a key between them.

---

### Edge Cases

- **A payment validating at the moment of cut-over.** Its earlier attempts
  may have set the provider's replay flag. The attempt counter lives on the
  payment, not in the old service, so the retry carve-out applies exactly as
  it does across any two attempts today. No payment is told its own transfer
  belongs to somebody else because the service changed under it.
- **The provider credential planted in one environment and not another.** The
  channel is available where the credential is and says "unavailable" where it
  is not. Two environments may differ by that one secret and nothing else.
- **The receipt reader unavailable.** An image falls through to the
  provider's own reading rather than failing, as today. A door that still
  works beats one that answers with an error.
- **A business born with a key from the old service.** The stored key is
  never read again. Whether the column is dropped or left in place is the
  plan's call under the additive-migration rule; either way nothing depends
  on it.
- **A top-up in flight at cut-over.** It validates under the platform's own
  attribution on its next attempt; it never needed a business key and still
  does not.
- **The old service still deployed after the API no longer calls it.** It
  answers nobody. Retiring it is a step of this feature, not a consequence of
  it; until that step runs it costs nothing and decides nothing.
- **The old database at retirement.** It is exported before it is deleted, the
  same posture the production deploy takes before migrating. The export is
  kept unread: nothing is carried across (FR-022).
- **Two deadlines becoming one.** Today the caller cuts at 30 s and the engine
  at 25 s, so the engine always finishes first and no call is billed unseen.
  With one process there is one deadline, and it is the engine's: every
  provider call still ends, every timeout is still retryable, and no call can
  complete after its caller gave up.
- **A payer identified differently before and after.** Today the payer's
  history is keyed to a disguised reference built from a secret; after, to the
  product's own customer identity for the link. History accumulates forward
  from the cut-over under the new key; nothing is carried across (FR-022).
- **A feature in flight that depends on the validation path.**
  `003-automated-collections-api` names "the existing SPEI validation path"
  as a dependency and changes who asks and who is told. This feature changes
  how the product reaches that path and guarantees the path's behaviour
  (FR-002). Whichever lands second rebases on the first; neither waits.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Validation MUST run inside the product's API, in the same
  service that takes the payment. The only traffic a validation sends outside
  the product is the call to the provider and, when the provider must read a
  file, the short-lived link it fetches the file from. No validation MAY reach
  the product's own engine over the network, and no key MAY be needed to reach
  it.
- **FR-002**: Every verdict, every reason, the replay flag, the provider's
  reading, the reading gate, the shape signals, the trust block and the retry
  suggestion MUST be produced by the same rules as today. Nothing the payer's
  page or the back office shows about a payment changes by this feature.
- **FR-003**: Every validation and every reading MUST be attributed to the
  business it served, or to the platform when the transaction was the
  platform's own top-up. The business is the tenant identity; there is no
  per-business credential for the engine. Every query that returns one of
  these records filters by business, as every business table does. Exactly
  two derived statistics read across businesses — the clave shape a bank
  uses, and Banxico's publication latency per pair of banks — because they
  are facts about banks, not about anyone's business; each returns a rule,
  never a row, and reads no column that names a business or a payer.
- **FR-004**: The validation record MUST stay append-only: one row per
  provider call that returned an answer, including a call the provider
  rejected but billed; no row is ever updated or deleted. The count of paid
  calls, per business and for the platform, MUST remain a sum over this record.
- **FR-005**: The reading record MUST hold what was read and a fingerprint of
  the file, never the file itself, and one row MUST exist per reading whatever
  its outcome — a refusal at the edge included.
- **FR-006**: Payer history MUST be keyed to the product's own customer
  identity for the link — the customer's usuario for a link a person created
  in the panel; the caller's own customer reference for a link created
  through the API of `003-automated-collections-api` — scoped to the
  business, and MUST NOT depend on an optional secret. The secret that
  disguised the identity before it crossed the network is retired with the
  network it crossed.
- **FR-007**: The trust block and the retry suggestion MUST ride the same
  verdicts they ride today — "not yet" answers, where the caller is deciding
  whether to wait — and never a confirmed or a contradicted one. The payment in
  flight MUST stay excluded from its own evidence.
- **FR-008**: A receipt read inside the product MUST be read from the
  product's own storage. The provider MUST receive a short-lived link only
  when the provider itself must read the file. The rules that guarded the
  engine against fetching an arbitrary caller-supplied address are no longer
  load-bearing for internal reads and MAY be retired with the door they
  guarded.
- **FR-009**: Absent configuration MUST degrade and never break: without the
  provider credential the SPEI channel says it is unavailable and the payer's
  page says so; without the receipt reader an image goes to the provider's own
  reading; in no case does a payer see a void or a payment fail for it.
- **FR-010**: Every provider call MUST carry a deadline. Every failure — the
  deadline reached, the provider unreachable or rate-limited, the request
  rejected, the receipt unreadable — MUST name itself on the payment with the
  engine's own code, and that code MUST carry whether waiting can help.
- **FR-011**: The schedule's answer to a failure MUST stay exactly what it is
  today: every failure, whether or not waiting can help, keeps the payment
  "validating" and rides the schedule to its outcome. Acting on the
  distinction — stopping early when the request must change — is a product
  decision this feature records on the row and does not take.
- **FR-012**: The deploy MUST deploy one API, migrate one database, plant one
  provider credential and verify it by reading the provider's answer, not only
  its status. It MUST NOT deploy, migrate or plant anything for a separate
  validation service.
- **FR-013**: The old service — its deployment, its database and its domain
  — MUST be retired as part of this feature, the database exported first.
  Nothing in the product's code, configuration or pipeline MAY reference them
  afterwards; citations of the read-only archive are exempt, and so is the
  one-shot retirement job, for exactly as long as it has not yet run.
- **FR-014**: The every-minute sweep MUST stop minting keys and MUST keep
  every other job it runs today, on the same single trigger.
- **FR-015**: The configuration that existed only for the separate service —
  the base URL, the platform key, the issuer token, the admin token and the
  identity-disguising secret — MUST be removed from every environment and from
  the pipeline. The key stored per business MUST no longer be read or written.
- **FR-016**: Every decision citation in the moved code MUST survive the move
  unchanged, and every rule this feature adds MUST cite this feature's own
  decision that made it.
- **FR-017**: Every behaviour the engine's tests prove today MUST be proven
  again after the move, by a cited test at the layer that can answer it; the
  provider is intercepted at its real origin, and that origin is pinned so no
  developer's local configuration can redirect a suite.
- **FR-018**: The bank vocabulary MUST keep being generated from its one
  documented source into every constant that remains, with the drift check in
  CI. The number of constants MAY drop; the source and the check MAY NOT.
- **FR-019**: The Banxico latency report MUST read one database.
- **FR-020**: A payment or top-up that was validating when this feature
  shipped MUST continue on the engine on its next attempt, with its earlier
  attempts counted, and reach the outcome it would have reached.
- **FR-021**: The engine MUST NOT keep a door reachable from outside the
  product: the standalone doors for validating, reading, listing banks and
  issuing keys go with the service. (Clarified 2026-09-12: internal only.)
- **FR-022**: The engine's existing record — dev only; production never had
  one — MUST NOT be carried into the product's database. History accumulates
  forward from the cut-over; a cold start is silence, never a guess. The old
  database is exported before it is retired and kept unread. (Clarified
  2026-09-12: start empty.)
- **FR-023**: This feature is complete when production is *able* to validate:
  the API carries the engine, the deploy can plant and verify the credential,
  and planting it is the only remaining act. Whether the credential is planted
  is a separate decision, taken on its own evidence. (Clarified 2026-09-12:
  able, not on.)
- **FR-024**: The constitution MUST be amended to describe the product as
  built — its stack table, its Principle V key rule and its Principle IV test
  rule at least — and the plan MUST propose the amendment. The gap between the
  law and the code is not tolerated silently.
- **FR-025**: Local development MUST need one API process to validate a
  payment; the provider sandbox moves with the engine.

### Key Entities

- **Validation engine (Consta)**: the part of the product that turns a claim —
  transfer data, or a receipt — into a verdict from Banxico through the
  provider, with the reading, the gate, the shape signals, the trust block and
  the retry suggestion around it. After this feature it is a component of the
  product, not a service; it keeps its name so every decision it carries keeps
  resolving.
- **Validation record**: one row per provider call that returned an answer,
  attributed to a business or to the platform. Append-only; the count of paid
  calls is a sum over it. Today it lives in the engine's own database under a
  key; after, in the product's database under the business.
- **Reading record**: one row per receipt read, whatever the outcome — passed,
  gated, not a receipt, unreadable, refused, routed to the provider. Holds what
  was read and a fingerprint of the file, never the file. Attributed like the
  validation record.
- **Business**: the tenant. Gains attribution of its validations and readings;
  loses its engine key.
- **Platform**: the owner of top-ups. Its validations are attributed to it and
  billed to nobody, as today.
- **Provider credential**: the one secret validation needs, planted per
  environment on the API and verified by the deploy. Absent, the channel is
  unavailable and says so.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A payment submitted before and after this feature ends in the
  same status, with the same words on the payer's page and in the back office,
  for every outcome the product produces today — compared case by case.
- **SC-002**: The count of services deployed to run the product drops from
  four to three, and the count of databases from two to one.
- **SC-003**: The count of secrets validation depends on drops from six, plus
  one base URL, to one.
- **SC-004**: The count of ways a validation can fail because the product
  could not reach itself is zero: no "engine unavailable", "engine not
  configured" or "engine rejected our key" outcome can occur any more. A
  missing provider credential is not one of these — it is the degraded state
  the channel announces (FR-009), never a failed attempt.
- **SC-005**: Production can validate a SPEI transfer as soon as the provider
  credential is planted, with no further deploy or code change — measured by
  planting it on a preview and validating one intercepted transfer.
- **SC-006**: The count of validation and reading records without an owner —
  a business or the platform — is zero.
- **SC-007**: The count of records one business can see that belong to
  another is zero.
- **SC-008**: The latency report reads exactly one database.
- **SC-009**: The count of references to the old service's URL, key, issuer
  or admin token in code, configuration and pipeline is zero, archive
  citations excepted.
- **SC-010**: The count of behaviours the engine's tests prove today that lose
  their proof in the move is zero, and every moved or new test carries its
  citation.
- **SC-011**: The count of decision citations lost in the move is zero.
- **SC-012**: A developer validates a payment locally with one API process
  running.
- **SC-013**: The trust block and the retry suggestion appear on exactly the
  verdicts they appear on today, and on no others.
- **SC-014**: The constitution's stack table and principles describe the
  product as built: `/speckit-analyze` finds no conflict between them and the
  plan.

## Assumptions

- **One service and one database, not a wire between two.** A service could
  reach another over a private binding, or bind a second database, and either
  would keep a hop or a second thing to migrate. The request says "into the API
  Worker", and the reading here is the plain one: one process, one database.
  The plan may argue otherwise in its complexity tracking; the spec does not.
- **The engine keeps its name.** "Consta" stays the name of the component so
  that every `consta … D<n>`, `proof-extraction D<n>`, `trust-layer D<n>` and
  `learned-retry D<n>` citation keeps resolving where it already resolves.
  The archive is history, not law, and the citations stay intact.
- **Nothing anyone sees changes.** The payer's page never names the engine;
  the back office shows statuses and reasons, not service names. This feature
  edits no product copy and adds no screen.
- **The disguising secret's reason is gone.** The payer's identity was
  disguised because it crossed the network to another service. Once nothing
  crosses, the rule has no decision behind it, and a rule without a decision
  is one the constitution says to remove. The product's own record then keys
  history to the customer identity it already stores for the link — no new
  personal data enters any table. The constitution itself cites the month of
  history a missing secret once lost; this closes that road.
- **Production's switch-on is a secret, not a deploy.** The feature makes
  production able to validate. Planting the provider credential there spends
  real credits on real transfers, and that is the creator's call, made when
  they make it (FR-023).
- **The old dev history is measurement, not money.** The engine's record in
  dev holds the creator's own test transfers and the learned-retry cells they
  seeded. Production holds nothing. Starting empty costs a cold start that the
  trust layer and the learned retry were designed to answer with silence
  (FR-022).
- **The provider still needs a link for what it reads itself.** PDFs and the
  second-opinion cross-check are read by the provider, which fetches the file
  over a short-lived signed link. That link exists for the provider and stays;
  the product's own reader takes the file from storage.
- **`003-automated-collections-api` is a sibling, not a prerequisite.** It
  depends on the validation path staying as it is, which FR-002 guarantees.
  The two touch the same rows of the business record and the same validation
  path; whichever lands second rebases. Its own constitution amendment names
  the engine as "internal, consumed directly by the API" — the same reading
  this feature acts on.
- **Cut-over is one deploy.** The API deploys carrying the engine and stops
  calling the old service in the same release. The old service is retired in
  a later step of the same feature, after its database is exported.
- **The reader's binding comes along.** The receipt reader runs on the
  platform's own model binding, which the API gains. Where the binding is
  absent, the image degrades to the provider's reading, as today.

## Out of Scope

- Any change to what a verdict means, when a payment is confirmed, how the
  schedule waits, what the fee is, or how a partial payment settles.
- Any change to product copy, on the payer's page or in the back office.
- A new validation provider, or switching away from the current one.
- Offering validation to other companies as a product of its own. The
  product's door for other companies' systems is `003-automated-collections-api`,
  and it exposes payments, not the engine.
- Self-service issuance of anything: no keys, no tokens, no consoles.
- Migrating production data: production never ran the engine and holds no
  engine record.
- Replacing the receipt reader's model or moving it off the platform.
- Paying registered technical debt that the move happens to touch; a debt the
  move cannot avoid touching is paid with evidence, not by accident.

## Dependencies

- The provider (apiCEP) and its credential, planted per environment.
- The platform's model binding for the receipt reader, on the API.
- The constitution amendment named in FR-024, proposed by this feature's
  plan: the stack table stops naming a separate validation service, Principle
  V stops describing per-business engine keys, Principle IV stops naming a
  separate engine suite. Landed as v1.3.0, stacked on the v1.2.0 amendment of
  `003-automated-collections-api` (PR #197), whose Principle III sentence
  naming the engine as a surface was rewritten in the same pass.
- The read-only archive `leolicona/devoladapago-legacy-documentation`, which
  the moved code keeps citing by its old paths.

# Feature Specification: production-launch

**Feature Branch**: `claude/production-deployment-b1e0c6`

**Created**: 2026-09-17

**Status**: Draft — decisions taken by the product creator in session; amended 2026-09-18 (the tag is the approval)

**Input**: User description: "The creator ships Devolada to production for the first time and can do it again for every release. A release is a `v*` tag cut from a `main` commit whose dev deploy is green; it waits for the creator's approval, archives the production database before migrating, deploys the API, the panel and the payment page under devoladapago.com, plants and verifies the credentials (email, provider, operator), and proves each public hostname answers before it calls itself done. The first business can sign up, verify its email, set its CLABE and WispHub key and collect a validated SPEI payment on day one; the creator's own business is the first row and opens the operator panel to set the platform's top-up account. A bad release is undone from CI, never from a laptop; data is never rolled back automatically."

## Clarifications

### Session 2026-09-17

Four decisions the creator took before this spec was written, recorded as
they were put and answered:

- Q: How do we run the launch inside the repo's rules — a spec, or
  operations plus a few pipeline edits? → A: **Spec it** as
  `006-production-launch`. Its quickstart is the runbook the tree lost with
  the archive, and every rule the pipeline gains cites a decision of this
  feature. (FR-013, FR-017)
- Q: Is SPEI validation switched on at launch, and with which provider
  token? → A: **On at launch, with a second token minted for production.**
  Dev keeps its own; a shared pool was rejected because a dev retry would
  spend a call a real payer depends on. (FR-006, FR-016, SC-006)
- Q: Who operates the platform in production? → A: **One operator, the
  creator's own address.** The creator signs up their own business first,
  because an operator signs in as a member of a business. (FR-018, SC-005)
- Q: Sign-up is fully open today — anyone with an email creates a business,
  born active, with a welcome allowance and no way to suspend it from a
  screen. Acceptable for launch? → A: **Yes, open sign-up at launch.** The
  address is not public, sign-up is rate-limited per address, and a
  stranger's worst case is a few pesos of provider credit. Admission policy
  is the next feature, after the pilot ISP is live. (Assumptions, Out of Scope)

### Amended 2026-09-18

- Q: GitHub refused the required-reviewer rule — on a private repository it
  needs GitHub Pro (measured 2026-09-18: HTTP 422 "Please ensure the billing
  plan supports the required reviewers protection rule"). The tag-only rule
  went in; the pause with a name on it did not. How do we get the pause?
  → A: **The tag is the approval.** Stay on the Free plan; pushing a `v*`
  tag is the deliberate act, and what keeps it deliberate is mechanical:
  the release refuses a commit whose dev deploy did not finish green or
  that is not on `main`, before it touches production. GitHub Pro and a
  third-party approval action were declined. The constitution's
  Development Workflow bullet is amended to say so (v1.4.0). (US1, FR-004,
  SC-001, SC-002)

## Summary

Production has never been deployed. The pipeline for it exists and is nearly
whole: a version tag runs the checks, archives the production database,
migrates it, deploys the three services, plants the credentials, verifies
the provider's and probes one address. What is missing is everything around
that pipeline. Nothing ties the tag to the gates that run on `main`, so
today a tag on any commit would sail straight through. Three of the
credentials it would plant are not there — one of them the email key, without
which no one can finish signing up, and the pipeline would only mention it in
passing. The proofs bucket's fifteen-day rule exists as a comment. There is no
way to undo a release except from a laptop, which the constitution forbids.
And the runbook that described the whole act left the tree with the archive
on 2026-09-09; the pipeline still points at it by name.

This feature makes the first release a repeatable act rather than a brave
one. A release is a tag, and the tag is the approval: pushing it is the
deliberate act. It is refused unless the commit it names already deployed to
dev and passed the gates there. It runs the same checks a pull request runs,
archives before it migrates, deploys, plants what the environment holds and
says out loud what it does not — naming
the consequence, not the variable — and proves that each public address
answers before it calls itself done. A bad release is undone from the same
place it was made, by naming the version to return to; the data is never
touched by that act, and the archived export is the restore point a human
may choose to use.

Around the pipeline, the feature writes down what the first day needs: the
environment's secrets and its deployment policy, the bucket rule, the two provider
accounts, and then the first business — the creator's own, so the operator
panel opens and the platform's top-up account gets set before any ISP runs
through its welcome allowance.

Nothing the payer or the ISP sees changes. What changes is that production
exists.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The creator ships a release from a tag, and the tag is the approval (Priority: P1)

The creator pushes a version tag on a commit of `main` — that push is the
approval, the one deliberate act. The release first refuses the commit
unless its dev deploy finished green, then runs the same checks a pull
request runs, archives the production database, migrates it, deploys the
API, the panel and the payment page, plants every credential the environment
holds, verifies the provider's by reading its answer, and then proves that
each of the three public addresses answers. Only then does it say it is done.
Whatever it could not plant, it says so in the log, in words that name what
will not work.

**Why this priority**: it is the feature. Nothing else here exists until a
release can be made and repeated.

**Independent Test**: push a tag on a green commit, read the log end to
end, then open the three addresses. Then start the release on a commit whose
dev deploy did not run and watch it refuse before it touches anything. Needs
nothing from the other two stories.

**Acceptance Scenarios**:

1. **Given** a `main` commit whose dev deploy is green, **When** a version tag
   is pushed on it, **Then** the release proceeds without a further click —
   the push was the approval — and nothing in production changes before the
   checks pass.
2. **Given** a commit whose dev deploy failed or never ran, **When** a version
   tag is pushed on it, **Then** the release refuses before it touches
   production, and the log names the missing dev run.
3. **Given** the checks passed, **When** the release runs, **Then** the
   production database is exported and archived before the first migration,
   and the archive is retrievable from the run for thirty days.
4. **Given** the environment holds every credential, **When** the release
   plants them, **Then** the log reports each one planted, the provider
   answered that the credential is valid, and no warning appears.
5. **Given** the environment lacks the email key, **When** the release plants
   credentials, **Then** the deploy still finishes and the log carries a
   warning saying that nobody can finish signing up until the key exists.
6. **Given** the environment lacks the one required secret, **When** the
   release reaches that step, **Then** it refuses to finish, as today.
7. **Given** the three services are deployed, **When** the release proves the
   addresses, **Then** it waits for each of the API, the panel and the payment
   page to answer within a bounded time, and fails naming the undo if one
   does not.
8. **Given** a release completed, **When** the creator reads its log, **Then**
   they can tell which version of each service is live and which archive was
   taken.

---

### User Story 2 - The first business collects on day one (Priority: P2)

The creator signs up their own business first: the code arrives by email,
the business is born, the operator panel appears because the creator's address
is the operator's, and the platform's top-up account and support contact are
set. Then the first ISP signs up the same way, saves its CLABE and its bank,
pastes its WispHub key, opens its links — they exist for every customer on
the roster — and shares one. A customer transfers; the payment is validated
against Banxico; the ISP sees the verdict. The integration is born observing,
so nothing is written to WispHub until the ISP switches actions on.

**Why this priority**: a release nobody can use is not a launch. This story
is what the release is for, and it is also how the release is verified.

**Independent Test**: follow the runbook's day-one path in production with a
real address, a real CLABE and one small real transfer. Every step has an
observable outcome and none depends on story 3.

**Acceptance Scenarios**:

1. **Given** production deployed with the email key planted, **When** a person
   signs up, **Then** the verification code reaches their inbox and they
   finish signing up without anyone reading a log.
2. **Given** the creator's address is the operator's and the creator has a
   business, **When** they sign in, **Then** the operator panel is reachable
   and they can set the platform's top-up account and support contact.
3. **Given** a business with a CLABE, a known bank and a WispHub key,
   **When** it opens its links, **Then** a link exists for each customer and
   the payment page shows the transfer channel as available.
4. **Given** a shared link, **When** the customer transfers and enters the
   transfer data, **Then** the payment is validated with the production
   provider credential, and the verdict is recorded against that business.
5. **Given** the integration is newly connected, **When** a payment is
   confirmed, **Then** no action reaches WispHub and the outcome reads as
   observation, until the ISP switches actions on.
6. **Given** the platform's top-up account is not yet set, **When** a
   business asks to top up, **Then** it is told top-ups are not available yet
   — which is why the operator sets the account on day one, before any
   business runs through its welcome allowance.

---

### User Story 3 - A bad release is undone from CI (Priority: P3)

A release went out and something is wrong. From the same place releases are
made, the creator names the service and the version to return to, and traffic
goes back to that version. No data moves. If data must be restored, the
archive the release took is there, and using it is a decision a person makes
with their eyes open, not something the undo does on its own.

**Why this priority**: the first release is the one most likely to need
undoing, and the constitution forbids the only other way. The undo must exist
before the first release, and be rehearsed by it.

**Independent Test**: after a release, run the undo against the version that
is already live. It completes, changes nothing, and proves the path. Then
run it against the previous version of one service and watch that service
answer as it did before.

**Acceptance Scenarios**:

1. **Given** a release is live, **When** the creator runs the undo naming a
   service and a version, **Then** that service serves the named version
   within minutes, and the other two services are untouched.
2. **Given** the undo ran, **When** the database is inspected, **Then** no row
   changed by the undo — the act is code only.
3. **Given** the undo names the version that is already live, **When** it
   runs, **Then** it completes as a harmless rehearsal.
4. **Given** the undo is attempted from a laptop, **Then** the runbook says
   not to, and the pipeline's log is the only record production accepts.

---

### Edge Cases

- **The very first run on an empty database.** The archive is empty and the
  whole migration history replays from nothing. That is correct: the history
  is what dev ran, and the tests replay it from empty on every run.
- **A new address's certificate.** The first time each public address
  exists, its certificate can take minutes. The proof waits a bounded time
  per address and says which one it was waiting for.
- **The seconds between deploy and planting, on the first run only.** A
  credential can be planted only after the service exists. On the very first
  release the API lives for a few seconds with no session secret, before any
  person could have a session. Accepted, and recorded here so it is not
  rediscovered as a mystery.
- **A tag on a commit that never went to dev.** Refused before production is
  touched. A tag on a commit whose dev deploy is still running is treated the
  same way: green means finished and green.
- **A tag pushed by mistake.** There is no second click to catch it: the tag
  is the approval. What stands between a mistake and production is the gate
  (a green dev deploy, on `main`), the checks, and the tag's own name — a
  `v*` tag is not something one pushes by accident. Chosen on 2026-09-18 over
  a paid plan and over a third-party pause.
- **Re-running the release by hand to plant a secret added later.** The
  release can be started from the Actions tab without a new tag; it archives,
  migrates nothing new, redeploys the same code and plants what is now
  there. This is how a credential that was not ready on launch day arrives —
  no code change, as spec 004 decided.
- **The same provider token in two environments.** Both would spend one pool.
  The production environment carries its own token; the runbook says so and
  the creator decided so.
- **The operator's address set, but the operator has no business.** The
  panel stays closed until the creator signs up a business; the runbook makes
  that the first act, not a surprise.
- **Undo to a version whose resources no longer exist.** The platform
  refuses such an undo. The undo reports the refusal; it does not invent a
  version.
- **The proofs bucket without its fifteen-day rule.** Proofs would be kept
  forever, invisibly. The rule is a one-time act outside the pipeline, listed
  in the pre-flight, and the release does not manage bucket policy.
- **A stranger signs up.** Sign-up is open by decision. The exposure is one
  welcome allowance of validations and the provider calls behind it; the
  address is unpublished and sign-up is limited per address. Admission is the
  next feature.
- **Two releases at once.** Releases queue; a second tag waits for the first
  run to finish rather than interleaving with it.
- **A feature in flight that adds a secret.** `003-automated-collections-api`
  declares a signing-key secret its later phases will need; the phases that
  need it join the planting step when they land. This feature plants what the
  product on `main` reads today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A release MUST be a version tag (`v` followed by a version)
  pushed to the repository, and the same release MUST be startable by hand
  from the pipeline's own interface for the case where only a credential
  changed.
- **FR-002**: A release MUST refuse a commit whose dev deploy has not
  finished green, before it touches production. The refusal names the
  commit and the missing or failed dev run. A commit that is not on `main` has
  no dev run and is refused for the same reason.
- **FR-003**: A release MUST run every check a pull request runs — the
  citation lint, the bank vocabulary check, the contrast lint, the pending
  lint, typecheck, tests and build — and none may be skipped or quarantined
  to get green. The browser and passkey layers are not repeated: they gate
  the dev deploy the release requires (FR-002).
- **FR-004**: The push of the version tag IS the approval: no further click
  stands between it and production, and none is promised. The production
  environment MUST accept deployments only from version tags and from the
  `main` branch (the by-hand re-run of FR-001). A required reviewer is not
  used — not available to this private repository on its plan, and declined
  as a paid or third-party substitute (Clarifications, 2026-09-18).
- **FR-005**: A release MUST export the production database and archive the
  export with the run, retrievable for thirty days, before its first
  migration.
- **FR-006**: A release MUST plant, after the deploy, every credential the
  production environment holds: the session secret, the email key, the
  provider credential, the operator's address. For each one absent it MUST
  say so in the log in words that name the consequence — "nobody can finish
  signing up", "the transfer channel is unavailable", "the operator panel is
  closed to everyone". The session secret stays the one credential whose
  absence refuses the release (constitution VIII); every other absence is a
  loud warning, never a silent skip.
- **FR-007**: A release MUST verify the provider credential it planted by
  reading the provider's answer, not only its status, as today — and the
  pipeline MUST state that the verification spends one provider call, because
  it does (measured 2026-08-19: a rejected request is billed).
- **FR-008**: A release MUST prove that each public address answers — the
  API's health, the panel, the payment page — waiting a bounded time for each,
  and MUST fail naming the address that did not answer and the undo to run.
- **FR-009**: A release's log MUST let the creator tell which version of each
  service is live and which archive was taken, without opening another tool.
- **FR-010**: The undo MUST be a job in the pipeline, started by hand on the
  production environment, that names one service and one version and returns
  that service to that version. It MUST NOT touch the database, and its own
  description MUST say so.
- **FR-011**: Restoring data MUST remain a human act: the runbook names the
  archive as the restore point and the decision as the creator's. No job
  restores data on its own.
- **FR-012**: The runbook MUST list, in order, everything the first release
  needs that the pipeline cannot do for itself: the environment's secrets and
  its deployment policy, the address variables, the bucket rule, the credential
  scopes, the two provider accounts, and the removal of secrets nothing reads
  any more. Each item says who does it and what happens if it is skipped.
- **FR-013**: Every rule the pipeline gains by this feature MUST cite this
  feature's decision that made it, in the pipeline's own comments. Citations
  of the archive already in the pipeline stay as they are.
- **FR-014**: The pipeline's own pointer to the lost runbook, in the words
  it prints when the address proof fails, MUST point at the undo that exists.
- **FR-015**: The repository's guidance for agents MUST name the two acts —
  how a release is made and how it is undone — beside the rule that nothing
  deploys from a laptop.
- **FR-016**: The production environment MUST carry its own provider token,
  never dev's, so that a dev retry can never spend a call a real payer
  depends on.
- **FR-017**: This feature MUST change no product behaviour: no application
  code, no product copy, no schema, no screen. Its code is the pipeline and
  the guidance; its rest is the runbook.
- **FR-018**: The runbook's day-one path MUST begin with the creator's own
  business, so the operator panel can open, and MUST set the platform's
  top-up account and support contact before the first ISP is invited.
- **FR-019**: The runbook's day-one path for the first ISP MUST be
  observable at every step — a code that arrives, a channel that shows
  available, links that exist, a verdict that lands — and MUST end with one
  real validated transfer, so that the release is verified by the product
  doing its job and not by a health answer alone.
- **FR-020**: The secrets the retired validation service left in the
  environments MUST be removed, on the creator's explicit go-ahead, so that
  the count of secrets nothing reads is zero.

### Key Entities

- **Release**: a version tag on a `main` commit whose dev deploy is green.
  One run of the pipeline — the tag push is its approval — producing one
  archive and one live version of each of the three services.
- **Production environment**: the pipeline's store of what production is
  allowed to receive — its secrets, its address variables, and the rule that
  only version tags and the `main` branch may deploy to it.
- **Archive**: the export of the production database taken by a release
  before it migrates. The restore point; kept thirty days with the run.
- **Version**: what a service is serving at a moment. Every release makes
  one per service; the undo returns a service to a named one.
- **Runbook**: the feature's quickstart — pre-flight, release, verification,
  undo — replacing the document the archive keeps.
- **First business**: the creator's own, born first so the operator panel
  opens; then the first ISP, whose one validated transfer closes the launch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The first production release completes from tag push to "done"
  in one run, with no act between the push and the address proof that a
  person performs.
- **SC-002**: A tag on a commit without a green dev deploy never touches
  production: count of such releases that got past the gate is zero.
- **SC-003**: The count of checks a release runs equals the count a pull
  request runs.
- **SC-004**: After a release, each of the three public addresses answers
  within the release's own wait — five minutes per address at most.
- **SC-005**: A real person completes sign-up in production with a code that
  arrived by email, in under five minutes, and the operator panel is
  reachable to the operator on their first sign-in with a business.
- **SC-006**: The first ISP collects one validated SPEI payment in
  production on its first day, and the dev environment's provider pool is
  unchanged by it.
- **SC-007**: The undo returns a service to a named version in under five
  minutes from the Actions tab, and the count of database rows it changes is
  zero.
- **SC-008**: The count of secrets in the production environment that no
  pipeline reads is zero.
- **SC-009**: The count of production changes performed from a laptop is
  zero; every act on production has a pipeline run and a log.
- **SC-010**: The runbook answers pre-flight, release, verification and undo
  without a reader opening the archive.
- **SC-011**: The count of credential absences a release reports without
  naming a consequence is zero.

## Assumptions

- **The first tag is `v1.0.0`.** The product goes live for real customers;
  pre-1.0 semantics do not fit a payment product. Package versions stay as
  they are — nothing reads them; the tag is the version.
- **What ships is `main` as it stands.** The Consta merge (004) is on `main`,
  so the release carries the validation engine and needs only the credential.
  The first phases of `003-automated-collections-api` are on `main` too and
  ship with it; its later phases, and `005-two-eyes-receipt`, ride later tags.
- **Validation is on from the first release.** The creator decided it, with
  a second provider token for production. Should the provider not allow a
  second token on one account, the runbook's fallback is a second account —
  never a shared pool.
- **The tag is the approval.** One developer builds this product, and the
  pause with a name on it that GitHub sells for private repositories was
  declined (Clarifications, 2026-09-18). The deliberate act is the push of a
  `v*` tag; the gate that makes it safe is a green dev deploy on `main`.
- **The bucket rule is done by hand, once.** The pipeline's credential is
  scoped to deploy, and bucket policy is not a thing a release changes. The
  runbook lists it and the launch checks it.
- **The seconds-long window on the first run is accepted.** Planting can only
  follow the service's first existence; no person can hold a session in those
  seconds; the window never recurs.
- **Open sign-up at launch.** The creator's decision; the exposure is one
  welcome allowance per stranger, and admission policy is the next feature.
- **The current platform plan carries a pilot.** One ISP's payments, an
  every-minute sweep and a handful of readings fit within the plan the
  account is on; the runbook names where usage is read so the creator sees
  the day that changes.
- **The email domain stays verified.** It was verified on 2026-08-15 and its
  records moved with the zone on 2026-09-01; the pre-flight confirms it
  still shows verified before the tag.
- **The pipeline verifies the dev deploy by asking the repository**, not by
  trusting the tagger. The check needs nothing but the pipeline's own token.

## Out of Scope

- Admission policy — who may become a business, and whether identity is
  checked before collecting. Left open by the constitution on purpose; the
  next feature.
- Observability and alerting. Nothing pages anyone today; a release makes
  that no worse and no better. A feature of its own.
- Automatic data restore, blue/green, canaries, a required reviewer (paid or
  third-party).
- The later phases of `003-automated-collections-api` and all of
  `005-two-eyes-receipt`.
- Paying `retired-consta-key-column`. Its own trigger is the first migration
  after the production deploy that carries the merge — that is, after this
  feature — and it is paid by its own path with evidence.
- The one-shot retirement of the old dev validation service (004 T050). A
  dev act the creator runs from the Actions tab; not a production concern.
- Any change to the product: copy, screens, schema, verdicts, fees.

## Dependencies

- The repository's environment features: a deployment policy of version
  tags and `main` on the production environment; the pipeline's own token to
  read the dev deploy's status.
- The platform account: the production database and proofs bucket already
  exist; the zone is live; the deploy credential's scopes cover the three
  services, the database, the reader's model and the zone.
- The provider (apiCEP): a second token for production; the pool it comes
  with; the one call each release spends verifying it.
- The email provider (Resend): the domain verified; a key in the production
  environment.
- `004-consta-api-merge`, delivered: production is able to validate, and the
  release plants the one credential that switches it on.

<!--
Sync Impact Report (v1.9.0, 2026-10-01)
- Version change: 1.8.0 → 1.9.0 — MINOR. One sub-bullet of Principle V is
  materially expanded: what a store may see of a business's customers
  grows from two things to three. Nothing is removed, redefined or
  renumbered. Precedent: v1.6.0, also MINOR, which admitted a third
  cross-business statistic in the same principle.
- Source: specs/018-cash-at-stores. /speckit-analyze (2026-10-01) found
  C1 (CRITICAL): the receipt's WhatsApp link would carry the customer's
  phone from the business's system, which v1.8.0's store bullet did not
  admit. The analysis offered two ways out:
  (a) never use the system's phone;
  (b) amend V.
  The creator chose (b) the same day, "no necesitamos guardar el
  teléfono", and asked for the message to be a default the operator can
  change in /operador.
- What this decides:
  · A store may receive one customer's phone, only for a payment that
    store recorded.
  · The phone is read from the business's system at the moment the
    receipt is sent, through the integration's existing live phone read,
    and only addresses that receipt.
  · It is never stored: not on the payment row, not per customer, not as
    a hash. `payment-without-receipt` D1/D4 stand unchanged.
- What it does not change: the search still never returns a phone; a
  phone the shopkeeper types still never reaches the server; the three
  cross-business statistics; tenant filtering; authorization by area.
- Modified sections:
  · V. Tenant Isolation and Authorization by Area, the store bullet — "it
    sees only two things: what a typed search returns (name, usuario,
    zone), and one customer's debt" → "it sees only three things: what a
    typed search returns (name, usuario, zone); one customer's debt; and,
    for a payment it recorded, that customer's phone. The phone is read
    from the business's system when the receipt is sent, used only to
    address that receipt, and never stored."
- Added sections: none. Removed sections: none. Renamed principles: none.
- Templates: plan-template.md ✅; spec-template.md ✅; tasks-template.md ✅;
  checklist-template.md ✅. No placeholder change needed.
- Follow-up TODOs:
  TODO(018-ARTIFACTS): specs/018-cash-at-stores must stop copying the phone
  onto the cash payment row and read it live for the receipt. Its plan's
  Constitution Check row V must cite v1.9.0. Done in the same commit as
  this amendment.
  Carried unchanged from v1.8.0: TODO(CLAUDE-MD-WORKERS), TODO(TD-005),
  TODO(BREATH-AMPLITUDE), and who may be admitted as a business.
-->

<!--
Sync Impact Report (v1.8.0, 2026-10-01)
- Version change: 1.7.1 → 1.8.0 — MINOR. Three sections are materially
  expanded: the Purpose paragraph, Principle V (one bullet added, one word
  in the first bullet) and the stack table (two rows). No principle is
  added, removed, redefined or renumbered. Precedents: v1.3.0, v1.5.0 and
  v1.6.0, also MINOR, for a table or a bullet that stopped describing the
  product as it will be built.
- Source: specs/018-cash-at-stores. The plan's Constitution Check blocked
  on the Purpose, Principle V and the stack table, and its Complexity
  Tracking proposed these three amendments. The creator ran this command
  on 2026-10-01, after the plan. The amendment leads the implementation on
  purpose, as v1.1.0, v1.3.0, v1.5.0 and v1.6.0 did: the code catches up
  under specs/018-cash-at-stores/tasks.md.
- What this decides:
  · A second way to collect exists: cash at a store of a network Devolada
    runs. Its truth is the store's word, not Banxico's, and the business
    confirms each hand-over. The money still never touches Devolada.
  · A store is a second kind of actor, never a member of a business. It
    is resolved from its own record, refused by business routes, and
    reaches only the businesses the operator switched the channel on for.
    Of their customers, it sees what a typed search returns and one
    customer's debt.
  · `stores` and `store_invitations` are platform rows without
    `business_id`. Every movement of a business's money carries it.
  · A fifth surface and Worker, `apps/red`, and Better Auth's `username`
    plugin for the shopkeeper's phone sign-in.
- What it does not change: tenant filtering on every business query;
  authorization by area for members; the three cross-business statistics;
  the operator named by deploy; the additive migration rule (018 adds no
  rebuild, by its research D11); Principles I–IV and VI–IX's rules.
- Modified sections:
  · Purpose — one sentence added after "validates every transfer": "A
    business may also collect in cash at a store of the network Devolada
    runs: there the store's word confirms the payment, and the business
    confirms each hand-over of the cash. The money never touches Devolada
    either way."
  · III. One Contract, Pure Routers, first bullet — "imported by the admin
    and the payment page" → "imported by the admin, the payment page and
    the store app". A count word that follows from the new surface.
  · V. Tenant Isolation and Authorization by Area — first bullet: "The
    actor is resolved" → "The business actor is resolved". One bullet
    added after it: the store actor, its reach, and the platform rows
    that carry no `business_id`.
  · IX. The Core Speaks Generic; Adapters Translate, first bullet — the
    core's list gains "the store channel". The store channel asks the
    integration by capability, like the rest of the core.
  · Technology Stack & Constraints — Auth row gains the `username` plugin;
    Frontend row gains `apps/red`.
  · Development Workflow & Quality Gates, second bullet — "the four
    Workers" → "the five Workers".
- Added sections: none. Removed sections: none. Renamed principles: none.
- Templates: plan-template.md ✅ (Constitution Check is filled at plan time
  from this file); spec-template.md ✅; tasks-template.md ✅;
  checklist-template.md ✅. No placeholder change needed.
- Follow-up TODOs:
  TODO(018-PLAN-CHECK): specs/018-cash-at-stores/plan.md's Constitution
  Check marks the Purpose, V, the Frontend and Auth rows and the gates as
  ⛔, pending this amendment. They must cite v1.8.0 and turn ✅. That is
  a spec artifact edit, outside this command.
  TODO(CLAUDE-MD-WORKERS): CLAUDE.md still says "all four Workers" and
  lists no `apps/red` dev command. It is updated by 018's tasks, with the
  Worker it describes.
  TODO(TD-005): still open from v1.0.0 — spec-lint runs warning-only until
  the debt it names is registered with /speckit-debt-log.
  TODO(BREATH-AMPLITUDE): carried unchanged from v1.1.0.
  Carried from v1.2.0, still open: who may be admitted as a business, and
  whether identity is checked before one can collect.
-->

<!--
Sync Impact Report (v1.7.1, 2026-09-27)
- Version change: 1.7.0 → 1.7.1 — PATCH. One sentence of Principle IX is
  reworded; no rule is added or removed.
- Source: /speckit-analyze on specs/014-cobros-in-links, finding K1. IX said
  a business whose adapter lacks a capability "gets the core without that
  feature, and the screen says so". Read literally, every screen would have
  to announce every feature an adapter does not offer. The creator chose
  (2026-09-27, option A of two) that a feature the integration does not
  offer is simply not offered, and the screen speaks only when something
  the business relies on is missing or failing.
- What it does not change: Principle VIII. A connection down or a key
  refused is still said on screen, never shown as a void.
- Templates: none touched.
-->

<!--
Sync Impact Report (v1.7.0, 2026-09-27)
- Version change: 1.6.0 → 1.7.0 — MINOR. Principle IX is added, and the
  Purpose paragraph is reworded to name adapters. No principle is removed or
  redefined, and nothing is renumbered.
- Source: the creator, session 2026-09-27, while reviewing
  specs/014-cobros-in-links: "Devoladapago is a product for validating SPEI
  transfers for many kinds of businesses, not ISPs. It supports adapters
  for specific providers, in this case for ISPs that use WispHub. That is
  how we tell the base behaviour of Devoladapago from each adapter's."
  (translated from Spanish). The review found the read side (customers,
  open invoices, debt) had no boundary: 12 core files import the WispHub
  folder, Consta included, and 014's plan would have added two core routes
  that build WispHub paths.
- Added: IX. The Core Speaks Generic; Adapters Translate.
- Modified: Purpose — "with dedicated downstream automation for ISPs" →
  "What a business's own system does with a payment goes through an adapter
  for that system: today there is one, WispHub, for ISPs." v1.2.0 already
  widened who the product is for; this names the mechanism.
- What this decides:
  · Provider paths, pagination, cursors, field names, error vocabulary and
    measured provider facts live in the adapter.
  · The core offers a feature by capability, never by provider name.
  · Core contracts and copy use the core's words. The provider's name
    appears only as the value that identifies an integration, and in the
    copy of that integration's own screens.
  · The money law's parsers belong to the core.
- What it does not change: the action side already follows this rule — the
  queue writes the core's words (`done`/`queued`/`withheld`) while the
  adapter speaks its own (`integrations-hub` D7). Principles I–VIII are
  untouched.
- Existing gaps, registered as debt, not tolerated silently (Governance):
  `apps/api/src/wisphub/money.ts` imported by Consta and the core;
  `WISPHUB_CAPABILITIES` imported by name in `direct-payments/classes.ts`;
  core routes calling `wisphubFor` directly (payments, direct-payments,
  payment-requests); the customers contract's `wisphub` field and the
  `WISPHUB_*` error codes in browser-facing contracts.
- Templates: plan-template's Constitution Check is filled per principle at
  plan time, so IX gets its gate with no template change. No template file
  is edited.
- Follow-up outside this file: CLAUDE.md's opening still says "a Mexican
  ISP". specs/014-cobros-in-links is revised to follow IX before it is built.
-->

<!--
Sync Impact Report (v1.6.0, 2026-09-25)
- Version change: 1.5.0 → 1.6.0 — MINOR. One bullet of Principle V is
  materially expanded (a third cross-business statistic is admitted), and the
  stack table's Data row describes the reader model as it will be built. No
  principle is added, removed or redefined, and nothing is renumbered.
  Precedent: v1.3.0, also MINOR, which generalised a bullet of V.
- Source: specs/011-receipt-reader-tuning. The /speckit-analyze run of
  2026-09-25 found C1 (CRITICAL): the panel's count of reader fallbacks reads
  `extractions` across businesses, which V limited to two statistics. The
  creator chose to amend V rather than keep a separate platform counter or
  drop the count (session 2026-09-25). The analysis also noted that the
  stack table's "(model is a var)" would become incomplete (research R16).
  As with v1.1.0, v1.3.0 and v1.5.0, the amendment leads the implementation
  on purpose: the code catches up under specs/011-receipt-reader-tuning/tasks.md.
- What this decides:
  · The platform operator may see one number across businesses: how many
    payer readings, in a recent window, fell back from the chosen reader
    model to the default. It is a fact about a model. It returns a number,
    never a row. It reads no column that names a business or a payer (only
    the fallback marker and the time). A fourth such read still needs an
    amendment.
  · The reader's models stay configuration: every model id the reader can
    use is a var. The platform operator picks one of them at runtime in
    `/operador`. VIII's "model ids are `vars`, never literals" is unchanged
    and still holds word for word.
- What it does not change: the two bank statistics, and what they may read.
  Tenant filtering on every business query. The operator named by deploy
  (`PLATFORM_OPERATOR_EMAILS`). Principle IV: stubbed reader answers are
  still measured ones. The feature resolves analyze finding C2 without an
  amendment, by pinning the fixture to the answer the bench captures.
- Modified sections:
  · V. Tenant Isolation and Authorization by Area, last bullet — "Exactly
    two derived statistics … A third such read is an amendment, not a
    comment." becomes "Exactly three derived statistics …", adding the
    reader-fallback count from `receipt-reader-tuning`, restating the shared
    limits (no rows, no column naming a business or a payer) and ending "A
    fourth such read is an amendment, not a comment."
  · Technology Stack & Constraints, Data row — "Workers AI for receipt
    reading (model is a var)" → "(the models are a var; the platform
    operator picks one of them in `/operador`)".
- Added sections: none. Removed sections: none. Renamed principles: none.
- Templates: plan-template.md ✅ (Constitution Check is filled at plan time
  from this file); spec-template.md ✅; tasks-template.md ✅;
  checklist-template.md ✅. No placeholder change needed.
- Follow-up TODOs:
  TODO(011-PLAN-V): specs/011-receipt-reader-tuning/plan.md's Constitution
  Check row V says "No new cross-business read", and tasks.md T014 says to
  note the read "in the comment". Both must cite v1.6.0 instead. This is a
  spec artifact edit, outside this command.
  TODO(TD-005): still open from v1.0.0 — spec-lint runs warning-only until
  the debt it names is registered with /speckit-debt-log.
  TODO(BREATH-AMPLITUDE): carried unchanged from v1.1.0.
  Carried from v1.2.0, still open: who may be admitted as a business, and
  whether identity is checked before one can collect — production-launch
  D8 launches with open sign-up and names admission as the next feature.
-->

<!--
Sync Impact Report (v1.5.0, 2026-09-20)
- Version change: 1.4.0 → 1.5.0 — MINOR: the fixed stack table gains one
  row, its Tests row names a second test runner for one workspace, and one
  bullet of Principle VI counts surfaces differently. No principle added,
  removed or redefined, no renumbering. Precedent: v1.3.0, also MINOR, for
  a table that stopped describing the product as built.
- Source: specs/008-landing-page — plan.md Complexity Tracking (the one
  departure from the stack table), research.md D2 (the page renders the
  shared atoms at build and ships no client framework), D13 (Astro 7
  mandates Vite 8, which the workspace's Vitest 3 does not support, so that
  one workspace tests on Vitest 4) and D19 (this amendment, drafted after
  the /speckit-analyze finding C1 of 2026-09-19); run by the creator on
  2026-09-20. As with v1.1.0 and v1.3.0, the amendment leads the
  implementation on purpose: the code catches up under
  specs/008-landing-page/tasks.md.
- What this decides: a third surface exists and the law counts it. The
  landing page is a static site built by Astro, served by an assets Worker
  with a small script in front (host redirect, channel tag, headers); it
  consumes the design system at build — tokens, stylesheet, atoms, recipes —
  and sends no framework to the browser. `packages/ui` remains the single
  definition of every shared atom; what changes is how many surfaces the
  rule counts, and that a surface may consume an atom as built HTML and a
  recipe as a class string rather than as a hydrated component.
- What it does not change: the Frontend row (React 19, Vite 6) still
  governs `apps/admin` and `apps/pago`; the page's requests and counts are
  resources of `apps/api` under Principle III like any other; no new Worker
  trigger; no principle added, removed or redefined; no renumbering;
  templates unchanged.
- Modified sections:
  · Technology Stack & Constraints — new row **Landing** after **Shared
    UI**: "`apps/landing`: Astro (static output, no adapter) on an assets
    Worker with a script in front for the host redirect, the channel tag
    and the headers; consumes `@devolada/ui` tokens, stylesheet, atoms and
    recipes at build; ships no client framework".
  · Technology Stack & Constraints, Tests row — "Vitest 3" gains "Vitest 4
    in `apps/landing`, whose Astro build sits on Vite 8, until the workspace
    moves", folded into the row's existing parenthesis.
  · VI. Visual Foundations, the `packages/ui` bullet — "any atom both
    surfaces render" → "any atom more than one surface renders", plus one
    sentence: "A surface that ships no client framework consumes the atoms
    rendered at build and the recipes as class strings — the definition
    stays in the package either way." The rest of the bullet is unchanged.
  · Two count words that follow from the new row, not named in research
    D19, changed so the document does not contradict itself: Shared UI row,
    "consumed by both apps" → "consumed by every surface"; Development
    Workflow & Quality Gates, second bullet, "the three Workers" → "the
    four Workers".
- Added sections: none. Removed sections: none. Renamed principles: none.
- Templates: plan-template.md ✅ (Constitution Check is filled at plan time
  from this file); spec-template.md ✅; tasks-template.md ✅;
  checklist-template.md ✅. No placeholder change needed.
- Follow-up TODOs:
  TODO(TD-005): still open from v1.0.0 — spec-lint runs warning-only until
  the debt it names is registered with /speckit-debt-log.
  TODO(BREATH-AMPLITUDE): carried unchanged from v1.1.0.
  Carried from v1.2.0, still open: who may be admitted as a business, and
  whether identity is checked before one can collect — production-launch
  D8 launches with open sign-up and names admission as the next feature.
-->

<!--
Sync Impact Report (v1.4.0, 2026-09-18)
- Version change: 1.3.0 → 1.4.0 — MINOR: one bullet of Development Workflow
  & Quality Gates describes a different mechanism for the same act. No
  principle added, removed or redefined, no renumbering. Precedent: v1.3.0,
  also MINOR, for a table that stopped describing the product as built.
- Source: specs/006-production-launch — spec Clarifications (amended
  2026-09-18), plan D3, research R3; the creator's decision in session.
- What this decides: the approval a production release waits for is the
  push of the tag itself, not a click on a required reviewer. Measured
  2026-09-18: GitHub answers HTTP 422 "Please ensure the billing plan
  supports the required reviewers protection rule" for this private
  repository on the Free plan. The creator chose the tag as the deliberate
  act over GitHub Pro and over a third-party approval action. What keeps
  the act deliberate is mechanical, not ceremonial: the release refuses a
  commit whose dev deploy did not finish green, or that is not on `main`,
  before it touches production; the `production` environment accepts
  deployments only from `v*` tags and the `main` branch.
- Modified sections:
  · Development Workflow & Quality Gates, fourth bullet — "through the
    `production` environment's approval gate" → "the tag is the approval:
    pushing it is the deliberate act, taken on a `main` commit whose dev
    deploy finished green — the release refuses any other commit before it
    touches production". The D1 export before migrating is unchanged.
- Added sections: none. Removed sections: none. Renamed principles: none.
- Templates: plan-template.md ✅ (Constitution Check is filled at plan time
  from this file); spec-template.md ✅; tasks-template.md ✅;
  checklist-template.md ✅. No placeholder change needed.
- Follow-up TODOs:
  TODO(TD-005): still open from v1.0.0 — spec-lint runs warning-only until
  the debt it names is registered with /speckit-debt-log.
  TODO(BREATH-AMPLITUDE): carried unchanged from v1.1.0.
  Carried from v1.2.0, still open: who may be admitted as a business, and
  whether identity is checked before one can collect — production-launch
  D8 launches with open sign-up and names admission as the next feature.
-->

<!--
Sync Impact Report (v1.3.0, 2026-09-16)
- Version change: 1.2.0 → 1.3.0 — MINOR: the fixed stack table shrinks by one
  Worker and one database, one bullet of Principle V is generalised and one
  added, and three sentences in III, IV and VIII stop naming a service that
  the code will no longer have. No principle removed or redefined, no
  renumbering. Built on v1.2.0 (PR #197, 003-automated-collections-api),
  whose Purpose sentence and `retryable` grant it keeps.
- Source: specs/004-consta-api-merge — plan.md Constitution Check and
  Complexity Tracking, research.md R3 and R14, decisions D3, D4, D11, D15;
  the /speckit-analyze run of 2026-09-12 (findings C1, C3). Governance
  requires a blocked feature's plan to propose the amendment rather than
  route around it; this is that amendment. As with v1.1.0, the amendment
  leads the implementation on purpose: the code catches up under
  specs/004-consta-api-merge/tasks.md.
- What this decides: Consta, the SPEI validation engine, stops being a
  Worker of its own with its own D1, API keys and secrets, and becomes a
  module of `apps/api`. Validation is attributed to the business (or to the
  platform, for its own top-ups) by `business_id`, not by a key. The engine
  keeps its name so every `consta … D<n>`, `proof-extraction D<n>`,
  `trust-layer D<n>` and `learned-retry D<n>` citation in the code keeps
  resolving.
- Modified sections:
  · Technology Stack & Constraints, API row — `apps/consta` removed; the
    engine is named inside `apps/api`.
  · Technology Stack & Constraints, Environments row — "Consta has no prod
    env until its first external consumer" removed; the engine deploys where
    the API deploys, and the provider credential decides whether it
    validates.
  · III. One Contract, Pure Routers — v1.2.0's grant of `message` and
    `retryable` to program-facing surfaces is kept whole; its example list
    shrinks from two surfaces to one. `apps/consta` was named for the routes
    it mounted and the eight places it sent `retryable`; after this
    amendment it mounts nothing and answers no caller over a wire. The
    engine's in-process failure carries `retryable`, which is not an
    envelope. `/v1/*` remains the surface the grant was written for.
  · IV. Tests Run on the Real Runtime — "API and Consta tests" → "API
    tests"; the intercepted providers no longer list Consta; one sentence
    added naming the receipt reader's Workers AI binding as the one binding
    tests stub (it has no local runtime and no origin to intercept) — the
    practice since proof-extraction, now written down (analyze C3).
  · V. Tenant Isolation and Authorization by Area — the bullet "Consta keys
    are stored as SHA-256 only; the issuer token opens ONLY key issuance" is
    generalised into a rule any credential can be held to (a credential the
    product only compares is hashed; one it must send is stored as it is),
    which keeps the precedent 003-automated-collections-api D11 relies on;
    the issuer clause goes with the issuer. One bullet added: the validation
    and reading records carry `business_id`, NULL for the platform's own
    top-ups, and exactly two derived statistics read across businesses by
    decision consta-api-merge D4 — bank clave shape and Banxico latency per
    bank pair — returning rules, never rows.
  · VIII. Absent Configuration Degrades, Never Breaks — "no Consta key" →
    "no provider credential"; "the Consta base URL is absent in prod by
    decision" → the provider credential absent from an environment is a
    decision the deploy log records, never an accident.
- Added sections: none. Removed sections: none. Renamed principles: none.
- Templates: plan-template.md ✅ (Constitution Check is filled at plan time
  from this file); spec-template.md ✅; tasks-template.md ✅;
  checklist-template.md ✅. No placeholder change needed.
- Follow-up TODOs:
  TODO(TD-005): still open from v1.0.0 — spec-lint runs warning-only until
  the debt it names is registered with /speckit-debt-log. `.specify/debt/`
  now exists (three entries); TD-005 itself is not yet among them.
  TODO(MOTION-DEBT): paid — `.specify/debt/unmapped-motion-tokens` closed
  2026-09-09 with evidence. Kept one more report so the trail reads whole.
  TODO(BREATH-AMPLITUDE): carried unchanged from v1.1.0.
  Carried from v1.2.0, still open: who may be admitted as a business, and
  whether identity is checked before one can collect.

Sync Impact Report (v1.2.0, 2026-09-12)
- Version change: 1.1.0 → 1.2.0 — MINOR: the Purpose paragraph widens who the
  product is for, and Principle III gains one rule. No principle removed or
  redefined, no renumbering.
- Source: /speckit-analyze findings C1 and H2 on feature
  003-automated-collections-api. Governance requires a blocked feature's plan to
  propose the amendment rather than route around it; both texts below were
  written by the developer and are recorded verbatim.
- Purpose (finding C1): "Devolada lets a Mexican ISP (the *business*, or
  Negocio) collect its customers' payments by SPEI, validate the transfer
  through Consta, and act on it in the ISP's own system" → "Devolada lets
  Mexican businesses collect payments by SPEI, with dedicated downstream
  automation for ISPs."
  What this decides, beyond the wording: the business is no longer assumed to
  run an internet service, and acting in the business's own system is one thing
  that can follow a verdict rather than the definition of the product. ISPs keep
  a named place — the WispHub automation is "dedicated", not legacy.
  What it does NOT change: the money never touches Devolada. The payer transfers
  to the business's own CLABE and Consta validates against Banxico. That is what
  makes the widening affordable, and no principle here grants Devolada custody
  of anyone's money.
- Modified principles: III. One Contract, Pure Routers — the envelope bullet is
  split in two. The base envelope is now stated without an inline exception, and
  a second bullet permits an optional `message` and an optional boolean
  `retryable` on any surface whose callers are programs rather than browsers.
  `apps/consta` stops being a named exception and becomes an instance of the
  rule; browser-facing routes are explicitly barred from both properties, so
  es-MX product copy is never replaced by a provider's message.
  The test is program-vs-browser, not internal-vs-external, and the distinction
  is load bearing: `apps/consta` is internal — consumed directly by the
  `apps/api` Worker, exposed to nothing else — while `/v1/*` is deliberately
  reachable by other companies' systems. Both answer programs, so both qualify.
  Scoping the grant to internal services would have excluded `/v1/*`, the
  surface it was written for; scoping it to the path `/v1/*` would have excluded
  `apps/consta`, which mounts at `/validate`, `/extract`, `/banks` and
  `/admin/keys` and already sends `retryable` from eight places. It also
  survives the Environments row's own expectation that Consta may one day have
  an external consumer: on this test, that day amends nothing.
- Added sections: none. Removed sections: none. Renamed principles: none.
- Code impact: `apps/consta` already answers with `retryable` and needs no
  change. Nothing in the tree sends `message` today — the property is permitted,
  never required, and no existing response shape moves.
- Templates: plan-template.md ✅ (Constitution Check is filled at plan time from
  this file); spec-template.md ✅; tasks-template.md ✅; checklist-template.md
  ✅. No placeholder change needed.
- Carried from v1.1.0, still open: the Purpose amendment does not settle who may
  be admitted as a business, or whether identity is checked before one can
  collect. The developer deliberately left that open on 2026-09-12;
  `businesses.status` already gates the money path, so a policy can arrive later
  without a migration.

Sync Impact Report (v1.1.0)
- Version change: 1.0.0 → 1.1.0 — MINOR: six rules added to an existing
  principle, none removed or redefined, no renumbering.
- Modified principles: VI. Visual Foundations (NON-NEGOTIABLE) — extended with
  the layering scale, the single dimming treatment, packages/ui as the one
  definition of a shared atom (compact 40px / standard 48px / decisive 64px),
  and the feedback motion vocabulary (waiting breathes, the outcome
  cross-fades, motion never carries state alone nor escalates). The existing
  "prefers-reduced-motion honoured" bullet is now given its meaning rather than
  replaced: translation, scale and rotation go; an opacity-only breath at low
  amplitude stays, so a working screen never reads as frozen.
- Added sections: none. Removed sections: none. Renamed principles: none.
- Source: .specify/design/foundations.md, runs 1 and 2 (2026-09-09), decisions
  D5–D15. The gaps those rules close are documented there and are NOT yet
  fixed in code — the amendment leads the implementation on purpose.
- Numbering kept deliberately (carried from v1.0.0): VII is "every test cites
  its story" because scripts/spec-lint.mjs and .github/workflows/ci.yml refer
  to it as "constitution VII"; VI is "visual foundations" because the
  web-design-guidelines overlay refers to Principle VI.
- Templates: .specify/templates/plan-template.md ✅ (Constitution Check is
  filled at plan time from this file); spec-template.md ✅; tasks-template.md
  ✅; checklist-template.md ✅. No placeholder change needed.
- Follow-up TODOs:
  TODO(TD-005): still open from v1.0.0 — spec-lint runs warning-only until the
  debt it names is registered with /speckit-debt-log; .specify/debt/ does not
  yet exist.
  TODO(MOTION-DEBT): the 15 hand-written `duration-150` literals (foundations
  D15) are debt to register before the design-foundations feature runs.
  TODO(BREATH-AMPLITUDE): the amplitude and period of the permitted
  opacity breath are undecided (foundations §6); until they are, "low
  amplitude" is a judgement call, not a measurement.
-->

# Devolada Constitution

Devolada lets Mexican businesses of any kind collect payments by SPEI and
validates every transfer. A business may also collect in cash at a store of
the network Devolada runs: there the store's word confirms the payment, and
the business confirms each hand-over of the cash. The money never touches
Devolada either way. What a business's own system does with a payment
goes through an adapter for that system: today there is one, WispHub, for
ISPs (Principle IX). It is built by one developer working with AI agents;
that developer decides. Ask for decisions, not approvals.

## Core Principles

### I. Spec-Driven, Every Decision Cited

- Features are specified with Spec Kit under `specs/NNN-slug/` before they are
  built: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-implement`. A bug takes the lite path (`/speckit-bug-assess` →
  `-fix` → `-test`, under `.specify/bugs/<slug>/`); a shortcut is registered
  with `/speckit-debt-log` under `.specify/debt/<slug>/`.
- Every non-obvious rule in code MUST cite the decision that made it, in a
  comment, in the form `<feature-slug> D<n>` (e.g. `direct-payment D9`).
  A comment explains *why*, and when the reason was measured it says when
  (`measured 2026-08-19: …`).
- The retired specification corpus lives read-only in
  `leolicona/devoladapago-legacy-documentation`; anything rebuilt is
  specified again with Spec Kit, never by editing the archive.

Rationale: the codebase reads as a trail of decisions. A rule without its
decision is one nobody dares change and nobody can verify.

### II. Money Law

- Money is integer cents, end to end: schema columns (`*_cents`), API
  contracts (`receivedCents`), UI props. Floats never touch an amount.
- Provider values (decimal strings, JSON numbers) are converted by string
  parsing (`decimalToCents`, `amountToCents`); `value * 100` is forbidden.
- Display is `Intl.NumberFormat("es-MX", { currency: "MXN" })`; amounts render
  with tabular numerals. SPEI is exact to the cent: reconciliation tolerance is
  born at 0 and only a business decision raises it.
- Timestamps are milliseconds since epoch. The business's timezone owns
  "today" (`America/Mexico_City` by default) — never the browser, never UTC.

Rationale: a payment platform's one unforgivable bug is being a cent off. The
law removes the class of error rather than testing for it.

### III. One Contract, Pure Routers

- Every API resource has `routes/<area>/{index,handler,schema}.ts`. The router
  is pure: middleware, `zValidator`, wiring, nothing else. Logic lives in the
  handler. Schemas are zod and are THE contract: exported from `@devolada/api`
  (`./<area>-schema`), imported by the admin, the payment page and the store
  app for types,
  and used by MSW handlers and Playwright stubs to validate every fixture.
- Responses wear one envelope: `{ success: true, data }` or
  `{ success: false, error: { code } }` with `UPPER_SNAKE` codes. Better Auth's
  own endpoints are the only exemption and the clients know it (`baPost`).
- A surface whose callers are programs rather than browsers may extend that
  error object, and only such a surface may: it MAY carry an optional `message`
  and an optional boolean `retryable` (`error: { code, message, retryable }`),
  so a programmatic client can tell a failure worth retrying from one worth
  fixing. One surface qualifies today: the `/v1/*` contracts in `apps/api`,
  which serve other companies' systems. The SPEI validation engine is a
  component of `apps/api`, not a surface — its in-process failure carries
  `retryable`, and that is not an envelope. Neither property is ever
  required. A browser-facing route MUST NOT carry either: its client ships
  with the code list, and its words are es-MX product copy, never a
  provider's `message`.
- A vocabulary that must agree in several places (the bank list) is generated
  from one documented source (`scripts/gen-banks.mjs`) and CI fails when a copy
  drifts (`--check`). Hand-transcribed duplicates are forbidden.

Rationale: a frontend that derives its types from the server's schema cannot
drift into fiction the server would never send; a stub validated by the same
schema cannot test a shape that does not exist.

### IV. Tests Run on the Real Runtime

- API tests run in workerd via `@cloudflare/vitest-pool-workers` with a real
  local D1: migrations applied per test, isolated storage, **no database
  mocks**. External providers (WispHub, apiCEP, Resend) are intercepted at
  the network edge (`fetchMock`) at their real origin; the vitest config pins
  those origins and secrets so `.dev.vars` can never redirect a suite. The
  receipt reader is a Workers AI binding, not an origin: it has no local
  runtime, so tests stub it at the binding (`env.AI`) — the one binding a
  test may stand in for, and the answer it returns is a measured one.
- Component tests run on happy-dom with Testing Library and MSW
  (`onUnhandledRequest: "error"`); handlers answer with the envelope and
  schema-validated fixtures. `axe` runs on every rendered screen, with
  `color-contrast` and `target-size` disabled there because a simulated DOM
  cannot answer them.
- The browser layer (Playwright + axe, `tests/e2e`) answers what needs
  layout: real contrast in light and dark, touch-target size, tab order with
  a *measured* focus indicator, no horizontal scroll at 360/768/1280. The
  passkey ceremony (`tests/passkey`) runs against a real API with Chromium's
  virtual authenticator.
- A test starts from empty or it is not a test: module caches are reset
  `beforeEach`, MSW handlers `afterEach`, `localStorage` where a screen
  remembers state.

Rationale: what happy-dom cannot measure is guessed, and a guessed verdict is
worth less than no verdict. Each layer answers only the questions it can.

### V. Tenant Isolation and Authorization by Area

- Every business table carries `business_id`; every business query filters by
  the actor's business. The business actor is resolved from Better Auth's
  membership and active organization on every request (`requireSession`),
  with the membership's role riding along.
- A store is the one actor that is not a member of a business:
  - It is resolved from its own record on every request (`requireStore`),
    never from a membership, and a business route refuses it.
  - It reaches only the businesses the platform operator switched the cash
    channel on for.
  - Of their customers, it sees only three things: what a typed search
    returns (name, usuario, zone); one customer's debt; and, for a payment
    it recorded, that customer's phone. The phone is read from the
    business's system when the receipt is sent, used only to address that
    receipt, and never stored.
  - `stores` and `store_invitations` are platform rows without
    `business_id`. Every movement of a business's money carries it: the
    payment, the store's cash book and the hand-over.
- Authorization names an area and an action (`requireArea("payments",
  "operate")`), never a button. `auth/role-matrix.ts` is the single source of
  truth: pure data, imported by the admin as `@devolada/api/role-matrix`, so it
  MUST never import server code. Better Auth's plugin roles are derived from
  it, never written twice.
- Platform operators come from `PLATFORM_OPERATOR_EMAILS`; the right is never
  grantable from a screen — changing it is a deploy.
- A credential the product only ever compares is stored as a SHA-256 hash and
  shown in plaintext once, at issuance; a credential the product must send to
  a provider is stored as it is, with the same trust as the row it sits on.
  Dev-only routes answer 404 outside `ENVIRONMENT=dev`. CORS is an allow-list
  of frontend origins.
- The validation and reading records (`validations`, `extractions`) carry
  `business_id`, NULL for the platform's own top-ups. Exactly three derived
  statistics read across businesses. Two come from decision
  `consta-api-merge D4`: the bank clave shape (proof-extraction D14) and
  Banxico's latency per bank pair (learned-retry D2). The third comes from
  `receipt-reader-tuning`: the count of payer readings where the chosen
  reader model failed and the default model read instead, shown only to the
  platform operator. The first two are facts about banks and return a rule;
  the third is a fact about a reader model and returns a number. None
  returns a row, and none reads a column that names a business or a payer.
  A fourth such read is an amendment, not a comment.

Rationale: a multi-tenant payment system leaks money, not just data, when a
filter is missing. One matrix, checked by area, is auditable with grep.

### VI. Visual Foundations (NON-NEGOTIABLE)

- All UI consumes semantic design tokens from `packages/ui/src/styles/tokens.css`
  (`--color-surface`, `--space-4`), mapped to Tailwind via `@theme inline`. No
  raw colour, size or spacing values in components; component tokens are
  derived, never new values. `tokens.css` is the law:
  `scripts/contrast-lint.mjs` measures it and CI fails on drift.
- Aesthetic direction: functionalist (Rams), warm neutrals, deep-teal action
  accent, subtle borders over shadows, minimal purposeful motion — "trust
  doesn't bounce". Colour is information (green paid, amber queued, red
  failed) and is ALWAYS paired with icon + text.
- Accessibility: WCAG 2.2 AA minimum — 4.5:1 body text, 3:1 controls, borders
  and focus ring; AAA is the aim on status and amount inks. Focus is visible
  and measured; keyboard-complete; `prefers-reduced-motion` honoured.
- Dark mode is its own palette, never an inversion: system preference plus
  `[data-theme]`, verified in both themes by contrast-lint and the browser
  layer.
- Mobile-first: real floor 360px, designed at 375; body text 16px; touch
  targets 48px, 64px for the decisive action; no horizontal scroll, ever.
- Copy is es-MX product copy: the customer's page says "pago", never
  "cobro"; auth emails carry codes, never links. Fonts are self-hosted
  (Archivo Variable, JetBrains Mono for folios and keys); no external font
  requests.
- Stacking order is semantic and tokenised: every overlapping surface takes its
  position from the layering scale in `tokens.css`. No raw z-index in a
  component, and no new layer without a name.
- One dimming treatment: every modal surface — dialog, sheet, confirmation —
  renders the same backdrop from `--color-surface-overlay`. A hand-mixed
  translucent black or ink is drift, in either theme.
- `packages/ui` is the single definition of any atom more than one surface
  renders; a duplicate recipe in an app is drift. A surface that ships no
  client framework consumes the atoms rendered at build and the recipes as
  class strings — the definition stays in the package either way. Sizes are
  declared, not improvised: compact (40px, desktop admin), standard (48px
  touch), decisive (64px). Primitives only one surface uses may live in that
  app, but consume the shared tokens and never redefine a value.
- Feedback has a named motion vocabulary: waiting breathes, the outcome
  cross-fades, nothing spins or bounces on the payer's page. Duration and
  easing come from tokens — a literal duration in a component is drift.
- Motion never carries state on its own, and it never escalates: when a wait
  grows, the copy says so and the animation does not.
- Reduced motion removes translation, scale and rotation — never the feedback
  itself. An opacity-only breath at low amplitude is the permitted floor, so a
  screen that is still working never reads as frozen.

Rationale: the customer proofreads a CLABE and an amount on a phone in a bank
app's shadow. Every rule here is one way that reading goes wrong.

### VII. Every Test Cites Its Story

- Every `*.test.*` / `*.spec.*` file under `apps/` and `packages/` MUST cite
  what it proves: `<feature-slug> US<n>` for a Spec Kit story, `US-XNN` for a
  story still carried from the archive, or `bug: <slug>` for a regression from
  the lite path. A bare `US1` is not a citation.
- `scripts/spec-lint.mjs` enforces the citation in CI. It is warning-only
  until the debt it names (TD-005) is paid; paying it makes the gate an error.
- A task in `tasks.md` carries its `[US<n>]` label so the test that lands for
  it inherits the citation.

Rationale: coverage that can be traced with grep is coverage that can be
questioned. A test nobody can tie to a promise is a test nobody can retire.

### VIII. Absent Configuration Degrades, Never Breaks

- Every binding is declared in `env.ts` with a comment saying what "unset"
  means. An optional secret that is missing turns its feature *unavailable*
  with a warning (no provider credential → the SPEI channel says so; no Resend
  key → the code is logged; no AI binding → the receipt reader falls back to
  the provider's OCR); it never throws at the edge and never leaves a customer
  looking at a void.
- The one exception is named: `BETTER_AUTH_SECRET` is required to deploy;
  CI refuses to finish a deploy without it.
- Secrets live in CI environments and are `wrangler secret put` *after* the
  deploy (TD-011); nothing secret is committed (`.dev.vars*` is ignored).
  Base URLs, model ids and feature switches are `vars`, never literals — an
  environment without the provider credential is a decision the deploy log
  records with a warning, never an accident.
- A secret that exists is not a secret that works: a deploy verifies the
  provider credential it planted, and reads the body, not just the status.

Rationale: the failures that hurt were silent — a green step that planted a
dead token, a missing HMAC key that lost a month of payer history. Degrade
loudly, in the UI and in the deploy log.

### IX. The Core Speaks Generic; Adapters Translate

- Devolada is the **core**: payment links, SPEI validation, payments, the
  panel, the payer's page, the collections API, the store channel. An **adapter** connects the
  core to one provider's system (today `apps/api/src/wisphub/`, for ISPs).
  The core never assumes the business is an ISP.
- What belongs to one provider lives inside its adapter: its endpoints and
  query strings, its pagination and cursors, its field names and words, its
  error vocabulary, and every fact measured about it (for example, WispHub's
  billing run folding the carried balance into a new invoice). A core route,
  handler, contract, table or screen MUST NOT build a provider's path, parse
  its payload, or carry a rule that holds only for that provider.
- The core asks by **capability**, never by provider name. An adapter
  declares what it can do (list customers, read open invoices, read one
  customer's debt, register a payment, reconnect, absorb an overpayment), and
  the core offers a feature because the business's integration has that
  capability. A business with no integration, or whose adapter lacks the
  capability, gets the core without that feature: it is simply not offered.
  The screen speaks only when something the business relies on is missing
  or failing — a connection down, a key refused — and never leaves a void
  (Principle VIII).
- Contracts, tables and copy use the core's words: business, customer, open
  invoices, debt, integration. A provider's name appears in a contract only
  as the value that says which provider an integration is, and in copy only
  where the screen is about that integration (its setup, its failures).
- The core reaches an adapter through one entry point that picks the adapter
  for an integration and returns the capabilities it has. Adapters import the
  core; the core imports no adapter internals. Generic rules never live in an
  adapter's folder: the money law's parsers (Principle II) serve the whole
  product and belong to the core.
- Code that already breaks this principle is registered with
  `/speckit-debt-log`, which is how the gap stays visible rather than
  tolerated, and is paid through the normal flow. New code MUST NOT add a
  leak: `/speckit-plan` gates it in the Constitution Check, and
  `/speckit-analyze` treats a new leak as CRITICAL.

Rationale: the product serves many kinds of businesses. Every rule written in
one provider's words inside the core is a rule the next adapter must route
around, and an ISP's facts silently become every business's facts. An
adapter that owns its provider's quirks can be measured, replaced or joined
by a second one without touching what the payer and the operator rely on.

## Technology Stack & Constraints

The stack is fixed; a plan that departs from it justifies the departure in
Complexity Tracking.

| Layer | Convention |
| --- | --- |
| Runtime | Cloudflare Workers, `compatibility_date` 2025-05-01, `nodejs_compat` where Better Auth needs it |
| API | Hono 4 + `@hono/zod-validator`; `apps/api` — the product API, the SPEI validation engine (Consta, at `src/consta/`, attributed by `business_id` and reachable only in-process), and the every-minute cron sweeps |
| Data | D1 via Drizzle ORM (`sqlite`), one database, migrations generated by `drizzle-kit`, additive — the per-PR preview applies them to the live dev database while the deployed Worker keeps serving; R2 for transfer proofs behind signed URLs; Workers AI for receipt reading (the models are a var; the platform operator picks one of them in `/operador`) |
| Auth | Better Auth 1.6: email + password with OTP verification, passkeys (`@better-auth/passkey`), organization plugin as the tenant twin, `username` plugin for the shopkeeper's phone sign-in; sessions in our D1 |
| Frontend | React 19, Vite 6, Tailwind CSS 4, shadcn/ui (new-york, lucide) over Radix, TanStack Router + Query; `apps/admin` (panel), `apps/pago` (public payment page) and `apps/red` (the shopkeeper's app, phone-first) served as assets-only Workers with SPA fallback |
| Shared UI | `@devolada/ui`: tokens, base stylesheet and atoms consumed by every surface |
| Landing | `apps/landing`: Astro (static output, no adapter) on an assets Worker with a script in front for the host redirect, the channel tag and the headers; consumes `@devolada/ui` tokens, stylesheet, atoms and recipes at build; ships no client framework |
| Language | TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`; Node 22; pnpm 10 workspace |
| Tests | Vitest 3 (`vitest-pool-workers` for Workers, happy-dom for React; Vitest 4 in `apps/landing`, whose Astro build sits on Vite 8, until the workspace moves), MSW 2, Testing Library, Playwright 1.6x + axe |
| Environments | `dev` and `prod` per Worker under `devoladapago.com`; per-PR preview versions. The engine deploys where the API deploys; whether an environment validates is decided by the provider credential planted there, not by a deploy |

Additional constraints:

- Product copy is es-MX; identifiers and comments are English.
- The app never proxies the API through Vite: SPA routes and API paths share
  names, so clients call the Worker directly with `VITE_API_URL` baked in at
  build time.
- One Worker trigger: new sweeps ride the existing every-minute cron with
  `waitUntil`, and speak only when they did something.

## Development Workflow & Quality Gates

- Work happens on a branch and lands in `main` by pull request. Every PR
  runs, in order: `spec-lint`, `gen-banks --check`, `contrast-lint`,
  typecheck, unit/component/API tests, build. All MUST pass; none may be
  skipped, disabled or quarantined to get green.
- With `PREVIEW_ENABLED`, every PR uploads no-traffic preview versions of the
  five Workers against the dev database; migrations are applied early
  because they are additive.
- Merge to `main` deploys `dev`: the browser layer (`pnpm e2e`) and the
  passkey ceremony (`pnpm e2e:passkey`) gate the deploy, then migrations,
  deploy, secrets sync, credential verification, smoke test.
- Production deploys from a `v*` tag, and the tag is the approval: pushing
  it is the deliberate act, taken on a `main` commit whose dev deploy finished
  green — the release refuses any other commit before it touches production —
  with a D1 export archived before migrating.
- A feature is done when its spec's stories have cited tests at the layer
  that can answer them (Principle IV), its plan's Constitution Check passes,
  and `/speckit-analyze` reports no CRITICAL finding.
- A shortcut taken on purpose is registered the same day with
  `/speckit-debt-log`; it is closed only by `/speckit-debt-pay` with evidence.

## Governance

- This constitution supersedes every other practice document in the repo.
  Where code and constitution disagree, one of them is amended — silently
  tolerating the gap is not an option.
- Amendments go through `/speckit-constitution` and bump the version:
  MAJOR for removing or redefining a principle, MINOR for adding one or
  materially expanding guidance, PATCH for wording. Each amendment updates
  the Sync Impact Report and the `Last Amended` date.
- Compliance is checked at three points: `/speckit-plan` fills its
  Constitution Check with one gate per principle and records any justified
  violation in Complexity Tracking; `/speckit-analyze` treats a conflict as
  CRITICAL; CI runs the executable half (`spec-lint`, `contrast-lint`,
  `gen-banks --check`).
- Principle numbers are stable: code and CI cite them (`constitution VII`).
  A renumbering is a MAJOR change and updates every citation in the tree.
- The developer decides. When a principle blocks a feature, the feature's
  plan says so and proposes the amendment; it does not route around it.

**Version**: 1.9.0 | **Ratified**: 2026-09-09 | **Last Amended**: 2026-10-01

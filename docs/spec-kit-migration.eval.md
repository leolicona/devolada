# Spec Kit migration — evaluation of the alternatives

> **Status: evaluation, no decision taken.** This document exists to let the
> owner choose. It carries no US-ID and reserves none: adopting any option
> below changes the methodology (`docs/SPEC.md`, `CLAUDE.md`,
> `scripts/spec-lint.mjs`), not the product. Written 2026-09-08 against
> spec-kit at commit `4a7341a` (v1.0.5.dev0; latest release 1.0.4,
> 2026-09-02), verified by reading the sources and running `specify init` —
> not from the published guides, most of which are now wrong (see §2).

## 1. The measured baseline — what a migration would be moving

| Asset | Volume |
|---|---|
| Living specs `docs/<domain>/<feature>.spec.md` | 36 files · ~9 400 lines · ~120 000 words |
| Numbered decisions (`D1…Dn`, mini-ADRs with discarded alternatives) | 367 |
| **Inline citations of those decisions** (`pivot D5`, `debt-truth D16`, …) | **2 347** |
| US-IDs reserved in `SPEC.md` | 60 distinct, cited in 85 test files |
| Relative links between docs | 54 |
| Parallel registers | `BUGS.md` (BUG-021 and down), `TECH_DEBT.md` (19 × `TD-NNN`) |
| Cross-cutting layers | `ARCHITECTURE.md` · `FRONTEND.md` · `TESTING.md` · `CICD.md` · `integrations/*.md` |
| Enforcement | `scripts/spec-lint.mjs`, blocking in CI |

Two properties of this corpus decide the whole evaluation:

1. **The specs are a living reference organized by domain**, not per-cycle
   artifacts. `SPEC.md` rule 2 is explicit: *"The `.spec.md` is updated with
   reality during development; it never forks."* A spec carries its
   Decisions, Contract, Schema, UI Contract, Scenarios and DoD, and stays
   the thing you read to know what the system does today.
2. **The decisions form a citation graph.** 367 nodes, 2 347 edges. `pivot
   D5` is quoted from six other specs; `direct-payment D11` from eight.
   That graph is the project's institutional memory, and it is what makes
   the specs cheap to amend instead of rewrite.

## 2. What Spec Kit 1.x actually is (verified, not remembered)

Between v0.10 and v1.0 the project changed shape. Anything written before
mid-2026 — and most blog posts — describes a tool that no longer exists.
Verified at `4a7341a`:

- **Git branching is out of the core.** `scripts/bash/*` contains **zero**
  git invocations (the only two matches in `create-new-feature.sh` are
  comments about signed arithmetic). `get_current_branch()` reads
  `SPECIFY_FEATURE` or returns empty — there is no `git rev-parse` fallback
  anywhere. Branching lives in an **opt-in** `git` extension. `--no-git` was
  removed in v0.10 because git is no longer assumed.
- **The active feature is a path, not a branch.** `get_feature_paths()`
  resolves `SPECIFY_FEATURE_DIRECTORY` → `.specify/feature.json` →
  hard error. `feature.json` is gitignored by the managed
  `.specify/.gitignore`, so it is per-checkout state — which is exactly what
  our worktree rule (CICD.md, "one spec per worktree") wants.
- **`--ai` is gone**, replaced by `--integration`. For Claude the CLI writes
  `.claude/skills/speckit-<name>/SKILL.md` — agent skills, not
  `.claude/commands/*.md` — and the invocation separator is `-`, so the
  commands are `/speckit-plan`, not `/speckit.plan`. It never touches
  `CLAUDE.md` (that is the opt-in `agent-context` extension).
- **`init` creates no `specs/` directory and no constitution content.**
  Output is `.claude/skills/*`, `.specify/{memory,scripts,templates,
  integrations,workflows}`. `specs/` appears on the first `/speckit-specify`.
- **The feature directory may be any path**, but the **filenames inside it
  are hard-coded**: `$FEATURE_DIR/{spec,plan,tasks,research,data-model,
  quickstart}.md` and `contracts/`. This single fact drives §6.
- **Templates are customizable safely.** `.specify/templates/overrides/<name>.md`
  is priority 1 with a "replace" strategy, above presets, extensions and
  core. Overrides are files the package does not ship, so an upgrade cannot
  clobber them. Editing `.specify/templates/*` **in place** is unsafe —
  `init --force` overwrites those.

The command surface: `constitution → specify → clarify → plan → checklist →
tasks → analyze → implement → converge`. Notable members:

- **`/speckit-analyze`** — read-only cross-artifact consistency report over
  spec/plan/tasks/constitution. **It never reads source code.**
- **`/speckit-converge`** — the one command that does read the codebase and
  compare it against the spec. Append-only: its sole possible write is a new
  `## Phase N: Convergence` section at the end of `tasks.md`.
- **`/speckit-checklist`** — reviewer-owned "unit tests for requirements".

Spec template mandates `## User Scenarios & Testing`, `## Requirements`
(`FR-001`: System MUST …), `## Success Criteria` (`SC-001`, required to be
measurable and technology-agnostic) and `## Assumptions`, with
`[NEEDS CLARIFICATION: …]` markers capped at three.

**What it does not ship:** `specify --help` lists `init check version self
extension integration event preset bundle workflow`. There is **no `lint`,
`validate` or `doctor`**, no schema, no exit code that fails a build. Nothing
parses `FR-###`, `SC-###` or `[NEEDS CLARIFICATION]` — those are conventions
consumed by prompts. Drift is the acknowledged structural weakness; an
entire cottage industry of community extensions (`reconcile`, `drift`,
`ci-guard`, `arch-governance`) exists because core has no answer.

## 3. Concept mapping

| Devolada | Spec Kit 1.x |
|---|---|
| `docs/<domain>/<feature>.spec.md` (one living file) | `specs/NNN-slug/` (five-plus files) |
| `## Decisions` — `D1…Dn`, stable IDs, cited across specs | **No equivalent.** Rationale → `research.md` (unnumbered, per-feature); rejected alternatives only reach `plan.md` § Complexity Tracking, and only when the constitution is violated |
| `## Contract`, `## Schema`, `## UI Contract` | `contracts/`, `data-model.md` — treated as implementation-time derivations, not maintained reference |
| `## Scenarios`, `## Definition of Done` | `### Acceptance Scenarios` (Given/When/Then), `## Success Criteria` (`SC-###`) |
| `SPEC.md` — glossary + US-ID registry + index + rules | **Split and mostly lost.** Rules → `constitution.md`; glossary → nothing; index → nothing (no manifest, `specs/` is a directory scan) |
| `US-D03: …` cited in 85 test files | `US1`/`US2` story labels, `FR-###`/`SC-###` — per-feature, not repo-wide |
| `ARCHITECTURE` / `FRONTEND` / `TESTING` / `CICD` / `integrations/*` | **No equivalent.** The constitution is a principles document, not a technical layer reference. Spec Kit's own monorepo guide says flatly there is no base/inheritance mechanism |
| `BUGS.md` (one append-only log) | `bug` extension → `.specify/bugs/<slug>/{assessment,fix,test}.md`; three files per bug, **no aggregated log** |
| `TECH_DEBT.md` (`TD-NNN` + payment condition) | **No equivalent** |
| Lite path (bugfix = BUGS entry + test, no spec) | **No equivalent** |
| `scripts/spec-lint.mjs`, blocking in CI | **No equivalent** |

## 4. The four frictions

**F1 — Organization axis.** `specs/NNN-slug/` is chronological and flat. Our
tree is domain-organized, and the domain axis is load-bearing: US-ID letters
(`S`/`C`/`A`/`L`/`V`/`D`/`B`/`R`/`I`/`P`), the `SPEC.md` index and the
glossary all key on it. Renumbering 36 specs into arrival order discards it.

**F2 — The decision graph.** This is the expensive one. Spec Kit has no ADR
concept and no stable citable decision ID. Adopting the stock spec template
means 367 decisions lose their identity and 2 347 citations lose their
referent. *Mitigable* — an overridden spec template can mandate a
`## Decisions` section — but nothing upstream supports or checks it.

**F3 — Persistence model.** Spec Kit deliberately refuses to choose one
(`docs/concepts/spec-persistence.md` names flow-back, flow-forward and
living-spec and states *"none is the default, and none is required"*). The
tooling nevertheless biases **flow-forward**: `create-new-feature.sh` errors
on an existing directory, `setup-plan.sh`/`setup-tasks.sh` skip files that
exist, numbering only increments. Our model is unambiguously **living
spec**. Adopting Spec Kit does not give us that discipline — we would keep
enforcing it by convention exactly as today, so there is no gain here, only
a tool pulling gently the other way.

**F4 — Artifact fan-out.** One Devolada spec maps to five Spec Kit files.
36 specs become 150+. Worse, the sections we depend on as *living contract*
(Contract, Schema, UI Contract) land in `plan.md`/`data-model.md`/`contracts/`,
which Spec Kit treats as disposable derivations. This is precisely the
documented failure mode: "a sea of markdown documents", and "spec volume
drowns the actual project structure" on multi-module brownfield repos — which
is what `apps/{api,consta,pago,admin}` + `packages/ui` is.

**And the gap that is not a friction but a floor:** Spec Kit ships no
enforcement. Our golden rule is enforced by a linter that fails CI. Whatever
we adopt, **`spec-lint.mjs` cannot be retired** — nothing upstream replaces
it, and `/speckit-analyze` is an LLM reading markdown for one feature that
never opens a source file.

## 5. What Spec Kit genuinely adds

Stated fairly, because these are real:

1. **A named, repeatable command surface**, installed as Claude skills. Today
   the interview → decisions → spec loop lives as prose in `CLAUDE.md` and
   is re-improvised every feature.
2. **`/speckit-clarify`** — a bounded ambiguity hunt (≤5 questions) before
   planning, with the answers folded back into the spec.
3. **The Constitution Check as a gate inside `/speckit-plan`**, run before
   Phase 0 and again after Phase 1. We have `ARCHITECTURE.md` and
   `FRONTEND.md`, but nothing forces a per-feature check against them —
   which is how TD-019 happened (a law asserted in a spec and true nowhere).
4. **`SC-###` measurable, technology-agnostic success criteria.** Our DoD
   boxes are prose and several are unmeasurable by construction ("the
   deployed check is open").
5. **`/speckit-converge`** — the closest thing to a machine-assisted golden
   rule: read the code, compare against the spec, append what is missing.
6. **`/speckit-checklist`** — reviewer-owned requirement checklists, with
   explicit "agents must not self-check" semantics.
7. **Standard vocabulary** if a second engineer ever joins.

## 6. The alternatives

### A — Canonical migration

Everything moves to `specs/NNN-slug/`; each spec is split into the five-file
shape; `SPEC.md` dissolves into `constitution.md`; `spec-lint.mjs` retires.

- **Wins:** the stock workflow with zero customization; upgrades are free.
- **Costs:** all four frictions at full force. 367 decisions and 2 347
  citations lose their referent. Domain organization gone. Enforcement gone.
  ~120 000 words rewritten by hand (an LLM rewrite of a corpus this size is
  where the amendment history — the *why we did not do X* — quietly dies).
  `BUGS.md`, `TECH_DEBT.md`, the layer docs and the lite path have no home.
- **Verdict: reject.** It trades the strongest parts of the system for a
  command surface obtainable without them.

### B — Layout migration, Devolada semantics *(recommended)*

Each spec becomes its own directory, **staying in its domain**:
`docs/<domain>/<feature>.spec.md` → `docs/<domain>/<feature>/spec.md`. One
file per spec — **no fan-out**. `.specify/templates/overrides/spec-template.md`
mandates our section set (Decisions `D1…Dn`, Contract, Schema, UI Contract,
Scenarios, DoD) plus the two Spec Kit ideas worth having (`SC-###` in the
DoD, `[NEEDS CLARIFICATION]`). `SPEC.md` stays as glossary + US-ID registry
+ index. `spec-lint.mjs` stays, taught the new path. The git extension is
**not** installed.

This works because `SPECIFY_FEATURE_DIRECTORY` accepts an arbitrary path —
`docs/direct-payment/partial-payment` is a legal feature directory — and
because it is gitignored per-checkout, which matches the worktree rule.

- **Mechanical churn, measured:** 36 `git mv` · 36 index rows · 54 relative
  links · one linter walk. The 2 347 D-citations are **prose, not paths** —
  they survive untouched. The 60 US-IDs in 85 test files are **unaffected**.
- **Wins:** the full command surface works, including `/speckit-plan`,
  `/speckit-tasks`, `/speckit-analyze` and `/speckit-converge`. Domain
  organization, decision graph, living-spec discipline and enforcement all
  survive. Reversible: the rename is one `git mv` away from undone.
- **Costs:** we own an override template and a command override forever;
  every `specify` upgrade needs a diff of core templates against ours. The
  `NNN-` numbering convention is abandoned (nothing checks it, but we leave
  the beaten path). `plan.md`/`tasks.md` become per-spec ephemera, which
  contradicts `SPEC.md` rule 4 ("`.plan.md` files are ephemeral") unless
  that rule is rewritten to say they are gitignored.

### C — Tooling only, corpus untouched

Install `.specify/`, write the constitution, use the commands; leave all 36
specs exactly where they are.

- **Wins:** zero churn, zero risk, keeps everything.
- **Costs:** **the scripted half of the pipeline does not resolve.** The
  filenames under `FEATURE_DIR` are hard-coded to `spec.md`, and ours are
  `<feature>.spec.md`. So `/speckit-plan`, `/speckit-tasks`,
  `/speckit-analyze`, `/speckit-implement` and `/speckit-converge` — every
  command with a `scripts:` key — fail to find the spec. What still works is
  `/speckit-constitution` and `/speckit-specify` (which has no `scripts:` key
  and does its own file handling). Recovering the rest means overriding the
  shell scripts too, at which point B is cheaper and cleaner.
- **Verdict:** a real option only if the goal is the constitution gate alone.

### D — Borrow the ideas, take no dependency

No `.specify/`. Fold the parts that are actually good into what we have: a
`## Constitution check` section in our own spec template that names which
`ARCHITECTURE`/`FRONTEND`/`TESTING` laws the feature touches; `SC-###`
measurable criteria in the DoD; `[NEEDS CLARIFICATION]` markers that
`spec-lint.mjs` **fails on** when a spec leaves development; a checklist
convention; a local `/converge` skill in `.claude/skills/`.

- **Wins:** the highest value per unit of risk, and the only option that
  *increases* enforcement (Spec Kit's markers become blocking here, which
  they never are upstream). No upgrade churn, no upstream coupling.
- **Costs:** it is not a migration. No standard vocabulary, no community
  tooling, and we keep maintaining our own prompts.

### E — Defer

Do nothing now; revisit when a second engineer joins or when the pilot ends
and the corpus stops moving weekly.

- **Wins:** the corpus is mid-pivot (phase 2–4 of `platform/pivot.spec.md`);
  restructuring 36 specs during a live pivot competes with the pilot.
- **Costs:** the decision recurs, and every new spec written meanwhile is
  one more file to move later — though at ~36 files, that cost grows slowly.

## 7. Matrix

| | A Canonical | B Layout+semantics | C Tooling only | D Borrow | E Defer |
|---|---|---|---|---|---|
| Decision graph (2 347 citations) | ✗ lost | ✓ intact | ✓ intact | ✓ intact | ✓ intact |
| Domain organization | ✗ lost | ✓ kept | ✓ kept | ✓ kept | ✓ kept |
| Living-spec discipline | ✗ fights it | ✓ kept | ✓ kept | ✓ kept | ✓ kept |
| Golden-rule enforcement | ✗ retired | ✓ kept | ✓ kept | ✓ strengthened | ✓ kept |
| `BUGS` / `TECH_DEBT` / lite path | ✗ homeless | ✓ kept | ✓ kept | ✓ kept | ✓ kept |
| Full command surface | ✓ | ✓ | ◐ constitution + specify only | ✗ | ✗ |
| Constitution gate in planning | ✓ | ✓ | ✓ | ◐ by convention | ✗ |
| `/speckit-converge` (code↔spec) | ✓ | ✓ | ✗ | ◐ hand-rolled | ✗ |
| Upgrade cost over time | none | template diff per release | template diff per release | none | none |
| Migration effort | weeks, lossy | ~1 PR, mechanical | ~1 PR, trivial | ~1 PR | none |
| Reversible | no | yes (`git mv`) | yes | yes | — |

## 8. Recommendation

**B, with D's enforcement additions folded into the same template.** Concretely:

1. **Do not install the `git` extension.** Core is git-free; the branch
   convention would fight trunk-based `main` for nothing.
2. **Do not adopt the five-artifact fan-out.** One spec, one file, as today.
   `plan.md`/`tasks.md` may exist per feature but are gitignored — which
   turns `SPEC.md` rule 4 from a manual discipline into a mechanical one.
3. **Keep `spec-lint.mjs` and make it stricter**, not weaker: it learns the
   new path, and gains a rule that a spec at `status: current` carries no
   `[NEEDS CLARIFICATION]` marker. Spec Kit ships no enforcement; ours is the
   floor and must not be lowered by the migration.
4. **The constitution is written from what already exists** — the golden
   rule, the glossary law (one word per concept, es-MX copy / English
   identifiers), integer cents, append-only money tables, `businessId` on
   every business table, the API envelope, never-rejected-by-provider, the
   token law and `StatusBadge`. It **summarizes and links** `ARCHITECTURE.md`
   / `FRONTEND.md` / `TESTING.md` / `CICD.md`; it does not replace them, and
   they stay the normative text (`integrations/agnostic-auth.md`'s "the local
   file wins" rule is the precedent).
5. **Sequence it after the pivot's phase 4**, or into a quiet week. The
   rename touches every spec path; running it while three specs are open in
   worktrees guarantees conflicts (CICD.md worktree rule 3 by another road).

Suggested phasing, one PR each:

- **PR 1 — no movement.** `specify init --here --integration claude --script sh
  --non-interactive`; write `constitution.md`; write
  `.specify/templates/overrides/spec-template.md` with our sections. Nothing
  in `docs/` moves. Try `/speckit-constitution` and `/speckit-clarify` on one
  spec by hand. **This PR alone answers whether the workflow suits us**, and
  is throwaway if it does not.
- **PR 2 — the rename.** 36 `git mv`, 54 links, 36 index rows,
  `spec-lint.mjs`, `CLAUDE.md`, `SPEC.md` rules 1–4. One PR, mechanical,
  no prose rewritten.
- **PR 3 — enforcement.** `[NEEDS CLARIFICATION]` blocking, `SC-###` in the
  DoD template, the `## Constitution check` section, `.gitignore` for
  `plan.md`/`tasks.md`/`.specify/feature.json`.

**Two tasks the constitution added to the plan (2026-09-08):**

1. **Fold the layer documents into the constitution before `docs/legacy/` is
   deleted.** Governance makes the constitution the governing document and the
   layers its detailed reference — an arrangement that is temporary by
   construction, since the final PR deletes them. Any law still living only in
   `ARCHITECTURE` / `FRONTEND` / `TESTING` / `CICD` at that point would be
   deleted with them. This is a per-domain job inside PR3, not a final sweep.
2. **Test citations migrate with their feature, never separately.** Principle
   VII adopts Spec Kit's per-feature `US<n>`, prefixed with the feature slug
   (`direct-payment US1: …`) so grep traceability survives the loss of global
   uniqueness. The 85 files citing a legacy `US-XNN` stay compliant until their
   feature is rebuilt; `scripts/spec-lint.mjs` accepts both forms for the
   duration, and drops the legacy one when the last domain lands.

**Do not do A.** The corpus's value is the 367 decisions and their 2 347
citations, and A is the only option that spends them.

## 9. Open questions for the owner

1. **Is the goal the workflow or the standard?** If it is the repeatable
   interview→clarify→plan→converge loop, B delivers it. If it is
   interoperability with a wider ecosystem, only A does — at the cost in §6.
2. ~~Does `apps/consta` get its own Spec Kit project?~~ **Decided
   2026-09-08: no — one Spec Kit project at the repository root, and Consta
   is one domain among the others.** The owner also retired the commercial
   premise the question rested on: Consta is the validation engine, is not
   sold separately, and its API is offered through devoladapago. The runtime
   boundary (own Worker, own D1, own API-key auth) is untouched by that — it
   is architectural, not commercial. Two consequences are open and recorded
   in [BRIEF.md](BRIEF.md) §7: how an API integrator is billed, and whether
   the no-internals rule survives now that "extraction stays a folder move"
   is no longer its justification.
3. **Timing against the pivot.** Phases 2–5 are live and specs are amended
   weekly. PR 2 wants a quiet week.
4. ~~Still unverified: whether a command override can redirect
   `/speckit-specify`.~~ **Settled by PR1.B (2026-09-08), and the answer
   changes the mechanism, not the conclusion.** A command override never
   reaches the rendered `SKILL.md` — neither `specify integration upgrade
   claude` nor `specify init --here --force` re-renders it from
   `.specify/templates/overrides/`, and the skill keeps pointing at the core
   template. It is not needed. The two mechanisms that carry option B were
   both exercised instead: template overrides resolve at priority 1 and
   **survive `init --force`**, and `SPECIFY_FEATURE_DIRECTORY` takes an
   arbitrary path — `setup-plan.sh` aimed at a `docs/` directory resolved
   `FEATURE_SPEC` and `IMPL_PLAN` inside it. So redirection is an instruction
   to the agent (in `CLAUDE.md` / the constitution), not a file to override.

## Sources

Read directly at `4a7341a`: `scripts/bash/common.sh` (`get_feature_paths`,
`get_current_branch`, `resolve_template_content`), `scripts/bash/create-new-feature.sh`,
`templates/{spec,plan,tasks,constitution,checklist}-template.md`,
`src/specify_cli/commands/init.py`, `src/specify_cli/shared_infra.py`
(`_decide_overwrite`); plus a live `specify init --here --integration claude`.

Docs: [github/spec-kit](https://github.com/github/spec-kit) ·
[Agentic SDD](https://github.com/github/spec-kit/blob/main/docs/reference/agentic-sdd.md) ·
[Core CLI](https://github.com/github/spec-kit/blob/main/docs/reference/core.md) ·
[Spec persistence models](https://github.com/github/spec-kit/blob/main/docs/concepts/spec-persistence.md) ·
[Existing projects](https://github.com/github/spec-kit/blob/main/docs/guides/existing-projects.md) ·
[Monorepo](https://github.com/github/spec-kit/blob/main/docs/guides/monorepo.md) ·
[Presets](https://github.com/github/spec-kit/blob/main/docs/reference/presets.md)

Critiques weighed: [Discussion #1784 "SpecKit creates the illusion of work"](https://github.com/github/spec-kit/discussions/1784) ·
[Discussion #152 (living specs / master spec)](https://github.com/github/spec-kit/discussions/152) ·
[Scott Logic, "radical idea or reinvented waterfall"](https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html)

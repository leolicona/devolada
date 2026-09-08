---
name: speckit-cloudflare-discover
description: Map a feature's needs to Cloudflare products, bindings and limits using the cloudflare skill and the Cloudflare MCP server, before /speckit-plan
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: github-spec-kit
  source: cloudflare:commands/speckit.cloudflare.discover.md
---

# Cloudflare Discover

Before `/speckit-plan`, turn the feature's needs into a concrete set of Cloudflare
products, bindings and the limits that matter, so the plan starts from verified
platform facts instead of memory. This command reads the spec, never edits it, and
writes one artifact: `FEATURE_DIR/cloudflare-discovery.md`.

Context: the project constitution fixes Cloudflare as the platform (the "Stack and runtime boundaries" section).
Respect the stack it names; this command chooses *which* Cloudflare products serve
each need and records the evidence.

## User Input

```text
$ARGUMENTS
```

Optional. Free text is treated as extra context (a constraint, a product the
developer already chose, a need not yet in the spec).

## Guidance sources (load in this order)

1. `.claude/skills/cloudflare/SKILL.md` — the need-to-product map. Read it in full
   before choosing anything; follow its bundled references under
   `.claude/skills/cloudflare/references/<product>/README.md` for the products you
   pick.
2. `.claude/skills/workers-best-practices/SKILL.md` — defaults every Worker must meet.
3. Product skills when relevant: `durable-objects`, `agents-sdk`, `wrangler`,
   `web-perf`.
4. **Cloudflare MCP server** (`cloudflare`, tools prefixed `mcp__cloudflare__`): if it
   is connected, use its documentation search for every limit, quota, pricing or API
   claim you record, and cite the URL it returns. If it is not connected or a call
   fails, use the bundled references and mark the row **Unverified (bundled
   reference, synced <date from .claude/skills/skills.lock.json (source `cloudflare`)>)**. Never
   present a memorised number as verified.

Prefer retrieval over pre-training: your knowledge of Cloudflare limits and APIs may
be outdated.

## Steps

1. Run `.specify/scripts/bash/check-prerequisites.sh --json --paths-only` from the
   repository root and parse `FEATURE_DIR` and `FEATURE_SPEC`. If the spec is
   missing, stop and tell the user to run `/speckit-specify` first.
2. Read `FEATURE_SPEC` and `.specify/memory/constitution.md`. Extract every need that
   touches the platform: request handling, persistence, coordination, files, async
   work, scheduling, AI inference, static assets, email, caching, observability.
3. For each need, pick the product using the `cloudflare` skill's map. When two
   products could fit, state the deciding requirement (data shape, consistency,
   coordination, lifecycle) in one sentence. Do not add a product that no need
   requires (constitution Principle V).
4. For each chosen product, record: the binding you would declare (name and type),
   the one or two limits that could bite this feature, the reference or docs URL
   you verified them against, and the skill to load during planning.
5. Write `FEATURE_DIR/cloudflare-discovery.md`:

   ```markdown
   # Cloudflare Discovery: <feature>

   **Date**: <YYYY-MM-DD> | **Spec**: spec.md | **Verification**: MCP live docs | bundled references (synced <date>)

   | Need | Product | Binding (name / type) | Limits that matter | Deciding requirement | Verified against | Skill for the plan |
   |---|---|---|---|---|---|---|

   ## Worker defaults to carry into the plan
   - compatibility_date: <today>
   - observability.enabled = true, observability.traces.enabled = true
   - `wrangler types` after binding changes

   ## Notes for /speckit-plan
   <paste-ready bullets: products, bindings, limits, which skills to consult, unverified claims to re-check>

   ## Open questions
   - [NEEDS CLARIFICATION: ...] (only for choices the developer must make)
   ```

6. Report to the user: the table in brief, the count of verified vs unverified
   claims, and the exact block to hand to `/speckit-plan`.

## Rules

- Read-only for `spec.md`, `plan.md` and the constitution.
- Every limit or API statement carries a source column; "from memory" is not a source.
- Keep the product set minimal and coherent; explain additions by the need they serve.
- Write in English (constitution governance rule).
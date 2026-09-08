---
name: speckit-cloudflare-review
description: Review a plan (mode plan) or Worker code and Wrangler config (mode code) against Cloudflare best practices, verifying limits and APIs through the Cloudflare MCP server
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: github-spec-kit
  source: cloudflare:commands/speckit.cloudflare.review.md
---

# Cloudflare Review

Check a feature against Cloudflare platform guidance and current documentation, and
write the result as `FEATURE_DIR/cloudflare-check.md` using the
`cloudflare-platform-check` template. Two modes:

- **plan** — after `/speckit-plan`: validate the plan's Cloudflare Platform Context
  (products, bindings, limits, Worker defaults) and every platform claim it makes.
- **code** — after `/speckit-implement` (or on any branch): scan the Wrangler
  configuration and Worker source for anti-patterns and missing configuration.

The command is read-only for source, configuration, `spec.md` and `plan.md`. It
reports and recommends; the developer decides what to change.

## User Input

```text
$ARGUMENTS
```

`plan` or `code`. If empty: `code` when a Wrangler configuration file exists in the
repository, otherwise `plan`. Any further text is extra context.

## Guidance sources

1. `.claude/skills/workers-best-practices/SKILL.md` and its `references/`
   (configuration, runtime patterns, platform APIs) — the checklist and the
   anti-pattern table.
2. `.claude/skills/wrangler/SKILL.md` — configuration fields and commands.
3. `.claude/skills/cloudflare/SKILL.md` and `references/<product>/` for each product
   the feature uses; `durable-objects`, `agents-sdk`, `web-perf` when relevant.
4. **Cloudflare MCP server** (`cloudflare`, tools prefixed `mcp__cloudflare__`): when
   connected, verify each limit, quota and API claim through its documentation search
   and cite the URL. When not connected, use the bundled references and mark the item
   **Unverified** with the sync date from `.claude/skills/skills.lock.json (source `cloudflare`)`.

Prefer retrieval over pre-training. Use the project's installed Wrangler version,
generated types and configured `compatibility_date` as the baseline; a newer type
package does not supersede the project's configured target.

## Steps

1. Run `.specify/scripts/bash/check-prerequisites.sh --json --paths-only` from the
   repository root; parse `FEATURE_DIR`, `FEATURE_SPEC`, `IMPL_PLAN`. Resolve the
   report template with
   `.specify/scripts/bash/resolve-template.sh cloudflare-platform-check --json`.
2. Read `.specify/memory/constitution.md` (the "Stack and runtime boundaries" and "Implementation conventions" sections are the
   MUST rules this review enforces) and `FEATURE_DIR/cloudflare-discovery.md` if it
   exists.
3. **Mode plan**
   - Read `IMPL_PLAN`. Locate the "Cloudflare Platform Context" block (project
     template override) or, if absent, the Technical Context.
   - For every product/binding row: confirm the product fits the need per the
     `cloudflare` map, confirm the binding type is valid for that product, verify the
     stated limit (MCP or bundled reference), and set Status.
   - Check the Worker defaults: current `compatibility_date`, observability with
     traces, types regenerated, secrets via `wrangler secret`, no third-party runtime
     dependency unsupported by `workerd`.
   - Check the plan's Constitution Check rows this review references this review.
4. **Mode code**
   - Locate every Wrangler configuration (`wrangler.jsonc`, `wrangler.json`,
     `wrangler.toml`) and Worker entry points (`main`, `assets`, Durable Object
     classes, queue consumers, cron handlers).
   - Configuration: `compatibility_date` present and recent; `observability.enabled`
     and `observability.traces.enabled` both `true`; bindings declared for every
     product the code uses; generated types file present and newer than the config;
     no secrets in config or source.
   - Source: walk the anti-pattern table from `workers-best-practices` (unbounded
     buffering, hardcoded secrets, `Math.random()` for tokens, un-awaited async work
     outside `ctx.waitUntil()`, module-level mutable request state, REST API calls
     where a binding exists, `passThroughOnException()` as error handling) and the
     product-specific checks from `durable-objects` / `agents-sdk` when those are used.
     Record each as Checked / Found (file:line) / N/A.
   - Run `wrangler types --check` or the project's typecheck if available; report,
     do not fix.
5. Fill the template and write `FEATURE_DIR/cloudflare-check.md`. Assign severities:
   CRITICAL for a constitution MUST or a hard platform limit; HIGH for an
   anti-pattern or a limit at risk; MEDIUM for missing configuration or an
   unverified claim; LOW otherwise. Gate = FAIL on any CRITICAL, PASS with findings
   otherwise, PASS when empty.
6. Report to the user: gate, findings count by severity, unverified claims, and the
   concrete next actions (which plan.md section or file to change; suggested
   `/speckit-plan` or manual edit). Offer, without applying, the remediation edits
   for the top findings.

## Rules

- Never modify source, configuration, `spec.md` or `plan.md`; the only write is
  `FEATURE_DIR/cloudflare-check.md`.
- Every verified claim cites a URL or a bundled reference path; every unverified
  claim is labelled as such.
- Constitution conflicts are CRITICAL and cannot be waived here.
- Write in English (constitution governance rule).
# Cloudflare Platform Check: [FEATURE]

**Mode**: [plan | code] | **Date**: [DATE] | **Feature**: [link to spec.md / plan.md]

**Guidance sources**: [skills consulted, e.g. cloudflare, workers-best-practices, wrangler, durable-objects] | **Verification**: [Cloudflare MCP server (live docs) | bundled references synced <date> — claims marked "unverified"]

## Products and bindings

| Need (from spec/plan) | Product | Binding name / type | Limit or quota that matters | Verified against | Status |
|---|---|---|---|---|---|
| [e.g. persist conversations] | [D1] | [DB / d1] | [rows read per query, DB size] | [docs URL or reference path] | [OK / At risk / Unverified] |

## Worker configuration

| Item | Expected | Found | Status |
|---|---|---|---|
| `compatibility_date` | current date for new Workers | | |
| `observability.enabled` / `observability.traces.enabled` | both `true` | | |
| Generated types (`wrangler types`) | committed and current | | |
| Secrets | `wrangler secret`, none in source or config | | |
| Assets / routes / triggers | as declared in the plan | | |

## Findings

| ID | Severity | Location | Finding | Recommendation | Source |
|---|---|---|---|---|---|
| CF-1 | [CRITICAL / HIGH / MEDIUM / LOW] | [plan.md section or file:line] | | | |

Severity: CRITICAL = violates a constitution MUST or a hard platform limit; HIGH = anti-pattern from workers-best-practices or a limit at risk; MEDIUM = missing configuration or unverified claim; LOW = wording or optional improvement.

## Anti-patterns checked (code mode)

[List each anti-pattern from workers-best-practices with Checked / Found / N/A]

## Result

- **Gate**: [PASS | PASS with findings | FAIL]
- **Unverified claims**: [count and list, when the MCP server was not available]
- **Next actions**: [what to change in plan.md / tasks.md / code; suggested commands]

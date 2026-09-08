# Spec Kit extension: cloudflare

Brings the [Cloudflare Agent Skills](https://github.com/cloudflare/skills) and the
Cloudflare MCP server into the Spec-Driven Development flow of this repository.

## What it adds

| Piece | Kind | When |
|---|---|---|
| `/speckit-cloudflare-discover` | command | before `/speckit-plan`: needs → products, bindings, limits, with sources |
| `/speckit-cloudflare-review plan` | command | after `/speckit-plan`: validates the plan's Cloudflare Platform Context |
| `/speckit-cloudflare-review code` | command | after `/speckit-implement`: Wrangler config and Worker code against best practices |
| `cloudflare-platform-check` | template | report skeleton resolved through the Spec Kit template stack |
| `before_plan`, `after_plan`, `after_implement` | optional hooks | Spec Kit offers the commands at the right moments |

## Prerequisites (provided by the repository, not by this extension)

- Skills under `.claude/skills/` synced by `tools/scripts/sync-skills.sh` (manifest `tools/skills.json`, source `cloudflare`)
  (`cloudflare`, `workers-best-practices`, `wrangler`, `durable-objects`,
  `agents-sdk`, `web-perf`). The commands read them by path.
- The Cloudflare MCP server declared in `.mcp.json` (`https://mcp.cloudflare.com/mcp`).
  Claude Code asks for approval the first time a project MCP server is used. When the
  server is unreachable, the commands fall back to the bundled references and label
  every claim as unverified.

## Install / update / remove

```bash
specify extension add --dev tools/speckit-extensions/cloudflare          # install
specify extension add --dev tools/speckit-extensions/cloudflare --force  # after editing the source
specify extension remove cloudflare
```

`--dev` copies the source into `.specify/extensions/cloudflare/` and renders the
commands as `.claude/skills/speckit-cloudflare-*`. Edit the source here, then
re-install with `--force`.

## Why an extension plus a project override (and not a preset)

- New capability (commands, hooks, a new template) → extension (priority 3).
- The "Cloudflare Platform Context" block inside the plan template is specific to a
  project whose constitution mandates Cloudflare → project-local override
  (`.specify/templates/overrides/plan-template.md`, priority 1).
- A preset would be the right layer only if several repositories needed the same
  override; extracting one later is a copy of the override file.

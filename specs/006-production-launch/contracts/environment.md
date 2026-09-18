# Contract: the production environment and the account

**Feature**: 006 · **Date**: 2026-09-17 · **Phase**: 1

What must exist outside the repository before the first release, who puts it
there, and how each item is checked. The runbook (`quickstart.md`) walks it
in order; this is the reference.

## GitHub — repository `leolicona/devolada`

### Environment `production`

| Item | Value | Set by | Check |
| --- | --- | --- | --- |
| required reviewer | **none** — the tag is the approval (D3, amended 2026-09-18); GitHub refuses the rule on a private Free-plan repository | — | `gh api repos/leolicona/devolada/environments/production --jq '.protection_rules[].type'` → `branch_policy` only |
| deployment policy | custom: tag `v*`, branch `main` | agent via `gh api`, on the creator's word (R3) — done 2026-09-18 | `gh api …/environments/production/deployment-branch-policies --jq '.branch_policies[] \| "\(.type) \(.name)"'` → `tag v*`, `branch main` |
| secret `BETTER_AUTH_SECRET` | present since 2026-08-15 | — | `gh secret list --env production` |
| secret `CLOUDFLARE_API_TOKEN` | present since 2026-09-01; scopes below | — | same |
| secret `RESEND_API_KEY` | the Resend key | **creator** — never the agent | same; the release log shows it planted |
| secret `APICEP_TOKEN` | a **second** `apicep_…` token, minted for production (D4); no trailing newline | **creator** | same; the release log shows `apiCEP accepted the credential` |
| secret `PLATFORM_OPERATOR_EMAILS` | `leolicona.dev@gmail.com` (D9) | creator, or agent with the value the creator gives | same |
| retired secret `CONSTA_ISSUER_TOKEN` | **absent** | agent, on the creator's go-ahead (R10) | `gh secret list --env production` shows no `CONSTA_*` |

### Environment `dev`

Retired secrets `CONSTA_API_KEY`, `CONSTA_ISSUER_TOKEN`, `CONSTA_ADMIN_TOKEN`
**absent** after R10. Nothing else changes.

### Repository variables

| Name | Value | Set by |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | `714b01a4209c57b8d51a7a91847357f9` (present) | — |
| `PROD_API_URL` | `https://api.devoladapago.com` (present) | — |
| `PROD_ADMIN_URL` | `https://app.devoladapago.com` | agent (`gh variable set`) — not a secret |
| `PROD_PAGO_URL` | `https://link.devoladapago.com` | agent — not a secret |

## Cloudflare — account `devoladapago`

| Item | State on 2026-09-17 | Needed | Check |
| --- | --- | --- | --- |
| D1 `devolada-db-prod` | exists, 0 tables, id `91a82e4a-…` in `apps/api/wrangler.jsonc` | the release migrates it | `d1_databases_list` / dashboard |
| R2 `devolada-transfer-proofs` | exists | lifecycle rule `expire-15d`, 15 days (D10) | dashboard: R2 → bucket → Settings → Object lifecycle rules |
| zone `devoladapago.com` | live (dev hostnames resolve) | the release creates `api.`, `app.`, `link.` custom domains | `dig` after the release |
| Workers `devolada-api`, `devolada-admin`, `devolada-pago` | do not exist | created by the release | `workers_list` after |
| deploy token scopes | Workers Scripts, D1, Workers AI, zone DNS (per the archive's CICD.md) | unchanged; **not** R2 management | a green release proves them |
| Workers AI | bound in `env.prod` (`ai: { binding: "AI" }`) | enabled on the account | the reader answers; else the image falls to the provider's OCR |
| cron `* * * * *` | in `env.prod` | created by the release | dashboard → Worker → Triggers |

## Providers

| Provider | Needed | Who | If skipped |
| --- | --- | --- | --- |
| apiCEP | second token for production (D4); note the 800-calls/month pool; one call per release for the probe (D11) | creator, at app.apicep.cloud; fallback: a second account, never a shared token | channel says "no disponible"; nothing validates |
| Resend | `devoladapago.com` still *verified* after the zone moved on 2026-09-01; the key in `production` | creator, at resend.com | nobody finishes sign-up (D5) |
| WispHub | nothing at platform level; each ISP pastes its own key, born observing | the ISP, in the panel | verdicts land, no reconnection until actions are on |

## What the agent may and may not do here

- May: set the two repository variables; delete the retired secrets and set
  `PLATFORM_OPERATOR_EMAILS` **only after the creator says so in chat**;
  configure the deployment policy via `gh api` on the same word.
- May not: see, type or store `RESEND_API_KEY`, `APICEP_TOKEN` or any
  credential. The creator sets those with `gh secret set <NAME> --env production`
  in their own terminal or in the GitHub UI.

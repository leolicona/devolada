# Data Model: production-launch

**Feature**: 006 · **Date**: 2026-09-17 · **Phase**: 1

This feature adds no table, column or row. Its entities are the things a
release is made of; they live in the repository's environments, in the
pipeline's runs and artifacts, and in the platform's deployment records.
They are written down here so the tasks and the runbook name the same
things.

## Release

A version tag on a `main` commit whose *Deploy Dev* run finished green.
Pushing it is the approval (D3, amended 2026-09-18).

| Attribute | Value | Source |
| --- | --- | --- |
| identity | the tag name, `v<major>.<minor>.<patch>` | `github.ref_name` |
| commit | the tagged commit | `github.sha` |
| dev evidence | the *Deploy Dev* run for that commit, conclusion `success` | R1 |
| approver | the person who pushes the tag — no second click (R3, amended) | R3 |
| archive | the D1 export artifact `d1-backup-<tag>` | R12 |
| result | one live version per service, printed in the job summary | R6 |

**States** (one run of `deploy-prod.yml`):

```
tagged ─► gated ─► tested ─► archived ─► migrated  (the push was the approval)
   │         │         │                                          │
   │         ▼         ▼                                          ▼
   │      refused    failed                                    deployed
   │   (no green dev run,                                         │
   │    or not on main)                                           ▼
   │                                                          planted (secrets)
   │                                                              │
   │                                                              ▼
   │                                                          verified (provider answered)
   │                                                              │
   │                                                              ▼
   │                                                          proven (three hostnames answer)
   │                                                              │
   ▼                                                              ▼
 (manual dispatch enters at `gated` with the same rules)        done
```

`refused` happens before production is touched. `failed` after `deployed`
leaves production changed: the log names the undo.

## Production environment

The pipeline's store of what production may receive.

| Kind | Name | Required | Absent means |
| --- | --- | --- | --- |
| secret | `CLOUDFLARE_API_TOKEN` | yes — nothing deploys without it | the run fails at its first platform call |
| secret | `BETTER_AUTH_SECRET` | yes — the one refusal (constitution VIII) | the run refuses to finish |
| secret | `RESEND_API_KEY` | no — loud warning | nobody can finish signing up (D5) |
| secret | `APICEP_TOKEN` | no — loud warning | the transfer channel says it is unavailable (004 D9) |
| secret | `PLATFORM_OPERATOR_EMAILS` | no — loud warning | the operator panel is closed to everyone |
| variable (repo) | `CLOUDFLARE_ACCOUNT_ID` | yes | the run fails at its first platform call |
| variable (repo) | `PROD_API_URL` | no — smoke skips with a warning | the API is not probed; panel and page bake an empty base |
| variable (repo) | `PROD_ADMIN_URL` | no — smoke skips with a warning | the panel is not probed (D6) |
| variable (repo) | `PROD_PAGO_URL` | no — smoke skips with a warning | the payment page is not probed (D6) |
| rule | deployments from tag `v*` and branch `main` only | yes (D3) | any branch could dispatch a release |
| rule | required reviewer | **none** — not available to a private repository on the Free plan; the tag is the approval (D3, amended 2026-09-18) | — |

Retired names that must not be present: `CONSTA_ISSUER_TOKEN`,
`CONSTA_API_KEY`, `CONSTA_ADMIN_TOKEN`, `CUSTOMER_REF_SECRET` (FR-020). The
dev environment carries the same table with `DEV_*` variables and no
reviewer.

## Archive

The export of the production database taken by a release before it
migrates.

- name: `d1-backup-<tag>` (or `d1-backup-main` on a manual dispatch)
- retention: 30 days with the run
- content: the database as it was; empty on the very first release
- role: the restore point. No job reads it; restoring is a human act
  (FR-011).

## Version

What a service serves at a moment. Every release makes one per service.

| Attribute | Value |
| --- | --- |
| identity | the platform's version id (`Current Version ID:` in the deploy output) |
| service | `devolada-api`, `devolada-admin` or `devolada-pago` (the `prod` names) |
| made by | a release run (R6) or, for the *live* pointer only, a rollback run (R7) |
| rollback target | any version the platform still holds (the last 100), whose bound resources still exist |

**Live pointer**: the first entry of the service's deployment list, which
the rollback job reads after acting and compares with the version it was
asked for.

## Runbook

`quickstart.md` of this feature: pre-flight, release, verification, undo.
Replaces the archive's `CICD.md` for everything a release needs. The only
document a release's red log points at.

## First business

Not a table row this feature creates — a sequence the runbook prescribes:

1. the creator's own business, born first, so that the operator (whose
   address is in `PLATFORM_OPERATOR_EMAILS`) can sign in and open
   `/operador`;
2. the platform's top-up account and support contact, set there
   (`topup_clabe`, `topup_bank`, `topup_beneficiary`, `support_whatsapp`,
   `support_email` — rows of `platform_settings`, written only from the
   panel);
3. the first ISP: CLABE and bank, WispHub key, links, one real transfer.

Each step has an observable outcome (spec US2) and none is automated by the
release.

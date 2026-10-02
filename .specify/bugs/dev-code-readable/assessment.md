# Bug Assessment: the deployed dev API hands out any account's sign-in código, and any pending invitation's id

- **Slug**: dev-code-readable
- **Created**: 2026-10-02
- **Source**: pasted text — research D15 of `specs/020-passwordless-access`
  (quoted below), and the product creator's decision in session to close it
  before that feature ships (tasks.md T004: "Cerrarla ya"). No URL, so
  nothing was fetched and the URL trust policy did not apply. The slug was
  given (T004). Evidence is the code, read-only; the deployed dev API was
  **not** probed on purpose — reading a stranger's código there is the
  attack itself.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim)

> `apps/api/wrangler.jsonc` sets `ENVIRONMENT: "dev"` for the deployed dev
> Worker as well as locally (lines 34 and 86). So `/dev/*` answers on
> `api.dev.devoladapago.com`, not only on a laptop. `GET /dev/last-code`
> returns the last six digits stored for any address that contains the query
> (`routes/dev.ts` line 78). The email-OTP plugin's `sign-in/email-otp` is
> open. Together, anyone could sign into any account on the dev environment:
> ask for a sign-in código for the address, read it there, type it.
>
> Production is not affected (`ENVIRONMENT: "prod"`, and `/dev/*` answers
> 404). Dev holds demo data, but also the operator's account on dev.

## Symptom

On `api.dev.devoladapago.com`, anyone who knows an account's address can
sign into it without its owner: ask for a sign-in código, read it from
`GET /dev/last-code`, type it. The platform operator's dev account is one of
them. Expected: the dev helpers that read what an email would carry answer
only for test addresses nobody can own.

Found while assessing: `GET /dev/last-invitation` opens a second door of the
same kind. It hands out the id of any pending member invitation, and that id
alone lets a stranger create the invitee's account and join the inviting
business as the invited role.

## Reproduction

From the code (not run against the deployed API, see Source):

1. `POST https://api.dev.devoladapago.com/auth/email-otp/send-verification-otp`
   with `{ "email": "<victim>", "type": "sign-in" }` — Better Auth's
   built-in limit is 3 per minute per address of origin, no obstacle.
2. `GET https://api.dev.devoladapago.com/dev/last-code?email=<victim>` →
   `{ "code": "482913" }`. With no `email` at all, the empty string matches
   every identifier, and the answer is the **latest código of anyone**.
3. `POST https://api.dev.devoladapago.com/auth/sign-in/email-otp` with
   `{ "email": "<victim>", "otp": "482913" }` → a session for the victim.
   The `forget-password` type plus `/email-otp/reset-password` reaches the
   same end by replacing the password.

The invitation door:

1. An owner on dev invites `<invitee>`, who has no account yet.
2. `GET /dev/last-invitation?email=<invitee>` → `{ "id": "<invitationId>" }`.
3. `POST /businesses/invitations/<invitationId>/accept-new` with a name and
   a password → the invitee's account, verified, with a session, inside the
   inviting business as the invited role.

## Suspected Code Paths

- `apps/api/wrangler.jsonc:34, :86` — `ENVIRONMENT: "dev"` at the top level
  (laptop, tests) and in `env.dev`, the deployed `devolada-api-dev` Worker
  on `api.dev.devoladapago.com` (`:70–71`).
- `apps/api/src/index.ts:84–88` — `/dev/*` is mounted whenever
  `ENVIRONMENT === "dev"`. Nothing tells the laptop from the deployed Worker.
- `apps/api/src/routes/dev.ts:78–84` (`GET /last-code`) — reads every
  `verification` row and keeps the last whose identifier `includes` the
  query: any address, and every address when the query is empty.
- `apps/api/src/routes/dev.ts:86–91` (`GET /last-invitation`) — the last
  invitation id for any address.
- `apps/api/src/auth/better.ts:168–180` — the `emailOTP` plugin, with its
  `/sign-in/email-otp` and `/email-otp/reset-password` doors open; the
  `hooks.before` there only refuses a `username`.
- `apps/api/src/routes/businesses/handler.ts:366–396`
  (`acceptInvitationAsNewUser`) — an invitation id is enough to create the
  invitee's account with a password and a session (better-auth D14: the
  invitation proves the address, because only its email carries the id).

## Root Cause Hypothesis

The two read helpers were written for the passkey journeys on a laptop
(`tests/passkey/identity-journey.spec.ts`, `tests/passkey/red.spec.ts`), and
assume `ENVIRONMENT === "dev"` means a laptop. It also means the deployed dev
Worker, so what an email would carry — a código, an invitation id — is
readable by anyone on a public host. Better Auth's doors behave as designed:
they trust that only the inbox knows the código and the id. Confidence:
high.

## Proposed Remediation

**Preferred**: an address rule in `apps/api/src/routes/dev.ts`, applied by
both read helpers. A test address is one that:

- ends in `.invalid` — the top-level domain RFC 2606 reserves so that it can
  never resolve, so no mailbox can exist there and no real person can own,
  verify or be invited at such an address; or
- is the seed's demo address, `demo@devolada.app`, whose password `/dev/seed`
  already hands out to anyone who calls it.

`GET /dev/last-code` and `GET /dev/last-invitation` refuse every other
address, the empty one included, with
`403 { success: false, error: { code: "TEST_ADDRESS_ONLY" } }`, and read
nothing from the database for it. Inside the rule they answer as today. This
is the rule `specs/020-passwordless-access` research D14 gives its
`/dev/code`, a feature early. Production is untouched (its `/dev/*` is
already 404).

**Alternatives**:
- Stop mounting `/dev/*` on the deployed Worker (a var set only in local
  configs). Closes the whole family, but also removes the on-demand sweeps
  from deployed dev (`/dev/reconnect-sweep` exists for a visit to a pilot's
  router, its D7) and changes every quickstart. A bigger decision than this
  hole needs.
- A shared secret header on `/dev/*`. A secret to rotate and hand out, for
  helpers whose only callers are local test harnesses.

**Files likely to change**:
- `apps/api/src/routes/dev.ts`
- `apps/api/test/dev-seed.test.ts` (the dev routes' existing suite) or a new
  `apps/api/test/dev-codes.test.ts`

**Tests to add or update**:
- A código stored for a real address: `/dev/last-code?email=<it>` answers
  403 `TEST_ADDRESS_ONLY`, and the body carries no digits.
- No `email` at all: 403, never somebody's latest código.
- A `.invalid` address and the demo address: the código, as the passkey
  journeys read it today.
- `/dev/last-invitation`: a real invitee's address is refused, a `.invalid`
  one answers the id.
- Each cites `bug: dev-code-readable`.

## Risks & Considerations

- The passkey journeys already use `@journey.invalid`
  (`identity-journey.spec.ts:26–27`, `red.spec.ts:20`) and the demo address:
  unaffected.
- Anyone who reads a real address's código on a laptop with these helpers
  must switch to a `.invalid` one. The comment on the routes says so.
- The match stays `includes`: once the guard passes, only identifiers that
  contain a `.invalid` or the demo address can match, and no real one does.
- Out of scope, named so nobody assumes it was covered: `/dev/seed` on
  deployed dev resets the demo business and hands out its password and API
  keys (demo data, by design); the sweeps on demand run real work against
  whatever dev holds.
- `specs/020-passwordless-access` replaces `/dev/last-code` with `/dev/code`
  under the same rule (T008, research D14), and hashes the códigos (D2). This
  fix is that rule, earlier. T008 must keep it.

## Open Questions

- [NEEDS CLARIFICATION: does deployed dev hold a pilot business's real
  provider credentials (a WispHub key, a CLABE)? It raises the stakes of a
  takeover there, not the fix.]
- [NEEDS CLARIFICATION: were these helpers ever called from outside? The
  Worker's request logs for `/dev/last-code` and `/dev/last-invitation` on
  `api.dev.devoladapago.com` would tell. Not checked.]

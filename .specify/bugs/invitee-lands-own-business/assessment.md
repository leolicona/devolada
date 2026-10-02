# Bug Assessment: an invitee who already has a business lands in their own business and never joins — and the invitation email is the only way back

- **Slug**: invitee-lands-own-business
- **Created**: 2026-10-01
- **Source**: pasted text — the product creator's report in session (es-MX,
  quoted below). No URL, so nothing was fetched and the URL trust policy did
  not apply. Evidence was gathered read-only from the production D1, from the
  reporter's own inbox (only messages from `no-reply@devoladapago.com`) and
  from a local reproduction (wrangler + D1, the admin built against it,
  Chromium). The slug was generated in session (no slug was given).
- **Verdict**: valid
- **Severity**: high

## Report (verbatim)

> Tenemos un bug al crear usuarios por roles, el mensaje tarda en llegar al
> email, y si el correo ya se usa en otra negocio no permite crear el rol,
> redirecciona al negocio que ya usa el correo.

Two complaints: (1) the invitation email is slow; (2) when the invited
address already belongs to another business, the membership is never created
and the person ends up in the business that address already uses.

## Symptom

An owner invites an address that already has an account — an owner or member
of another business. The invitee never joins: whatever they do, they end up
inside **their own** business, the invitation is never accepted, and it
expires after 48 hours.

Expected: an invitee who proves the invited address — with the password, the
recovery code or a session they already hold — lands inside the business that
invited them, as the role it named.

## Reproduction

### Observed in production (read-only, 2026-10-01)

1. 2026-09-22 03:16:22 UTC — an owner invited, as *Operador*, an address that
   already owned a business of its own (`invitation` row: one membership
   elsewhere, none in the inviting business).
2. 03:16:23 UTC — the invitation email reached that Gmail inbox **one second
   later** (headers: `Date` 03:16:23 +0000, `Received` by mx.google.com
   20:16:23 PDT; DKIM pass for `devoladapago.com`, SPF pass for
   `send.devoladapago.com`; no `dmarc=` result at all).
3. 04:20:43 UTC — a **password-recovery code** reached the same inbox.
4. The invitation stayed `pending` until it expired on 2026-09-24. Every
   session of that account since then has its own business active; none has
   ever pointed at the inviting business.

### Reproduced locally (Chromium, wrangler + D1, admin built against it)

The invitee owns a business; a second owner invites them as operator.

| Path the invitee takes | Result |
| --- | --- |
| Signed out, opens the link, types the password | joins ✓ |
| Signed in to their own business, opens the link | joins ✓ |
| Browser signed in as the inviter, "Entrar con el correo invitado" | joins ✓ |
| Opens the link, **"Olvidé mi contraseña"**, resets | `/recover` opens with no address and no way back; after the new password, lands in **their own business** as *Dueño*; the inviting business still has its owner alone |
| Signs in at `/login` without the link (the email has not arrived) | lands in **their own business**; nothing on any screen names the invitation |
| Opens the link after 48 h, "Ir a iniciar sesión" | lands in their own business (expected: the invitation expired and says so) |

The production sequence above is row 4, reproduced: the page asked for a
password, the person asked for a recovery code, and the recovery page sent
them home.

## Suspected Code Paths

- `apps/admin/src/features/invitations/AcceptInvitationScreen.tsx:232-237` —
  "Olvidé mi contraseña" links to `/recover` with nothing: the invitation the
  person came from is forgotten the moment they click it.
- `apps/admin/src/router.tsx:64` — the `/recover` route validates no search, so
  it cannot carry `next` the way `/login`, `/signup` and `/verify-email` do
  (better-auth D12).
- `apps/admin/src/features/auth/pages.tsx:386-398` — `RecoverPage` signs the
  person in and always navigates to `/`. With one membership the sign-in hook
  (`apps/api/src/auth/better.ts`, `databaseHooks.session.create`) activates
  their own business, so `/` *is* "the business that already uses the email".
- `apps/admin/src/features/auth/pages.tsx:158` — the login page's own
  "Olvidé mi contraseña" drops `next` the same way (the inviter's-browser path:
  "Entrar con el correo invitado" → `/login?next=/invitaciones/…` → forgot the
  password → home).
- `apps/api/src/routes/businesses/` and `apps/admin/src/features/shell/Shell.tsx`
  — nothing reads the invitations addressed to the person who is signed in. The
  email is the only door to an invitation, so a slow email or a sign-in through
  any other door strands the invitee in their own business.
- `apps/api/src/auth/better.ts` (`sendInvitationEmail`) and
  `apps/api/src/email/sender.ts` (`sendMemberInvitation`) — the email is sent
  inside the invite request, awaited, with nothing deferred. Not a cause of
  delay (measured: one second to Gmail).

## Root Cause Hypothesis

**Confidence: high** for complaint (2). The invitation page is the only place
that remembers the invitation, and two of its exits forget it: the recovery
door (no `next`, a fixed landing on `/`) and any sign-in that does not start
from the email link. For a person with exactly one business, `/` resolves to
that business, which reads as being "redirected to the business that already
uses the email". The API side is sound: `createInvitation` and
`acceptInvitation` accept an address that belongs to another business
(`business-memberships.test.ts` scenario 9, and the three local paths above
that join).

**Confidence: medium** for complaint (1). Nothing in the code delays the
email: it leaves inside the request and reached Gmail in one second. The
second production invitation (2026-10-01 16:11:49 UTC, an address with no
account) was re-sent 2 min 26 s later, so its recipient had not seen it; that
address is not an inbox we could read, so its delivery was not measured. The
headers show the sending domain publishes no DMARC policy, which some
providers (Outlook, company filters) answer with delay or the junk folder.
That is DNS, not code. What the code *does* control is how much a slow email
costs: today it costs the invitation, because the email is the only door.

## Proposed Remediation

**Preferred** — keep the invitation through every door, and stop making the
email the only one:

1. **Recovery comes back to the invitation.** `/recover` validates the same
   search as `/verify-email` (`next`, `email`). The invitation page links to
   it with `next` = itself and the invited address (D14: the address is the
   invitation's, never typed); the login page passes its own `next` along.
   `RecoverPage` prefills the address, keeps `next` on its "Volver a iniciar
   sesión", and after the new password signs in it clears the cache and goes
   to `next` — where the invitation page, now signed in with the invited
   address, accepts as it already does.
2. **The panel names the invitation.** A new read,
   `GET /businesses/invitations/mine`, answers the pending, unexpired
   invitations addressed to the verified person behind the session (business
   name, role, expiry, id), skipping businesses they already belong to. It
   resolves the session itself, because the business wizard asks before any
   membership exists. The panel shows each one as a notice — *Te invitaron a
   X como operador.* **Unirme** — in the shell and on the new-business wizard.
   *Unirme* opens the invitation page, which accepts for the invited address
   (one way to accept, not two). With this, a slow or lost email no longer
   blocks anyone who can sign in with the invited address.

**Alternatives**:
- Fix only (1). It closes the path observed in production, but the next
  invitee who signs in before the email arrives is stranded the same way.
- Call Better Auth's own `GET /auth/organization/list-user-invitations` from
  the panel. It exists, but answers expired rows as `pending`, has no zod
  contract for fixtures to validate against (constitution III), and would
  offer businesses the person already belongs to.
- Accept from the notice directly. Two acceptance paths to keep in step;
  the invitation page already owns the decision (D14).

**Files likely to change**:
- `apps/api/src/routes/businesses/{index,handler,schema}.ts`
- `apps/admin/src/router.tsx`
- `apps/admin/src/features/auth/pages.tsx`
- `apps/admin/src/features/invitations/AcceptInvitationScreen.tsx`
- `apps/admin/src/features/invitations/PendingInvitations.tsx` (new)
- `apps/admin/src/features/shell/Shell.tsx`
- `apps/admin/src/features/onboarding/NewBusinessScreen.tsx`
- `apps/admin/test/msw.ts`, `tests/e2e/stubs.ts` (the shell's new read)
- `apps/api/test/invitee-lands-own-business.test.ts`,
  `apps/admin/test/invitee-lands-own-business.test.tsx` (new)

**Tests to add or update** (all citing `bug: invitee-lands-own-business`):
- API: an invitee who owns a business reads the invitation through their own
  session (business name, role, expiry); the inviter, a stranger and no
  session do not; an expired, accepted or cancelled invitation is not listed;
  a person with no business yet (signed up through the código) reads it too.
- Component: from the invitation page, "Olvidé mi contraseña" opens recovery
  with the address filled in; after the new password the person is back on
  the invitation, which accepts and lands inside the inviting business.
- Component: the login page's recovery link keeps `next`.
- Component: the shell shows a pending invitation; *Unirme* opens the
  invitation page, which accepts; the wizard shows it too; nothing shows when
  there is nothing.

## Risks & Considerations

- **Exposure**: the new read gives the invitation id to the person the email
  was sent to — the same key the email holds — and only after the address is
  proven (better-auth D16: nobody unverified holds a session). An unverified
  or store session is refused.
- **Every shell render asks one more question.** One indexed read by email;
  the admin suite's MSW default and the e2e stubs must answer it (constitution
  IV: `onUnhandledRequest: "error"`).
- **No migration**, no change to Better Auth's configuration, no change to
  who may invite whom.
- **The email itself is unchanged.** Publishing a DMARC record for
  `devoladapago.com` is a DNS decision for the creator; Resend's log can say
  what happened to the 2026-10-01 sends.

## Open Questions

- None blocking. Whether to publish DMARC (and with which policy) is a
  decision outside the code.

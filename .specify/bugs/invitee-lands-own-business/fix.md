# Bug Fix: an invitee who already has a business lands in their own business and never joins — and the invitation email is the only way back

- **Slug**: invitee-lands-own-business
- **Fixed**: 2026-10-01
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The recovery door now keeps the invitation: from the invitation page,
"Olvidé mi contraseña" carries the page and the invited address to
`/recover`, and the new password lands back on the invitation, which
accepts. And the email stops being the only door: a new read,
`GET /businesses/invitations/mine`, lets the panel name each pending
invitation addressed to the person signed in — in the shell, on the
business wizard and on the chooser — with **Unirme** opening the invitation
page that already accepts for the invited address. The email itself is
unchanged: it was never slow in the code (one second to Gmail).

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/routes/businesses/schema.ts` | modified | `myInvitation`, `myInvitationsResponse` — business name, role, expiry, id |
| `apps/api/src/routes/businesses/handler.ts` | modified | `myInvitations`: resolves the session itself (no membership needed), refuses an unverified or store session, answers pending and unexpired invitations to the session's address, skips businesses the person already belongs to |
| `apps/api/src/routes/businesses/index.ts` | modified | `GET /businesses/invitations/mine` |
| `apps/admin/src/router.tsx` | modified | `/recover` validates `next` and `email` (`verifySearch`) |
| `apps/admin/src/features/auth/pages.tsx` | modified | `RecoverPage` prefills the address, keeps `next` on its back link, clears the cache and lands on `next`; the login page's recovery link keeps `next` |
| `apps/admin/src/features/invitations/AcceptInvitationScreen.tsx` | modified | "Olvidé mi contraseña" carries `next` (this page) and the invited address |
| `apps/admin/src/features/invitations/PendingInvitations.tsx` | added | the notice: *Te invitaron a X como rol.* + **Unirme** → `/invitaciones/:id`; a named region, silent when there is nothing or the read fails |
| `apps/admin/src/features/shell/Shell.tsx` | modified | the notice under the credit banners |
| `apps/admin/src/features/onboarding/NewBusinessScreen.tsx` | modified | the notice above the wizard's form |
| `apps/admin/src/features/onboarding/ChooseBusinessScreen.tsx` | modified | the notice above the list of businesses |
| `apps/admin/test/msw.ts` | modified | default answer (none) for the new read, and `handlers.myInvitations` |
| `tests/e2e/stubs.ts` | modified | the admin stub answers the new read (none), parsed by its contract |
| `apps/api/test/invitee-lands-own-business.test.ts` | added test | 4 cases |
| `apps/admin/test/invitee-lands-own-business.test.tsx` | added test | 7 cases |

## Diff Highlights

```tsx
// AcceptInvitationScreen.tsx — the door that dropped the invitation
<Link to="/recover" search={{ next: here, email: inv.email ?? undefined }}>
  Olvidé mi contraseña
</Link>

// pages.tsx — RecoverPage, after the new password signs in
queryClient.clear();
void navigate({ to: next ? asRoute(next) : "/" });
```

```ts
// handler.ts — myInvitations
.where(and(eq(invitation.email, session.user.email.toLowerCase()), eq(invitation.status, "pending")))
…
.filter((r) => r.inv.expiresAt.getTime() > now && !joined.has(r.inv.organizationId))
```

## Tests Added or Updated

All cite `bug: invitee-lands-own-business`.

- `apps/api/test/invitee-lands-own-business.test.ts`
  - an invitee who owns a business reads the invitation through their own
    session (business name, role, 48 h); the inviter and a stranger read
    none; no session answers 401;
  - an expired, a cancelled or an accepted invitation is not offered (the
    accepted one through Better Auth's own door);
  - a person with no business yet, signed up through the código, reads it;
  - an unverified account (`EMAIL_NOT_VERIFIED`) and a shopkeeper
    (`WRONG_ACTOR`) are refused.
- `apps/admin/test/invitee-lands-own-business.test.tsx`
  - from the invitation page, "Olvidé mi contraseña" opens recovery with
    `next` and the address filled in; after the new password the person is
    back on the invitation, which accepts and activates the inviting
    business (the regression the production evidence showed);
  - the login page's recovery link keeps `next`;
  - a plain recovery, with no `next`, still lands on the panel;
  - the shell names the invitation (axe clean); **Unirme** opens the
    invitation, which accepts; the notice is gone once spent;
  - the wizard offers it to someone with no business yet (axe clean);
  - the chooser offers it to someone with several businesses (axe clean);
  - nothing to offer, or a failed read, renders nothing.

## Local Verification

- Regression proof: with the recovery link's `search` and `RecoverPage`'s
  `next` removed, the first component case fails (`expected {} to deeply
  equal { next: '/invitaciones/inv-1', … }`); restored, 7/7 pass.
- `npx vitest run test/invitee-lands-own-business.test.ts` (api) → 4/4.
- `pnpm --filter @devolada/api exec vitest run` → 67 files, 1197 tests pass.
- `pnpm --filter @devolada/admin exec vitest run` → 29 files, 368 tests pass.
- `pnpm -r --if-present typecheck` → clean; `pnpm -r --if-present build` → all
  five surfaces build.
- `node scripts/spec-lint.mjs` → 113 test files checked; `gen-banks --check`,
  `contrast-lint`, `pending-lint` → pass.
- Browser, against a real local API (wrangler + D1) and the admin built
  against it, in Chromium: an invitee who owns a business (1) uses
  "Olvidé mi contraseña" from the link → back on the invitation, joins as
  Operador; (2) signs in at `/login` with one business → the shell names
  the invitation, **Unirme** joins as Administrador; (3) with two
  businesses → the chooser names it, joins as Lector; (4) an address with
  no account signs up without the link → the wizard names it, joins as
  Lector. Before the fix, (1) and (2) landed in the person's own business
  with no membership created.
- Browser layer (`tests/e2e`, Playwright + axe, stubbed API): 231 of 233 in
  one parallel run. The two failures (`feedback.spec.ts:29`,
  `landing.spec.ts:90`) pass 3/3 when run alone; `feedback.spec.ts:29`
  fails the same 6/6 on `main` without this change under the same
  four-worker load, so it is this container's timing, not this fix.

## Deviations from Assessment

- **The chooser shows the notice too.** The assessment named the shell and
  the wizard. In the browser, an invitee with two businesses lands on
  *Elige un negocio* after signing in, where the shell's notice is not yet
  on screen. It is the same component; one more component case covers it.
- **The read refreshes at the session's pace** (`staleTime` 60 s), so the
  shell does not ask again on every window focus.

## Follow-ups

- **DMARC for `devoladapago.com`** (DNS, the creator's decision): the
  received headers carry no `dmarc=` result. Some providers delay or junk
  mail from a domain without a policy; a `p=none` record with a report
  address is the usual first step.
- **Resend's log for the 2026-10-01 sends** (16:11:49 and 16:14:15 UTC) says
  whether that recipient's provider deferred them.
- **The invitation page has no passkey door.** A person who signs in with a
  fingerprint and does not know their password can now recover and come
  back, or sign in at `/login` and join from the shell — but the page
  itself offers only the password.
- **When the password is right but the acceptance fails**, the page still
  says "Correo o contraseña incorrectos". Not observed in production; worth
  its own wording.

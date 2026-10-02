# Bug Fix: the deployed dev API hands out any account's sign-in código, and any pending invitation's id

- **Slug**: dev-code-readable
- **Fixed**: 2026-10-02
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`GET /dev/last-code` and `GET /dev/last-invitation` now answer only for a
test address: one in `.invalid`, or the demo account. Every other address,
the empty query included, gets `403 TEST_ADDRESS_ONLY` before a row is read.
The código lookup now matches the address whole instead of as a substring.
Production was never affected and is untouched.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/routes/dev.ts` | modified | `testAddress()` (the rule, lowercased and trimmed) and `notTestAddress` (the refusal); both read helpers refuse first; `/last-code` matches `-<address>` at the end of the identifier |
| `apps/api/test/dev-code-readable.test.ts` | added test | 5 cases |

## Diff Highlights

```ts
const testAddress = (email: string | undefined): string | null => {
  const address = (email ?? "").trim().toLowerCase();
  return address.endsWith(".invalid") || address === DEMO.ispEmail ? address : null;
};

dev.get("/last-code", async (c) => {
  const address = testAddress(c.req.query("email"));
  if (!address) return c.json(notTestAddress, 403);
  // …
  const row = rows.filter((r) => r.identifier.toLowerCase().endsWith(`-${address}`)).at(-1);
```

## Tests Added or Updated

`apps/api/test/dev-code-readable.test.ts`, every case under
`bug: dev-code-readable`:

- **refuses a real address, and no digit of its código leaves**: 403, the
  envelope, the stored digits absent from the body.
- **refuses a missing or blank address instead of answering anyone's latest
  código**: no `email`, `email=` and a blank one; before the fix, these
  answered the newest código in the table.
- **matches the address whole**: `ana.invalid` does not reach
  `sign-in-otp-ana.invalid@gmail.com`, and `owner@journey.invalid` does not
  reach `bowner@journey.invalid`.
- **still reads a `.invalid` address's código and the demo account's**: the
  passkey journeys' path, with the demo address typed in mixed case.
- **refuses a real invitee's address and answers a `.invalid` one's
  invitation id**.

## Local Verification

- Commands run:
  - `pnpm --filter @devolada/api exec vitest run test/dev-code-readable.test.ts test/dev-seed.test.ts` → 11/11 pass (5 new, 6 existing for the dev routes).
  - `pnpm --filter @devolada/api typecheck` → clean.
- Manual checks: the email-OTP identifier format read in Better Auth
  1.6.29's dist (`plugins/email-otp/utils.mjs`, `toOTPIdentifier`:
  `` `${type}-otp-${email}` ``, with the address lowercased by every route),
  which is what makes the whole-address match exact.

## Deviations from Assessment

- **The match does not stay `includes`.** The assessment's Risks section
  said a substring match was safe once the guard passed. It is not: the
  guard reads the query, and a query that ends in `.invalid` can still sit
  inside a real address — `ana.invalid` is a substring of
  `sign-in-otp-ana.invalid@gmail.com`, and `mail.invalid` of an address at
  `mail.invalid.com.mx`. So the lookup matches `-<address>` at the end of the
  identifier, which is exact given Better Auth's format. The rule, the
  refusal and the routes are as the assessment proposed; the root cause is
  unchanged, so no new assessment was needed.
- **`/dev/last-invitation` looks up the lowercased address.** Before, it
  used the query as typed. Better Auth's organization plugin stores
  invitation addresses lowercased, and the passkey journeys already use
  lowercase. Nothing that worked before stops working.

## Follow-ups

- `specs/020-passwordless-access` T008 replaces `/dev/last-code` with
  `/dev/code` under this same rule (research D14). It must keep the
  whole-address match and the refusal for an empty query.
- The assessment's open questions stand for the creator: whether deployed
  dev holds a pilot business's real provider credentials, and whether the
  Worker's request logs show these routes being called from outside.

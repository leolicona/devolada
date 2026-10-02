# Data Model: Passwordless Access

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

**No migration.** No table, column or index is added, changed or dropped.
What changes is which rows may exist, how one column's value is written,
and when two status changes happen:

- **No password rows.** No `account` row has `provider_id = 'credential'`
  (D5).
- **No unverified panel accounts.** No `user` row is unverified unless a
  store names it (D5).
- **Hashed códigos.** A código's `verification.value` is a SHA-256 hash with
  its try count (D2).
- **Status at the código.** A store, and its invitation, change status when
  the código is typed, no longer when the email is typed (D10).

The tables are Better Auth's (`apps/api/src/db/auth-schema.ts`, generated —
better-auth D10) and the store tables of `cash-at-stores`
(`apps/api/src/db/schema.ts`). Every timestamp is ms.

## `user` — a person, or a store's account

| Column | Rule after this feature |
| --- | --- |
| `email` | proven; the master key (spec, "What a passkey is") |
| `email_verified` | `1` from birth, on every door that creates a user: the panel's código (D1), the member invitation (D9) and the store invitation (D10). A `0` row exists only from before the release; D5 erases it unless a store names it |
| `name` | 2–80 characters, trimmed. It is `""` only between a sign-in-door birth and `/welcome` (D1, D6), and the shell sends such a session to `/welcome` |
| `username`, `display_username` | the store's phone, 10 national digits. Written only by the store acceptance (cash-at-stores D3, unchanged). Read by the store's sign-in to find the account a código goes to (D10). Null for every panel person |

**Lifecycle**:
- **Born.** At the código (panel registration or sign-in door), at
  `accept-new` (member invitation, no código: the invitation proves the
  inbox) or at the store acceptance's código.
- **Named.** At once, or on `/welcome` (sign-in door).
- **Holds keys and sessions** (below).
- **Never holds a password.**

## `account` — how a user proves who they are

| `provider_id` | After this feature |
| --- | --- |
| `credential` (email + password) | **none**. Erased by D5's sweep: panel users from PR 1, store users from PR 2. Re-erased within a minute if one ever reappears (a restored export, a forgotten door) |

No other provider is configured. A key is a `passkey` row, not an `account`.

## `verification` — códigos and passkey challenges

The email-OTP plugin writes one row per address and kind:

| Field | Rule |
| --- | --- |
| `identifier` | `sign-in-otp-<email>` (`plugins/email-otp/utils.mjs`). The `email-verification` and `forget-password` kinds are no longer written once PR 2 lands |
| `value` | `<SHA-256, base64url>:<tries>` (D2). It was `<six digits>:<tries>` in plain text |
| `expires_at` | the request + 10 minutes (D2) |

**Lifecycle of a código**:

```text
requested ──► live ──(right, tries < 3)──► consumed (row deleted; session opens)
               │
               ├─(wrong)──► live, tries + 1 ──(third wrong)──► dead
               ├─(10 minutes)──► expired (deleted on its next check)
               └─(a new request for the same address)──► replaced
```

The passkey plugin's challenge rows are unchanged.

## `passkey` — a key (FR-028)

Unchanged. A key stores only:
- `public_key` and `credential_id`;
- `counter`, `device_type`, `backed_up`, `transports` and `aaguid`;
- `name` (the store app writes "Tienda"; the panel writes none, so the list
  says "Llave de acceso");
- `user_id` and `created_at`.

It holds no biometric data and never the private half.

**Lifecycle**:
- **Created** only by a device's ceremony, on a fresh session (D8).
- **Removed** from Seguridad or Caja, or with its user.

A removed key stops signing in at once, because its row is gone.

## `session`

Unchanged columns, with new doors in and out:
- **Born by**:
  - `sign-in/email-otp` (both apps; the store's through its phone routes);
  - a key's `verify-authentication`;
  - the invitation routes, which mint and consume a código (D9, D10).
- **Ended by**:
  - sign-out;
  - `revoke-other-sessions` (D11);
  - suspension, as today;
  - D10's race guard;
  - D5's erasure of a legacy unverified user;
  - expiry: 30 days, renewed by use (better-auth D5).

A session is "fresh" for a day after its `created_at`. Only a fresh session
may add a key (D8).

## `stores` — cash-at-stores, one transition moved

`status: invited → active` happens at the invitation's código, in the same
batch that links `user_id`, writes the username and accepts the invitation
(D10, cash-at-stores T089). It used to happen when the email and password
were sent. A store whose shopkeeper leaves before the código stays `invited`,
and its invitation stays open (FR-031).

## `store_invitations` — cash-at-stores, one transition moved

`status: sent → accepted` happens at the código (D10).

- **`EMAIL_TAKEN`** after a right código leaves it `sent`.
- **A wrong código** leaves it `sent`.
- **Expiry and replacement** are unchanged (seven days; a resend replaces it,
  cash-at-stores D4).

## `invitation` — the organization plugin's member invitation

Unchanged: 48 hours, the address fixed (business-and-memberships D8,
better-auth D14). `accept-new` now takes a name and no password (D9).

## `rateLimit`

New keys, no new shape:
- Better Auth's custom rule for `/sign-in/email-otp` (D3);
- the store routes' `hono:` keys: `store-sign-in-code`, `store-sign-in`
  and `store-invitation-code` (D3, better-auth D15).

## Validation rules

| Field | Rule | Where |
| --- | --- | --- |
| name | trimmed, 2–80 characters | registration, `/welcome`, `accept-new` (today's signup rule); on the server, `hooks.before` refuses any other `name` on `/sign-in/email-otp` and `/update-user` with `INVALID_NAME` (analysis A3) |
| email | an address shape, lowercased | every door (the plugin lowercases) |
| código | exactly six digits | `CodeInput` (D12); the plugin checks the rest |
| phone | 10 national digits after `nationalPhone` | store sign-in (D10); the same rule as the store's own phone (cash-at-stores L5) |

## Mapping to the spec's Key Entities

| Entity | Rows |
| --- | --- |
| Person (account) | `user` with `username` null, its `session` and `passkey` rows, and `member` rows (unchanged) |
| Store account | `user` named by `stores.user_id`, with `username` = the store's phone |
| Key (passkey) | `passkey` |
| Código | `verification` with identifier `sign-in-otp-<email>` |
| Session | `session` |
| Invitation | `invitation` (member) and `store_invitations` (store) |

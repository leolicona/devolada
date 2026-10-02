import type { Bindings } from "../env";
import { D1_MAX_PARAMS } from "../db/params";

/* passwordless-access D5 (FR-029): the passwords that exist are erased,
   and so are the legacy accounts whose email was never proven.

   A sweep on the every-minute cron, not a migration: migrations are
   additive, because a PR's preview applies them to the dev database while
   the old Worker still serves it — a migration that deleted passwords would
   lock dev out of the old Worker's password door for the length of the PR.
   And a sweep is a guarantee, where a migration runs once: a password
   brought back by a restored export, or written by a door nobody
   remembered (`email-otp/reset-password` until PR 2), is gone within a
   minute. After the first run it finds nothing.

   Two deletions, each on its own (analysis U1, 2026-10-02): inside one
   batch, a single row that still named a user would fail the whole batch
   every minute, and the passwords would never go. */

/* An account still being born is left alone for this long. Until PR 2 the
   store acceptance births its shopkeeper unverified, with a password, a
   moment before it links the store (cash-at-stores T089): caught in
   between, the user would read as a legacy panel account. Every legacy row
   is far older; a panel password set through a forgotten door belongs to
   an old user, and still goes at the next minute. */
const BIRTH_GRACE_MS = 10 * 60_000;

/* "No row names the user" (D5, read in schema.ts on 2026-10-02): every user
   column of ours, none of which cascades, plus the organization plugin's
   `member` (it cascades, but a membership means the account is in use) and
   `invitation.inviter_id`. A column added later that names a user joins
   this list. */
const NAMED_BY = [
  ["member", "user_id"],
  ["invitation", "inviter_id"],
  ["payments", "store_user_id"],
  ["platform_settings", "author_user_id"],
  ["top_ups", "submitted_by_user_id"],
  ["credit_entries", "granted_to_user_id"],
  ["credit_entries", "author_user_id"],
  ["bench_receipts", "uploaded_by"],
  ["bench_readings", "marked_by"],
  ["stores", "user_id"],
  ["stores", "created_by_user_id"],
  ["store_invitations", "created_by_user_id"],
  ["store_handovers", "declared_by_user_id"],
  ["store_handovers", "resolved_by_user_id"],
  ["store_ledger", "author_user_id"],
] as const;

export type CredentialErase = { credentials: number; users: number };

export async function eraseLegacyCredentials(env: Bindings, now = new Date()): Promise<CredentialErase> {
  /* Better Auth's timestamps are stored in seconds (`mode: "timestamp"`) */
  const bornBefore = Math.floor((now.getTime() - BIRTH_GRACE_MS) / 1000);

  /* 1. Passwords. PR 1 keeps the store's: the store app still signs in by
     phone and password until User Story 6 — passwordless-access T064
     removes this filter with it. */
  const credentials = await env.DB.prepare(
    `DELETE FROM account
       WHERE provider_id = 'credential'
         AND user_id IN (SELECT id FROM "user" WHERE created_at < ?1)
         AND user_id NOT IN (SELECT user_id FROM stores WHERE user_id IS NOT NULL)`,
  )
    .bind(bornBefore)
    .run();

  /* 2. Legacy unverified accounts that no row names. Nobody unverified holds
     a session (better-auth D16), so none of them made a business; after
     this feature every door births its user verified (D1, D9), so this only
     ever meets rows from before. A store's unverified shopkeeper is kept —
     `stores.user_id` names them. */
  const unnamed = NAMED_BY.map(([table, column]) => `AND NOT EXISTS (SELECT 1 FROM ${table} WHERE ${column} = u.id)`).join(
    "\n         ",
  );
  const { results } = await env.DB.prepare(
    `SELECT u.id AS id FROM "user" u
       WHERE u.email_verified = 0
         AND u.created_at < ?1
         ${unnamed}`,
  )
    .bind(bornBefore)
    .all<{ id: string }>();
  const ids = results.map((r) => r.id);

  /* Their sessions, accounts and keys do not cascade: they go first, in
     one batch with the users, so a user is never left half-erased */
  for (let i = 0; i < ids.length; i += D1_MAX_PARAMS) {
    const chunk = ids.slice(i, i + D1_MAX_PARAMS);
    const marks = chunk.map((_, n) => `?${n + 1}`).join(", ");
    await env.DB.batch(
      ["session", "account", "passkey"]
        .map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE user_id IN (${marks})`).bind(...chunk))
        .concat(env.DB.prepare(`DELETE FROM "user" WHERE id IN (${marks})`).bind(...chunk)),
    );
  }

  return { credentials: credentials.meta.changes ?? 0, users: ids.length };
}

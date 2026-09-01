import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { businesses } from "../db/schema";

/* One Consta key per business (payments-and-classes D7, pivot D20).

   The door is issue-only: CONSTA_ISSUER_TOKEN opens POST /admin/keys and
   nothing else, so a compromised api can mint keys but never revoke
   another tenant's. The key lands in `businesses.consta_api_key`, in the
   row, with the same trust as the WispHub key. A missing key is never a
   blocker: validations fall back to the platform's CONSTA_API_KEY until
   the backfill below fills the gap. */

const ISSUE_TIMEOUT_MS = 10_000;

/* Mint one key. Returns null when issuance is not configured (a warning,
   not an error); throws when the issuer answered badly — the callers
   decide what a failure costs (birth: nothing; backfill: a retry). */
export async function issueConstaKey(env: Bindings, name: string): Promise<string | null> {
  if (!env.CONSTA_BASE_URL || !env.CONSTA_ISSUER_TOKEN) {
    console.warn(
      "CONSTA_ISSUER_TOKEN unset — businesses are born without their own Consta key and validate under the platform's (payments-and-classes D7)",
    );
    return null;
  }
  const res = await fetch(`${env.CONSTA_BASE_URL}/admin/keys`, {
    method: "POST",
    signal: AbortSignal.timeout(ISSUE_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${env.CONSTA_ISSUER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json().catch(() => null)) as
    | { success: boolean; data?: { key: string } }
    | null;
  if (!res.ok || !body?.success || !body.data?.key) {
    throw new Error(`consta issuer answered ${res.status}`);
  }
  return body.data.key;
}

const BACKFILL_BATCH = 5;

/* The backfill sweep (D7): every business without a key gets one —
   existing rows once, and any business whose issuer was down at birth.
   Rides the every-minute scheduled handler; the SELECT is a no-op when
   nothing is missing. */
export async function backfillConstaKeys(env: Bindings): Promise<number> {
  if (!env.CONSTA_BASE_URL || !env.CONSTA_ISSUER_TOKEN) return 0;
  const db = drizzle(env.DB);
  const missing = await db
    .select({ id: businesses.id, name: businesses.name })
    .from(businesses)
    .where(isNull(businesses.constaApiKey))
    .limit(BACKFILL_BATCH);
  let issued = 0;
  for (const b of missing) {
    try {
      const key = await issueConstaKey(env, `${b.name} · ${b.id}`);
      if (!key) return issued;
      await db.update(businesses).set({ constaApiKey: key }).where(eq(businesses.id, b.id));
      issued++;
    } catch (e) {
      /* One bad mint must not stall the rest; the sweep returns anyway */
      console.error(`consta key backfill failed for ${b.id}:`, e);
    }
  }
  return issued;
}

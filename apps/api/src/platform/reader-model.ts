import type { DrizzleD1Database } from "drizzle-orm/d1";
import { and, count, desc, eq, gte, isNotNull } from "drizzle-orm";
import { extractions, platformSettings } from "../db/schema";
import { READER_MODEL_KEY, type ReaderModel } from "../consta/extraction/models";

/* receipt-reader-tuning D8 — the operator's choice of reader model.

   An append-only `platform_settings` row, like every other platform
   setting (operator-panel D1), but kept out of the `SETTINGS` registry:
   its value is an id from a list the deploy sets, not a type the registry
   knows, and the Reglas tab must never list it. The read that resolves it
   per reading lives in `consta/extraction/models.ts`. */

/* FR-003: an id outside the environment's list can never be stored */
export async function chooseReaderModel(
  db: DrizzleD1Database,
  list: ReaderModel[],
  modelId: string,
  authorUserId: string,
): Promise<{ ok: true } | { ok: false }> {
  if (!list.some((m) => m.id === modelId)) return { ok: false };
  await db.insert(platformSettings).values({ key: READER_MODEL_KEY, value: modelId, authorUserId });
  return { ok: true };
}

export async function readerHistory(db: DrizzleD1Database, limit = 5) {
  const rows = await db
    .select({
      value: platformSettings.value,
      authorUserId: platformSettings.authorUserId,
      createdAt: platformSettings.createdAt,
    })
    .from(platformSettings)
    .where(eq(platformSettings.key, READER_MODEL_KEY))
    .orderBy(desc(platformSettings.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() }));
}

/* receipt-reader-tuning D11 — the one cross-business read constitution V
   admits since v1.6.0: how many payer readings fell back, counted where
   the chosen model failed *and the default read* (`model` set). A row
   where both failed has no `model` and is a different fact, so it is not
   counted (analyze C3). A number, never a row; it reads `fallback_from`,
   `model` and `created_at` and nothing else. */
export async function fallbacksSince(db: DrizzleD1Database, sinceMs: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(extractions)
    .where(
      and(
        isNotNull(extractions.fallbackFrom),
        isNotNull(extractions.model),
        gte(extractions.createdAt, new Date(sinceMs)),
      ),
    );
  return row?.n ?? 0;
}

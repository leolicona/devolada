import type { DrizzleD1Database } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { platformSettings } from "../../db/schema";
import { DEFAULT_MODEL } from "./reader";

/* receipt-reader-tuning D7–D9 — which model reads a receipt.

   The environment sets the list (a deploy); the operator picks one from
   it in /operador → Lector (a row); every reading resolves the pick on
   its own, with no cache, so the next reading after a choice uses it
   (spec SC-003). Pure except for the one indexed read in `readerChoice`. */

export type ReaderModel = { id: string; label: string; input?: Record<string, unknown> };
/* `fallback` is the default when the chosen model is not the default,
   else null — a failing default has nothing to fall back to (D11) */
export type ReaderPlan = { chosen: ReaderModel; fallback: ReaderModel | null };

/* The platform_settings key of the choice. Not in `SETTINGS`: its value
   is an id from a list the deploy sets, not a type the registry knows,
   and the Reglas tab must never list it (D8). */
export const READER_MODEL_KEY = "reader_model";

const listSchema = z.array(
  z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    input: z.record(z.unknown()).optional(),
  }),
);

type ModelsEnv = { EXTRACTION_MODEL?: string; EXTRACTION_MODELS?: unknown };

let warned = false;

/* D7: a JSON var reaches the Worker already parsed; a test binding (and
   a `.dev.vars` line) reaches it as a string. Both are read. Unset →
   the default alone (the reader before this feature); invalid → the
   same, with one warning per isolate (constitution VIII). */
export function readerModels(env: ModelsEnv): { list: ReaderModel[]; defaultModel: ReaderModel } {
  const defaultId = env.EXTRACTION_MODEL ?? DEFAULT_MODEL;
  let parsed: ReaderModel[] = [];
  const raw = env.EXTRACTION_MODELS;
  if (raw !== undefined && raw !== null && raw !== "") {
    let value: unknown = raw;
    try {
      if (typeof raw === "string") value = JSON.parse(raw);
    } catch {
      value = undefined;
    }
    const result = listSchema.safeParse(value);
    if (result.success) {
      parsed = result.data;
    } else if (!warned) {
      warned = true;
      console.warn("EXTRACTION_MODELS is not a list of { id, label, input? }; the default model reads alone");
    }
  }

  /* Ids are unique, first wins; the default is always in the list, and
     prepended with its id as label when the list lacks it */
  const seen = new Set<string>();
  const list: ReaderModel[] = [];
  if (!parsed.some((m) => m.id === defaultId)) {
    list.push({ id: defaultId, label: defaultId });
    seen.add(defaultId);
  }
  for (const m of parsed) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    list.push(m);
  }
  const defaultModel = list.find((m) => m.id === defaultId)!;
  /* The contract lists the default first */
  return { list: [defaultModel, ...list.filter((m) => m !== defaultModel)], defaultModel };
}

/* Only for the isolate-once warning's own test */
export function resetReaderModelsWarning() {
  warned = false;
}

export type ReaderChoice = {
  active: ReaderModel;
  /* default — no choice ever made; applies — the latest choice is in
     the list; stale — it left the list, and the default reads (D8) */
  choice: "default" | "applies" | "stale";
  stale: string | null;
};

/* D8, SC-003: the latest `reader_model` row, through
   `platform_settings_key_created_idx`, on every reading — no cache */
export async function readerChoice(
  db: DrizzleD1Database,
  list: ReaderModel[],
  defaultModel: ReaderModel = list[0],
): Promise<ReaderChoice> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, READER_MODEL_KEY))
    /* The same order as the panel's history, so the model the panel shows
       first is the one that reads */
    .orderBy(desc(platformSettings.createdAt), desc(platformSettings.id))
    .limit(1);
  if (!row) return { active: defaultModel, choice: "default", stale: null };
  const chosen = list.find((m) => m.id === row.value);
  return chosen
    ? { active: chosen, choice: "applies", stale: null }
    : { active: defaultModel, choice: "stale", stale: row.value };
}

/* D9: resolved by the two callers that hold `db` (`extract.ts`,
   `validate.ts`) and handed to `extractProof` */
export async function readerPlan(env: ModelsEnv, db: DrizzleD1Database): Promise<ReaderPlan> {
  const { list, defaultModel } = readerModels(env);
  const { active } = await readerChoice(db, list, defaultModel);
  return { chosen: active, fallback: active.id === defaultModel.id ? null : defaultModel };
}

import { and, eq, isNotNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { validations } from "../db/schema";
import { BANKS, type Bank } from "../provider/banks";

/* proof-extraction D14 — a rule is recomputed from `valid` rows, never
   stored, and the thresholds live here.

   A `valid` row is a (bank, clave) pair Banxico proved: a wrong bank is
   answered `invalid` (BUG-007's measurement), so the log is the only
   honest source of per-bank shape — Banxico publishes none, each bank
   invents its own. Recomputing from every row each time is what makes a
   counterexample retire a rule by arithmetic: the shared property simply
   stops being shared. */

export const GRADUATION_SAMPLES = 10;

/* One minute: the query is one indexed pass over hundreds of rows, and a
   bank graduating sixty seconds late costs nobody anything. */
const CACHE_TTL_MS = 60_000;

export type ShapeRule = {
  bank: Bank;
  length: number;
  /* Per position: a letter every sample shares is literal, a position
     that is always a digit is `\d`, always a letter `[A-Z]`, else any
     alphanumeric. Digits are never literal — BBVA and Azteca both embed
     the date (`YYMMDD`) and a sequence, so a rule frozen on today's
     digits would false-alarm tomorrow. Letters carry the bank's own
     marks: Nu's `NU`, BBVA's `MBAN`, Azteca's trailing `I`. */
  pattern: RegExp;
  samples: number;
};

export type ShapeVerdict = "ok" | "mismatch" | "unknown";

const KNOWN = new Set<string>(BANKS);

export function deriveShapeRules(rows: { senderBank: string; trackingKey: string }[]): ShapeRule[] {
  const byBank = new Map<string, Set<string>>();
  for (const { senderBank, trackingKey } of rows) {
    if (!KNOWN.has(senderBank)) continue;
    const set = byBank.get(senderBank) ?? new Set<string>();
    set.add(trackingKey.trim().toUpperCase());
    byBank.set(senderBank, set);
  }

  const rules: ShapeRule[] = [];
  for (const [bank, claves] of byBank) {
    if (claves.size < GRADUATION_SAMPLES) continue;
    const samples = [...claves];
    const length = samples[0].length;
    /* Two shapes under one bank (a second channel, a silent change) is
       real and never noise. No uniform length → no rule, by design. */
    if (samples.some((s) => s.length !== length)) continue;

    let source = "^";
    for (let i = 0; i < length; i++) {
      const chars = new Set(samples.map((s) => s[i]));
      const allDigits = [...chars].every((ch) => ch >= "0" && ch <= "9");
      const allLetters = [...chars].every((ch) => ch >= "A" && ch <= "Z");
      if (allDigits) source += "\\d";
      else if (allLetters && chars.size === 1) source += samples[0][i];
      else if (allLetters) source += "[A-Z]";
      else source += "[A-Z0-9]";
    }
    source += "$";
    rules.push({ bank: bank as Bank, length, pattern: new RegExp(source), samples: samples.length });
  }
  return rules;
}

let cache: { rules: ShapeRule[]; expires: number } | null = null;

export async function loadShapeRules(db: DrizzleD1Database, now = Date.now()): Promise<ShapeRule[]> {
  if (cache && cache.expires > now) return cache.rules;
  const rows = await db
    .select({ senderBank: validations.senderBank, trackingKey: validations.trackingKey })
    .from(validations)
    .where(
      and(
        eq(validations.status, "valid"),
        isNotNull(validations.senderBank),
        isNotNull(validations.trackingKey),
      ),
    );
  const rules = deriveShapeRules(rows as { senderBank: string; trackingKey: string }[]);
  cache = { rules, expires: now + CACHE_TTL_MS };
  return rules;
}

/* Tests seed the log and must see the new rules at once */
export function resetShapeRules(): void {
  cache = null;
}

const fits = (rule: ShapeRule, clave: string) => rule.pattern.test(clave.trim().toUpperCase());

/* D15 — `unknown` when the bank has no graduated rule or there is no
   clave to check: a bank's first customer meets silence, not suspicion. */
export function checkShape(rules: ShapeRule[], bank: Bank | null, trackingKey: string | null): ShapeVerdict {
  if (!bank || !trackingKey) return "unknown";
  const rule = rules.find((r) => r.bank === bank);
  if (!rule) return "unknown";
  return fits(rule, trackingKey) ? "ok" : "mismatch";
}

/* D16 — exactly one graduated shape fits, or nothing is suggested. Shape
   is not a fingerprint: two banks can share one, and a wrong suggestion
   confirmed by a hurried payer is the silent false rejection this whole
   spec exists to kill. */
export function suggestBank(rules: ShapeRule[], trackingKey: string | null): Bank | null {
  if (!trackingKey) return null;
  const matches = rules.filter((r) => fits(r, trackingKey));
  return matches.length === 1 ? matches[0].bank : null;
}

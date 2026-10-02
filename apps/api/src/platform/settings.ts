import { desc, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { platformSettings, user } from "../db/schema";
import { BANKS } from "../direct-payments/banks";
import { DEFAULT_RECEIPT_TEMPLATE, RECEIPT_TEMPLATE_MAX, RECEIPT_TEMPLATE_MIN, receiptTemplateProblem } from "../receipt/template";

/* operator-panel D1: the keys, their types, their birth values and their
   validation — in code, never in the table. A key with no row answers
   its birth value, so the platform works before the panel is opened. */

type Def =
  | { type: "cents" | "int"; birth: number; min: number; max: number }
  | { type: "clabe" | "bank" | "phone"; birth: null }
  | { type: "text"; birth: null; min: number; max: number }
  | { type: "enum"; birth: string; values: readonly string[] }
  /* cash-at-stores D31: multi-line text with placeholders */
  | { type: "template"; birth: string; min: number; max: number };

export const SETTINGS = {
  validation_fee_cents: { type: "cents", birth: 500, min: 100, max: 5000 },
  welcome_bonus_validations: { type: "int", birth: 20, min: 0, max: 100 },
  negative_cap_cents: { type: "cents", birth: 5000, min: 0, max: 50000 },
  topup_min_cents: { type: "cents", birth: 5000, min: 0, max: 100000 },
  topup_clabe: { type: "clabe", birth: null },
  topup_bank: { type: "bank", birth: null },
  topup_beneficiary: { type: "text", birth: null, min: 3, max: 120 },
  default_timezone: {
    type: "enum",
    birth: "America/Mexico_City",
    values: ["America/Mexico_City", "America/Hermosillo", "America/Tijuana"],
  },
  default_fee_payer: { type: "enum", birth: "isp", values: ["customer", "isp"] },
  /* payments-and-classes D1: what a newborn business starts with. $0 and
     `flag` are the honest SPEI defaults; the operator may loosen them
     platform-wide, each business may override its own in Configuración. */
  default_tolerance_cents: { type: "cents", birth: 0, min: 0, max: 10000 },
  default_over_treatment: { type: "enum", birth: "flag", values: ["flag", "credit"] },
  /* operator-panel D1 (identity round, 2026-09-02): where a suspended
     business writes to. Unset = the screen shows no channel, and says
     so to nobody — set them before the first suspension. */
  support_whatsapp: { type: "phone", birth: null },
  support_email: { type: "text", birth: null, min: 5, max: 120 },
  /* cash-at-stores D22: the network's fee at the counter — the payer pays
     it on top of what they apply to the debt and the store keeps it all.
     One value for every store and every business (FR-008); read at quote
     and again at record (D14), copied onto `payments.store_fee_cents`. */
  store_fee_cents: { type: "cents", birth: 1500, min: 0, max: 5000 },
  /* cash-at-stores D31 (FR-043): the receipt the store sends by WhatsApp,
     with placeholders `renderReceipt` fills. Applies when a receipt is
     asked for: receipts are never stored, so there is no older version
     to keep. */
  store_receipt_template: {
    type: "template",
    birth: DEFAULT_RECEIPT_TEMPLATE,
    min: RECEIPT_TEMPLATE_MIN,
    max: RECEIPT_TEMPLATE_MAX,
  },
} as const satisfies Record<string, Def>;
/* Not here: `reader_model`, the operator's reader choice — its value is an
   id from the deploy's list, so it lives in platform/reader-model.ts
   (receipt-reader-tuning D8). */

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
type NumericKey = {
  [K in SettingKey]: (typeof SETTINGS)[K]["type"] extends "cents" | "int" ? K : never;
}[SettingKey];

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTINGS;
}

/* Validates per the key's type; returns the canonical stored string. */
export function validateSetting(
  key: SettingKey,
  raw: unknown,
): { ok: true; value: string } | { ok: false } {
  const def: Def = SETTINGS[key];
  switch (def.type) {
    case "cents":
    case "int": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isInteger(n) || n < def.min || n > def.max) return { ok: false };
      return { ok: true, value: String(n) };
    }
    case "clabe":
      return typeof raw === "string" && /^\d{18}$/.test(raw.trim())
        ? { ok: true, value: raw.trim() }
        : { ok: false };
    case "bank":
      return typeof raw === "string" && (BANKS as readonly string[]).includes(raw)
        ? { ok: true, value: raw }
        : { ok: false };
    case "phone": {
      /* Digits only, country code included (wa.me wants it that way) */
      const v = typeof raw === "string" ? raw.replace(/\D/g, "") : "";
      return v.length >= 10 && v.length <= 15 ? { ok: true, value: v } : { ok: false };
    }
    case "text": {
      const v = typeof raw === "string" ? raw.trim() : "";
      return v.length >= def.min && v.length <= def.max ? { ok: true, value: v } : { ok: false };
    }
    case "enum":
      return typeof raw === "string" && def.values.includes(raw) ? { ok: true, value: raw } : { ok: false };
    case "template": {
      /* cash-at-stores D31: the length, `{folio}`, and only the known
         placeholders — the same check the panel runs before it saves */
      const v = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
      return receiptTemplateProblem(v) === null ? { ok: true, value: v } : { ok: false };
    }
  }
}

type DB = DrizzleD1Database<Record<string, unknown>>;

async function latestRow(db: DB, key: SettingKey) {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .orderBy(desc(platformSettings.createdAt), desc(platformSettings.id))
    .limit(1);
  return row ?? null;
}

export async function getSetting(db: DB, key: SettingKey): Promise<string | null> {
  const row = await latestRow(db, key);
  if (row) return row.value;
  const birth = SETTINGS[key].birth;
  return birth === null ? null : String(birth);
}

export async function getNumberSetting(db: DB, key: NumericKey): Promise<number> {
  const v = await getSetting(db, key);
  return Number(v);
}

export async function setSetting(db: DB, key: SettingKey, value: string, authorUserId: string) {
  const [row] = await db.insert(platformSettings).values({ key, value, authorUserId }).returning();
  return row;
}

/* The panel's read: every key with its current value, its birth value
   and its last five rows (operator-panel D4). */
export async function listSettings(db: DB) {
  /* cash-at-stores T085 (FR-008, FR-043): who changed a rule, by name —
     as the reader model's history already says it (readerHistory) */
  const rows = await db
    .select({
      id: platformSettings.id,
      key: platformSettings.key,
      value: platformSettings.value,
      authorUserId: platformSettings.authorUserId,
      authorEmail: user.email,
      createdAt: platformSettings.createdAt,
    })
    .from(platformSettings)
    .leftJoin(user, eq(user.id, platformSettings.authorUserId))
    .where(inArray(platformSettings.key, SETTING_KEYS))
    .orderBy(desc(platformSettings.createdAt), desc(platformSettings.id));
  return SETTING_KEYS.map((key) => {
    const history = rows.filter((r) => r.key === key).slice(0, 5);
    const birth = SETTINGS[key].birth;
    return {
      key,
      type: SETTINGS[key].type,
      birth: birth === null ? null : String(birth),
      current: history[0]?.value ?? (birth === null ? null : String(birth)),
      history: history.map((r) => ({
        value: r.value,
        authorUserId: r.authorUserId,
        authorEmail: r.authorEmail ?? null,
        createdAt: r.createdAt.getTime(),
      })),
    };
  });
}

/* operator-panel D2: the operator is named in a Worker secret */
export function isPlatformOperator(env: { PLATFORM_OPERATOR_EMAILS?: string }, email: string): boolean {
  const list = (env.PLATFORM_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

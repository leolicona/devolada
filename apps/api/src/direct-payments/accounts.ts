import type { businesses } from "../db/schema";
import type { ConstaBeneficiary, RegisteredAccount } from "../consta";
import { BANKS } from "./banks";

/* receipt-triage D29, D30, D32 — the ISP's receiving accounts, read in
   one place.

   An ISP registers up to a CLABE, a debit card and a phone, and chooses
   one as its *cuenta de cobro* — the only account its payers see (D29).
   `spei_collect_kind` NULL reads `clabe`, so every business born before
   this feature collects exactly where it did. No kind is required any
   more (D32): the channel is configured when the cuenta de cobro is
   registered with a bank the provider knows. This helper replaces every
   `speiClabe!` beneficiary read.

   A payment snapshots, at submission, the account it is checked against
   and every account registered then — current and retired (D25, D30) —
   so an edit in Cuenta never moves a payment in flight (FR-021). The
   JSON on the payment row is `{ kind, value, bank, retired? }`; the
   engine speaks `ConstaBeneficiary`. Both conversions live here. */

type Isp = typeof businesses.$inferSelect;

export type AccountKind = "clabe" | "card" | "phone";

/* The shape stored on `payments.beneficiary`, `payments.registered_accounts`
   and `businesses.spei_retired_accounts` (the last adds `removedAt`) */
export type StoredAccount = {
  kind: AccountKind;
  value: string;
  bank: string;
  retired?: true;
  removedAt?: number;
};

const KNOWN_BANKS: ReadonlySet<string> = new Set(BANKS);

export function collectKind(business: Pick<Isp, "speiCollectKind">): AccountKind {
  return business.speiCollectKind ?? "clabe";
}

/* The business's current accounts, each only when its number and bank
   are both set */
export function currentAccounts(
  business: Pick<Isp, "speiClabe" | "speiBank" | "speiCard" | "speiCardBank" | "speiPhone" | "speiPhoneBank">,
): StoredAccount[] {
  const out: StoredAccount[] = [];
  if (business.speiClabe && business.speiBank) out.push({ kind: "clabe", value: business.speiClabe, bank: business.speiBank });
  if (business.speiCard && business.speiCardBank) out.push({ kind: "card", value: business.speiCard, bank: business.speiCardBank });
  if (business.speiPhone && business.speiPhoneBank) out.push({ kind: "phone", value: business.speiPhone, bank: business.speiPhoneBank });
  return out;
}

/* The cuenta de cobro's two halves as the columns hold them, before the
   pair is judged — so a gate can tell "no account" from "an account
   whose bank the provider does not know" (BUG-008) */
export function collectHalves(business: Isp): { value: string | null; bank: string | null } {
  switch (collectKind(business)) {
    case "clabe":
      return { value: business.speiClabe, bank: business.speiBank };
    case "card":
      return { value: business.speiCard, bank: business.speiCardBank };
    case "phone":
      return { value: business.speiPhone, bank: business.speiPhoneBank };
  }
}

/* D29: the cuenta de cobro as stored, or null when the chosen kind has
   no number registered (a business that has not configured SPEI) */
export function collectStored(business: Isp): StoredAccount | null {
  return currentAccounts(business).find((a) => a.kind === collectKind(business)) ?? null;
}

/* D29/D32: the cuenta de cobro as the engine's beneficiary. The
   beneficiary name travels when configured (claimed-amount D5). */
export function collectAccount(business: Isp): ConstaBeneficiary | null {
  const stored = collectStored(business);
  return stored ? toBeneficiary(stored, business.speiBeneficiaryName) : null;
}

/* D32: `configured` — the cuenta de cobro is registered and its bank is
   one the provider knows. For a CLABE-only business with NULL
   `spei_collect_kind` this is exactly the test before this feature. */
export function collectBankIsKnown(business: Isp): boolean {
  const stored = collectStored(business);
  return Boolean(stored && KNOWN_BANKS.has(stored.bank));
}

export function retiredAccounts(business: Pick<Isp, "speiRetiredAccounts">): StoredAccount[] {
  return parseAccounts(business.speiRetiredAccounts).map((a) => ({ ...a, retired: true as const }));
}

/* D30: what a payment snapshots — the current accounts and every retired
   one, flagged. A number set again is on the current list only (the
   settings handler takes it off the retired one in the same write). */
export function registeredAccounts(business: Isp): StoredAccount[] {
  const current = currentAccounts(business);
  const retired = retiredAccounts(business).filter(
    (r) => !current.some((c) => c.kind === r.kind && c.value === r.value),
  );
  return [...current, ...retired.map(({ removedAt: _removedAt, ...r }) => r)];
}

export function parseAccounts(json: string | null | undefined): StoredAccount[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter(isStored) : [];
  } catch {
    return [];
  }
}

export function parseAccount(json: string | null | undefined): StoredAccount | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return isStored(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isStored(v: unknown): v is StoredAccount {
  const o = v as StoredAccount;
  return Boolean(o && typeof o === "object" && ["clabe", "card", "phone"].includes(o.kind) && typeof o.value === "string" && typeof o.bank === "string");
}

export function toBeneficiary(stored: StoredAccount, name?: string | null): RegisteredAccount {
  const base =
    stored.kind === "clabe"
      ? { bank: stored.bank, clabe: stored.value }
      : stored.kind === "card"
        ? { bank: stored.bank, cardNumber: stored.value }
        : { bank: stored.bank, phoneNumber: stored.value };
  return {
    ...base,
    ...(name ? { name } : {}),
    ...(stored.retired ? { retired: true as const } : {}),
  } as RegisteredAccount;
}

export function fromBeneficiary(account: ConstaBeneficiary & { retired?: true }): StoredAccount {
  const kind: AccountKind = "clabe" in account ? "clabe" : "cardNumber" in account ? "card" : "phone";
  const value = "clabe" in account ? account.clabe : "cardNumber" in account ? account.cardNumber : account.phoneNumber;
  return { kind, value, bank: account.bank, ...(account.retired ? { retired: true as const } : {}) };
}

export const lastFour = (value: string) => value.slice(-4);

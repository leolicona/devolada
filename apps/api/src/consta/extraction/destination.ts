import type { ConstaBeneficiary, RegisteredAccount } from "../index";
import type { Reading } from "./reader";

/* receipt-triage D24, D30 — which of the ISP's accounts a receipt's
   destination names.

   A receipt rarely prints the whole receiving account: receipt 1 shows
   "••••8195" under a CLABE label, receipt 2 shows "195", receipt 3 shows
   "•3819 Cuenta" — the account number inside the CLABE, not its tail. So
   the tie is by the last visible digits — four, or three when only three
   show — against every *form* of every account the payment registered:
   the CLABE whole and its 11-digit account segment (positions 7–17), the
   card's 16, the phone's 10. Retired accounts are included and come back
   flagged (D30): a receipt paid to a removed account is checked there,
   and the lifecycle holds its confirmation for the ISP (D31).

   The kind the label names only *orders* the search. Labels lie
   ("Tarjeta" over a CLABE's account number), and a wrong kind must never
   turn a fit into a mismatch (clarified 2026-09-24): exactly one fit
   among the forms of the named kind ties it; otherwise every form of
   every account is tried. Fewer than three visible digits, or digits
   that end two accounts, is `unknown` — it neither stops nor confirms
   anything (FR-019). Only a reading that fits nothing is `none`.

   Pure: no database, no clock. */

export type AccountKind = "clabe" | "card" | "phone";

export type TieResult = { tied: RegisteredAccount } | "unknown" | "none";

export function accountKind(account: ConstaBeneficiary): AccountKind {
  if ("clabe" in account) return "clabe";
  if ("cardNumber" in account) return "card";
  return "phone";
}

export function accountValue(account: ConstaBeneficiary): string {
  if ("clabe" in account) return account.clabe;
  if ("cardNumber" in account) return account.cardNumber;
  return account.phoneNumber;
}

/* The CLABE's account number: 3 digits of bank, 3 of plaza, then 11 of
   account, then the check digit — so positions 7 to 17 (receipt 3). */
const clabeSegment = (clabe: string) => clabe.slice(6, 17);

/* Each account's forms, tagged with the reader's kind that names them.
   A CLABE answers to `clabe` whole and to `account` by its segment. */
function formsOf(account: RegisteredAccount): { kind: NonNullable<Reading["destination"]["kind"]>; digits: string }[] {
  const value = accountValue(account);
  switch (accountKind(account)) {
    case "clabe":
      return [
        { kind: "clabe", digits: value },
        { kind: "account", digits: clabeSegment(value) },
      ];
    case "card":
      return [{ kind: "card", digits: value }];
    case "phone":
      return [{ kind: "phone", digits: value }];
  }
}

export function visibleTail(digits: string | null | undefined): string | null {
  const only = (digits ?? "").replace(/\D/g, "");
  if (only.length < 3) return null;
  return only.slice(-4);
}

export function tieDestination(
  destination: Reading["destination"] | null | undefined,
  accounts: RegisteredAccount[],
): TieResult {
  const tail = visibleTail(destination?.digits);
  if (!tail) return "unknown";

  const fitting = (kind: Reading["destination"]["kind"] | "any") =>
    accounts.filter((a) =>
      formsOf(a).some((f) => (kind === "any" || f.kind === kind) && f.digits.endsWith(tail)),
    );

  /* The label's kind first: exactly one fit there ties it */
  if (destination?.kind) {
    const byKind = fitting(destination.kind);
    if (byKind.length === 1) return { tied: byKind[0] };
  }
  const all = fitting("any");
  if (all.length === 1) return { tied: all[0] };
  return all.length === 0 ? "none" : "unknown";
}

/* receipt-triage D22: Banxico's own word on the receiving account, as the
   CEP names it — whole or masked is unmeasured, so it goes through the
   same tie with no kind. A whole account (≥ 10 digits) that fits none of
   the snapshot is a contradiction; a masked one that fits nothing, or two,
   is simply no better than what the payment already had. */
export function tieCepAccount(
  account: string | null | undefined,
  accounts: RegisteredAccount[],
): TieResult | "contradicts" {
  const digits = (account ?? "").replace(/\D/g, "");
  if (digits.length >= 10) {
    const whole = accounts.filter((a) => accountValue(a) === digits);
    if (whole.length === 1) return { tied: whole[0] };
    return whole.length === 0 ? "contradicts" : "unknown";
  }
  const tie = tieDestination({ kind: null, digits }, accounts);
  return tie === "none" ? "unknown" : tie;
}

/* Two accounts are the same account when their kind and number are */
export function sameAccount(a: ConstaBeneficiary, b: ConstaBeneficiary): boolean {
  return accountKind(a) === accountKind(b) && accountValue(a) === accountValue(b);
}

/* What the provider may see: the account itself, never our `retired`
   flag (the guard would pass it, the provider has no use for it). */
export function asBeneficiary(account: RegisteredAccount): ConstaBeneficiary {
  const { retired: _retired, ...rest } = account as RegisteredAccount & { retired?: true };
  return rest as ConstaBeneficiary;
}

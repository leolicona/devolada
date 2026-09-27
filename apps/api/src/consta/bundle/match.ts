import { tieCepAccount } from "../extraction/destination";
import { wallClockMs } from "../../time/business-day";
import { CEP_TIMEZONE } from "./cadena";
import type { CepRecord, MatchPolicy, MatchResult, ReceiptSide, TrailCandidate, TrailWhy } from "./types";

/* cep-bundle-match D6, D7, D8, D11 — which transfer a receipt is, among
   the ones a search without a clave found.

   The engine reads (bundle, cadena, records); the lifecycle decides, with
   this: one pure function over the receipt's side, the candidates, the
   claves live payments already hold and the policy — pure so spec 012's
   batch path can run it with a bank statement standing in for the receipt
   (FR-012). No names anywhere: the sender may be a relative paying for
   the customer, and the link already says who the customer is (spec,
   the creator's two rules).

   The order (D8), each step recording why it drops what it drops:
     1. integrity — another amount, or a destination that ties to none of
        the payment's accounts: this was never the business's transfer;
     2. used — a clave a live payment holds already paid for something;
     3. tail — the receipt's sender digits, by the CEP's account type (D7);
     4. window — the receipt's time against the credit time (D6).
   One left is chosen. None, or several, is undecided — the payer is asked
   for the clave (D10). */

/* D6, clarified 2026-09-27: from one minute before the receipt's time to
   three after — a credit cannot precede its send except by clock drift,
   and the measured gaps were +8 s, +22 s and about +60 s — and no choice
   when the two nearest were credited within 30 s of each other */
export const MATCH_POLICY: MatchPolicy = { beforeS: 60, afterS: 180, marginS: 30 };

/* The panel shows a candidate by four digits, never more (FR-010) */
export const tailOf = (account: string) => account.slice(-4);

/* D7: the receipt's tail against the CEP's sender account, by the type the
   CEP names. `40` is a CLABE, and receipts print either its end or the end
   of the account number inside it — Azteca's "***8301" is positions 14–17,
   the digits before the check digit (measured 2026-09-26) — so both are
   compared. A debit card (`3`), a phone (`10`) or any other type is
   compared on its own end. */
export function tailFits(receiptTail: string, record: Pick<CepRecord, "senderAccountType" | "senderAccount">): boolean {
  const account = record.senderAccount.replace(/\D/g, "");
  if (!account) return false;
  if (account.endsWith(receiptTail)) return true;
  return Number(record.senderAccountType) === 40 && account.length >= 18 && account.slice(0, 17).endsWith(receiptTail);
}

/* FR-010, D7: which four. When the receipt's tail fitted the account
   number inside a CLABE rather than the CLABE's own end — Azteca's
   "***8301" in a CLABE ending 3010 (research R8) — the panel shows those
   four, the ones the operator can hold against the receipt; otherwise
   the account's last four. Four digits either way. */
export function shownTail(
  record: Pick<CepRecord, "senderAccountType" | "senderAccount">,
  receiptTail: string | null | undefined,
): string {
  const account = record.senderAccount.replace(/\D/g, "");
  const tail = receiptTail?.replace(/\D/g, "") ?? "";
  if (tail.length >= 3 && !account.endsWith(tail) && tailFits(tail, record)) return account.slice(13, 17);
  return tailOf(account);
}

/* The receipt's instant as an interval: a time with seconds is a point; a
   time printed "HH:MM" is the whole minute (research R7) */
function receiptInterval(receipt: ReceiptSide): { from: number; to: number } | null {
  if (!receipt.time || !receipt.day) return null;
  const at = wallClockMs(CEP_TIMEZONE, receipt.day, receipt.time);
  const withSeconds = receipt.time.length > 5;
  return { from: at, to: withSeconds ? at : at + 59_000 };
}

/* d = credit − receipt, in whole seconds, at the receipt interval's point
   nearest the credit: 0 when the credit falls inside a printed minute */
function distanceS(creditedAt: number, receipt: { from: number; to: number }): number {
  if (creditedAt < receipt.from) return Math.round((creditedAt - receipt.from) / 1000);
  if (creditedAt > receipt.to) return Math.round((creditedAt - receipt.to) / 1000);
  return 0;
}

export function matchCandidates(
  receipt: ReceiptSide,
  candidates: CepRecord[],
  used: ReadonlySet<string>,
  policy: MatchPolicy = MATCH_POLICY,
): MatchResult {
  const fate = new Map<string, { fate: TrailCandidate["fate"]; why: TrailWhy | null; distanceS?: number | null }>();
  const drop = (c: CepRecord, why: TrailWhy, d?: number | null) =>
    fate.set(c.id, { fate: "dropped", why, ...(d !== undefined ? { distanceS: d } : {}) });

  /* 1. integrity */
  const whole = candidates.filter((c) => {
    if (receipt.amountCents !== null && c.amountCents !== receipt.amountCents) return drop(c, "amount"), false;
    if (tieCepAccount(c.receiverAccount, receipt.accounts) === "contradicts") return drop(c, "account"), false;
    return true;
  });
  /* 2. used — claves compare whatever case a payer typed them in */
  const taken = new Set([...used].map((u) => u.toUpperCase()));
  const free = whole.filter((c) => (taken.has(c.clave.toUpperCase()) ? (drop(c, "used"), false) : true));

  /* 3. tail — three digits at least, or it tells nothing (D7) */
  const tail = receipt.tail && receipt.tail.replace(/\D/g, "").length >= 3 ? receipt.tail.replace(/\D/g, "") : null;
  const byTail = tail ? free.filter((c) => (tailFits(tail, c) ? true : (drop(c, "tail"), false))) : free;
  const tailDropped = byTail.length < free.length;

  /* 4. window — and the nearest, unless the two nearest are too close */
  const interval = receiptInterval(receipt);
  let left = byTail;
  let timeDropped = false;
  let tooClose = false;
  const distances = new Map<string, number>();
  if (interval) {
    const inside = byTail.filter((c) => {
      const d = distanceS(c.creditedAt, interval);
      distances.set(c.id, d);
      if (d < -policy.beforeS || d > policy.afterS) return drop(c, "window", d), false;
      return true;
    });
    timeDropped = inside.length < byTail.length;
    const ranked = [...inside].sort((a, b) => Math.abs(distances.get(a.id)!) - Math.abs(distances.get(b.id)!));
    if (ranked.length >= 2) {
      const [a, b] = ranked;
      /* Too close to call: credited within the margin of each other, or
         exactly as near — two credits inside one printed minute are both
         at 0 (spec Edge Cases) */
      if (
        Math.abs(a.creditedAt - b.creditedAt) <= policy.marginS * 1000 ||
        Math.abs(distances.get(a.id)!) === Math.abs(distances.get(b.id)!)
      ) {
        tooClose = true;
        left = ranked;
        for (const c of ranked) {
          const near =
            Math.abs(c.creditedAt - a.creditedAt) <= policy.marginS * 1000 ||
            Math.abs(distances.get(c.id)!) === Math.abs(distances.get(a.id)!);
          fate.set(c.id, near ? { fate: "kept", why: "too_close", distanceS: distances.get(c.id)! } : { fate: "dropped", why: "farther", distanceS: distances.get(c.id)! });
        }
        left = ranked.filter((c) => fate.get(c.id)!.fate === "kept");
      } else {
        /* The nearest wins; the others were inside the window, farther */
        for (const c of ranked.slice(1)) drop(c, "farther", distances.get(c.id)!);
        timeDropped = true;
        left = [a];
      }
    } else {
      left = ranked;
    }
  }

  const trail = (chosen: CepRecord | null): TrailCandidate[] =>
    candidates.map((c) => {
      const f = chosen && c.id === chosen.id ? { fate: "chosen" as const, why: null } : (fate.get(c.id) ?? { fate: "kept" as const, why: null });
      const d = f.distanceS ?? distances.get(c.id);
      return {
        cepId: c.id,
        clave: c.clave,
        creditTime: c.creditTime,
        tail: shownTail(c, tail),
        fate: f.fate,
        why: f.why,
        ...(d !== undefined ? { distanceS: d } : {}),
      };
    });

  if (left.length === 1 && !tooClose) {
    const chosen = left[0];
    return {
      decided: "chosen",
      chosen,
      by: tailDropped && timeDropped ? "both" : tailDropped ? "tail" : timeDropped ? "time" : "none",
      distanceS: interval ? distances.get(chosen.id)! : null,
      trail: trail(chosen),
    };
  }
  if (left.length === 0) {
    /* all used — step 2 dropped every candidate that was this business's */
    const reason = whole.length > 0 && free.length === 0 ? "all_used" : "none_fit";
    return { decided: "undecided", reason, trail: trail(null) };
  }
  return { decided: "undecided", reason: tooClose ? "too_close" : "no_signal", trail: trail(null) };
}

/* D11 (research R11): a clave the payer typed, against the candidates the
   undecided payment kept. Measured on dev 2026-09-26: four typed claves
   failed — three with O and 0 swapped, one with a character missing. Both
   sides are read with O as 0 and I as 1 (Azteca's claves end in the letter
   I, and payers type 1), and a typed clave one character short of a
   candidate fits it. Only exactly one fit is an answer; forgiveness is
   only ever against the kept candidates, never against Banxico. */
export function fitClave(typed: string, candidates: string[]): string | null {
  const read = (s: string) => s.trim().toUpperCase().replace(/O/g, "0").replace(/I/g, "1");
  const t = read(typed);
  if (!t) return null;
  const fits = [...new Set(candidates)].filter((candidate) => {
    const c = read(candidate);
    if (c === t) return true;
    if (c.length !== t.length + 1) return false;
    for (let i = 0; i < c.length; i++) if (c.slice(0, i) + c.slice(i + 1) === t) return true;
    return false;
  });
  return fits.length === 1 ? fits[0] : null;
}

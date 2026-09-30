import { tieCepAccount } from "../extraction/destination";
import { wallClockMs } from "../../time/business-day";
import { CEP_TIMEZONE } from "./cadena";
import type { CepRecord, MatchMode, MatchPolicy, MatchResult, ReceiptSide, TrailCandidate, TrailWhy } from "./types";

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
  /* payment-without-receipt D10/D11: `receipt` is this function's body,
     unchanged; the two others are below */
  mode: MatchMode = "receipt",
): MatchResult {
  if (mode === "own") return matchOwn(receipt, candidates, used);
  if (mode === "typed") return matchTyped(receipt, candidates, used);
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

/* ---- payment-without-receipt D10, D11, D26: the payer's own reference,
   and a reference they typed ---- */

const digitsOf = (account: string) => account.replace(/\D/g, "");
const inAccounts = (c: CepRecord, accounts: string[] | undefined) =>
  Boolean(accounts?.length) && accounts!.some((a) => digitsOf(a) === digitsOf(c.senderAccount));

/* The earliest credited, the clave breaking a tie so the choice never
   depends on the order the bundle listed them */
const earliest = (pool: CepRecord[]) =>
  [...pool].sort((a, b) => a.creditedAt - b.creditedAt || a.clave.localeCompare(b.clave))[0];

/* Steps 1–2 of every mode, as cep-bundle-match D8 wrote them: integrity,
   then used. `fate` records why each dropped. */
function wholeAndFree(receipt: ReceiptSide, candidates: CepRecord[], used: ReadonlySet<string>, fate: Map<string, TrailWhy>) {
  const whole = candidates.filter((c) => {
    if (receipt.amountCents !== null && c.amountCents !== receipt.amountCents) return fate.set(c.id, "amount"), false;
    if (tieCepAccount(c.receiverAccount, receipt.accounts) === "contradicts") return fate.set(c.id, "account"), false;
    return true;
  });
  const taken = new Set([...used].map((u) => u.toUpperCase()));
  const free = whole.filter((c) => (taken.has(c.clave.toUpperCase()) ? (fate.set(c.id, "used"), false) : true));
  return { whole, free };
}

function trailOfModes(candidates: CepRecord[], fate: Map<string, TrailWhy>, chosen: CepRecord | null, tail: string | null): TrailCandidate[] {
  return candidates.map((c) => {
    const why = fate.get(c.id) ?? null;
    return {
      cepId: c.id,
      clave: c.clave,
      creditTime: c.creditTime,
      tail: shownTail(c, tail),
      /* the payer's other transfers are kept for their next confirmation */
      fate: chosen && c.id === chosen.id ? ("chosen" as const) : why ? ("dropped" as const) : ("kept" as const),
      why: chosen && c.id === chosen.id ? null : why,
    };
  });
}

const typedTail = (receipt: ReceiptSide) => {
  const t = receipt.tail?.replace(/\D/g, "") ?? "";
  return t.length >= 3 ? t : null;
};

/* D10 — the payer's own reference: every transfer it found is theirs.
   Integrity → used → (a D26 transition) the previous holder's accounts
   dropped → the typed four digits, when a correction brought them → an
   account learned for this service first → the earliest credited. Nothing
   is undecided but `all_used`; during a transition, a transfer from an
   account not known for this person is held until they type its four
   digits (FR-041). */
function matchOwn(receipt: ReceiptSide, candidates: CepRecord[], used: ReadonlySet<string>): MatchResult {
  const fate = new Map<string, TrailWhy>();
  const { whole, free } = wholeAndFree(receipt, candidates, used, fate);
  const allowed = receipt.excludedAccounts
    ? free.filter((c) => (inAccounts(c, receipt.excludedAccounts) ? (fate.set(c.id, "excluded"), false) : true))
    : free;
  const tail = typedTail(receipt);
  const left = tail ? allowed.filter((c) => (tailFits(tail, c) ? true : (fate.set(c.id, "tail"), false))) : allowed;
  if (!left.length) {
    const reason = whole.length > 0 && free.length === 0 ? "all_used" : "none_fit";
    return { decided: "undecided", reason, trail: trailOfModes(candidates, fate, null, tail) };
  }
  const known = left.filter((c) => inAccounts(c, receipt.knownAccounts));
  const chosen = earliest(known.length ? known : left);
  if (receipt.excludedAccounts && !known.length && !tail) {
    return { decided: "undecided", reason: "no_signal", trail: trailOfModes(candidates, fate, null, tail) };
  }
  return {
    decided: "chosen",
    chosen,
    by: known.length ? "learned_account" : tail ? "sender_tail" : "earliest",
    distanceS: null,
    trail: trailOfModes(candidates, fate, chosen, tail),
  };
}

/* D11 — a reference the payer typed, which others may share: only a
   second fact ties a transfer to this customer (FR-032). Integrity → used
   → an account learned for this service, compared whole → the four digits
   the payer typed. Never the window: a typed row carries no time. One left
   confirms; none or several is undecided, and the lifecycle asks. */
function matchTyped(receipt: ReceiptSide, candidates: CepRecord[], used: ReadonlySet<string>): MatchResult {
  const fate = new Map<string, TrailWhy>();
  const { whole, free } = wholeAndFree(receipt, candidates, used, fate);
  const tail = typedTail(receipt);
  const known = free.filter((c) => inAccounts(c, receipt.knownAccounts));
  if (known.length === 1) {
    return { decided: "chosen", chosen: known[0], by: "learned_account", distanceS: null, trail: trailOfModes(candidates, fate, known[0], tail) };
  }
  const pool = known.length > 1 ? known : free;
  if (!pool.length) {
    const reason = whole.length > 0 && free.length === 0 ? "all_used" : "none_fit";
    return { decided: "undecided", reason, trail: trailOfModes(candidates, fate, null, tail) };
  }
  if (!tail) return { decided: "undecided", reason: "no_signal", trail: trailOfModes(candidates, fate, null, tail) };
  const fits = pool.filter((c) => (tailFits(tail, c) ? true : (fate.set(c.id, "tail"), false)));
  if (fits.length === 1) {
    return { decided: "chosen", chosen: fits[0], by: "sender_tail", distanceS: null, trail: trailOfModes(candidates, fate, fits[0], tail) };
  }
  return { decided: "undecided", reason: fits.length ? "no_signal" : "none_fit", trail: trailOfModes(candidates, fate, null, tail) };
}

/* payment-without-receipt D17 (research R15): the clave's last four
   characters, against the candidates an undecided payment kept — read as
   `fitClave` reads a clave (O as 0, I as 1). Exactly one fit is an answer;
   two sharing the four ask the whole clave. Never searched at Banxico. */
export function fitClaveTail(tail: string, candidates: string[]): string | null {
  const read = (s: string) => s.trim().toUpperCase().replace(/O/g, "0").replace(/I/g, "1");
  const t = read(tail);
  if (t.length !== 4) return null;
  const fits = [...new Set(candidates)].filter((c) => read(c).slice(-4) === t);
  return fits.length === 1 ? fits[0] : null;
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

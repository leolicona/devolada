/* Which of the two steps this device is on, per link (D19).

   The payment has an interruption at its centre: the transfer happens in
   the bank app, not here. The payer leaves, and when they come back the
   page has often been discarded and reloaded. Remembering the step is
   what makes the return trip land on the proof form instead of on a
   CLABE they already used.

   It lives next to the saved links (returning-customer-access D2) and
   for the same reason: the device already knows, and the API has no
   business hearing about it (D9 — this app is session-less). */

const KEY = "devolada-pago-step";

export type Step = "transfer" | "proof";

/* localStorage throws in some privacy modes, and what it holds is data we
   do not control. Anything unreadable means "start at the beginning" —
   the worst case is a payer who sees the CLABE one more time, which is
   the state the page was in before this existed. */
function readAll(): Record<string, Step> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, Step] => entry[1] === "transfer" || entry[1] === "proof",
      ),
    );
  } catch {
    return {};
  }
}

function write(steps: Record<string, Step>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(steps));
  } catch {
    /* Denied or out of quota: the page keeps working, the payer just
       starts at step 1 next time. */
  }
}

export function readStep(token: string): Step {
  return readAll()[token] ?? "transfer";
}

/* Both directions are remembered: a payer who walks back to the data on
   purpose must not be pushed forward again by the next reload (D19). */
export function rememberStep(token: string, step: Step): void {
  write({ ...readAll(), [token]: step });
}

/* A finished payment gives the step back — the link is permanent (D1)
   and next month starts where the next payment starts. */
export function forgetStep(token: string): void {
  const all = readAll();
  delete all[token];
  write(all);
}

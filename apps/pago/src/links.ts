/* The links this device was handed (returning-customer-access D2).

   Keeping them grants nothing new: the token was already on this device
   the moment the customer opened the link. What it buys is the return
   trip — next month the customer opens the bare origin instead of
   hunting for a WhatsApp message from four weeks ago. */

const KEY = "devolada-pago-links";

export type SavedLink = {
  token: string;
  /* What the chooser shows (D3). The customer's name when the API knows
     it; the ISP's name for a link whose channel is not configured yet,
     because that link is still worth coming back to. */
  name: string;
};

/* localStorage throws in some privacy modes, and what it holds is data we
   do not control. Anything unreadable counts as nothing saved — this page
   has a payment to take, and it must never fail on a stale key. */
export function readLinks(): SavedLink[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SavedLink =>
        typeof entry?.token === "string" &&
        entry.token.length > 0 &&
        typeof entry?.name === "string",
    );
  } catch {
    return [];
  }
}

function write(links: SavedLink[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(links));
  } catch {
    /* Denied or out of quota: the page keeps working, the customer just
       does not get the shortcut next month. */
  }
}

/* One entry per token, and the newest name wins — a customer renamed in
   WispHub should not be listed under the old name forever. */
export function rememberLink(token: string, name: string): void {
  write([...readLinks().filter((l) => l.token !== token), { token, name }]);
}

export function forgetLink(token: string): void {
  write(readLinks().filter((l) => l.token !== token));
}

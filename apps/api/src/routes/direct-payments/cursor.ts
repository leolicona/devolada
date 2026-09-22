/* The browse cursor of GET /direct-payments/customers
   (links-on-demand-search D2).

   A browse walks two sources, never interleaved: Devolada's own API
   links first — a business without WispHub holds nothing else (FR-015)
   — and the provider's customer list second. The cursor carries which
   one it is in, because an API link is not a WispHub customer and
   mixing them mid-block would make the position meaningless.

   Phase one is a keyset walk of `payment_links` by (created_at, id):
   stable, because Devolada owns that order. Phase two is the provider's
   own `offset`, which it pages by and offers no ordering for (D6).

   It is **opaque** on purpose. A client that could name an offset could
   walk the whole customer base a block at a time, which is the cost this
   feature exists to remove. base64url, so it survives a query string
   without escaping, and unreadable text is refused rather than guessed
   at: a cursor is either one this API wrote or it is a
   `VALIDATION_ERROR`. */

export type BrowseCursor =
  /* Still walking the business's API links: the last row handed out */
  | { phase: "api"; createdAt: number; id: string }
  /* Walking WispHub's list: the offset the next block starts at */
  | { phase: "wisphub"; offset: number };

/* Where a browse with no cursor begins */
export const FIRST_CURSOR: BrowseCursor = { phase: "api", createdAt: 0, id: "" };

const toBase64Url = (raw: string) =>
  btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const fromBase64Url = (raw: string) => {
  const padded = raw.replaceAll("-", "+").replaceAll("_", "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
};

export function encodeCursor(cursor: BrowseCursor): string {
  const plain =
    cursor.phase === "api"
      ? `api:${cursor.createdAt}:${cursor.id}`
      : `wh:${cursor.offset}`;
  return toBase64Url(plain);
}

/* null means unreadable — the caller answers VALIDATION_ERROR. Every
   failure mode lands here: text that is not base64url, a phase this
   version never wrote, a number that is not one, and a negative offset
   (a client probing the walk backwards). */
export function decodeCursor(raw: string): BrowseCursor | null {
  let plain: string;
  try {
    plain = fromBase64Url(raw);
  } catch {
    return null;
  }
  if (plain.startsWith("api:")) {
    /* The id may hold colons of its own; only the first two separate */
    const rest = plain.slice("api:".length);
    const cut = rest.indexOf(":");
    if (cut < 0) return null;
    const createdAt = Number(rest.slice(0, cut));
    const id = rest.slice(cut + 1);
    if (!Number.isSafeInteger(createdAt) || createdAt < 0 || id === "") return null;
    return { phase: "api", createdAt, id };
  }
  if (plain.startsWith("wh:")) {
    const offset = Number(plain.slice("wh:".length));
    if (!Number.isSafeInteger(offset) || offset < 0) return null;
    return { phase: "wisphub", offset };
  }
  return null;
}

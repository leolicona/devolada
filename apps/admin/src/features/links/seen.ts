import type { CustomerRow, CustomersResponse } from "@devolada/api/direct-payments-schema";

/* links-on-demand-search D11: the page's whole memory, in the browser.

   Four stores, no server state, all of them `sessionStorage` because
   that is exactly what they mean — per operator, per session, promised
   to nobody else:

   1. **Search results**, keyed by the normalised text, for two minutes
      (FR-012). A TanStack cache alone dies on reload; this is what
      brings a reloaded search back without a second visible wait.
   2. **Recently seen customers** — the name and phone WispHub last
      answered (FR-021). A live answer ALWAYS outranks it; it is read
      only when the provider did not answer.
   3. **Copied / sent marks** (FR-022). No delivery state is stored
      anywhere: Devolada has no record that a link was sent, and this
      mark promises nothing to another operator or a later session.
   4. **The last Links address** (cobros-in-links SC-005), added below:
      the view and the text, so a return through the menu lands where
      the operator was.

   All of them live in one module on purpose: US2 wires the first into
   `useCustomers`, US3 the second, and US1 renders the third. One file
   they each consume beats three phases each editing the same file.

   Every read and write is wrapped: `sessionStorage` throws in a private
   window and in an iframe with third-party storage blocked, and a page
   that cannot remember must still work. */

const RESULTS = "devolada.links.results.v1";
const CUSTOMERS = "devolada.links.customers.v1";
const MARKS = "devolada.links.marks.v1";
const ADDRESS = "devolada.links.address.v1";

/* FR-012: results for the same text are reused for two minutes */
export const RESULTS_TTL_MS = 2 * 60_000;
/* FR-021: "a short window". Long enough to survive a provider stall
   mid-session, short enough that a name nobody re-read is not offered
   as if it were current. */
export const CUSTOMERS_TTL_MS = 15 * 60_000;
/* The cache is a convenience, never a base: a session that browsed for
   an hour keeps the last few hundred rows it saw and forgets the rest. */
const CUSTOMERS_MAX = 300;

/* FR-004: case and accents ignored on both sides, so "María", "maria"
   and "MARIA" are one key and one search. */
export const foldText = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

export const normalizeSearch = (text: string) => foldText(text.trim()).replace(/\s+/g, " ");

/* The identity a row is remembered by: the usuario for a panel row, the
   caller's reference for an API one (D6). Cobros passes a debtor's
   usuario through the same door (D14), so the shape is the narrow one
   both screens can satisfy rather than a Links row. */
export const rowKey = (row: { usuario: string | null; customerRef?: string | null }) =>
  row.usuario ?? row.customerRef ?? "";

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* A full or forbidden store is not an error the operator can act
       on: the page simply stops remembering. */
  }
}

/* ---- 1. Search results (FR-012, US2) ---- */

/* The whole first block, not just its rows: the count the page reports
   and whether the provider answered are part of what the operator saw,
   and restoring rows without them would redraw the screen wrong. */
type StoredResults = { at: number; block: CustomersResponse };

/* cobros-in-links D12: which view asked. The same text in the customer
   view and in Por cobrar is two questions — Por cobrar asks for panel
   rows only (D8) — so it is two entries. The customer view keeps the
   bare key it always had. */
export type SearchView = "customers" | "receivables";
const resultsKey = (text: string, view: SearchView) => {
  const key = normalizeSearch(text);
  return key === "" || view === "customers" ? key : `${view}:${key}`;
};

/* Null past the two minutes, so an expired entry is simply a search
   nobody stored — the caller asks the provider again (FR-012). */
export function readResults(text: string, view: SearchView = "customers"): StoredResults | null {
  const stored = read<Record<string, StoredResults>>(RESULTS)?.[resultsKey(text, view)];
  if (!stored) return null;
  return Date.now() - stored.at > RESULTS_TTL_MS ? null : stored;
}

export function writeResults(text: string, block: CustomersResponse, view: SearchView = "customers"): void {
  const key = resultsKey(text, view);
  /* An empty box leaves no entry behind: a browse is not a search */
  if (key === "") return;
  const all = read<Record<string, StoredResults>>(RESULTS) ?? {};
  /* Drop what has expired rather than growing forever */
  const now = Date.now();
  for (const [stale, entry] of Object.entries(all)) {
    if (now - entry.at > RESULTS_TTL_MS) delete all[stale];
  }
  all[key] = { at: now, block };
  write(RESULTS, all);
}

/* ---- 2. Recently seen customers (FR-021, US3) ---- */

type SeenCustomer = {
  at: number;
  usuario: string;
  wisphubId: number | null;
  name: string | null;
  phone: string | null;
};

/* Every live answer overwrites what it covers: the cache can never
   contradict a provider that just spoke. */
export function rememberCustomers(rows: CustomerRow[]): void {
  const all = read<Record<string, SeenCustomer>>(CUSTOMERS) ?? {};
  const now = Date.now();
  for (const row of rows) {
    if (row.channel !== "panel" || row.usuario === null) continue;
    all[row.usuario] = {
      at: now,
      usuario: row.usuario,
      wisphubId: row.wisphubId,
      name: row.name,
      phone: row.phone,
    };
  }
  const kept = Object.values(all)
    .filter((entry) => now - entry.at <= CUSTOMERS_TTL_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, CUSTOMERS_MAX);
  write(CUSTOMERS, Object.fromEntries(kept.map((entry) => [entry.usuario, entry])));
}

/* Read ONLY when the provider did not answer (FR-014, FR-021): a name
   seen minutes ago is better than a blank row, and worse than a live
   one. Matching is the same contains promise the provider makes (FR-004). */
export function recallCustomers(search: string): SeenCustomer[] {
  const needle = normalizeSearch(search);
  const now = Date.now();
  return Object.values(read<Record<string, SeenCustomer>>(CUSTOMERS) ?? {})
    .filter((entry) => now - entry.at <= CUSTOMERS_TTL_MS)
    .filter(
      (entry) =>
        needle === "" ||
        foldText(entry.name ?? "").includes(needle) ||
        foldText(entry.usuario).includes(needle) ||
        (entry.phone ?? "").includes(needle),
    )
    .sort((a, b) => b.at - a.at);
}

/* ---- 3. The copied / sent mark (FR-022, US1) ---- */

export type Mark = "copied" | "sent";

export function readMarks(): Record<string, Mark> {
  return read<Record<string, Mark>>(MARKS) ?? {};
}

export function writeMark(key: string, mark: Mark): void {
  if (key === "") return;
  write(MARKS, { ...readMarks(), [key]: mark });
}

/* ---- 4. The last Links address (cobros-in-links FR-009, SC-005) ----

   The address carries the view and the search text, so the back button
   and a reload land where the operator was. A return through the MENU
   does not: its Links entry is a plain `/links`, and measured 2026-09-28
   it landed on the customer view with an empty box. SC-005 asks that
   every return — from another page included — comes back to the view and
   the text the operator left. So the page writes its address here and
   the menu's entry reads it (`Shell.tsx`).

   Per business: an operator who switches business in the same tab must
   not carry one business's search into another's list. Per session, like
   the other stores: promised to nobody else. */

export type LinksAddress = { q?: string; view?: "receivables" };
type StoredAddress = { businessId: string; q: string | null; view: "receivables" | null };

export function rememberLinksAddress(businessId: string, address: LinksAddress): void {
  const q = typeof address.q === "string" && address.q.trim() !== "" ? address.q : null;
  write(ADDRESS, { businessId, q, view: address.view === "receivables" ? "receivables" : null } satisfies StoredAddress);
}

/* Only what `linksSearch` itself would accept (router.tsx): a text that
   is not blank, and the one view name there is. Anything else — another
   business, a store written by an older version — is no address. */
export function lastLinksAddress(businessId: string | undefined): LinksAddress {
  const stored = read<Partial<StoredAddress>>(ADDRESS);
  if (!stored || businessId === undefined || stored.businessId !== businessId) return {};
  return {
    ...(typeof stored.q === "string" && stored.q.trim() !== "" ? { q: stored.q } : {}),
    ...(stored.view === "receivables" ? { view: "receivables" as const } : {}),
  };
}

/* Tests only: four module-level stores outlive a test's render, and a
   test starts from empty or it is not a test. */
export function resetSeenForTests(): void {
  for (const key of [RESULTS, CUSTOMERS, MARKS, ADDRESS]) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* nothing to clear */
    }
  }
}

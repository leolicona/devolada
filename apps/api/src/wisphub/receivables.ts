import {
  IntegrationError,
  type CapabilityName,
  type CustomerDebtAnswer,
  type IntegrationCapabilities,
  type OpenInvoice,
  type ReceivablesPage,
} from "../integrations/capabilities";
import {
  CUSTOMERS_BLOCK_MAX,
  CUSTOMERS_BLOCK_MIN,
  PENDING_INVOICES_PATH,
  pendingWindow,
  WispHubError,
  type PendingInvoice,
  type WispHubCustomer,
} from "./client";
import { debtFor, nothingOwedIsProven } from "./debt";
import { wisphubFor, type WispHubAddress } from "./factory";

/* The WispHub adapter's side of two core capabilities
   (constitution IX, cobros-in-links D18): `receivables`, a block of the
   business's open invoices, and `customerDebt`, what one customer owes.

   Everything here is WispHub's: the invoice list's path and window, the
   `inv:` cursor, the reading of a row, the two reads a debt takes and
   the measured billing-run rule that makes them two. The core asks for
   a page or a debt and gets the core's shapes back; it never sees a
   path, a cursor's insides or a `WispHubError`. */

/* What this adapter can do, as the session names it (D13) */
export const WISPHUB_CAPABILITY_NAMES = [
  "receivables",
  "customerDebt",
  /* payment-without-receipt D4 */
  "customersWithPhone",
] as const satisfies readonly CapabilityName[];

type AdapterEnv = { WISPHUB_BASE_URL?: string };

/* ---- The receivables cursor (D2) ---- */

/* Where the next block starts, as numbers only.

   The invoice list answers `next`, and measured 2026-09-27 (M1) that
   link pages by `offset` and `limit`, carrying every filter back. The
   cursor keeps those two numbers and the window fixed at the walk's
   first block — never the link itself. A cursor is text the browser
   hands back, and a path the server fetched with the business's key
   would let a client aim that key at any provider endpoint. The server
   rebuilds every path from the fixed filter and these values.

   The window rides in the cursor so that a walk crossing midnight keeps
   its window. A new window halfway through would skip or repeat a day of
   invoices between two blocks. */
type ReceivablesCursor = { desde: string; hasta: string; offset: number; limit: number };

/* The prefix this version writes. A cursor without it is not ours. */
const PREFIX = "inv:";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const toBase64Url = (raw: string) =>
  btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const fromBase64Url = (raw: string) => {
  const padded = raw.replaceAll("-", "+").replaceAll("_", "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
};

/* A real calendar day, by round trip: `Date.parse` alone accepts a day
   the month does not have ("2026-02-31" parses, as March 3 — checked
   2026-09-28 in the review of this feature). */
function isCalendarDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const at = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === day;
}

/* The widest window `pendingWindow` produces: 180 days back plus one ahead */
const WINDOW_DAYS = 181;

/* Same form as the customers door's cursor (`links-on-demand-search`
   D2): base64url, so it survives a query string without escaping. */
export function encodeReceivablesCursor(cursor: ReceivablesCursor): string {
  return toBase64Url(`${PREFIX}${cursor.desde}:${cursor.hasta}:${cursor.offset}:${cursor.limit}`);
}

/* null means unreadable, and reaches the core as "bad_cursor" (400).
   Every failure lands here: text that is not base64url, a prefix this
   version never wrote, a date that is not one, a window that runs
   backwards, and an offset or a limit that is not a number this adapter
   would have written. A provider path inside it has no place to go: no
   field takes text. */
export function decodeReceivablesCursor(raw: string): ReceivablesCursor | null {
  let plain: string;
  try {
    plain = fromBase64Url(raw);
  } catch {
    return null;
  }
  if (!plain.startsWith(PREFIX)) return null;
  const parts = plain.slice(PREFIX.length).split(":");
  if (parts.length !== 4) return null;
  const [desde, hasta, rawOffset, rawLimit] = parts;
  if (!isCalendarDay(desde) || !isCalendarDay(hasta) || desde > hasta) return null;
  /* No wider than the window this adapter writes (FR-004: 180 days back,
     one day ahead). A hand-built cursor cannot widen the walk. */
  if ((Date.parse(hasta) - Date.parse(desde)) / 86_400_000 > WINDOW_DAYS) return null;
  const offset = Number(rawOffset);
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  /* A block is one provider call of 10–50 rows (D4). A cursor asking
     for more is not one this adapter wrote. */
  if (!Number.isSafeInteger(limit) || limit < CUSTOMERS_BLOCK_MIN || limit > CUSTOMERS_BLOCK_MAX) return null;
  return { desde, hasta, offset, limit };
}

/* The path of one block, rebuilt from the fixed filter and the numbers */
function blockPath(cursor: ReceivablesCursor): string {
  return `${PENDING_INVOICES_PATH}&desde=${cursor.desde}&hasta=${cursor.hasta}&limit=${cursor.limit}&offset=${cursor.offset}`;
}

/* The next block's position, from the provider's own `next` (D2).
   Only `offset` and `limit` are taken, and the window stays the one
   this walk began with: `next` echoes it (measured 2026-09-27), and a
   provider that rewrote it must not move the walk's window. `undefined`
   means `next` could not be read. */
function followNext(next: string, current: ReceivablesCursor): ReceivablesCursor | undefined {
  let params: URLSearchParams;
  try {
    params = new URL(next, "https://provider.invalid").searchParams;
  } catch {
    return undefined;
  }
  const offset = Number(params.get("offset"));
  const limit = Number(params.get("limit") ?? current.limit);
  if (!params.has("offset") || !Number.isSafeInteger(offset) || offset <= current.offset) return undefined;
  if (!Number.isSafeInteger(limit) || limit < CUSTOMERS_BLOCK_MIN || limit > CUSTOMERS_BLOCK_MAX) return undefined;
  return { ...current, offset, limit };
}

/* The core's words for an invoice row (D5, D18) */
function toOpenInvoice(f: PendingInvoice): OpenInvoice {
  return {
    invoiceId: f.invoiceId,
    usuario: f.usuario,
    customerName: f.customerName,
    totalCents: f.totalCents,
    invoiceDate: f.invoiceDate,
    dueDate: f.dueDate,
    periodCents: f.periodCents ?? null,
    carriedCents: f.carriedCents ?? null,
    period: f.period ?? null,
  };
}

/* WispHub's two failures, in the core's words (D7, D18). A refused key
   is setup; everything else the adapter raises is weather. */
function translate(e: WispHubError): IntegrationError {
  return new IntegrationError(
    e.code === "WISPHUB_AUTH_FAILED" ? "INTEGRATION_AUTH_FAILED" : "INTEGRATION_UNAVAILABLE",
    e.message,
  );
}

/* A read whose failures leave as the core's two words */
async function translated<T>(read: () => Promise<T>, what: string): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof WispHubError) throw translate(e);
    throw new IntegrationError("INTEGRATION_UNAVAILABLE", `${what}: ${String(e)}`);
  }
}

/* One block of open invoices, live (D3): one `pendingInvoicesPage`
   call on a fresh client, so the block has its own operation budget
   (provider-latency D1). It never reads `readPendingInvoices`, the
   sweep's snapshot or the 30-second display cache — the view reads the
   block it shows, when it shows it (SC-006). */
async function receivablesPage(
  integration: WispHubAddress,
  env: AdapterEnv,
  rawCursor: string | null,
  limit: number,
): Promise<ReceivablesPage | "bad_cursor"> {
  let cursor: ReceivablesCursor;
  if (rawCursor === null) {
    /* FR-004: every block carries an explicit window — the first one
       fixes it for the whole walk */
    const size = Math.min(CUSTOMERS_BLOCK_MAX, Math.max(CUSTOMERS_BLOCK_MIN, Math.trunc(limit)));
    cursor = { ...pendingWindow(new Date()), offset: 0, limit: size };
  } else {
    const decoded = decodeReceivablesCursor(rawCursor);
    if (decoded === null) return "bad_cursor";
    cursor = decoded;
  }

  let page;
  try {
    page = await wisphubFor(integration, env).pendingInvoicesPage(blockPath(cursor));
  } catch (e) {
    if (e instanceof WispHubError) throw translate(e);
    /* A body that parsed but is not the list's shape is the provider's
       failure, not ours: weather, never an empty list (D7) */
    throw new IntegrationError("INTEGRATION_UNAVAILABLE", `invoice list: unreadable body: ${String(e)}`);
  }

  let next: ReceivablesCursor | null = null;
  if (page.next !== null) {
    next = followNext(page.next, cursor) ?? null;
    if (next === null) {
      /* The rows are true; only the way onward is lost. The count line
         still says how many there are, so the gap is visible rather
         than silent. */
      console.error("wisphub invoice list: unreadable next page:", page.next);
    }
  }
  return {
    invoices: page.invoices.map(toOpenInvoice),
    cursor: next === null ? null : encodeReceivablesCursor(next),
    total: page.total,
  };
}

/* What one customer owes (D9, D10), in one operation budget.

   Two reads, in order, on ONE client:
     1. the customer record, by exact `usuario=` — the fresh `saldo`, the
        billing label and the `id_servicio`;
     2. that customer's open invoices, from `/clientes/{id}/saldo/`,
        using the id the record just gave: a search row's id is a cache
        that may be recycled (`direct-payment` D5).

   Why both, and why together: the zone's billing run moves the carried
   balance into a new invoice and zeroes the record at the same instant
   (measured 2026-09-23, demo tenant). A balance read at search time and
   invoices read seconds later, across that instant, show 1,097.00 for
   798.00 owed. Half a second apart, inside one operation, they cannot
   straddle it. Neither half alone is the debt (FR-015).

   They compose with the existing rule — `debtFor` over a live, complete
   list and `nothingOwedIsProven` for a zero — and no new arithmetic. */
async function customerDebt(
  integration: WispHubAddress,
  env: AdapterEnv,
  usuario: string,
): Promise<CustomerDebtAnswer> {
  const wisphub = wisphubFor(integration, env);
  let record: WispHubCustomer;
  let invoices: PendingInvoice[];
  try {
    const found = await wisphub.getCustomer(usuario);
    /* Gone from WispHub: nothing can be confirmed about them */
    if (!found) return { state: "unconfirmed" };
    record = found;
    invoices = await wisphub.openInvoicesOf(record.wisphubId, record.usuario);
  } catch (e) {
    /* A refused key is setup, and the whole page says so (D11) */
    if (e instanceof WispHubError && e.code === "WISPHUB_AUTH_FAILED") throw translate(e);
    /* A stall, an outage, or an answer that cannot be read — a body of the
       wrong shape, a balance the money parser refuses — is weather for
       this ONE row: it could not be confirmed, and the others keep
       working (FR-018). Never a 5xx on this door (contract). Only the two
       reads are inside this guard, so a bug in the composition below
       still surfaces as one. Logged, never the key (007 FR-013). */
    const code = e instanceof WispHubError ? e.code : "UNREADABLE";
    console.error("wisphub debt read failed:", code, e instanceof Error ? e.message : String(e));
    return { state: "unconfirmed" };
  }

  const pending = { invoices, complete: true, source: "live" as const };
  const debt = debtFor(record, pending);
  const answer = {
    totalCents: debt.totalCents,
    invoiceCents: debt.invoiceCents,
    carriedBalanceCents: debt.carriedBalanceCents,
    /* Oldest first, the order the payer's page lists them (cobros-live D8) */
    invoices: [...invoices]
      .sort((a, b) => (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "") || a.invoiceId - b.invoiceId)
      .map((f) => ({
        invoiceId: f.invoiceId,
        invoiceDate: f.invoiceDate,
        dueDate: f.dueDate,
        totalCents: f.totalCents,
      })),
  };
  if (debt.totalCents > 0) return { state: "owes", ...answer };
  if (nothingOwedIsProven(record, pending)) return { state: "none", ...answer };
  return { state: "unconfirmed" };
}

/* Both capabilities, for one business's integration. Each call builds a
   fresh client, so each block and each debt has its own budget. */
export function wisphubCapabilities(integration: WispHubAddress, env: AdapterEnv): IntegrationCapabilities {
  return {
    receivables: {
      page: (cursor, limit) => receivablesPage(integration, env, cursor, limit),
    },
    customerDebt: {
      of: (usuario) => customerDebt(integration, env, usuario),
    },
    /* payment-without-receipt D4: the filter's words and its paging are
       the client's; here WispHub's failures become the core's two */
    customersWithPhone: {
      of: (phone) => translated(() => wisphubFor(integration, env).customersWithPhone(phone), "customers by phone"),
      phoneOf: (usuario) =>
        translated(async () => (await wisphubFor(integration, env).getCustomer(usuario))?.phone ?? null, "customer phone"),
    },
  };
}

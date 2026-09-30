import { amountToCents, decimalToCents, providerCents } from "../money";
import { nationalPhone } from "../phone";

/* WispHub adapter. Contract verified in .design/devolada/WISPHUB_SPIKE.md.
   All WispHub traffic goes through this file (ARCHITECTURE.md rule). */

/* Exported so the catalogue's default entry can be asserted equal to it
   (provider-address-per-isp D5): the factory falls back here, and two
   copies of one host that drift apart is a whole tenant calling the
   wrong server. */
export const DEFAULT_BASE_URL = "https://api.wisphub.net/api";

/* Deadlines (provider-latency spec D1). Measured 2026-08-18 against the
   live demo tenant: healthy calls answer in 0.4–0.6s, and about one call
   in eight stalls and never recovers (observed at 8s, 30s and 60s
   cutoffs). So the per-call ceiling is ten times the healthy worst case
   — it cuts off nothing real — and waiting past it buys nothing.
   The budget is the second ceiling: one operation makes several calls,
   and five separate 5s ceilings is a 25s wait on the screen the user is
   actually looking at. Per instance, and every instance is built per
   operation — including inside both sweep loops, which construct one per
   charge and per payment, so later rows keep their own budget. */
export const CALL_TIMEOUT_MS = 5_000;
export const OPERATION_BUDGET_MS = 12_000;

export type WispHubLimits = { callMs: number; operationMs: number };

/* What this integration does with money on its own (payments-and-classes
   D2). WispHub keeps a running account (`saldo`), so an overpayment
   registered against an invoice becomes the customer's credit by itself
   (partial-payment D10, measured) — the adapter states the fact once and
   the effective surplus treatment derives from it, never re-decided per
   screen. */
export const WISPHUB_CAPABILITIES = { absorbsOverpayment: true } as const;

export class WispHubError extends Error {
  constructor(
    public code: "WISPHUB_UNAVAILABLE" | "WISPHUB_AUTH_FAILED",
    detail?: string,
    /* The HTTP status when there was one: 422 on registrar-pago means
       "already paid", which the reconnection treats as the goal state */
    public status?: number,
  ) {
    super(detail ?? code);
  }
}

export type WispHubCustomer = {
  wisphubId: number;
  usuario: string;
  name: string;
  zone: string | null;
  /* For the receipt's wa.me link (receipt spec D3). Often empty. */
  phone: string | null;
  serviceStatus: "active" | "suspended" | "unknown";
  billingStatus: "paid" | "due" | "unknown";
  /* `precio_plan`: the plan's list price, NOT what this customer owes
     (debt-truth D8). It was the truncation fallback until bug:
     pending-invoice-cap removed that fallback from every money path;
     nothing decides an amount by it now. Still mapped: it is the one
     number a screen can show for a customer with no invoice yet. */
  planPriceCents: number;
  /* WispHub's running balance for the customer (`saldo`, debt-truth
     D7): positive is carried debt, negative is a credit. It is where a
     short payment's remainder lives, and the pending-invoice list can
     be empty while this is not — until the zone's next billing run,
     which folds it into the new invoice and resets it to 0 (measured
     2026-09-23, demo tenant). It never includes open invoices. */
  carriedBalanceCents: number;
};

/* Spike finding: estado is a free string owned by WispHub.
   Unknown values must never break the UI. */
function mapStatus(estado: unknown): WispHubCustomer["serviceStatus"] {
  if (estado === "Activo") return "active";
  if (estado === "Suspendido" || estado === "Cortado") return "suspended";
  return "unknown";
}

/* D3 (charge-confirm spec): "Pagadas" means nothing is due. */
function mapBillingStatus(estadoFacturas: unknown): WispHubCustomer["billingStatus"] {
  if (estadoFacturas === "Pagadas") return "paid";
  if (estadoFacturas === "Pendiente de Pago" || estadoFacturas === "Vencidas") return "due";
  return "unknown";
}

/* D2: the mapping is an allow-list — extra WispHub fields never leak. */
function mapCustomer(c: WispHubListItem): WispHubCustomer {
  return {
    wisphubId: c.id_servicio,
    usuario: c.usuario ?? "",
    name: c.nombre ?? "",
    zone: c.zona?.nombre ?? null,
    phone: c.telefono?.trim() ? c.telefono.trim() : null,
    serviceStatus: mapStatus(c.estado),
    billingStatus: mapBillingStatus(c.estado_facturas),
    planPriceCents: c.precio_plan ? decimalToCents(c.precio_plan) : 0,
    /* D9: already in this response — reading it costs no extra call */
    carriedBalanceCents: c.saldo ? decimalToCents(c.saldo) : 0,
  };
}

/* links-on-demand-search D12: `queryParamFor` is REMOVED. It chose a
   filter from the shape of the text — digits meant `telefono`, an `@`
   meant `usuario`, anything else meant `nombre` — which sent a usuario
   of digits to the phone filter and answered "not found" for customers
   who exist (`bug: customer-lookup-misses`). A search asks all four
   `__contains` filters at once now (D4), and `getCustomer` asks
   `usuario=` outright. */

export type PendingInvoice = {
  invoiceId: number;
  usuario: string;
  /* From the row's `cliente` serializer; null when WispHub omits it */
  customerName: string | null;
  totalCents: number;
  /* YYYY-MM-DD, or null when the row lacks the field (cobros-live) */
  invoiceDate: string | null;
  dueDate: string | null;
  /* cobros-in-links D5: three details the Por cobrar row shows, all in
     the row already fetched — no extra call. OPTIONAL on purpose: this
     type is shared with the money paths, and `debtOf`, the sweep and
     the payer's page read `totalCents` alone. Absent or unreadable is
     null; a row is never dropped for a detail. */
  /* `sub_total`: what this period bills */
  periodCents?: number | null;
  /* The invoice's own `saldo`: the part carried from before, measured
     299.00 inside a 798.00 invoice (2026-09-23, demo) */
  carriedCents?: number | null;
  /* The first line item whose text names the period */
  period?: string | null;
};

/* cobros-in-links D5: how a line item names its period, measured
   2026-09-27 (M3) as the second line of `descripcion`:
   "Plan de Internet: Plan 2M/1M 2.00\r\nPeriodo del 1/Oct./2026 al 31/Oct./2026\r\n".
   Each date is one run of non-space characters, so the match stops at
   the `\r\n` that ends the line. */
const PERIOD_PATTERN = /Per[ií]odo del\s+\S+\s+al\s+\S+/i;

function periodOf(articulos: unknown): string | null {
  if (!Array.isArray(articulos)) return null;
  for (const item of articulos) {
    const text = (item as { descripcion?: unknown } | null)?.descripcion;
    if (typeof text !== "string") continue;
    const match = PERIOD_PATTERN.exec(text);
    if (match) return match[0].trim();
  }
  return null;
}

/* `source` says how old the list can be (bug: pending-invoice-cap): a
   `live` one was read from WispHub inside this operation, a `snapshot`
   one by the sweep, minutes ago — and the readers of a snapshot let the
   customer record, which is always live, outrank it (`debt.ts`). */
export type PendingInvoices = {
  invoices: PendingInvoice[];
  complete: boolean;
  source: "live" | "snapshot";
};

/* How deep a live read goes before it gives up and says so. Five pages
   is what a request can pay (provider-latency D1); a tenant that needs
   more is read by the sweep (`snapshot.ts`), which uses this
   number to tell the two apart. */
export const PENDING_LIVE_PAGES = 5;

/* The open-invoice filter every read of the list asks: `estado=1` is
   Pendiente, windowed by issue date (debt-truth D1–D3). */
export const PENDING_INVOICES_PATH = "/facturas/?estado=1&tipo_fecha=fecha_emision";

/* The window every read of the list carries (debt-truth D3): 180 days
   back by issue date — the suspended customer whose unpaid invoice is
   months old — and one day ahead, because WispHub stamps in the
   tenant's timezone, not UTC. The provider's own default is the current
   month, which silently drops older arrears (cobros-in-links FR-004), so
   no read relies on it. */
export function pendingWindow(now: Date): { desde: string; hasta: string } {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return {
    desde: day(new Date(now.getTime() - 180 * 24 * 3600 * 1000)),
    hasta: day(new Date(now.getTime() + 24 * 3600 * 1000)),
  };
}

/* `total` is the envelope's own `count` for the filter, read
   defensively: null when absent or not a count (cobros-in-links D5,
   FR-007). Only the Por cobrar view reads it. */
export type PendingPage = { invoices: PendingInvoice[]; next: string | null; total: number | null };
export type CustomersPage = { customers: WispHubCustomer[]; next: string | null };

/* links-on-demand-search D4: the four filters a search is put to, in
   the order they are asked. `__contains` is case- and accent-insensitive
   (provider documentation read 2026-09-21), and no filter takes several
   identities at once — which is why there are four calls and not one. */
export const CUSTOMER_SEARCH_FIELDS = ["nombre", "apellido", "usuario", "telefono"] as const;
export type CustomerSearchField = (typeof CUSTOMER_SEARCH_FIELDS)[number];

export type CustomerSearch = {
  /* Merged and deduped by usuario. Returned WHOLE, not cut to the
     caller's limit: the four filters advance together, so a row fetched
     and dropped would be a row the next block skips (D5, amended
     2026-09-23). Up to four blocks' worth, usually far less — the
     filters overlap heavily. */
  customers: WispHubCustomer[];
  /* Each ASKED filter's own `count`, for the floor the page reports
     (D5). Partial because a narrowed walk asks fewer than four. */
  counts: Partial<Record<CustomerSearchField, number>>;
  /* Which filters still have rows past this block. Empty means the
     search is walked out and the page can stop asking. */
  more: CustomerSearchField[];
};

/* links-on-demand-search D3: the band a browse block is clamped to */
export const CUSTOMERS_BLOCK_MIN = 10;
export const CUSTOMERS_BLOCK_MAX = 50;

type WispHubListItem = {
  id_servicio: number;
  usuario: string | null;
  nombre: string | null;
  /* payment-without-receipt D4: read by `customersWithPhone` alone, which
     groups a phone's customers by their whole name; the mapped customer
     keeps `nombre` as its name, as it always did */
  apellido?: string | null;
  telefono: string | null;
  estado: string | null;
  estado_facturas: string | null;
  precio_plan: string | null;
  saldo: string | null;
  zona: { nombre?: string } | null;
};

export class WispHub {
  private readonly limits: WispHubLimits;
  /* D1: spent when this instance's operation runs out of time. Set at
     construction, so the clock starts when the operation does. */
  private readonly deadlineAt: number;

  constructor(
    private apiKey: string,
    /* Readable on purpose (provider-address-per-isp T046): the provider
       caches key their entries by the address the answer came from, and
       asking the instance is the only way that cannot drift from where
       the call actually went. It is a host, never a credential — the key
       beside it stays private. Nothing else should read it: the panel is
       never shown an endpoint (FR-005) and every caller already gets its
       client from `wisphubFor`. */
    readonly baseUrl: string = DEFAULT_BASE_URL,
    limits: Partial<WispHubLimits> = {},
  ) {
    this.limits = {
      callMs: limits.callMs ?? CALL_TIMEOUT_MS,
      operationMs: limits.operationMs ?? OPERATION_BUDGET_MS,
    };
    this.deadlineAt = Date.now() + this.limits.operationMs;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    /* D1: a spent budget fails the call without opening a connection —
       there is no point starting what there is no time to finish. */
    const remaining = this.deadlineAt - Date.now();
    if (remaining <= 0) {
      throw new WispHubError("WISPHUB_UNAVAILABLE", "operation budget spent");
    }
    const timeoutMs = Math.min(this.limits.callMs, remaining);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Api-Key ${this.apiKey}`,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch (e) {
      /* D6: a deadline is an outage, not a new state. The distinction
         lives in the log line; the wire keeps one code. */
      const name = (e as { name?: string })?.name;
      const detail =
        name === "TimeoutError" || name === "AbortError"
          ? `timed out after ${timeoutMs}ms`
          : `network error: ${String(e)}`;
      throw new WispHubError("WISPHUB_UNAVAILABLE", detail);
    }
    /* 401/403 means WispHub rejected the key: a setup problem, not an outage.
       Note: WispHub sends the same generic 403 for "no permission" (spike). */
    if (res.status === 401 || res.status === 403) {
      throw new WispHubError("WISPHUB_AUTH_FAILED", `status ${res.status}`, res.status);
    }
    if (!res.ok) throw new WispHubError("WISPHUB_UNAVAILABLE", `status ${res.status}`, res.status);
    /* The deadline covers the body too: a provider that answers headers
       and then stalls mid-stream aborts here, and must surface as the
       same outage rather than an unmapped throw. */
    try {
      return (await res.json()) as T;
    } catch (e) {
      throw new WispHubError("WISPHUB_UNAVAILABLE", `body read failed: ${String(e)}`);
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  /* One page of `/clientes/`, mapped: the rows, the provider's own
     `count` for that filter, and the path of the next page. Every read
     of the customer list goes through here — the allow-list mapping (D2)
     and the "no usuario, no link" rule (US-D07 review) are written once. */
  private async listPage(path: string): Promise<CustomersPage & { count: number }> {
    const data: { count?: number; next: string | null; results: WispHubListItem[] } =
      await this.get(path);
    const customers: WispHubCustomer[] = [];
    for (const c of data.results) {
      if (c.usuario) customers.push(mapCustomer(c));
    }
    /* WispHub's `next` is absolute; keep only the API path */
    const next = data.next ? data.next.slice(data.next.indexOf("/clientes/")) : null;
    return { customers, next, count: data.count ?? customers.length };
  }

  /* links-on-demand-search D4: a search asks FOUR filters at once and
     merges what comes back. No parameter is chosen from the shape of
     the text — that guess is `bug: customer-lookup-misses`, where a
     usuario of digits was sent to the `telefono` filter and an existing
     customer came back as "not found".

     All four run for every search, including one that is plainly digits
     or plainly letters: the saved call is not worth the bug. One round
     trip for the operator, four requests on the wire, each capped at
     `limit`, merged and deduped by usuario.

     `counts` is each filter's own `count`. The union's true size cannot
     be known without fetching all four whole, so the caller reports the
     largest as a FLOOR and says so in words (D5). */
  async searchCustomers(
    q: string,
    limit = 10,
    /* Where this block starts in every filter, and which filters are
       still worth asking. `fields` is the walk narrowing itself: the
       first block asks all four, later blocks only the ones that had
       more, so a deep search costs ONE call a block rather than four
       (D5, amended 2026-09-23). */
    opts: { offset?: number; fields?: readonly CustomerSearchField[] } = {},
  ): Promise<CustomerSearch> {
    const text = encodeURIComponent(q);
    const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
    const fields = opts.fields?.length ? opts.fields : CUSTOMER_SEARCH_FIELDS;
    const pages = await Promise.all(
      fields.map((field) =>
        this.listPage(`/clientes/?${field}__contains=${text}&limit=${limit}&offset=${offset}`),
      ),
    );
    /* Dedupe by identity, first filter to answer wins the row */
    const merged = new Map<string, WispHubCustomer>();
    for (const page of pages) {
      for (const customer of page.customers) {
        if (!merged.has(customer.usuario)) merged.set(customer.usuario, customer);
      }
    }
    const counts: Partial<Record<CustomerSearchField, number>> = {};
    const more: CustomerSearchField[] = [];
    fields.forEach((field, i) => {
      counts[field] = pages[i].count;
      /* The provider's own `next` is the honest end-of-filter signal: a
         count can drift while the operator scrolls, a missing `next`
         cannot. */
      if (pages[i].next !== null) more.push(field);
    });
    return { customers: [...merged.values()], counts, more };
  }

  /* links-on-demand-search D3: one block of the customer list, where
     the browse is. `limit` is what fills the caller's viewport and
     `offset` is where the last block stopped — the provider pages by
     exactly these two and offers no ordering parameter, which is why
     the order is never promised (D6).

     The clamp lives here as well as in the contract: the floor keeps a
     tall screen from paying four round trips to fill itself, the
     ceiling keeps one block at one provider call. `total` is the
     provider's own count of the base. */
  async customersBlock(limit: number, offset: number): Promise<{ customers: WispHubCustomer[]; total: number }> {
    const size = Math.min(CUSTOMERS_BLOCK_MAX, Math.max(CUSTOMERS_BLOCK_MIN, Math.trunc(limit)));
    const start = Math.max(0, Math.trunc(offset));
    const { customers, count } = await this.listPage(`/clientes/?limit=${size}&offset=${start}`);
    return { customers, total: count };
  }

  /* links-on-demand-search D12: `listCustomersFull` and `customersPath`
     are REMOVED. Reading the whole customer base — ten pages of a
     hundred, and a link written for every row — is what this feature
     exists to end (FR-001, FR-008). `customersPage` STAYS: the walk
     unit is what `snapshot.ts` resumes from, and the `pending` pass
     still uses the same machinery. */

  /* One page of the customer list and the path of the next — the unit
     the sweep stores and resumes from (bug: links-roster-cap). A row
     without `usuario` is nobody a link can be made for (US-D07 review). */
  async customersPage(path: string): Promise<CustomersPage> {
    const { customers, next } = await this.listPage(path);
    return { customers, next };
  }

  /* payment-without-receipt D4 — every customer whose phone is this one.
     WispHub keeps `telefono` as the business typed it, so the filter asks
     for the last seven digits (`__contains`, which any spelling of the
     number holds) and pages to the end at 50, and each result is kept only
     when its own `telefono` reads as the same national phone — a
     `…2345678` in another area code is someone else. The name comes back
     in WispHub's two halves; the core groups by it and stores neither. */
  async customersWithPhone(phone: string): Promise<{ usuario: string; firstName: string; lastName: string }[]> {
    const tail = encodeURIComponent(phone.slice(-7));
    const out: { usuario: string; firstName: string; lastName: string }[] = [];
    for (let offset = 0, page = 0; page < 100; page++) {
      const data: { next: string | null; results: WispHubListItem[] } = await this.get(
        `/clientes/?telefono__contains=${tail}&limit=50&offset=${offset}`,
      );
      for (const c of data.results) {
        if (c.usuario && nationalPhone(c.telefono) === phone) {
          out.push({ usuario: c.usuario, firstName: c.nombre ?? "", lastName: c.apellido ?? "" });
        }
      }
      if (!data.next || data.results.length === 0) break;
      offset += data.results.length;
    }
    return out;
  }

  /* D1 (charge-confirm spec): one customer loads through the list filter.
     The detail endpoint returns nombre/usuario as null (spike finding).

     links-on-demand-search D4: identity is NOT a search. The exact
     `usuario=` filter is what the provider documents for it, and asking
     it directly is what closes the first half of
     `bug: customer-lookup-misses` — the parameter used to be guessed
     from the text's shape, so a usuario of digits went to `telefono` and
     a plain-word usuario went to `nombre`, and an existing customer came
     back null. A null customer is what files a confirmed payment as
     "owes nothing". */
  async getCustomer(usuario: string): Promise<WispHubCustomer | null> {
    const data = await this.get<{ results: WispHubListItem[] }>(
      `/clientes/?usuario=${encodeURIComponent(usuario)}&limit=10`,
    );
    return data.results.map(mapCustomer).find((c) => c.usuario === usuario) ?? null;
  }

  /* D6 (charge-record spec): find the cash payment method by name. */
  async getCashPaymentMethodId(): Promise<number> {
    const data = await this.get<{ results: { id: number; nombre: string }[] }>(
      "/formas-de-pago/",
    );
    if (data.results.length === 0) {
      throw new WispHubError("WISPHUB_UNAVAILABLE", "no payment methods");
    }
    const cash = data.results.find((m) => /efect|cash/i.test(m.nombre));
    return (cash ?? data.results[0]).id;
  }

  /* Health probes for the connection test (provider-address-per-isp
     D7), and nothing else. One call each, `limit=1`, no paging: the
     question is "does this key reach this endpoint on this
     installation", not "what is in it". The business methods below
     answer a different question and page up to five times, which is not
     what an ISP waiting on a Probar conexión button should pay for.

     They deliberately do NOT interpret an empty list as a failure: a
     tenant with no invoice yet has a perfectly good permission. Only
     the provider's own refusal means anything here. */
  async probeInvoices(): Promise<void> {
    await this.get<{ results: unknown[] }>("/facturas/?limit=1");
  }

  async probePaymentMethods(): Promise<void> {
    await this.get<{ results: unknown[] }>("/formas-de-pago/?limit=1");
  }

  /* The pending invoices of the whole tenant, for an explicit window
     (debt-truth spec D1–D3; grew out of TD-009's find).

     The list endpoint takes `estado` and a date range but **no customer
     filter** — re-verified against the live API 2026-08-16 — so the
     match happens in the caller. `estado=1` is Pendiente. The window is
     180 days by issue date: the product's core case is the suspended
     customer whose unpaid invoice can be months old (D3). Up to
     `PENDING_LIVE_PAGES` of 100; `complete` says whether the answer is
     the whole truth or a truncated one.

     debt-truth D4, as amended by bug: pending-invoice-cap — a truncated
     answer used to fall back to WispHub's label and the plan's price.
     It no longer does: a tenant this read cannot finish is read by the
     sweep instead, and until that list exists the callers answer
     "cannot confirm", never "owes nothing" and never a guessed amount. */
  async pendingInvoices(now: Date): Promise<PendingInvoices> {
    const invoices: PendingInvoice[] = [];
    let path: string | null = this.pendingInvoicesPath(now);
    for (let page = 0; page < PENDING_LIVE_PAGES && path; page++) {
      const data: PendingPage = await this.pendingInvoicesPage(path);
      invoices.push(...data.invoices);
      path = data.next;
    }
    return { invoices, complete: path === null, source: "live" };
  }

  /* The first page of the window above — where a pass begins, whether
     the live read's or the sweep's. */
  pendingInvoicesPath(now: Date): string {
    const { desde, hasta } = pendingWindow(now);
    return `${PENDING_INVOICES_PATH}&desde=${desde}&hasta=${hasta}&limit=100`;
  }

  /* One page of the walk, and the path of the next — the unit the sweep
     stores and resumes from (bug: pending-invoice-cap). */
  async pendingInvoicesPage(path: string): Promise<PendingPage> {
    const data: {
      next: string | null;
      /* cobros-in-links D5: present on this list (measured 2026-09-27,
         M1) and still read as if it might not be */
      count?: unknown;
      results: {
        id_factura: number;
        cliente: { usuario: string | null; nombre?: string | null };
        /* D8: the amount this customer actually owes for the period —
           prorations, discounts and any reconnection charge included.
           It rides in the same row we already fetch (D9). */
        total: number | null;
        /* The dates the list filters by (integrations/wisphub.md,
           2026-09-01). Optional on purpose: a row without them still
           is a debt, and the Cobros section degrades to no date. */
        fecha_emision?: string | null;
        fecha_vencimiento?: string | null;
        /* cobros-in-links D5: JSON numbers on this list (measured
           2026-09-27, M3), converted through the two-shape helper all
           the same — the customer record sends the same word as a
           string */
        sub_total?: unknown;
        saldo?: unknown;
        articulos?: unknown;
      }[];
    } = await this.get(path);
    const invoices: PendingInvoice[] = [];
    for (const f of data.results) {
      if (f.cliente?.usuario) {
        /* WispHub may stamp a datetime; the day is all Cobros needs */
        const day = (v: unknown) => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);
        invoices.push({
          invoiceId: f.id_factura,
          usuario: f.cliente.usuario,
          customerName: f.cliente.nombre ?? null,
          totalCents: f.total == null ? 0 : amountToCents(f.total),
          invoiceDate: day(f.fecha_emision),
          dueDate: day(f.fecha_vencimiento),
          periodCents: providerCents(f.sub_total),
          carriedCents: providerCents(f.saldo),
          period: periodOf(f.articulos),
        });
      }
    }
    /* WispHub's `next` is absolute; keep only the API path */
    const next = data.next ? data.next.slice(data.next.indexOf("/facturas/")) : null;
    const total =
      typeof data.count === "number" && Number.isSafeInteger(data.count) && data.count >= 0 ? data.count : null;
    return { invoices, next, total };
  }

  /* The open invoices of ONE customer, from WispHub's one-call balance
     door (cobros-in-links D10). It has no date window, so an invoice
     older than the list's 180 days counts (FR-017).

     Only `facturas[]` is read. The door's own `saldo` is deliberately
     ignored: it counts open invoices only, and measured 2026-09-23 on
     the demo it answered 0 while the customer carried 299.00 (FR-015).
     `url_pago` is ignored too — it came back without a host
     (`http:///saldo/…`). The debt is composed by the caller, from this
     list AND the customer record, read together (D9).

     Measured: the demo, 2026-09-23 (0 with no open invoice, then 798.00
     with the invoice listed once the billing run issued it) and
     2026-09-27 (M2 case (a): the same invoice ids as `/facturas/`).
     Cases (b), two open invoices, and (c), a short-payer, are still to
     be measured on the pilot (research, "Measurements recorded").

     The door also answers PUT, PATCH and DELETE (its `allow` header,
     measured 2026-09-27). This adapter only ever sends GET to it.

     `usuario` comes from the caller — the record it just read — so the
     rows join the debt rule by the same identity as every other list.
     An answer it cannot read throws, and the caller says "could not
     confirm", never zero. */
  async openInvoicesOf(idServicio: number, usuario: string): Promise<PendingInvoice[]> {
    const data = await this.get<{ facturas?: unknown }>(`/clientes/${idServicio}/saldo/`);
    if (!Array.isArray(data?.facturas)) {
      throw new WispHubError("WISPHUB_UNAVAILABLE", "balance door: unreadable body");
    }
    const day = (v: unknown) => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);
    return data.facturas.map((raw) => {
      if (!raw || typeof raw !== "object") {
        throw new WispHubError("WISPHUB_UNAVAILABLE", "balance door: unreadable invoice");
      }
      const f = raw as { id?: unknown; fecha_emision?: unknown; fecha_vencimiento?: unknown; total?: unknown };
      const totalCents = providerCents(f.total);
      /* A debt with an invoice nobody can read cannot be summed */
      if (typeof f.id !== "number" || !Number.isSafeInteger(f.id) || totalCents === null) {
        throw new WispHubError("WISPHUB_UNAVAILABLE", "balance door: unreadable invoice");
      }
      return {
        invoiceId: f.id,
        usuario,
        customerName: null,
        totalCents,
        invoiceDate: day(f.fecha_emision),
        dueDate: day(f.fecha_vencimiento),
      };
    });
  }

  /* Whether one invoice can still carry a payment — asked fresh, right
     before money is registered against an id that came from the sweep's
     snapshot (bug: pending-invoice-cap). A snapshot is minutes old, and
     an invoice paid in the panel meanwhile would answer `registrar-pago`
     with the 422 that reconnection D8 reads as "already landed" — and
     the SPEI payment would go unregistered. The detail route's `estado`
     shape is not documented: only a clear "paid" or "cancelled" — or a
     404 — closes the door; anything unreadable keeps today's behaviour. */
  async invoiceState(invoiceId: number): Promise<"pending" | "closed" | "unknown"> {
    let data: { estado?: unknown };
    try {
      data = await this.get(`/facturas/${invoiceId}/`);
    } catch (e) {
      if (e instanceof WispHubError && e.status === 404) return "closed";
      /* A route WispHub does not serve (405) cannot answer; an outage or
         a rejected key must surface as itself */
      if (e instanceof WispHubError && e.status !== undefined && e.status < 500 && e.code !== "WISPHUB_AUTH_FAILED") {
        return "unknown";
      }
      throw e;
    }
    const estado = data.estado;
    if (estado === 1 || estado === "1" || (typeof estado === "string" && /pendiente/i.test(estado))) {
      return "pending";
    }
    if (estado === 2 || estado === 3 || (typeof estado === "string" && /pagad|cancel/i.test(estado))) {
      return "closed";
    }
    return "unknown";
  }

  /* TD-009: the pending invoice a customer already has, if any.
     Oldest first: pay the debt the customer has been carrying. */
  async findPendingInvoiceId(usuario: string, now: Date): Promise<number | null> {
    const { invoices } = await this.pendingInvoices(now);
    const mine = invoices.filter((f) => f.usuario === usuario);
    return mine.length ? Math.min(...mine.map((f) => f.invoiceId)) : null;
  }

  /* Creates a pending invoice. WispHub answers with a message string,
     not an id (spike finding, TD-008): we parse "la factura N".

     `amountCents` is **new** debt only. An invoice sized to a balance the
     customer already carries raises the running account by that amount, so
     their payment would leave them owing exactly what they owed before —
     measured (debt-truth D15). The zero-total case is the vehicle that
     rule needs: it adds nothing and still gives `registrar-pago` an id. */
  async createInvoice(
    usuario: string,
    amountCents: number,
    date: string,
    descripcion = "Mensualidad de internet",
  ): Promise<number> {
    const amount = amountCents / 100; /* boundary conversion, outbound only */
    const data = await this.request<{ messages?: string }>("/facturas/", {
      method: "POST",
      body: JSON.stringify({
        cliente: usuario,
        tipo_factura: 1,
        articulos: [{ descripcion, precio: amount, cantidad: 1 }],
        fecha_emision: date,
        fecha_vencimiento: date,
        fecha_pago: date,
        estado: 1,
        sub_total: amount,
        total: amount,
      }),
    });
    const match = /factura (\d+)/.exec(data.messages ?? "");
    if (!match) throw new WispHubError("WISPHUB_UNAVAILABLE", "invoice id not found in message");
    return Number.parseInt(match[1], 10);
  }

  /* provisional-release D3 (US-D15), measured live 2026-08-27: the
     payment promise is WispHub's own "keep the service while the payment
     arrives" primitive. With `accion: 1` it acts on the router in the
     same second — the Moroso entry of a physically suspended customer
     was removed and `estado` went Activo the moment the 201 landed. It
     refuses a paid invoice with a 400, normalises `fecha_limite` to
     "YYYY-MM-DD 00:00", auto-deletes when the payment is registered, and
     its API is create-only (GET answers 405 — the list and the delete
     live in the panel). `deadline` is a YYYY-MM-DD date. */
  async createPaymentPromise(invoiceId: number, deadline: string): Promise<void> {
    await this.request("/promesa-pago/", {
      method: "POST",
      body: JSON.stringify({ id_factura: invoiceId, fecha_limite: deadline, accion: 1 }),
    });
  }

  /* The opt-in switch for payment-triggered reactivation (spike finding;
     reconnection-queue D9). Defaults to false on every customer, so a
     suspended customer's payment would reactivate nothing without this.
     PATCH persistence verified against the live API 2026-08-16. */
  async ensureAutoActivate(idServicio: string): Promise<void> {
    await this.request(`/clientes/${idServicio}/`, {
      method: "PATCH",
      body: JSON.stringify({ auto_activar_servicio: true }),
    });
  }

  /* Registers the payment. Async on WispHub's side when it has router
     work to do — `accion: 1` answers with a `task_id`, `accion: 0` with
     `null`, and that is the difference.

     `accion` is the reconnection switch, measured 2026-08-20 on a real
     router: `1` lifts the cut, `0` records the money and leaves it in
     place. It takes those two values and no others (`2`, `3`, `99` all
     answer 400). `auto_activar_servicio` does **not** decide this — a
     payment with the flag off reconnected anyway, and one with the flag
     on and `accion: 0` did not. See integrations/wisphub.md. */
  async registerPayment(
    invoiceId: number,
    paymentMethodId: number,
    amountCents: number,
    dateTime: string,
    reconnect = true,
  ): Promise<void> {
    await this.request<{ messages?: string[] }>(`/facturas/${invoiceId}/registrar-pago/`, {
      method: "POST",
      body: JSON.stringify({
        forma_pago: paymentMethodId,
        accion: reconnect ? 1 : 0,
        fecha_pago: dateTime,
        total_cobrado: amountCents / 100,
      }),
    });
  }
}

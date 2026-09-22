import { amountToCents, decimalToCents } from "./money";

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
     be empty while this is not. */
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

/* D1: the query type is detected, not selected.

   Nothing calls this any more: links-on-demand-search D4 replaced the
   guess with four `__contains` filters asked at once, and `getCustomer`
   asks `usuario=` outright. It comes out with the roster it belonged to
   (D12, tasks T045) rather than in the middle of a phase — left here so
   that removal is one commit with one reason. */
export function queryParamFor(q: string): "telefono" | "usuario" | "nombre" {
  if (/^\d+$/.test(q)) return "telefono";
  if (q.includes("@")) return "usuario";
  return "nombre";
}

export type PendingInvoice = {
  invoiceId: number;
  usuario: string;
  /* From the row's `cliente` serializer; null when WispHub omits it */
  customerName: string | null;
  totalCents: number;
  /* YYYY-MM-DD, or null when the row lacks the field (cobros-live) */
  invoiceDate: string | null;
  dueDate: string | null;
};
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

export type PendingPage = { invoices: PendingInvoice[]; next: string | null };
export type CustomersPage = { customers: WispHubCustomer[]; next: string | null };

/* links-on-demand-search D4: the four filters a search is put to, in
   the order they are asked. `__contains` is case- and accent-insensitive
   (provider documentation read 2026-09-21), and no filter takes several
   identities at once — which is why there are four calls and not one. */
export const CUSTOMER_SEARCH_FIELDS = ["nombre", "apellido", "usuario", "telefono"] as const;
export type CustomerSearchField = (typeof CUSTOMER_SEARCH_FIELDS)[number];

export type CustomerSearch = {
  /* Merged and deduped by usuario, capped at the caller's limit */
  customers: WispHubCustomer[];
  /* Each filter's own `count`, for the floor the page reports (D5) */
  counts: Record<CustomerSearchField, number>;
};

/* links-on-demand-search D3: the band a browse block is clamped to */
export const CUSTOMERS_BLOCK_MIN = 10;
export const CUSTOMERS_BLOCK_MAX = 50;

/* How deep a live read of the customer list goes before it says so:
   ten pages of 100 was "the pilot scale with room" (direct-payment D5),
   and it is what one admin request can pay. A tenant past it is read by
   the sweep (bug: links-roster-cap). */
export const ROSTER_LIVE_PAGES = 10;

type WispHubListItem = {
  id_servicio: number;
  usuario: string | null;
  nombre: string | null;
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
  async searchCustomers(q: string, limit = 10): Promise<CustomerSearch> {
    const text = encodeURIComponent(q);
    const pages = await Promise.all(
      CUSTOMER_SEARCH_FIELDS.map((field) =>
        this.listPage(`/clientes/?${field}__contains=${text}&limit=${limit}`),
      ),
    );
    /* Dedupe by identity, first filter to answer wins the row */
    const merged = new Map<string, WispHubCustomer>();
    for (const page of pages) {
      for (const customer of page.customers) {
        if (!merged.has(customer.usuario)) merged.set(customer.usuario, customer);
      }
    }
    const counts = {} as Record<CustomerSearchField, number>;
    CUSTOMER_SEARCH_FIELDS.forEach((field, i) => {
      counts[field] = pages[i].count;
    });
    return { customers: [...merged.values()].slice(0, limit), counts };
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

  /* The whole tenant, full shape — the Links roster (admin-links-view,
     amended by the pilot-UX round: WispHub's own filters are
     exact-match and the param was guessed, so "search" moved client-side
     over this list). Up to `ROSTER_LIVE_PAGES` of 100; `complete` says
     whether the cap was hit — and bug: links-roster-cap reads a tenant
     this cannot finish by the sweep instead (`snapshot.ts`), page by
     page through `customersPage` below. */
  async listCustomersFull(): Promise<{ customers: WispHubCustomer[]; complete: boolean }> {
    const customers: WispHubCustomer[] = [];
    let path: string | null = this.customersPath();
    for (let page = 0; page < ROSTER_LIVE_PAGES && path; page++) {
      const data: CustomersPage = await this.customersPage(path);
      customers.push(...data.customers);
      path = data.next;
    }
    return { customers, complete: path === null };
  }

  /* The first page of the customer list — where a pass begins, whether
     the live read's or the sweep's. */
  customersPath(): string {
    return "/clientes/?limit=100";
  }

  /* One page of the customer list and the path of the next — the unit
     the sweep stores and resumes from (bug: links-roster-cap). A row
     without `usuario` is nobody a link can be made for (US-D07 review). */
  async customersPage(path: string): Promise<CustomersPage> {
    const { customers, next } = await this.listPage(path);
    return { customers, next };
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
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const desde = day(new Date(now.getTime() - 180 * 24 * 3600 * 1000));
    /* One day ahead: WispHub stamps in the tenant's timezone, not UTC */
    const hasta = day(new Date(now.getTime() + 24 * 3600 * 1000));
    return `/facturas/?estado=1&tipo_fecha=fecha_emision&desde=${desde}&hasta=${hasta}&limit=100`;
  }

  /* One page of the walk, and the path of the next — the unit the sweep
     stores and resumes from (bug: pending-invoice-cap). */
  async pendingInvoicesPage(path: string): Promise<PendingPage> {
    const data: {
      next: string | null;
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
        });
      }
    }
    /* WispHub's `next` is absolute; keep only the API path */
    const next = data.next ? data.next.slice(data.next.indexOf("/facturas/")) : null;
    return { invoices, next };
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

import { decimalToCents } from "./money";

/* WispHub adapter. Contract verified in .design/devolada/WISPHUB_SPIKE.md.
   All WispHub traffic goes through this file (ARCHITECTURE.md rule). */

const DEFAULT_BASE_URL = "https://api.wisphub.net/api";

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
  monthlyFeeCents: number;
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

/* D1: the query type is detected, not selected. */
export function queryParamFor(q: string): "telefono" | "usuario" | "nombre" {
  if (/^\d+$/.test(q)) return "telefono";
  if (q.includes("@")) return "usuario";
  return "nombre";
}

export type PendingInvoice = { invoiceId: number; usuario: string };
export type PendingInvoices = { invoices: PendingInvoice[]; complete: boolean };

type WispHubListItem = {
  id_servicio: number;
  usuario: string | null;
  nombre: string | null;
  telefono: string | null;
  estado: string | null;
  estado_facturas: string | null;
  precio_plan: string | null;
  zona: { nombre?: string } | null;
};

export class WispHub {
  private readonly limits: WispHubLimits;
  /* D1: spent when this instance's operation runs out of time. Set at
     construction, so the clock starts when the operation does. */
  private readonly deadlineAt: number;

  constructor(
    private apiKey: string,
    private baseUrl: string = DEFAULT_BASE_URL,
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

  /* Uses the LIST endpoint on purpose: the detail endpoint returns
     usuario as null (spike finding). D2: the mapping is an allow-list —
     extra WispHub fields never leak to the frontend. */
  async searchCustomers(q: string): Promise<WispHubCustomer[]> {
    const param = queryParamFor(q);
    const data = await this.get<{ results: WispHubListItem[] }>(
      `/clientes/?${param}=${encodeURIComponent(q)}&limit=10`,
    );
    return data.results.map((c) => ({
      wisphubId: c.id_servicio,
      usuario: c.usuario ?? "",
      name: c.nombre ?? "",
      zone: c.zona?.nombre ?? null,
      phone: c.telefono?.trim() ? c.telefono.trim() : null,
      serviceStatus: mapStatus(c.estado),
      billingStatus: mapBillingStatus(c.estado_facturas),
      monthlyFeeCents: c.precio_plan ? decimalToCents(c.precio_plan) : 0,
    }));
  }

  /* Every customer of the tenant, for payment-link generation
     (direct-payment spec D5). Same list endpoint, paginated; the page
     bound keeps one admin request from walking a huge tenant forever —
     10 pages of 100 covers the pilot scale with room. */
  async listCustomers(): Promise<{ wisphubId: number; usuario: string }[]> {
    const customers: { wisphubId: number; usuario: string }[] = [];
    let path: string | null = "/clientes/?limit=100";
    for (let page = 0; page < 10 && path; page++) {
      const data: { next: string | null; results: WispHubListItem[] } = await this.get(path);
      for (const c of data.results) {
        if (c.usuario) customers.push({ wisphubId: c.id_servicio, usuario: c.usuario });
      }
      path = data.next ? data.next.slice(data.next.indexOf("/clientes/")) : null;
    }
    return customers;
  }

  /* D1 (charge-confirm spec): one customer loads through the list filter.
     The detail endpoint returns nombre/usuario as null (spike finding). */
  async getCustomer(usuario: string): Promise<WispHubCustomer | null> {
    const matches = await this.searchCustomers(usuario);
    return matches.find((c) => c.usuario === usuario) ?? null;
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

  /* The pending invoices of the whole tenant, for an explicit window
     (debt-truth spec D1–D3; grew out of TD-009's find).

     The list endpoint takes `estado` and a date range but **no customer
     filter** — re-verified against the live API 2026-08-16 — so the
     match happens in the caller. `estado=1` is Pendiente. The window is
     180 days by issue date: the product's core case is the suspended
     customer whose unpaid invoice can be months old (D3). Up to 5 pages
     of 100; `complete` says whether the answer is the whole truth or a
     truncated one the caller must not treat as "owes nothing" (D4). */
  async pendingInvoices(now: Date): Promise<PendingInvoices> {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const desde = day(new Date(now.getTime() - 180 * 24 * 3600 * 1000));
    /* One day ahead: WispHub stamps in the tenant's timezone, not UTC */
    const hasta = day(new Date(now.getTime() + 24 * 3600 * 1000));

    const invoices: PendingInvoice[] = [];
    let path: string | null =
      `/facturas/?estado=1&tipo_fecha=fecha_emision&desde=${desde}&hasta=${hasta}&limit=100`;
    for (let page = 0; page < 5 && path; page++) {
      const data: {
        next: string | null;
        results: { id_factura: number; cliente: { usuario: string | null } }[];
      } = await this.get(path);
      for (const f of data.results) {
        if (f.cliente?.usuario) invoices.push({ invoiceId: f.id_factura, usuario: f.cliente.usuario });
      }
      /* WispHub's `next` is absolute; keep only the API path */
      path = data.next ? data.next.slice(data.next.indexOf("/facturas/")) : null;
    }
    return { invoices, complete: path === null };
  }

  /* TD-009: the pending invoice a customer already has, if any.
     Oldest first: pay the debt the customer has been carrying. */
  async findPendingInvoiceId(usuario: string, now: Date): Promise<number | null> {
    const { invoices } = await this.pendingInvoices(now);
    const mine = invoices.filter((f) => f.usuario === usuario);
    return mine.length ? Math.min(...mine.map((f) => f.invoiceId)) : null;
  }

  /* Creates a pending invoice. WispHub answers with a message string,
     not an id (spike finding, TD-008): we parse "la factura N". */
  async createInvoice(usuario: string, amountCents: number, date: string): Promise<number> {
    const amount = amountCents / 100; /* boundary conversion, outbound only */
    const data = await this.request<{ messages?: string }>("/facturas/", {
      method: "POST",
      body: JSON.stringify({
        cliente: usuario,
        tipo_factura: 1,
        articulos: [{ descripcion: "Mensualidad de internet", precio: amount, cantidad: 1 }],
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

  /* Registers the payment. Async on WispHub's side (returns a task_id). */
  async registerPayment(
    invoiceId: number,
    paymentMethodId: number,
    amountCents: number,
    dateTime: string,
  ): Promise<void> {
    await this.request<{ messages?: string[] }>(`/facturas/${invoiceId}/registrar-pago/`, {
      method: "POST",
      body: JSON.stringify({
        forma_pago: paymentMethodId,
        accion: 1,
        fecha_pago: dateTime,
        total_cobrado: amountCents / 100,
      }),
    });
  }
}

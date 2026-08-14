import { decimalToCents } from "./money";

/* WispHub adapter. Contract verified in .design/devolada/WISPHUB_SPIKE.md.
   All WispHub traffic goes through this file (ARCHITECTURE.md rule). */

const DEFAULT_BASE_URL = "https://api.wisphub.net/api";

export class WispHubError extends Error {
  constructor(
    public code: "WISPHUB_UNAVAILABLE" | "WISPHUB_AUTH_FAILED",
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

export type WispHubCustomer = {
  wisphubId: number;
  usuario: string;
  name: string;
  zone: string | null;
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

type WispHubListItem = {
  id_servicio: number;
  usuario: string | null;
  nombre: string | null;
  estado: string | null;
  estado_facturas: string | null;
  precio_plan: string | null;
  zona: { nombre?: string } | null;
};

export class WispHub {
  constructor(
    private apiKey: string,
    private baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Api-Key ${this.apiKey}` },
      });
    } catch {
      throw new WispHubError("WISPHUB_UNAVAILABLE", "network error");
    }
    /* 401/403 means WispHub rejected the key: a setup problem, not an outage.
       Note: WispHub sends the same generic 403 for "no permission" (spike). */
    if (res.status === 401 || res.status === 403) {
      throw new WispHubError("WISPHUB_AUTH_FAILED", `status ${res.status}`);
    }
    if (!res.ok) throw new WispHubError("WISPHUB_UNAVAILABLE", `status ${res.status}`);
    return (await res.json()) as T;
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
      serviceStatus: mapStatus(c.estado),
      billingStatus: mapBillingStatus(c.estado_facturas),
      monthlyFeeCents: c.precio_plan ? decimalToCents(c.precio_plan) : 0,
    }));
  }

  /* D1 (charge-confirm spec): one customer loads through the list filter.
     The detail endpoint returns nombre/usuario as null (spike finding). */
  async getCustomer(usuario: string): Promise<WispHubCustomer | null> {
    const matches = await this.searchCustomers(usuario);
    return matches.find((c) => c.usuario === usuario) ?? null;
  }
}

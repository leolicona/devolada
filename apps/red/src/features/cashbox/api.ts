import type {
  CashboxResponse,
  DeclareHandoverRequest,
  DeclareHandoverResponse,
  StoreHandoversResponse,
  StoreLedgerQuery,
  StoreLedgerResponse,
} from "@devolada/api/store-schema";
import { api } from "@/lib/api";

/* The store's cash book (contracts/store-api.md § The cash book) */

export const getCashbox = () => api<CashboxResponse>("/store/cashbox");

export const getLedger = (q: StoreLedgerQuery) => {
  const params = new URLSearchParams();
  if (q.cursor) params.set("cursor", q.cursor);
  if (q.businessId) params.set("businessId", q.businessId);
  if (q.kind) params.set("kind", q.kind);
  if (q.since !== undefined) params.set("since", String(q.since));
  const qs = params.toString();
  return api<StoreLedgerResponse>(`/store/ledger${qs ? `?${qs}` : ""}`);
};

export const declareHandover = (body: DeclareHandoverRequest) =>
  api<DeclareHandoverResponse>("/store/handovers", { method: "POST", body: JSON.stringify(body) });

/* T080: the store's own hand-overs to one business, newest first */
export const getHandovers = (businessId: string, cursor?: string) => {
  const params = new URLSearchParams({ businessId });
  if (cursor) params.set("cursor", cursor);
  return api<StoreHandoversResponse>(`/store/handovers?${params.toString()}`);
};

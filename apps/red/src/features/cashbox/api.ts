import type {
  CashboxResponse,
  DeclareHandoverRequest,
  DeclareHandoverResponse,
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
  const qs = params.toString();
  return api<StoreLedgerResponse>(`/store/ledger${qs ? `?${qs}` : ""}`);
};

export const declareHandover = (body: DeclareHandoverRequest) =>
  api<DeclareHandoverResponse>("/store/handovers", { method: "POST", body: JSON.stringify(body) });

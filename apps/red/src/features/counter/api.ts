import type {
  CollectionReceiptResponse,
  CollectionStatusResponse,
  RecordCollectionRequest,
  RecordCollectionResponse,
  StoreQuoteResponse,
  StoreSearchResponse,
} from "@devolada/api/store-schema";
import { api } from "@/lib/api";

/* The counter's five doors (contracts/store-api.md). The business is never
   named by the client: the counter always serves the one with the channel
   on (D7). */

export const searchCustomers = (q: string) =>
  api<StoreSearchResponse>(`/store/customers?q=${encodeURIComponent(q)}`);

export const getQuote = (usuario: string) =>
  api<StoreQuoteResponse>(`/store/customers/debt?usuario=${encodeURIComponent(usuario)}`);

export const recordCollection = (body: RecordCollectionRequest) =>
  api<RecordCollectionResponse>("/store/collections", { method: "POST", body: JSON.stringify(body) });

export const getCollection = (id: string) => api<CollectionStatusResponse>(`/store/collections/${encodeURIComponent(id)}`);

/* D18: asked for only when WhatsApp is tapped — the phone is read then */
export const getReceipt = (id: string) =>
  api<CollectionReceiptResponse>(`/store/collections/${encodeURIComponent(id)}/receipt`);

import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import {
  cashboxResponse,
  collectionReceiptResponse,
  collectionStatusResponse,
  invitationPreviewResponse,
  storeLedgerResponse,
  storeMeResponse,
  storeQuoteResponse,
  storeSearchResponse,
} from "@devolada/api/store-schema";

/* The store app's network layer (constitution IV): every fixture is parsed
   by the API's own schema, so a test cannot exercise a shape the API would
   never send — a phone slipped into a search row fails here, at `.parse`. */

export const storeMe = storeMeResponse.parse({
  type: "store",
  storeId: "store-1",
  name: "Abarrotes Lupita",
  businessName: "WiFi Plus",
});

export const searchRows = storeSearchResponse.parse({
  rows: [
    { usuario: "greyes@wifiplus", name: "Guadalupe Reyes", zone: "Centro" },
    { usuario: "gruiz@wifiplus", name: "Gabriel Ruiz", zone: null },
  ],
  more: false,
  integration: "ok",
});

export const owes = storeQuoteResponse.parse({
  state: "owes",
  usuario: "greyes@wifiplus",
  name: "Guadalupe Reyes",
  zone: "Centro",
  debtCents: 79800,
  invoiceCents: 49900,
  carriedBalanceCents: 29900,
  feeCents: 1500,
  totalCents: 81300,
  reconnectsFromCents: 79800,
});

export const quote = (over: Record<string, unknown>) => storeQuoteResponse.parse({ ...owes, ...over });

export const noDebt = storeQuoteResponse.parse({
  state: "none",
  usuario: "greyes@wifiplus",
  name: "Guadalupe Reyes",
  zone: "Centro",
  debtCents: 0,
  invoiceCents: 0,
  carriedBalanceCents: 0,
  feeCents: 1500,
  totalCents: 1500,
});

export const searchUnavailable = storeSearchResponse.parse({ rows: [], more: false, integration: "unavailable" });

export const collection = (over: Record<string, unknown> = {}) =>
  collectionStatusResponse.parse({
    id: "pay-1",
    folio: "DV-7K2Q9M",
    createdAt: Date.UTC(2026, 9, 1, 20, 35),
    businessName: "WiFi Plus",
    customerName: "Guadalupe Reyes",
    amountCents: 79800,
    feeCents: 1500,
    class: "exact",
    remainingCents: 0,
    outcome: "reconnected",
    reconnects: true,
    ...over,
  });

export const receipt = (over: Record<string, unknown> = {}) =>
  collectionReceiptResponse.parse({
    text: "Comprobante de pago · WiFi Plus\n\nFolio: DV-7K2Q9M",
    waLink: "https://wa.me/?text=Comprobante",
    hasPhone: false,
    ...over,
  });

export const cashbox = (over: Record<string, unknown> = {}) =>
  cashboxResponse.parse({
    businesses: [
      {
        businessId: "business-1",
        businessName: "WiFi Plus",
        heldCents: 435000,
        feesSinceHandoverCents: 4500,
        lastHandover: null,
        pendingHandover: null,
        ...over,
      },
    ],
  });

export const ledger = (rows: unknown[], nextCursor: string | null = null) => storeLedgerResponse.parse({ rows, nextCursor });

export const invitation = (state: "open" | "invalid") =>
  invitationPreviewResponse.parse(state === "open" ? { state, storeName: "Abarrotes Lupita", phoneTail: "5678" } : { state });

export const ok = (data: unknown, status = 200) => HttpResponse.json({ success: true, data }, { status });
export const fail = (code: string, status: number) => HttpResponse.json({ success: false, error: { code } }, { status });

/* Better Auth endpoints have no envelope (constitution III's exemption) */
export const baOk = () => HttpResponse.json({});
export const baFail = (code: string, status: number) => HttpResponse.json({ code }, { status });

type Reply = Response | Promise<Response>;

export const handlers = {
  session: (r: () => Reply) => http.get("/auth/me", () => r()),
  search: (r: (url: URL) => Reply) => http.get("/store/customers", ({ request }) => r(new URL(request.url))),
  quote: (r: (url: URL) => Reply) => http.get("/store/customers/debt", ({ request }) => r(new URL(request.url))),
  record: (r: (body: unknown) => Reply) => http.post("/store/collections", async ({ request }) => r(await request.json())),
  collection: (r: (id: string) => Reply) => http.get("/store/collections/:id", ({ params }) => r(String(params.id))),
  receipt: (r: (id: string) => Reply) => http.get("/store/collections/:id/receipt", ({ params }) => r(String(params.id))),
  cashbox: (r: () => Reply) => http.get("/store/cashbox", () => r()),
  ledger: (r: (url: URL) => Reply) => http.get("/store/ledger", ({ request }) => r(new URL(request.url))),
  handover: (r: (body: unknown) => Reply) => http.post("/store/handovers", async ({ request }) => r(await request.json())),
  invitation: (r: (token: string) => Reply) => http.get("/store/invitations/:token", ({ params }) => r(String(params.token))),
  accept: (r: (body: unknown) => Reply) =>
    http.post("/store/invitations/:token/accept", async ({ request }) => r(await request.json())),
  signIn: (r: (body: unknown) => Reply) => http.post("/auth/sign-in/username", async ({ request }) => r(await request.json())),
  signOut: () => http.post("/auth/sign-out", () => baOk()),
  sendCode: (r: (body: unknown) => Reply) =>
    http.post("/auth/email-otp/send-verification-otp", async ({ request }) => r(await request.json())),
  verifyEmail: (r: (body: unknown) => Reply) => http.post("/auth/email-otp/verify-email", async ({ request }) => r(await request.json())),
  resetPassword: (r: (body: unknown) => Reply) =>
    http.post("/auth/email-otp/reset-password", async ({ request }) => r(await request.json())),
};

export const server = setupServer();

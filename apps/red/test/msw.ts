import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import {
  acceptStoreInvitationResponse,
  cashboxResponse,
  collectionReceiptResponse,
  collectionStatusResponse,
  invitationPreviewResponse,
  storeLedgerResponse,
  storeHandoversResponse,
  storeMeResponse,
  storeQuoteResponse,
  storeSearchResponse,
  storeInvitationCodeResponse,
  storeSignInCodeResponse,
  storeSignInResponse,
} from "@devolada/api/store-schema";

/* The store app's network layer (constitution IV): every fixture is parsed
   by the API's own schema, so a test cannot exercise a shape the API would
   never send — a phone slipped into a search row fails here, at `.parse`. */

export const storeMe = storeMeResponse.parse({
  type: "store",
  storeId: "store-1",
  name: "Abarrotes Lupita",
  businessName: "WiFi Plus",
  /* passwordless-access D8: where Caja's step-up sends its código */
  email: "lupita@correo.mx",
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
        feesSince: null,
        lastHandover: null,
        pendingHandover: null,
        ...over,
      },
    ],
  });

export const ledger = (rows: unknown[], nextCursor: string | null = null) => storeLedgerResponse.parse({ rows, nextCursor });

export const handoverList = (handovers: unknown[], nextCursor: string | null = null) =>
  storeHandoversResponse.parse({ businessName: "WiFi Plus", handovers, nextCursor });

export const invitation = (state: "open" | "invalid") =>
  invitationPreviewResponse.parse(state === "open" ? { state, storeName: "Abarrotes Lupita", phoneTail: "5678" } : { state });

/* passwordless-access D10: the store's two doors, each answer parsed by its
   schema (contracts/store-access.md) */
export const invitationCodeSent = (sentTo = "lupita@correo.mx") => storeInvitationCodeResponse.parse({ sentTo });
export const invitationAccepted = acceptStoreInvitationResponse.parse({ storeName: "Abarrotes Lupita" });
export const signInCodeSent = storeSignInCodeResponse.parse({ sent: true });
export const signedIn = storeSignInResponse.parse({ storeName: "Abarrotes Lupita" });

export const ok = (data: unknown, status = 200) => HttpResponse.json({ success: true, data }, { status });
export const fail = (code: string, status: number) => HttpResponse.json({ success: false, error: { code } }, { status });
/* The store routes' limiter (`rateLimitRoute`, apps/api/src/auth/
   rate-limit.ts) answers 429 in the envelope (D3, FR-027) */
export const tooMany = () => fail("TOO_MANY_REQUESTS", 429);

/* Better Auth endpoints have no envelope (constitution III's exemption) */
export const baOk = () => HttpResponse.json({});
export const baFail = (code: string, status: number) => HttpResponse.json({ code }, { status });
export const baStatus = (body: Record<string, unknown>) => HttpResponse.json(body);
/* Better Auth's limiter answers 429 with its own body (D3, FR-027) */
export const baTooMany = () => HttpResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });

type Reply = Response | Promise<Response>;
type Body = Record<string, unknown>;
const bodyOf = async (request: Request) => (await request.json()) as Body;

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
  /* T080 */
  handovers: (r: (url: URL) => Reply) => http.get("/store/handovers", ({ request }) => r(new URL(request.url))),
  invitation: (r: (token: string) => Reply) => http.get("/store/invitations/:token", ({ params }) => r(String(params.token))),
  /* passwordless-access D10: the four store routes. Each hands over the
     body it received, so a test reads what the screen sent. */
  invitationCode: (r: (body: Body, token: string) => Reply = () => ok(invitationCodeSent())) =>
    http.post("/store/invitations/:token/code", async ({ request, params }) => r(await bodyOf(request), String(params.token))),
  accept: (r: (body: Body, token: string) => Reply = () => ok(invitationAccepted, 201)) =>
    http.post("/store/invitations/:token/accept", async ({ request, params }) => r(await bodyOf(request), String(params.token))),
  signInCode: (r: (body: Body) => Reply = () => ok(signInCodeSent)) =>
    http.post("/store/sign-in/code", async ({ request }) => r(await bodyOf(request))),
  signIn: (r: (body: Body) => Reply = () => ok(signedIn)) => http.post("/store/sign-in", async ({ request }) => r(await bodyOf(request))),
  signOut: () => http.post("/auth/sign-out", () => baOk()),
  /* D8, D11: Better Auth's own endpoints Caja's card reaches, in Better
     Auth's own shapes (envelope-exempt, as `baPost` expects) */
  stepUpCode: (r: (body: Body) => Reply = () => baStatus({ success: true })) =>
    http.post("/auth/email-otp/send-verification-otp", async ({ request }) => r(await bodyOf(request))),
  stepUpSignIn: (r: (body: Body) => Reply = () => baStatus({ token: "test-session-token", user: { id: "user-1" } })) =>
    http.post("/auth/sign-in/email-otp", async ({ request }) => r(await bodyOf(request))),
  passkeyList: (r: () => Reply) => http.get("/auth/passkey/list-user-passkeys", () => r()),
  passkeyDelete: (r: (body: Body) => Reply) => http.post("/auth/passkey/delete-passkey", async ({ request }) => r(await bodyOf(request))),
  revokeOtherSessions: (r: () => Reply = () => baStatus({ status: true })) => http.post("/auth/revoke-other-sessions", () => r()),
};

/* passwordless-access FR-036: Caja's card lists the keys on every device, so
   every screen that shows Caja asks for the list. A store with none is the
   ambient answer; a test about the card replaces it. */
export const server = setupServer(http.get("/auth/passkey/list-user-passkeys", () => HttpResponse.json([])));

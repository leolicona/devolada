import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

/* Handlers honor the API envelope ({ success, data } | { success, error })
   — mocks that lie are worse than no mocks (TESTING.md rule 5). */

export const storeActor = {
  type: "store",
  id: "store-1",
  ispId: "isp-1",
  name: "Abarrotes La Esquina",
  phone: "5512345678",
  status: "active",
} as const;

export const ok = (data: unknown, status = 200) =>
  HttpResponse.json({ success: true, data }, { status });

export const fail = (code: string, status: number) =>
  HttpResponse.json({ success: false, error: { code } }, { status });

/* Better Auth endpoints have no envelope (better-auth.spec.md D6) */
export const baOk = () => HttpResponse.json({});
export const baFail = (code: string, status: number) =>
  HttpResponse.json({ code }, { status });

export const handlers = {
  session: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/auth/me", () => response()),
  login: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.post("/auth/sign-in/username", () => response()),
  customerSearch: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/charges/customers", () => response()),
  customerQuote: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/charges/customers/:usuario", () => response()),
  recordCharge: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.post("/charges", () => response()),
  chargeStatus: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/charges/:chargeId", () => response()),
  receipt: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/charges/:chargeId/receipt", () => response()),
  cashbox: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/cashbox", () => response()),
  logout: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.post("/auth/sign-out", () => response()),
  recordDrop: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.post("/cash-drops", () => response()),
  ledger: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/ledger", () => response()),
  acceptInvitation: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.post("/auth/store/accept-invitation", () => response()),
  verifyEmailCode: (response: () => ReturnType<typeof baOk | typeof baFail>) =>
    http.post("/auth/email-otp/verify-email", () => response()),
  requestPasswordReset: (response: () => ReturnType<typeof baOk | typeof baFail>) =>
    http.post("/auth/email-otp/request-password-reset", () => response()),
  resetPassword: (response: () => ReturnType<typeof baOk | typeof baFail>) =>
    http.post("/auth/email-otp/reset-password", () => response()),
};

export const server = setupServer();

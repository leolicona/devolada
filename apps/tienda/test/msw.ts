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

export const handlers = {
  session: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/auth/me", () => response()),
  login: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.post("/auth/store/login", () => response()),
  customerSearch: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/charges/customers", () => response()),
  customerQuote: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/charges/customers/:usuario", () => response()),
  recordCharge: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.post("/charges", () => response()),
  chargeStatus: (response: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/charges/:chargeId", () => response()),
};

export const server = setupServer();

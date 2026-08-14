import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const ispActor = {
  type: "isp",
  id: "isp-1",
  name: "ISP Demo",
  email: "demo@devolada.app",
  emailVerified: true,
  status: "active",
} as const;

export const ok = (data: unknown, status = 200) =>
  HttpResponse.json({ success: true, data }, { status });

export const fail = (code: string, status: number) =>
  HttpResponse.json({ success: false, error: { code } }, { status });

export const handlers = {
  session: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/auth/me", () => r()),
  login: (r: () => ReturnType<typeof ok | typeof fail>) => http.post("/auth/admin/login", () => r()),
  signup: (r: () => ReturnType<typeof ok | typeof fail>) => http.post("/auth/signup", () => r()),
  verifyEmail: (r: () => ReturnType<typeof ok | typeof fail>) => http.post("/auth/verify-email", () => r()),
  resend: (r: () => ReturnType<typeof ok | typeof fail>) => http.post("/auth/resend-verification", () => r()),
  recover: (r: () => ReturnType<typeof ok | typeof fail>) => http.post("/auth/recover", () => r()),
  feed: (r: (url: URL) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/charges/feed", ({ request }) => r(new URL(request.url))),
  stores: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/stores", () => r()),
  createStore: (r: () => ReturnType<typeof ok | typeof fail>) => http.post("/stores", () => r()),
  store: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/stores/:id", () => r()),
  patchStore: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.patch("/stores/:id", async ({ request }) => r(await request.json())),
  resendInvitation: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.post("/stores/:id/resend-invitation", () => r()),
  storeLedger: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/stores/:id/ledger", () => r()),
};

export const server = setupServer();

import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const ispActor = {
  type: "isp",
  id: "isp-1",
  name: "ISP Demo",
  email: "demo@devolada.app",
  emailVerified: true,
  status: "active",
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphubConfigured: true,
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
  session: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/auth/me", () => r()),
  login: (r: () => ReturnType<typeof ok | typeof fail>) => http.post("/auth/sign-in/email", () => r()),
  signup: (r: () => ReturnType<typeof ok | typeof fail>) => http.post("/auth/isp/signup", () => r()),
  verifyEmail: (r: () => ReturnType<typeof baOk | typeof baFail>) => http.post("/auth/email-otp/verify-email", () => r()),
  sendCode: (r: () => ReturnType<typeof baOk | typeof baFail>) => http.post("/auth/email-otp/send-verification-otp", () => r()),
  requestReset: (r: () => ReturnType<typeof baOk | typeof baFail>) =>
    http.post("/auth/email-otp/request-password-reset", () => r()),
  resetPassword: (r: () => ReturnType<typeof baOk | typeof baFail>) =>
    http.post("/auth/email-otp/reset-password", () => r()),
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
  settings: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/settings", () => r()),
  patchSettings: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.patch("/settings", async ({ request }) => r(await request.json())),
  testWisphub: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/settings/wisphub/test", async ({ request }) => r(await request.json())),
  cashDrops: (r: (url: URL) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/cash-drops", ({ request }) => r(new URL(request.url))),
  confirmCashDrop: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.post("/cash-drops/:id/confirm", () => r()),
  disputeCashDrop: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/cash-drops/:id/dispute", async ({ request }) => r(await request.json())),
};

export const server = setupServer();

import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const businessActor = {
  type: "business",
  id: "business-1",
  name: "ISP Demo",
  email: "demo@devolada.app",
  emailVerified: true,
  status: "active",
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphubConfigured: true,
  role: "owner",
  orgId: "org_business-1",
  userId: "user-1",
  businesses: [{ id: "business-1", name: "ISP Demo", role: "owner" }],
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
  signup: (r: () => ReturnType<typeof ok | typeof fail>) => http.post("/auth/business/signup", () => r()),
  verifyEmail: (r: () => ReturnType<typeof baOk | typeof baFail>) => http.post("/auth/email-otp/verify-email", () => r()),
  sendCode: (r: () => ReturnType<typeof baOk | typeof baFail>) => http.post("/auth/email-otp/send-verification-otp", () => r()),
  requestReset: (r: () => ReturnType<typeof baOk | typeof baFail>) =>
    http.post("/auth/email-otp/request-password-reset", () => r()),
  resetPassword: (r: () => ReturnType<typeof baOk | typeof baFail>) =>
    http.post("/auth/email-otp/reset-password", () => r()),
  feed: (r: (url: URL) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/charges/feed", ({ request }) => r(new URL(request.url))),
  settings: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/settings", () => r()),
  patchSettings: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.patch("/settings", async ({ request }) => r(await request.json())),
  testWisphub: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/settings/wisphub/test", async ({ request }) => r(await request.json())),
  linksSearch: (r: (url: URL) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/direct-payments/links/search", ({ request }) => r(new URL(request.url))),
};

export const server = setupServer();

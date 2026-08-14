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
};

export const server = setupServer();

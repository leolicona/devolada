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
  integrationConfigured: true,
  speiConfigured: true,
  role: "owner",
  orgId: "org_business-1",
  userId: "user-1",
  userName: "Leo Licona",
  businesses: [{ id: "business-1", orgId: "org_business-1", name: "ISP Demo", role: "owner" }],
  platformOperator: false,
  credit: { balanceCents: 10000, step: "ok" },
  observing: false,
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
  verifyEmail: (r: (info: { request: Request }) => ReturnType<typeof baOk | typeof baFail> | Promise<ReturnType<typeof baOk | typeof baFail>>) =>
    http.post("/auth/email-otp/verify-email", ({ request }) => r({ request })),
  sendCode: (r: (info: { request: Request }) => ReturnType<typeof baOk | typeof baFail> | Promise<ReturnType<typeof baOk | typeof baFail>>) =>
    http.post("/auth/email-otp/send-verification-otp", ({ request }) => r({ request })),
  /* better-auth D18: the passkey list and its "Quitar" */
  passkeyList: (r: () => Response) => http.get("/auth/passkey/list-user-passkeys", () => r()),
  passkeyDelete: (r: (body: unknown) => ReturnType<typeof baOk | typeof baFail>) =>
    http.post("/auth/passkey/delete-passkey", async ({ request }) => r(await request.json())),
  requestReset: (r: () => ReturnType<typeof baOk | typeof baFail>) =>
    http.post("/auth/email-otp/request-password-reset", () => r()),
  resetPassword: (r: () => ReturnType<typeof baOk | typeof baFail>) =>
    http.post("/auth/email-otp/reset-password", () => r()),
  feed: (r: (url: URL) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/payments/feed", ({ request }) => r(new URL(request.url))),
  /* cobros-live (US-R01) */
  paymentRequests: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/payment-requests", () => r()),
  /* payments-and-classes D4/D5 */
  paymentProof: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/payments/:id/proof", ({ params }) => r(String(params.id))),
  retryReconnection: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/payments/:id/retry-action", ({ params }) => r(String(params.id))),
  /* integrations-hub (US-I01–I03) */
  integrations: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/integrations", () => r()),
  patchWisphub: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.patch("/integrations/wisphub", async ({ request }) => r(await request.json())),
  testWisphubIntegration: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/integrations/wisphub/test", async ({ request }) => r(await request.json())),
  executeAction: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/payments/:id/execute-action", ({ params }) => r(String(params.id))),
  settings: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/settings", () => r()),
  patchSettings: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.patch("/settings", async ({ request }) => r(await request.json())),
  testWisphub: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/settings/wisphub/test", async ({ request }) => r(await request.json())),
  linksRoster: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/direct-payments/links/roster", () => r()),
  /* business-and-memberships (US-B01–B03) */
  getSession: (r: () => Response) => http.get("/auth/get-session", () => r()),
  logout: (r: () => Response) => http.post("/auth/sign-out", () => r()),
  invitationPreview: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/businesses/invitations/:id/preview", ({ params }) => r(String(params.id))),
  acceptInvitationNew: (r: (id: string, body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/businesses/invitations/:id/accept-new", async ({ params, request }) => r(String(params.id), await request.json())),
  resendInvitation: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/businesses/invitations/:id/resend", ({ params }) => r(String(params.id))),
  cancelInvitation: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.delete("/businesses/invitations/:id", ({ params }) => r(String(params.id))),
  updateMemberRole: (r: (id: string, body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.patch("/businesses/members/:id", async ({ params, request }) => r(String(params.id), await request.json())),
  support: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/support", () => r()),
  createBusiness: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/businesses", async ({ request }) => r(await request.json())),
  members: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/businesses/members", () => r()),
  invite: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/businesses/members", async ({ request }) => r(await request.json())),
  removeMember: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.delete("/businesses/members/:id", ({ params }) => r(String(params.id))),
  orgList: (r: () => Response) => http.get("/auth/organization/list", () => r()),
  setActive: (r: (body: unknown) => ReturnType<typeof baOk | typeof baFail>) =>
    http.post("/auth/organization/set-active", async ({ request }) => r(await request.json())),
  acceptInvitation: (r: (body: unknown) => ReturnType<typeof baOk | typeof baFail>) =>
    http.post("/auth/organization/accept-invitation", async ({ request }) => r(await request.json())),
  /* prepaid-credit / operator-panel */
  credit: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/credit", () => r()),
  creditEntries: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/credit/entries", () => r()),
  topUps: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/credit/top-ups", () => r()),
  submitTopUp: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/credit/top-ups", async ({ request }) => r(await request.json())),
  platformSettings: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/platform/settings", () => r()),
  setPlatformSetting: (r: (key: string, body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/platform/settings/:key", async ({ params, request }) => r(String(params.key), await request.json())),
  platformBusinesses: (r: (url: URL) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/platform/businesses", ({ request }) => r(new URL(request.url))),
  platformBusiness: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/platform/businesses/:id", ({ params }) => r(String(params.id))),
  adjustment: (r: (id: string, body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/platform/businesses/:id/adjustments", async ({ params, request }) => r(String(params.id), await request.json())),
};

export const sessionUser = { id: "user-1", name: "Leo", email: "demo@devolada.app", emailVerified: true };

export const server = setupServer();

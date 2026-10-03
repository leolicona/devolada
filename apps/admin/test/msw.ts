import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { devoladaMethods, type DevoladaMethods } from "@devolada/api/integrations-schema";

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
  /* cobros-in-links D13: a WispHub integration answers both */
  integrationCapabilities: ["receivables", "customerDebt"],
  speiConfigured: true,
  role: "owner",
  orgId: "org_business-1",
  userId: "user-1",
  userName: "Leo Licona",
  businesses: [{ id: "business-1", orgId: "org_business-1", name: "ISP Demo", role: "owner" }],
  platformOperator: false,
  credit: { balanceCents: 10000, step: "ok" },
  observing: false,
  /* cash-at-stores D7, D23: a business that never had cash at stores */
  storeChannel: { on: false, since: null },
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
  /* cobros-in-links D1: the Por cobrar view's blocks. The URL carries
     `limit` and the opaque `cursor`. */
  paymentRequests: (r: (url: URL) => ReturnType<typeof ok | typeof fail> | Promise<ReturnType<typeof ok | typeof fail>>) =>
    http.get("/payment-requests", ({ request }) => r(new URL(request.url))),
  /* cobros-in-links D9: what one search result owes, row by row */
  customerDebt: (r: (url: URL) => ReturnType<typeof ok | typeof fail> | Promise<ReturnType<typeof ok | typeof fail>>) =>
    http.get("/direct-payments/customers/debt", ({ request }) => r(new URL(request.url))),
  /* presence-freshness D5 */
  paymentsPulse: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/payments/pulse", () => r()),
  /* payments-and-classes D4/D5 */
  paymentProof: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/payments/:id/proof", ({ params }) => r(String(params.id))),
  retryReconnection: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/payments/:id/retry-action", ({ params }) => r(String(params.id))),
  /* cep-bundle-match US4: the transfers no payment holds */
  unmatchedTransfers: (r: (url: URL) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/payments/unmatched-transfers", ({ request }) => r(new URL(request.url))),
  /* integrations-hub (US-I01–I03) */
  integrations: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/integrations", () => r()),
  patchWisphub: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.patch("/integrations/wisphub", async ({ request }) => r(await request.json())),
  testWisphubIntegration: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/integrations/wisphub/test", async ({ request }) => r(await request.json())),
  /* payment-method-per-channel D8: the setup block, read on its own */
  devoladaMethods: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/integrations/wisphub/payment-methods", () => r()),
  /* automated-collections-api US1: the API card (FR-001, FR-003, FR-004) */
  apiIntegration: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/integrations/api", () => r()),
  issueCredential: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/integrations/api/credentials", async ({ request }) => r(await request.json())),
  revokeCredential: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/integrations/api/credentials/:id/revoke", ({ params }) => r(String(params.id))),
  /* automated-collections-api US2: the webhook's health (FR-018) */
  webhookIntegration: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/integrations/webhook", () => r()),
  /* automated-collections-api US1 (T036): the public surface, for a screen
     or a fixture that rehearses what the business's software sees. The
     panel itself never calls /v1 — a browser holding a `dk_` key is a
     mistake, not a use case (research D1). */
  v1CreatePaymentLink: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/v1/payment-links", async ({ request }) => r(await request.json())),
  v1PaymentLink: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/v1/payment-links/:id", ({ params }) => r(String(params.id))),
  executeAction: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/payments/:id/execute-action", ({ params }) => r(String(params.id))),
  /* receipt-triage D31 */
  reviewPayment: (r: (id: string, body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/payments/:id/review", async ({ params, request }) => r(String(params.id), await request.json())),
  settings: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/settings", () => r()),
  patchSettings: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.patch("/settings", async ({ request }) => r(await request.json())),
  testWisphub: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/settings/wisphub/test", async ({ request }) => r(await request.json())),
  /* links-on-demand-search D1 (US1): the roster is gone — one door for
     browsing and searching the ISP's customers, and one for the act
     that creates a link. Shared by the whole admin suite: every screen
     that renders /links takes its rows from here. */
  customers: (r: (url: URL) => ReturnType<typeof ok | typeof fail> | Promise<ReturnType<typeof ok | typeof fail>>) =>
    http.get("/direct-payments/customers", ({ request }) => r(new URL(request.url))),
  createLink: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/direct-payments/links", async ({ request }) => r(await request.json())),
  /* links-on-demand-search D13 (FR-023): the one-time cleanup's count.
     Every render of /links asks for it, so the whole admin suite needs
     the handler — it answers `null` by default, which is what a
     business with nothing to be told sees. */
  pruneNotice: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/direct-payments/prune-notice", () => r()),
  dismissPruneNotice: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.post("/direct-payments/prune-notice/dismiss", () => r()),
  /* business-and-memberships (US-B01–B03) */
  getSession: (r: () => Response) => http.get("/auth/get-session", () => r()),
  logout: (r: () => Response) => http.post("/auth/sign-out", () => r()),
  invitationPreview: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/businesses/invitations/:id/preview", ({ params }) => r(String(params.id))),
  /* bug: invitee-lands-own-business: the invitations sent to me */
  myInvitations: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/businesses/invitations/mine", () => r()),
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
  /* landing-page US2 (D17): the operator's Landing tab */
  landingRequests: (r: (url: URL) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/platform/landing/requests", ({ request }) => r(new URL(request.url))),
  landingCounts: (r: (url: URL) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/platform/landing/counts", ({ request }) => r(new URL(request.url))),
  /* receipt-reader-tuning US1/US3 (D19): the operator's Lector tab */
  readerState: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/platform/reader", () => r()),
  readerChoose: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/platform/reader/model", async ({ request }) => r(await request.json())),
  benchList: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/platform/reader/bench", () => r()),
  benchTally: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/platform/reader/bench/tally", () => r()),
  benchDetail: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/platform/reader/bench/:id", ({ params }) => r(String(params.id))),
  benchUpload: (r: (form: FormData) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/platform/reader/bench", async ({ request }) => r(await request.formData())),
  benchRead: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/platform/reader/bench/:id/read", ({ params }) => r(String(params.id))),
  benchMarks: (r: (readingId: string, body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.put("/platform/reader/bench/readings/:readingId/marks", async ({ params, request }) =>
      r(String(params.readingId), await request.json()),
    ),
  benchFile: (r: (id: string) => Response) => http.get("/platform/reader/bench/:id/file", ({ params }) => r(String(params.id))),
  /* payment-without-receipt D19 (US4): the provider's remaining calls,
     on the operator's Reglas tab */
  providerQuota: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/platform/provider-quota", () => r()),
  /* cash-at-stores US2: the operator's Tiendas tab and the switch */
  patchBusiness: (r: (id: string, body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.patch("/platform/businesses/:id", async ({ params, request }) => r(String(params.id), await request.json())),
  platformStores: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/platform/stores", () => r()),
  createStore: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/platform/stores", async ({ request }) => r(await request.json())),
  patchStore: (r: (id: string, body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.patch("/platform/stores/:id", async ({ params, request }) => r(String(params.id), await request.json())),
  resendStoreInvitation: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/platform/stores/:id/invitation", ({ params }) => r(String(params.id))),
  deleteStore: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.delete("/platform/stores/:id", ({ params }) => r(String(params.id))),
  storeLedger: (r: (id: string, businessId: string) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/platform/stores/:id/ledger/:businessId", ({ params }) => r(String(params.id), String(params.businessId))),
  storeCorrection: (r: (id: string, businessId: string, body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/platform/stores/:id/ledger/:businessId/corrections", async ({ params, request }) =>
      r(String(params.id), String(params.businessId), await request.json()),
    ),
  /* cash-at-stores US5: Puntos de pago */
  cashPoints: (r: () => ReturnType<typeof ok | typeof fail>) => http.get("/cash-points", () => r()),
  confirmHandover: (r: (id: string) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/cash-points/handovers/:id/confirm", ({ params }) => r(String(params.id))),
  disputeHandover: (r: (id: string, body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/cash-points/handovers/:id/dispute", async ({ params, request }) => r(String(params.id), await request.json())),
  handoverHistory: (r: (storeId: string) => ReturnType<typeof ok | typeof fail>) =>
    http.get("/cash-points/stores/:storeId/history", ({ params }) => r(String(params.storeId))),
};

export const sessionUser = { id: "user-1", name: "Leo", email: "demo@devolada.app", emailVerified: true };

/* links-on-demand-search D13: the prune notice is a ONE-TIME platform
   event, and every render of /links asks for it. Answering `null` by
   default — "this business has nothing to be told" — keeps it out of
   every other suite's arrangement; the tests that care about the notice
   override it with `handlers.pruneNotice(...)`.

   payment-without-receipt D19: the provider quota, likewise — every
   render of /operador's Reglas tab asks for it, and `null` is what the
   operator sees before any answer carried the header. The tests that
   care override it with `handlers.providerQuota(...)`.

   bug: invitee-lands-own-business: every render of the shell, the
   business wizard and the chooser asks for the invitations sent to the
   person signed in.
   None is what nearly everyone sees; the tests that care override it with
   `handlers.myInvitations(...)`. */
export const server = setupServer(
  http.get("/direct-payments/prune-notice", () => ok(null)),
  http.get("/platform/provider-quota", () => ok(null)),
  http.get("/businesses/invitations/mine", () => ok({ invitations: [] })),
);

/* payment-method-per-channel D8: a setup block, validated against the
   contract. The names and descriptions are the adapter's (D1, D15). */
export const METHOD_LINES = {
  link: {
    name: "SPEI - LINK.DEVOLADAPAGO",
    description:
      "Pagos SPEI validados por link de Devolada (bancos, Spin, Mercado Pago, CoDi, DiMo). Los registra Devolada; no usar en mostrador.",
  },
  network: {
    name: "CASH - RED.DEVOLADAPAGO",
    description: "Pagos en efectivo en tiendas de la red Devolada. Los registra Devolada; no usar en mostrador.",
  },
} as const;

type LineStatus = "found" | "missing" | "duplicate";
export function methodsBlock(link: LineStatus = "found", network: LineStatus | null = null): DevoladaMethods {
  return devoladaMethods.parse({
    checked: true,
    link: { ...METHOD_LINES.link, status: link },
    network: network === null ? null : { ...METHOD_LINES.network, status: network },
  });
}

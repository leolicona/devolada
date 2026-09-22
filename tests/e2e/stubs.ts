import type { Page } from "@playwright/test";
/* By path, not by package name: the root workspace does not depend on the
   API, and the contract's zod resolves from apps/api's own node_modules
   when the file is reached this way. */
import { accessRequestReceived as accessRequestReceivedSchema } from "../../apps/api/src/routes/landing/schema";

/* The API, stubbed at the network edge. Same discipline as MSW in the
   component layer: the shapes come from the real contracts, so a stub
   cannot drift into fiction the app would never receive. */

const envelope = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

/* The app is served from the same origin it calls, so a glob for an
   API endpoint can also match the browser navigating to a page of the
   same name. Fulfilling that navigation hands the browser JSON instead
   of the app, and the screen never renders. Documents always pass
   through. */
async function apiRoute(page: Page, pattern: string, data: unknown): Promise<void> {
  await page.route(pattern, (route) => {
    if (route.request().resourceType() === "document") return route.fallback();
    return route.fulfill(envelope(data));
  });
}

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
};

const at = Date.UTC(2026, 7, 14, 20, 30);

export const feed = {
  payments: [
    {
      id: "ch-1",
      folio: "DV-FEED01",
      channel: "spei",
      status: "confirmed",
      actionOutcome: "failed",
      reconciliationClass: "exact",
      askedCents: 41400,
      missingCents: 0,
      surplusCents: 0,
      receivedCents: 41400,
      invoiceCents: 39900,
      carriedBalanceCents: 0,
      serviceFeeCents: 1500,
      observedAction: null,
      dispatchedAction: null,
      customerName: "Janely Guadalupe Reyes",
      storeName: "Abarrotes La Esquina",
      createdAt: at,
      actionDoneAt: null,
      actionAttempts: 3,
      actionError: "WISPHUB_UNAVAILABLE",
    },
    {
      id: "ch-2",
      folio: "DV-FEED02",
      channel: "spei",
      status: "confirmed",
      actionOutcome: "done",
      reconciliationClass: "exact",
      askedCents: 51400,
      missingCents: 0,
      surplusCents: 0,
      receivedCents: 51400,
      invoiceCents: 49900,
      carriedBalanceCents: 0,
      serviceFeeCents: 1500,
      observedAction: null,
      dispatchedAction: null,
      customerName: "Abraham Flores",
      storeName: "Miscelánea Lupita",
      createdAt: at - 3_600_000,
      actionDoneAt: at - 3_500_000,
      actionAttempts: 1,
      actionError: null,
    },
  ],
  nextCursor: null,
  effectiveOverTreatment: "credit",
  today: { count: 2, totalCents: 92800, startedAtMs: Date.UTC(2026, 7, 14, 6) },
};

export const cobros = {
  cobros: [
    {
      externalId: 42,
      customerUsuario: "greyes@wifiplus",
      customerName: "Janely Guadalupe Reyes",
      amountCents: 49900,
      invoiceDate: "2026-08-01",
      dueDate: "2026-08-11",
      linkUrl: null,
      waLink: null,
    },
  ],
  complete: true,
  readAt: at,
};

export const integrationsHub = {
  wisphub: {
    provider: "wisphub",
    configured: true,
    keyTail: "1234",
    /* provider-address-per-isp FR-004/FR-007: the address rides beside
       the key now. The stub picks the pilot's installation on purpose —
       a non-default one is what proves the screen renders a CHOICE and
       not a constant. */
    installation: "wisphub_io",
    effectiveInstallation: { key: "wisphub_io", label: "wisphub.io", kind: "real", assumed: false },
    actionsEnabled: false,
    mapping: {
      exact: "register_and_reconnect",
      short: "register_and_reconnect",
      over: "register_and_reconnect",
    },
    thresholdPercent: 100,
    floorCents: 0,
    provisionalReleaseEnabled: false,
  },
  /* automated-collections-api US1: the API card's count */
  api: { activeCredentials: 1 },
};

/* automated-collections-api US1: the API card's detail */
export const apiIntegration = {
  credentials: [
    {
      id: "cred-1",
      name: "Sistema de facturación",
      keyTail: "9f3a",
      isTest: false,
      lastUsedAt: at,
      revokedAt: null,
      createdAt: at - 86_400_000,
    },
  ],
  validationAvailable: true,
};

/* links-on-demand-search D1 (US1): one block of the ISP's customers,
   both channels, each with their link if one exists. The roster this
   replaces handed back the whole tenant with a link for every row; here
   the panel customer has one and could equally have none — the buttons
   show either way (FR-008, D7). */
export const customersBlock = {
  results: [
    {
      channel: "panel",
      usuario: "greyes@wifiplus",
      wisphubId: 6,
      customerRef: null,
      label: null,
      askCents: null,
      linkState: null,
      name: "Janely Guadalupe Reyes",
      phone: "5551234567",
      hasLink: true,
      url: "https://link.dev.devoladapago.com/p/tok-greyes",
      waLink: "https://wa.me/525551234567?text=hola",
    },
    {
      channel: "api",
      usuario: null,
      wisphubId: null,
      customerRef: "CLI-4471",
      label: "Ana Ruiz",
      askCents: 49900,
      linkState: "open",
      name: "Ana Ruiz",
      phone: null,
      hasLink: true,
      url: "https://link.dev.devoladapago.com/p/tok-cli4471",
      waLink: "https://wa.me/?text=hola",
    },
  ],
  nextCursor: null,
  matched: null,
  total: 6513,
  wisphub: "ok",
};

/* links-on-demand-search D8: what the act answers (FR-008) */
export const createdLink = {
  token: "tok-greyes",
  url: "https://link.dev.devoladapago.com/p/tok-greyes",
  waLink: "https://wa.me/525551234567?text=hola",
  created: true,
};

/* What the business's software receives from POST /v1/payment-links
   (automated-collections-api US1, T036) — the same row the block above
   shows as its API entry */
export const apiPaymentLink = {
  id: "lnk_0123456789abcdef0123456789abcdef",
  url: "https://link.dev.devoladapago.com/p/tok-cli4471",
  customerRef: "CLI-4471",
  askCents: 49900,
  mode: "reusable",
  expiresAt: null,
  state: "open",
  closedAt: null,
  label: "Ana Ruiz",
  concept: null,
  isTest: false,
  createdAt: at,
  notices: [],
};

/* Holds one endpoint open until the test lets it go (feedback-vocabulary-rollout
   US1, D5).

   A pending state cannot be observed if the answer is already there: the
   assertion races the response and passes for whichever reason it happens to
   win. This makes the browser really wait while the check runs.

   Register it AFTER stubAdminApi — Playwright checks route handlers in reverse
   order of registration, so the later one wins for the same pattern.

   Returns the release. A test that forgets to call it still finishes; the route
   is torn down with the page. */
export async function holdApiRoute(
  page: Page,
  pattern: string,
  data: unknown,
): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    if (route.request().resourceType() === "document") return route.fallback();
    await held;
    return route.fulfill(envelope(data));
  });
  return release;
}

/* The business's settings, as /settings/direct-payment reads them
   (settings-schema). The SPEI card opens on a CLABE whose prefix is not in
   PREFIX_TO_BANK, which is the state the bank has to be picked by hand in
   (bug: bank-picker-unreachable). */
export const settings = {
  serviceFeeCents: 1500,
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphub: { configured: true, keyTail: "1234" },
  spei: {
    clabe: "159180157000000004",
    bank: null,
    beneficiaryName: null,
    serviceFeeCents: null,
    effectiveServiceFeeCents: 1500,
    bankUnknown: false,
    configured: false,
  },
  reconnection: { thresholdPercent: 100, floorCents: 0, provisionalReleaseEnabled: false },
  reconciliationPolicy: { toleranceCents: 0, overTreatment: "flag", effectiveOverTreatment: "flag" },
};

export async function stubAdminApi(page: Page): Promise<void> {
  await apiRoute(page, "**/auth/me", businessActor);
  await apiRoute(page, "**/settings", settings);
  await apiRoute(page, "**/payments/feed*", feed);
  await apiRoute(page, "**/payment-requests", cobros);
  await apiRoute(page, "**/integrations", integrationsHub);
  await apiRoute(page, "**/integrations/api", apiIntegration);
  await apiRoute(page, "**/direct-payments/customers*", customersBlock);
  await apiRoute(page, "**/direct-payments/links", createdLink);
  await apiRoute(page, "**/v1/payment-links", apiPaymentLink);
}

/* The customer's payment page (direct-payment D9): no session, so the
   only stubs are the link and the proof pipeline behind it. */
export const paymentLink = {
  ispName: "WifiPlus",
  customerName: "Janely Reyes",
  status: "debt",
  invoiceCents: 49900,
  carriedBalanceCents: 0,
  serviceFeeCents: 1500,
  totalCents: 51400,
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "WifiPlus SA de CV",
  reference: "greyes@wifiplus",
};

/* The longest real clave measured so far: 28 characters, from a live
   NUBANK receipt (D16/BUG-006). The field has to hold it. */
export const longTrackingKey = "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K";

export const proofReading = {
  source: "reader",
  isReceipt: true,
  amountCents: paymentLink.totalCents,
  trackingKey: longTrackingKey,
  /* Unresolved on purpose — but no longer a door. Until two-eyes-receipt
     D13 a hole like this one stopped the payer for a confirmation; now it
     travels to the provider, who may fill it for free (FR-005), and
     nobody is asked. The hole stays here because the reading a real
     reader returns usually has one, and the silent path is what every
     test using this stub is meant to walk. */
  senderBank: null,
  date: "2026-08-19",
  receiptStatus: "Aceptada",
  gate: { trackingKey: "ok", senderBank: "unresolved", amount: "ok" },
};

/* The one reading that still stops for the payer (claimed-amount D2):
   read whole, and above the debt. The surplus is consented to, never
   refused — so this is the only door left through which the machine's
   own clave is put in front of the payer to proofread, which is what
   BUG-009 measures. */
export const surplusReading = {
  ...proofReading,
  senderBank: "STP",
  amountCents: paymentLink.totalCents + 8600,
  gate: { trackingKey: "ok", senderBank: "ok", amount: "ok" },
};

export async function stubPagoSurplusReading(page: Page): Promise<void> {
  await apiRoute(page, "**/direct-payments/links/*/read", surplusReading);
}

export async function stubPagoApi(page: Page): Promise<void> {
  await apiRoute(page, "**/direct-payments/links/*", paymentLink);
  await apiRoute(page, "**/direct-payments/links/*/proof", { proofId: "link-1/proof-1" });
  await apiRoute(page, "**/direct-payments/links/*/read", proofReading);
}

/* automated-collections-api D6 / FR-031 (US1 scenarios 3 and 4): the one
   state an API link adds to the payer's page — a one-time link that was
   paid, or whose deadline passed. Static copy, no CLABE; the two reasons
   read different sentences. Shape from `linkStatusResponse`. */
export const closedLink = (closedReason: "paid" | "expired") => ({
  ispName: "Gimnasio Norte",
  status: "closed",
  closedReason,
});

export function stubPagoClosed(closedReason: "paid" | "expired") {
  return async (page: Page): Promise<void> => {
    await apiRoute(page, "**/direct-payments/links/*", closedLink(closedReason));
  };
}

/* The landing page's two doors (landing-page US1; contracts/landing-api.md),
   with fixtures the contract parses. The page is built with PUBLIC_API_URL
   pointing at its own preview origin, so these are same-origin routes like
   the admin's. */
export const accessRequestReceived = accessRequestReceivedSchema.parse({ id: "req-1", receivedAt: at });

export async function stubLandingApi(page: Page): Promise<void> {
  await apiRoute(page, "**/landing/requests", accessRequestReceived);
  await apiRoute(page, "**/landing/events", { counted: true });
}

/* One refusal from the request door, in the envelope with a bare code
   (constitution III; landing-page D6, D9) */
export async function stubLandingRefusal(page: Page, code: "REQUEST_REFUSED" | "TOO_MANY_REQUESTS" | "VALIDATION_ERROR", status: number): Promise<void> {
  await page.route("**/landing/requests", (route) => {
    if (route.request().resourceType() === "document") return route.fallback();
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ success: false, error: { code } }) });
  });
}

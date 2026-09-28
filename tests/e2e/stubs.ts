import type { Page } from "@playwright/test";
/* By path, not by package name: the root workspace does not depend on the
   API, and the contract's zod resolves from apps/api's own node_modules
   when the file is reached this way. */
import { accessRequestReceived as accessRequestReceivedSchema } from "../../apps/api/src/routes/landing/schema";
import { linkStatusResponse, proofReadingResponse } from "../../apps/api/src/routes/direct-payments/schema";
import { settingsResponse } from "../../apps/api/src/routes/settings/schema";
import { proofResponse, unmatchedTransfersResponse } from "../../apps/api/src/routes/payments/schema";
import {
  benchListResponse,
  benchReceiptDetail,
  benchTallyResponse,
  readerStateResponse,
} from "../../apps/api/src/routes/reader/schema";

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
   (bug: bank-picker-unreachable).
   receipt-triage T055 (Constitution III): parsed, so the stub serves what
   the server serves — the `wisphub` and `reconnection` keys it carried
   left for the hub (integrations-hub D9) and are stripped here too. */
export const settings = settingsResponse.parse({
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
    /* receipt-triage D9, D29: the card and the phone, unset; the cuenta de
       cobro reads the CLABE */
    card: null,
    cardBank: null,
    phone: null,
    phoneBank: null,
    collectKind: "clabe",
  },
  reconnection: { thresholdPercent: 100, floorCents: 0, provisionalReleaseEnabled: false },
  reconciliationPolicy: { toleranceCents: 0, overTreatment: "flag", effectiveOverTreatment: "flag" },
});

/* cep-bundle-match (T049): a payment a search without a clave decided —
   the proof dialog's decision line and its candidates. Synthetic claves;
   other senders by four digits only (FR-010). */
export const decidedProof = proofResponse.parse({
  folio: "DV-FEED01",
  proofMode: "receipt",
  cep: {
    trackingKey: "260926071199000021I",
    amountCents: 41400,
    date: "2026-09-26",
    senderBank: "AZTECA",
    senderName: null,
    beneficiaryName: "WifiPlus SA de CV",
  },
  imageUrl: null,
  match: {
    source: "several",
    decided: "chosen",
    by: "both",
    reason: null,
    distanceS: 22,
    receipt: { time: "07:10:58", tail: "8301" },
    candidates: [
      {
        clave: "260926071199000021I",
        creditDate: "2026-09-26",
        creditTime: "07:11:20",
        amountCents: 41400,
        senderBank: "AZTECA",
        senderTail: "8301",
        fate: "chosen",
        why: null,
      },
      {
        clave: "260926114099000022I",
        creditDate: "2026-09-26",
        creditTime: "11:40:47",
        amountCents: 41400,
        senderBank: "AZTECA",
        senderTail: "4171",
        fate: "dropped",
        why: "tail",
      },
      {
        clave: "MBAN01002609260099887766",
        creditDate: "2026-09-26",
        creditTime: "07:12:31",
        amountCents: 41400,
        senderBank: "BBVA MEXICO",
        senderTail: "8301",
        fate: "dropped",
        why: "farther",
      },
    ],
  },
});

/* cep-bundle-match US4 (T049): the transfers no payment holds */
export const unmatchedTransfers = unmatchedTransfersResponse.parse({
  transfers: [
    { clave: "260926114099000022I", creditDate: "2026-09-26", creditTime: "11:40:47", amountCents: 41400, senderBank: "AZTECA", senderTail: "4171" },
    { clave: "MBAN01002609250011223344", creditDate: "2026-09-25", creditTime: "19:00:05", amountCents: 123456, senderBank: "BANCO NACIONAL DE MEXICO", senderTail: "2344" },
  ],
});

export async function stubAdminApi(page: Page): Promise<void> {
  await apiRoute(page, "**/auth/me", businessActor);
  await apiRoute(page, "**/settings", settings);
  await apiRoute(page, "**/payments/feed*", feed);
  await apiRoute(page, "**/payments/unmatched-transfers*", unmatchedTransfers);
  await apiRoute(page, "**/payments/*/proof", decidedProof);
  await apiRoute(page, "**/payment-requests", cobros);
  await apiRoute(page, "**/integrations", integrationsHub);
  await apiRoute(page, "**/integrations/api", apiIntegration);
  await apiRoute(page, "**/direct-payments/customers*", customersBlock);
  /* links-on-demand-search D13: nothing to be told, which is what every
     business sees once the one-time cleanup has been dismissed */
  await apiRoute(page, "**/direct-payments/prune-notice", null);
  await apiRoute(page, "**/direct-payments/links", createdLink);
  await apiRoute(page, "**/v1/payment-links", apiPaymentLink);
}

/* The customer's payment page (direct-payment D9): no session, so the
   only stubs are the link and the proof pipeline behind it. */
/* receipt-triage (analyze 2026-09-25, D1): parsed, so the stub cannot
   carry a shape the server would never send (constitution III) */
export const paymentLink = linkStatusResponse.parse({
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
  /* receipt-triage D29: the one account the payer sees */
  collectAccount: { kind: "clabe", value: "646180157000000004", bank: "STP" },
});

/* The longest real clave measured so far: 28 characters, from a live
   NUBANK receipt (D16/BUG-006). The field has to hold it. */
export const longTrackingKey = "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K";

/* receipt-triage T055 (Constitution III): parsed like every fixture. The
   bank gate says `unknown` — the contract's word for a bank name outside
   the vocabulary; it said "unresolved", which no server ever sent. */
export const proofReading = proofReadingResponse.parse({
  source: "reader",
  isReceipt: true,
  /* Not judged: reads as `full`, and never refuses (two-eyes D2) */
  legibility: null,
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
  gate: { trackingKey: "ok", senderBank: "unknown", amount: "ok", referenceNumber: "missing" },
  /* receipt-triage D12, D15, D8: no reference, nothing to ask, and the
     destination's digits were read */
  referenceNumber: null,
  ask: null,
  destinationSeen: true,
});

/* receipt-triage US2/US4: a clear capture with neither key — the one the
   ask stops before any credit, and the guide answers "No se ve" for */
export const keylessReading = proofReadingResponse.parse({
  source: "reader",
  isReceipt: true,
  legibility: "full",
  amountCents: paymentLink.totalCents,
  trackingKey: null,
  referenceNumber: null,
  senderBank: "BANORTE",
  date: "2026-08-19",
  receiptStatus: "Aceptada",
  gate: { trackingKey: "missing", senderBank: "ok", amount: "ok", referenceNumber: "missing" },
  ask: { reason: "no_key", fields: ["key"] },
  destinationSeen: true,
});

export async function stubPagoKeylessReading(page: Page): Promise<void> {
  await apiRoute(page, "**/direct-payments/links/*/read", keylessReading);
}

/* The one reading that still stops for the payer (claimed-amount D2):
   read whole, and above the debt. The surplus is consented to, never
   refused — so this is the only door left through which the machine's
   own clave is put in front of the payer to proofread, which is what
   BUG-009 measures. */
export const surplusReading = proofReadingResponse.parse({
  ...proofReading,
  senderBank: "STP",
  amountCents: paymentLink.totalCents! + 8600,
  gate: { trackingKey: "ok", senderBank: "ok", amount: "ok", referenceNumber: "missing" },
});

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

/* receipt-reader-tuning US1/US3 (D19): /operador → Lector for the
   operator — the model card, a bench receipt with two readings (one read
   with the same-bank flag, one failed) and the tally. Parsed with the
   contract, so the stub cannot carry a shape the server would never send
   (constitution III). */
const MISTRAL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const GEMMA = "@cf/google/gemma-4-26b-a4b-it";

export const readerState = readerStateResponse.parse({
  models: [
    { id: MISTRAL, label: "Mistral Small 3.1" },
    { id: GEMMA, label: "Gemma 4 26B" },
  ],
  defaultModel: MISTRAL,
  activeModel: MISTRAL,
  choice: "applies",
  staleChoice: null,
  history: [{ value: MISTRAL, authorUserId: "user-1", authorEmail: "demo@devolada.app", createdAt: at }],
  fallbacksLast7Days: 1,
  questionVersion: "2",
  readerAvailable: true,
});

export const benchDetail = benchReceiptDetail.parse({
  id: "b1",
  mediaType: "image/png",
  byteSize: 1200,
  createdAt: at,
  fileAvailable: true,
  missing: [],
  readings: [
    {
      id: "r1",
      model: MISTRAL,
      modelLabel: "Mistral Small 3.1",
      questionVersion: "2",
      status: "read",
      failureCode: null,
      readerMs: 3100,
      reading: {
        isReceipt: true,
        legibility: "full",
        trackingKey: "260925071144368901I",
        referenceNumber: "038195",
        senderBank: "AZTECA",
        receivingBank: "AZTECA",
        amountCents: 35000,
        date: "2026-09-25",
        destination: { kind: "clabe", digits: "8195" },
        sameBank: true,
      },
      rawOutput: '```json\n{"esComprobante": true}\n```',
      marks: { trackingKey: "right" },
      judged: { trackingKey: "right" },
      markedAt: at,
    },
    {
      id: "r2",
      model: GEMMA,
      modelLabel: "Gemma 4 26B",
      questionVersion: "2",
      status: "failed",
      failureCode: "READER_UNREADABLE",
      readerMs: 4200,
      reading: null,
      rawOutput: '{"choices": []}',
      marks: {},
      judged: {},
      markedAt: null,
    },
  ],
});

export const benchList = benchListResponse.parse({
  items: [
    {
      id: "b1",
      mediaType: "image/png",
      byteSize: 1200,
      createdAt: at,
      fileAvailable: true,
      readings: [
        { id: "r1", model: MISTRAL, modelLabel: "Mistral Small 3.1", questionVersion: "2", status: "read", readerMs: 3100, marked: 1 },
        { id: "r2", model: GEMMA, modelLabel: "Gemma 4 26B", questionVersion: "2", status: "failed", readerMs: 4200, marked: 0 },
      ],
    },
  ],
  nextCursor: null,
});

export const benchTally = benchTallyResponse.parse({
  asOf: at,
  rows: [
    {
      model: MISTRAL,
      modelLabel: "Mistral Small 3.1",
      questionVersion: "2",
      readings: 7,
      failures: 0,
      judged: 50,
      right: 45,
      wrongByField: { trackingKey: 3, senderBank: 2 },
      p90Ms: 3400,
    },
    {
      model: GEMMA,
      modelLabel: "Gemma 4 26B",
      questionVersion: "2",
      readings: 7,
      failures: 7,
      judged: 0,
      right: 0,
      wrongByField: {},
      p90Ms: null,
    },
  ],
});

/* A real 1×1 PNG, so the bench picture renders rather than breaks */
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export async function stubOperatorReaderApi(page: Page): Promise<void> {
  await stubAdminApi(page);
  await apiRoute(page, "**/auth/me", { ...businessActor, platformOperator: true });
  await apiRoute(page, "**/platform/settings", { settings: [] });
  await apiRoute(page, "**/platform/reader", readerState);
  await apiRoute(page, "**/platform/reader/bench", benchList);
  await apiRoute(page, "**/platform/reader/bench/tally", benchTally);
  await apiRoute(page, "**/platform/reader/bench/b1", benchDetail);
  await page.route("**/platform/reader/bench/b1/file", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(ONE_PIXEL_PNG, "base64") }),
  );
}

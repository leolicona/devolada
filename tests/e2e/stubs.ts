import type { Page } from "@playwright/test";
/* By path, not by package name: the root workspace does not depend on the
   API, and the contract's zod resolves from apps/api's own node_modules
   when the file is reached this way. */
import { accessRequestReceived as accessRequestReceivedSchema } from "../../apps/api/src/routes/landing/schema";
import {
  customerDebtResponse,
  customersResponse,
  directPaymentStatusResponse,
  linkStatusResponse,
  proofReadingResponse,
} from "../../apps/api/src/routes/direct-payments/schema";
import { paymentRequestsResponse } from "../../apps/api/src/routes/payment-requests/schema";
import { devoladaMethods } from "../../apps/api/src/routes/integrations/schema";
import {
  acceptInvitationNewRequest,
  invitationPreviewResponse as memberInvitationPreviewResponse,
  myInvitationsResponse,
} from "../../apps/api/src/routes/businesses/schema";
import { settingsResponse } from "../../apps/api/src/routes/settings/schema";
import { feedResponse, proofResponse, unmatchedTransfersResponse } from "../../apps/api/src/routes/payments/schema";
import {
  cashboxResponse,
  collectionReceiptResponse,
  collectionStatusResponse,
  declareHandoverResponse,
  recordCollectionResponse,
  storeLedgerResponse,
  storeHandoversResponse,
  invitationPreviewResponse,
  acceptStoreInvitationResponse,
  storeInvitationCodeResponse,
  storeMeResponse,
  storeSignInCodeResponse,
  storeSignInResponse,
  storeQuoteResponse,
  storeSearchResponse,
} from "../../apps/api/src/routes/store/schema";
import { cashPointsResponse, handoverHistoryResponse } from "../../apps/api/src/routes/cash-points/schema";
import {
  DEFAULT_RECEIPT_TEMPLATE,
  platformLedgerResponse,
  settingsListResponse,
  storesListResponse,
} from "../../apps/api/src/routes/platform/schema";
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

/* cobros-in-links D1: one block of the Por cobrar view, parsed so the
   stub cannot carry a shape the server would never send (constitution
   III). Janely owes one invoice with a carried balance, overdue; Abraham
   one not yet due. */
export const cobros = paymentRequestsResponse.parse({
  results: [
    {
      externalId: 42,
      customerUsuario: "greyes@wifiplus",
      customerName: "Janely Guadalupe Reyes",
      amountCents: 79800,
      invoiceDate: "2026-08-01",
      dueDate: "2026-08-11",
      periodCents: 49900,
      carriedCents: 29900,
      period: "Periodo del 1/Ago./2026 al 31/Ago./2026",
    },
    {
      externalId: 88,
      customerUsuario: "aflores@wifiplus",
      customerName: "Abraham Flores",
      amountCents: 19900,
      invoiceDate: "2099-01-01",
      dueDate: "2099-01-11",
      periodCents: 19900,
      carriedCents: 0,
      period: null,
    },
  ],
  nextCursor: null,
  total: 2,
  integration: "ok",
});

/* cobros-in-links D9: what a search result owes — the short-payer found */
export const customerDebt = customerDebtResponse.parse({
  usuario: "greyes@wifiplus",
  state: "owes",
  totalCents: 29900,
  invoiceCents: 0,
  carriedBalanceCents: 29900,
  invoices: [],
});

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
/* payment-method-per-channel D8: the WispHub screen's setup block, both
   lines created, so the browser measures the card — badges, copy fields,
   mono names — in both themes and at every width */
export const wisphubPaymentMethods = devoladaMethods.parse({
  checked: true,
  link: {
    name: "SPEI - LINK.DEVOLADAPAGO",
    description:
      "Pagos SPEI validados por link de Devolada (bancos, Spin, Mercado Pago, CoDi, DiMo). Los registra Devolada; no usar en mostrador.",
    status: "found",
  },
  network: {
    name: "CASH - RED.DEVOLADAPAGO",
    description: "Pagos en efectivo en tiendas de la red Devolada. Los registra Devolada; no usar en mostrador.",
    status: "missing",
  },
});

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
  /* cobros-in-links D1: the block carries `?limit=` (and `cursor`) */
  await apiRoute(page, "**/payment-requests*", cobros);
  await apiRoute(page, "**/direct-payments/customers/debt*", customerDebt);
  await apiRoute(page, "**/integrations", integrationsHub);
  await apiRoute(page, "**/integrations/api", apiIntegration);
  await apiRoute(page, "**/integrations/wisphub/payment-methods", wisphubPaymentMethods);
  await apiRoute(page, "**/direct-payments/customers*", customersBlock);
  /* links-on-demand-search D13: nothing to be told, which is what every
     business sees once the one-time cleanup has been dismissed */
  await apiRoute(page, "**/direct-payments/prune-notice", null);
  /* bug: invitee-lands-own-business: the shell asks for the invitations
     sent to the person signed in — none, which is what nearly everyone sees */
  await apiRoute(page, "**/businesses/invitations/mine", myInvitationsResponse.parse({ invitations: [] }));
  await apiRoute(page, "**/direct-payments/links", createdLink);
  await apiRoute(page, "**/v1/payment-links", apiPaymentLink);
}

/* cobros-in-links US3: a search in Por cobrar with both of a result's
   non-amount answers on screen — Sin adeudo and Sin confirmar — so a
   browser can measure the two badges in both themes (D15). Registered
   after `stubAdminApi`, so these handlers win for their patterns. */
export async function stubPorCobrarSearch(page: Page): Promise<void> {
  await stubAdminApi(page);
  /* Constitution III (cobros-in-links T047): parsed like every fixture
     here, so the search's block cannot drift from the contract */
  await apiRoute(page, "**/direct-payments/customers*", customersResponse.parse({
    results: [
      { ...customersBlock.results[0] },
      {
        ...customersBlock.results[0],
        usuario: "aflores@wifiplus",
        wisphubId: 7,
        name: "Abraham Flores",
        phone: null,
        hasLink: false,
        url: null,
        waLink: null,
      },
    ],
    nextCursor: null,
    matched: 2,
    total: null,
    wisphub: "ok",
  }));
  await page.route("**/direct-payments/customers/debt*", (route) => {
    const usuario = new URL(route.request().url()).searchParams.get("usuario") ?? "";
    return route.fulfill(
      envelope(
        customerDebtResponse.parse(
          usuario === "greyes@wifiplus"
            ? { usuario, state: "none", totalCents: 0, invoiceCents: 0, carriedBalanceCents: 0, invoices: [] }
            : { usuario, state: "unconfirmed" },
        ),
      ),
    );
  });
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

/* payment-without-receipt US2 (T051): the same link with the payer's own
   reference (contracts/payment-page.md), a returning payer's two banks and
   the business's usual ones — parsed, like every fixture here, so the
   stub cannot carry a shape the server would never send. Proven, so step 2
   opens straight on the bank and the day: those are the controls whose
   sizes, focus and contrast only a browser can measure. */
export const referenceLink = linkStatusResponse.parse({
  ...paymentLink,
  timezone: "America/Mexico_City",
  payerReference: { digits: "2345678", fromPhone: true, proven: true, previousDigits: null },
  learnedBanks: ["AZTECA", "NUBANK"],
  bankOrder: ["BBVA MEXICO", "AZTECA", "NUBANK"],
});

/* Registered after stubPagoApi: Playwright tries the newest route first.
   confirmation-hierarchy US5 (T041): the same link paid by a debit card or
   by a phone, the two kinds that show their bank beside the number */
export async function stubPagoReference(page: Page, kind: "clabe" | "card" | "phone" = "clabe"): Promise<void> {
  const collectAccount =
    kind === "card"
      ? { kind, value: "4152313412345678", bank: "BBVA MEXICO" }
      : kind === "phone"
        ? { kind, value: "5512345678", bank: "NU MEXICO" }
        : referenceLink.collectAccount;
  await apiRoute(page, "**/direct-payments/links/*", linkStatusResponse.parse({ ...referenceLink, collectAccount }));
}

/* confirmation-hierarchy US5 (T052): a payer back on a link with a
   reference whose attempt, confirmed by their own reference, is the one
   the link names — the page opens on the confirmed view */
export const confirmedOwn = directPaymentStatusResponse.parse({
  status: "confirmed",
  validationAttempts: 1,
  nextValidationAt: null,
  error: null,
  trackingKey: "MBAN01002609290012345678",
  senderBank: "AZTECA",
  transferDate: "2026-09-29",
  claimedAmountCents: 51400,
  referenceNumber: "2345678",
  referenceSource: "own",
  senderTail: null,
  searchedDays: ["2026-09-29"],
  ask: null,
  tieBreak: null,
  usedBy: null,
  folio: "DV-OWN",
});

export async function stubPagoConfirmedOwn(page: Page): Promise<void> {
  await apiRoute(
    page,
    "**/direct-payments/links/*",
    linkStatusResponse.parse({ ...referenceLink, inReview: { directPaymentId: "dp-1", status: "validating" } }),
  );
  await apiRoute(page, "**/direct-payments/*/status", confirmedOwn);
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

/* ---- cash-at-stores: the store app and the panel's new screens ----

   Every fixture parses with the API's own schema (constitution III), so a
   stub cannot hand the browser a shape the API never sends — a phone in a
   search row fails here, at `.parse`, not in a screenshot. */

const storeAt = Date.UTC(2026, 9, 1, 20, 35);

export const storeMe = storeMeResponse.parse({
  type: "store",
  storeId: "store-1",
  name: "Abarrotes Lupita",
  businessName: "WiFi Plus",
  /* passwordless-access D8: the store account's own address, where Caja's
     step-up sends its código */
  email: "lupita@correo.mx",
});

export const storeSearch = storeSearchResponse.parse({
  rows: [
    { usuario: "greyes@wifiplus", name: "Guadalupe Reyes Hernández", zone: "Centro" },
    { usuario: "gruiz@wifiplus", name: "Gabriel Ruiz", zone: null },
  ],
  more: true,
  integration: "ok",
});

export const storeQuote = storeQuoteResponse.parse({
  state: "owes",
  usuario: "greyes@wifiplus",
  name: "Guadalupe Reyes Hernández",
  zone: "Centro",
  debtCents: 79800,
  invoiceCents: 49900,
  carriedBalanceCents: 29900,
  feeCents: 1500,
  totalCents: 81300,
  reconnectsFromCents: 79800,
});

export const storeCollection = (outcome: "reconnected" | "queued" = "reconnected") =>
  collectionStatusResponse.parse({
    id: "pay-1",
    folio: "DV-7K2Q9M",
    createdAt: storeAt,
    businessName: "WiFi Plus",
    customerName: "Guadalupe Reyes Hernández",
    amountCents: 50000,
    feeCents: 1500,
    class: "short",
    remainingCents: 29800,
    outcome,
    /* T071: the verdict decided a reconnection (the threshold is lenient here) */
    reconnects: true,
  });

export const storeReceipt = collectionReceiptResponse.parse({
  text: "Comprobante de pago · WiFi Plus\n\nFolio: DV-7K2Q9M",
  waLink: "https://wa.me/?text=Comprobante",
  hasPhone: false,
});

export const storeCashbox = cashboxResponse.parse({
  businesses: [
    {
      businessId: "business-1",
      businessName: "WiFi Plus",
      heldCents: 435000,
      feesSinceHandoverCents: 4500,
      feesSince: storeAt - 7 * 86_400_000,
      lastHandover: { cents: 150000, status: "disputed", at: storeAt - 3 * 86_400_000, note: "Faltaron $200 en el sobre" },
      pendingHandover: null,
    },
  ],
});

export const storeLedger = storeLedgerResponse.parse({
  rows: [
    { id: "l1", kind: "collection", cents: 50000, at: storeAt, businessId: "business-1", businessName: "WiFi Plus", folio: "DV-7K2Q9M", customerName: "Guadalupe Reyes Hernández", feeCents: 1500, reason: null },
    { id: "l2", kind: "handover", cents: -150000, at: storeAt - 86_400_000, businessId: "business-1", businessName: "WiFi Plus", folio: null, customerName: null, feeCents: null, reason: null },
    { id: "l3", kind: "correction", cents: -5000, at: storeAt - 2 * 86_400_000, businessId: "business-1", businessName: "WiFi Plus", folio: "DV-3M8P1Q", customerName: null, feeCents: null, reason: "Se capturó $50 de más" },
  ],
  nextCursor: "next",
});

/* The store app, signed in, at every screen of the counter and the cash
   book. `collection` picks the result screen's outcome: `queued` keeps it
   waiting, which is what the motion layer measures. */
/* cash-at-stores T080: the store's own hand-overs, a dispute among them */
export const storeHandovers = storeHandoversResponse.parse({
  businessName: "WiFi Plus",
  handovers: [
    { id: "h2", cents: 150000, status: "confirmed", declaredAt: storeAt - 2 * 86_400_000, resolvedAt: storeAt - 86_400_000, note: null },
    { id: "h1", cents: 200000, status: "disputed", declaredAt: storeAt - 9 * 86_400_000, resolvedAt: storeAt - 8 * 86_400_000, note: "Faltaron $200 en el sobre" },
  ],
  nextCursor: null,
});

export async function stubRedApi(page: Page, opts: { collection?: "reconnected" | "queued" } = {}): Promise<void> {
  await apiRoute(page, "**/auth/me", storeMe);
  /* `*` never crosses a slash: this is the search, never the debt */
  await apiRoute(page, "**/store/customers*", storeSearch);
  await apiRoute(page, "**/store/customers/debt*", storeQuote);
  await apiRoute(page, "**/store/collections", recordCollectionResponse.parse({ id: "pay-1", folio: "DV-7K2Q9M" }));
  await apiRoute(page, "**/store/collections/pay-1", storeCollection(opts.collection));
  await apiRoute(page, "**/store/collections/pay-1/receipt", storeReceipt);
  await apiRoute(page, "**/store/cashbox", storeCashbox);
  await apiRoute(page, "**/store/ledger*", storeLedger);
  await apiRoute(page, "**/store/handovers", declareHandoverResponse.parse({ id: "h9", status: "pending" }));
  await apiRoute(page, "**/store/handovers?*", storeHandovers);
  await apiRoute(
    page,
    "**/store/invitations/*",
    invitationPreviewResponse.parse({ state: "open", storeName: "Abarrotes Lupita", phoneTail: "5678" }),
  );
  /* passwordless-access FR-036: Caja's card lists the store's keys on every
     device, so every screen that reaches /caja meets the list */
  await baRoute(page, "**/auth/passkey/list-user-passkeys", storeKeys);
}

/* A business that has had cash at stores (D7): Pagos offers the channel
   filter and the menu shows Puntos de pago */
export const storeChannelActor = { ...businessActor, storeChannel: { on: true, since: storeAt - 30 * 86_400_000 } };

/* cash-at-stores T051: a cash row among the SPEI ones, with its fee and a
   correction, parsed by the changed contract */
export const storeFeed = feedResponse.parse({
  ...feed,
  payments: [
    {
      ...feed.payments[1],
      id: "ch-cash",
      folio: "DV-CASH01",
      channel: "store",
      customerName: "Mario Pérez Castañeda",
      storeName: "Abarrotes Lupita",
      receivedCents: 49900,
      askedCents: 49900,
      serviceFeeCents: 0,
      storeFeeCents: 1500,
      corrections: [{ cents: -5000, reason: "Se capturó $50 de más", author: "operador@devolada.app", at: at + 60_000 }],
      createdAt: at + 120_000,
    },
    ...feed.payments,
  ],
});

export async function stubAdminStoreApi(page: Page): Promise<void> {
  await stubAdminApi(page);
  await apiRoute(page, "**/auth/me", storeChannelActor);
  await apiRoute(page, "**/payments/feed*", storeFeed);
}

export const cashPoints = cashPointsResponse.parse({
  channelOn: true,
  stores: [
    {
      storeId: "s1",
      storeName: "Abarrotes Lupita",
      address: "Av. Benito Juárez 1250, Col. Centro, Tlaquepaque",
      storeStatus: "active",
      heldCents: 435000,
      lastConfirmed: { cents: 150000, at: storeAt - 7 * 86_400_000 },
      pending: { id: "h1", cents: 200000, declaredAt: storeAt },
    },
    {
      storeId: "s2",
      storeName: "Papelería El Sol",
      address: "Calle 5 de Mayo 40",
      storeStatus: "suspended",
      heldCents: 30000,
      lastConfirmed: null,
      pending: null,
    },
  ],
});

export const handoverHistory = handoverHistoryResponse.parse({
  handovers: [
    { id: "h0", storeId: "s1", cents: 150000, status: "disputed", note: "Faltaron $200 en el sobre", declaredAt: storeAt - 86_400_000, resolvedAt: storeAt - 80_000_000, resolvedBy: "owner@isp.mx" },
    { id: "h-1", storeId: "s1", cents: 150000, status: "confirmed", note: null, declaredAt: storeAt - 7 * 86_400_000, resolvedAt: storeAt - 7 * 86_400_000, resolvedBy: "owner@isp.mx" },
  ],
  nextCursor: null,
});

export async function stubCashPointsApi(page: Page): Promise<void> {
  await stubAdminStoreApi(page);
  await apiRoute(page, "**/cash-points", cashPoints);
  await apiRoute(page, "**/cash-points/stores/*/history*", handoverHistory);
  await apiRoute(page, "**/cash-points/handovers/*/confirm", { id: "h1", status: "confirmed" });
  await apiRoute(page, "**/cash-points/handovers/*/dispute", { id: "h1", status: "disputed" });
}

export const platformStores = storesListResponse.parse({
  stores: [
    {
      id: "s1",
      name: "Abarrotes Lupita",
      address: "Av. Benito Juárez 1250, Col. Centro, Tlaquepaque",
      shopkeeperName: "Guadalupe Reyes",
      phone: "5512345678",
      status: "active",
      createdAt: storeAt,
      collectsFor: [{ businessId: "business-1", businessName: "WiFi Plus", heldCents: 435000 }],
    },
    { id: "s2", name: "Papelería El Sol", address: "Calle 5 de Mayo 40", shopkeeperName: "Rosa Díaz", phone: "5587654321", status: "invited", createdAt: storeAt, collectsFor: [] },
    { id: "s3", name: "Farmacia Luz", address: "Calle Hidalgo 3", shopkeeperName: "Luis Pérez", phone: "5511112222", status: "suspended", createdAt: storeAt, collectsFor: [] },
  ],
});

export const platformStoreLedger = platformLedgerResponse.parse({
  heldCents: 435000,
  nextCursor: null,
  rows: [
    { id: "l1", kind: "collection", cents: 50000, at: storeAt, businessId: "business-1", businessName: "WiFi Plus", folio: "DV-7K2Q9M", customerName: "Guadalupe Reyes", feeCents: 1500, reason: null, paymentId: "p1", authorEmail: null },
    { id: "l3", kind: "correction", cents: -5000, at: storeAt - 1, businessId: "business-1", businessName: "WiFi Plus", folio: "DV-3M8P1Q", customerName: null, feeCents: null, reason: "Se capturó $50 de más", paymentId: "p0", authorEmail: "operador@devolada.app" },
  ],
});

export const storeSettings = settingsListResponse.parse({
  settings: [
    { key: "store_fee_cents", type: "cents", birth: "1500", current: "1500", history: [] },
    { key: "store_receipt_template", type: "template", birth: DEFAULT_RECEIPT_TEMPLATE, current: DEFAULT_RECEIPT_TEMPLATE, history: [] },
  ],
});

export async function stubOperatorStoresApi(page: Page): Promise<void> {
  await stubAdminApi(page);
  await apiRoute(page, "**/auth/me", { ...businessActor, platformOperator: true });
  await apiRoute(page, "**/platform/settings", storeSettings);
  await apiRoute(page, "**/platform/provider-quota", null);
  await apiRoute(page, "**/platform/stores", platformStores);
  await apiRoute(page, "**/platform/stores/*/ledger/*", platformStoreLedger);
}

/* passwordless-access T051 (constitution IV): the access screens, in the
   browser. Better Auth's endpoints answer in their own shapes — no
   envelope, as `baPost` expects (better-auth D6) — and the invitation
   preview is ours, parsed through its contract. */
async function baRoute(page: Page, pattern: string, data: unknown): Promise<void> {
  await page.route(pattern, (route) => {
    if (route.request().resourceType() === "document") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
}

export const accessUser = { id: "user-1", name: "Ana López", email: "ana@negocio.mx", emailVerified: true };

export const memberInvitation = (hasAccount: boolean) =>
  memberInvitationPreviewResponse.parse({
    status: "pending",
    businessName: "WifiPlus Norte",
    role: "operator",
    email: "ana@negocio.mx",
    hasAccount,
  });

export const accessKeys = [
  { id: "pk-1", name: "iPhone de Ana", createdAt: "2026-09-20T10:00:00.000Z", backedUp: true, deviceType: "multiDevice" },
  { id: "pk-2", name: null, createdAt: "2026-10-01T10:00:00.000Z", backedUp: false, deviceType: "singleDevice" },
];

export type AccessDevice = "verifies" | "passkeys-only" | "none";

/* D7: what the browser can do. Chromium has passkeys but, without a
   virtual authenticator, no built-in way to verify the person — so the
   device is set here, before the app loads. `none` is the browser without
   WebAuthn at all (US3). */
export async function setAccessDevice(page: Page, device: AccessDevice): Promise<void> {
  await page.addInitScript((kind) => {
    const w = window as unknown as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } };
    if (kind === "none") {
      delete w.PublicKeyCredential;
      return;
    }
    if (w.PublicKeyCredential) {
      w.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => kind === "verifies";
    }
  }, device);
}

export async function stubAccessApi(
  page: Page,
  opts: { user?: typeof accessUser | null; hasAccount?: boolean; device?: AccessDevice } = {},
): Promise<void> {
  await setAccessDevice(page, opts.device ?? "verifies");
  const user = opts.user === undefined ? null : opts.user;
  await baRoute(page, "**/auth/get-session", user ? { user, session: { id: "s-1", userId: user.id } } : null);
  /* /welcome reads the business actor beside the session before it
     decides, and says a read that got no answer instead of deciding on it
     (adversarial review, 2026-10-02): a signed-in person here is a member
     of the business */
  if (user) await apiRoute(page, "**/auth/me", { ...businessActor, userId: user.id, userName: user.name });
  await baRoute(page, "**/auth/email-otp/send-verification-otp", { success: true });
  await baRoute(page, "**/auth/sign-in/email-otp", { token: "t", user: accessUser });
  await baRoute(page, "**/auth/update-user", { status: true });
  await baRoute(page, "**/auth/revoke-other-sessions", { status: true });
  await baRoute(page, "**/auth/passkey/list-user-passkeys", accessKeys);
  await apiRoute(page, "**/businesses/invitations/*/preview", memberInvitation(opts.hasAccount ?? true));
  await stubAcceptAsNew(page);
}

/* The new person, inside the business the invitation names: the business
   actor accept-new answers with, as /auth/me's */
export const inviteeActor = {
  ...businessActor,
  name: "WifiPlus Norte",
  role: "operator",
  userId: accessUser.id,
  userName: accessUser.name,
  businesses: [{ id: "business-1", orgId: "org_business-1", name: "WifiPlus Norte", role: "operator" }],
};

/* passwordless-access D9 as amended 2026-10-03 (spec Clarifications Q5;
   contracts/panel-access.md § accept-new): the new person's second step
   posts the name and the código sent to the invited address. The body is
   read through the request's own contract, so a page that posts no código
   — the retired name-and-id-alone shape — meets the server's VALIDATION
   (400, in the envelope), never a welcome. A good one answers 201 with the
   business actor. */
async function stubAcceptAsNew(page: Page): Promise<void> {
  await page.route("**/businesses/invitations/*/accept-new", (route) => {
    if (route.request().resourceType() === "document") return route.fallback();
    if (!acceptInvitationNewRequest.safeParse(route.request().postDataJSON()).success) {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: { code: "VALIDATION" } }),
      });
    }
    return route.fulfill({ ...envelope(inviteeActor), status: 201 });
  });
}

/* Seguridad: the panel around the keys card */
export async function stubSecurityApi(page: Page): Promise<void> {
  await stubAdminApi(page);
  await stubAccessApi(page, { user: accessUser });
}

type AccessScreen = {
  name: string;
  url: string;
  stub: (page: Page) => Promise<void>;
  open?: (page: Page) => Promise<void>;
  ready: string;
  /* the access pages promise 48 px controls; Seguridad is the desktop-first panel */
  touch: boolean;
};

const askCode = async (page: Page) => {
  await page.getByLabel("Correo").fill("ana@negocio.mx");
  await page.getByRole("button", { name: "Enviar código" }).click();
};
const register = async (page: Page) => {
  await page.getByLabel("Tu nombre").fill("Ana López");
  await page.getByLabel("Correo").fill("ana@negocio.mx");
  await page.getByRole("button", { name: "Continuar" }).click();
};
/* the invitation's address is text, never typed (better-auth D14) */
const joinAsNew = async (page: Page) => {
  await page.getByLabel("Tu nombre").fill("Ana López");
  await page.getByRole("button", { name: "Continuar" }).click();
};

export const accessScreens = (ADMIN: string): AccessScreen[] => [
  { name: "Entrar", url: `${ADMIN}/login`, stub: (p) => stubAccessApi(p), ready: "o con un código", touch: true },
  { name: "Entrar · código", url: `${ADMIN}/login`, stub: (p) => stubAccessApi(p), open: askCode, ready: "Escribe tu código", touch: true },
  { name: "Entrar sin huella", url: `${ADMIN}/login`, stub: (p) => stubAccessApi(p, { device: "none" }), ready: "Enviar código", touch: true },
  { name: "Crear cuenta", url: `${ADMIN}/signup`, stub: (p) => stubAccessApi(p), ready: "Ya tengo cuenta", touch: true },
  { name: "Crear cuenta · código", url: `${ADMIN}/signup`, stub: (p) => stubAccessApi(p), open: register, ready: "Escribe tu código", touch: true },
  { name: "Crear cuenta sin huella", url: `${ADMIN}/signup`, stub: (p) => stubAccessApi(p, { device: "none" }), ready: "Ya tengo cuenta", touch: true },
  {
    name: "Bienvenida · nombre",
    url: `${ADMIN}/welcome?next=/`,
    stub: (p) => stubAccessApi(p, { user: { ...accessUser, name: "" } }),
    ready: "¿Cómo te llamas?",
    touch: true,
  },
  {
    name: "Bienvenida · huella o rostro",
    url: `${ADMIN}/welcome?next=/`,
    stub: (p) => stubAccessApi(p, { user: accessUser }),
    ready: "Activar huella o rostro",
    touch: true,
  },
  { name: "Invitación · cuenta", url: `${ADMIN}/invitaciones/inv-1`, stub: (p) => stubAccessApi(p), ready: "Enviarme un código", touch: true },
  {
    name: "Invitación · código",
    url: `${ADMIN}/invitaciones/inv-1`,
    stub: (p) => stubAccessApi(p),
    open: (p) => p.getByRole("button", { name: "Enviarme un código" }).click(),
    ready: "Reenviar código",
    touch: true,
  },
  /* A new person's two steps (D9 as amended 2026-10-03): the name, then
     the código sent to the invited address, which opens only once it was
     sent */
  {
    name: "Invitación · persona nueva",
    url: `${ADMIN}/invitaciones/inv-1`,
    stub: (p) => stubAccessApi(p, { hasAccount: false }),
    ready: "Continuar",
    touch: true,
  },
  {
    name: "Invitación · persona nueva · código",
    url: `${ADMIN}/invitaciones/inv-1`,
    stub: (p) => stubAccessApi(p, { hasAccount: false }),
    open: joinAsNew,
    ready: "Reenviar código",
    touch: true,
  },
  { name: "Seguridad", url: `${ADMIN}/settings/security`, stub: stubSecurityApi, ready: "Cerrar sesión en los demás dispositivos", touch: false },
];

/* passwordless-access T074 (US6; constitution IV): the store app's ways in,
   in the browser. The four store routes answer in the envelope, their
   fixtures parsed through the contract (contracts/store-access.md); Better
   Auth's own endpoints — Caja's list, "Quitar", the step-up and "Cerrar
   sesión en los demás dispositivos" — answer raw, as `baPost` and `baGet`
   expect (better-auth D6). The store's keys are named "Tienda" (D10). */
export const storeKeys = [
  { id: "pk-s1", name: "Tienda", createdAt: "2026-09-28T16:00:00.000Z", backedUp: true, deviceType: "multiDevice" },
];

export async function stubStoreAccessApi(page: Page, opts: { device?: AccessDevice } = {}): Promise<void> {
  await setAccessDevice(page, opts.device ?? "verifies");
  await stubRedApi(page);
  await apiRoute(page, "**/store/invitations/*/code", storeInvitationCodeResponse.parse({ sentTo: "lupita@correo.mx" }));
  await apiRoute(page, "**/store/invitations/*/accept", acceptStoreInvitationResponse.parse({ storeName: "Abarrotes Lupita" }));
  await apiRoute(page, "**/store/sign-in/code", storeSignInCodeResponse.parse({ sent: true }));
  await apiRoute(page, "**/store/sign-in", storeSignInResponse.parse({ storeName: "Abarrotes Lupita" }));
  await baRoute(page, "**/auth/email-otp/send-verification-otp", { success: true });
  await baRoute(page, "**/auth/sign-in/email-otp", { token: "t", user: { ...accessUser, email: storeMe.email } });
  await baRoute(page, "**/auth/revoke-other-sessions", { status: true });
  await baRoute(page, "**/auth/passkey/delete-passkey", { status: true });
}

/* `decisive`: the screen's committing action, measured at 64 px
   (contracts/store-access.md § UI: 48 px standard, 64 px decisive) */
type StoreAccessScreen = AccessScreen & { decisive?: string };

const askStoreCode = async (page: Page) => {
  await page.getByLabel("Tu teléfono").fill("55 1234 5678");
  await page.getByRole("button", { name: "Enviar código" }).click();
};
const giveStoreEmail = async (page: Page) => {
  await page.getByLabel("Tu correo").fill("lupita@correo.mx");
  await page.getByRole("button", { name: "Continuar" }).click();
};
const acceptWithCode = async (page: Page) => {
  await giveStoreEmail(page);
  await page.getByLabel("Código").fill("482913");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
};

/* /entrar's two steps and the device without passkey support, the
   invitation's three steps — the third only where the device can verify
   the person (D7) — and Caja's keys card (FR-036). Every one is a phone
   screen first, so every control is held to 48 px. */
export const storeAccessScreens = (RED: string): StoreAccessScreen[] => [
  { name: "Tienda · entrar", url: `${RED}/entrar`, stub: (p) => stubStoreAccessApi(p), ready: "o con un código", touch: true },
  {
    name: "Tienda · entrar · código",
    url: `${RED}/entrar`,
    stub: (p) => stubStoreAccessApi(p),
    open: askStoreCode,
    ready: "Usar otro teléfono",
    touch: true,
  },
  {
    name: "Tienda · entrar sin huella",
    url: `${RED}/entrar`,
    stub: (p) => stubStoreAccessApi(p, { device: "none" }),
    ready: "Enviar código",
    touch: true,
  },
  {
    name: "Tienda · invitación · correo",
    url: `${RED}/invitacion/tok-1`,
    stub: (p) => stubStoreAccessApi(p),
    ready: "Entrarás con tu huella o rostro, o con un código que te enviamos a tu correo.",
    touch: true,
  },
  {
    name: "Tienda · invitación · código",
    url: `${RED}/invitacion/tok-1`,
    stub: (p) => stubStoreAccessApi(p),
    open: giveStoreEmail,
    ready: "Usar otro correo",
    touch: true,
  },
  {
    name: "Tienda · invitación · huella o rostro",
    url: `${RED}/invitacion/tok-1`,
    stub: (p) => stubStoreAccessApi(p, { device: "verifies" }),
    open: acceptWithCode,
    ready: "Activar huella o rostro",
    touch: true,
    decisive: "Activar huella o rostro",
  },
  {
    name: "Tienda · Caja · llaves",
    url: `${RED}/caja`,
    stub: (p) => stubStoreAccessApi(p, { device: "verifies" }),
    /* The card sits at the foot of Caja, where a person scrolls to reach it.
       Measured 2026-10-02: at 768 px and the top of the page, the "Cerrar
       sesión" below the card peeks 17 px out from under the sticky tab bar,
       and axe's target-size reads that slice as the button; scrolled to the
       card, nothing is under the bar at any width. */
    open: async (p) => {
      await p.getByText("Cerrar sesión en los demás dispositivos").waitFor();
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    },
    ready: "Cerrar sesión en los demás dispositivos",
    touch: true,
  },
];

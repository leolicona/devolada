import type { Page } from "@playwright/test";

/* The API, stubbed at the network edge. Same discipline as MSW in the
   component layer: the shapes come from the real contracts, so a stub
   cannot drift into fiction the app would never receive. */

const envelope = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

/* The app is served from the same origin it calls, so a glob for the
   cashbox endpoint also matches the browser navigating to the /cashbox
   page. Fulfilling that navigation hands the browser JSON instead of the
   app, and the screen never renders. Documents always pass through. */
async function apiRoute(page: Page, pattern: string, data: unknown): Promise<void> {
  await page.route(pattern, (route) => {
    if (route.request().resourceType() === "document") return route.fallback();
    return route.fulfill(envelope(data));
  });
}

export const storeActor = {
  type: "store",
  id: "st-1",
  ispId: "isp-1",
  name: "Abarrotes La Esquina",
  phone: "5512345678",
  status: "active",
};

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
};

const at = Date.UTC(2026, 7, 14, 20, 30);

export const cashbox = {
  storeName: "Abarrotes La Esquina",
  balanceCents: 91000,
  commissionEarnedCents: 1800,
  cap: { capCents: 500000, approaching: false, blocked: false },
  lastCashDrop: { id: "d1", cents: 40000, status: "pending", note: null, createdAt: at },
};

export const feed = {
  charges: [
    {
      id: "ch-1",
      folio: "DV-FEED01",
      reconnectionStatus: "failed",
      totalCents: 41400,
      monthlyFeeCents: 39900,
      serviceFeeCents: 1500,
      customerName: "Janely Guadalupe Reyes",
      storeName: "Abarrotes La Esquina",
      createdAt: at,
      reconnectedAt: null,
      attempts: 3,
      lastError: "WISPHUB_UNAVAILABLE",
    },
    {
      id: "ch-2",
      folio: "DV-FEED02",
      reconnectionStatus: "reconnected",
      totalCents: 51400,
      monthlyFeeCents: 49900,
      serviceFeeCents: 1500,
      customerName: "Abraham Flores",
      storeName: "Miscelánea Lupita",
      createdAt: at - 3_600_000,
      reconnectedAt: at - 3_500_000,
      attempts: 1,
      lastError: null,
    },
  ],
  nextCursor: null,
  today: { count: 2, totalCents: 92800, startedAtMs: Date.UTC(2026, 7, 14, 6) },
};

export const stores = {
  stores: [
    {
      id: "st-1",
      name: "Abarrotes La Esquina",
      contactName: "Don Chuy",
      phone: "5512345678",
      zone: "Col. El Mirador",
      status: "active",
      invitationStatus: "accepted",
      commissionCents: null,
      balanceCents: 89100,
      cap: { capCents: 100000, approaching: true, blocked: false },
    },
  ],
};

export const pendingDrops = {
  drops: [
    {
      id: "cd-1",
      storeId: "st-1",
      storeName: "Abarrotes La Esquina",
      storeZone: "Col. El Mirador",
      cents: 50600,
      status: "pending",
      note: null,
      createdAt: at,
      confirmedAt: null,
      storeBalanceCents: 50600,
    },
  ],
  nextCursor: null,
};

/* The confirmed side of Entregas: the history list renders these, and a
   long store name is the point — a row that cannot show it is the bug
   design-review D1 describes. */
export const resolvedDrops = {
  drops: [
    {
      id: "cd-0",
      storeId: "st-1",
      storeName: "Abarrotes La Esquina",
      storeZone: "Col. El Mirador",
      cents: 40000,
      status: "confirmed",
      note: null,
      createdAt: at - 86_400_000,
      confirmedAt: at - 80_000_000,
      storeBalanceCents: 0,
    },
  ],
  nextCursor: null,
};

export const ledger = {
  entries: [
    {
      id: "e1",
      type: "charge",
      cents: 41400,
      createdAt: at,
      reference: { folio: "DV-FEED01", customerName: "Janely Guadalupe Reyes" },
    },
    { id: "e2", type: "commission", cents: -900, createdAt: at, reference: null },
  ],
  nextCursor: null,
};

/* The charge path's two screens. A long real name is the point: it is
   what the confirm screen exists to show (design-review D1). */
export const customers = {
  customers: [
    {
      wisphubId: 6,
      usuario: "greyes@wifiplus",
      name: "Janely Guadalupe Reyes",
      zone: "Zona dia 15",
      serviceStatus: "suspended",
      billingStatus: "due",
      monthlyFeeCents: 49900,
      /* This customer has a number in WispHub (customer-phone US-C07),
         like the unit fixtures' default. Missing here, it read as
         `undefined` and the confirm screen offered the optional capture
         field, which then took the first tab stop away from the charge
         button and failed the keyboard walk. */
      hasPhone: true,
    },
  ],
};

export const quote = {
  customer: customers.customers[0],
  quote: { monthlyFeeCents: 49900, serviceFeeCents: 1500, totalCents: 51400 },
  cap: { balanceCents: 91000, capCents: 500000, blocked: false },
};

/* One matcher per app: anything the screens ask for gets an answer, so a
   forgotten route shows up as an empty screen rather than a hang. */
export async function stubStoreApi(page: Page): Promise<void> {
  await apiRoute(page, "**/auth/me", storeActor);
  await apiRoute(page, "**/cashbox", cashbox);
  await apiRoute(page, "**/ledger*", ledger);
  /* Newest-first matching: the list, then the detail that shadows it */
  await page.route(
    (url) => url.pathname.endsWith("/charges/customers"),
    (route) =>
      route.request().resourceType() === "document"
        ? route.fallback()
        : route.fulfill(envelope(customers)),
  );
  await page.route(
    (url) => /\/charges\/customers\/[^/]+$/.test(url.pathname),
    (route) =>
      route.request().resourceType() === "document"
        ? route.fallback()
        : route.fulfill(envelope(quote)),
  );
}

export async function stubAdminApi(page: Page): Promise<void> {
  await apiRoute(page, "**/auth/me", ispActor);
  await apiRoute(page, "**/charges/feed*", feed);
  await apiRoute(page, "**/stores", stores);
  await apiRoute(page, "**/cash-drops*", pendingDrops);
  /* Registered last so it wins over the pending matcher: Playwright tries
     routes newest-first. */
  await page.route(
    (url) => url.pathname.endsWith("/cash-drops") && url.search.includes("scope=resolved"),
    (route) =>
      route.request().resourceType() === "document"
        ? route.fallback()
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ success: true, data: resolvedDrops }),
          }),
  );
}

/* The customer's payment page (direct-payment D9): no session, so the
   only stubs are the link and the proof pipeline behind it. */
export const paymentLink = {
  ispName: "WifiPlus",
  customerName: "Janely Reyes",
  status: "debt",
  monthlyFeeCents: 49900,
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
  /* Unresolved on purpose: it is what opens the confirmation screen
     instead of paying silently (D18). */
  senderBank: null,
  date: "2026-08-19",
  receiptStatus: "Aceptada",
  gate: { trackingKey: "ok", senderBank: "unresolved", amount: "ok" },
};

export async function stubPagoApi(page: Page): Promise<void> {
  await apiRoute(page, "**/direct-payments/links/*", paymentLink);
  await apiRoute(page, "**/direct-payments/links/*/proof", { proofId: "link-1/proof-1" });
  await apiRoute(page, "**/direct-payments/links/*/read", proofReading);
}

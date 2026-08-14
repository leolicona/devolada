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

/* One matcher per app: anything the screens ask for gets an answer, so a
   forgotten route shows up as an empty screen rather than a hang. */
export async function stubStoreApi(page: Page): Promise<void> {
  await apiRoute(page, "**/auth/me", storeActor);
  await apiRoute(page, "**/cashbox", cashbox);
  await apiRoute(page, "**/ledger*", ledger);
}

export async function stubAdminApi(page: Page): Promise<void> {
  await apiRoute(page, "**/auth/me", ispActor);
  await apiRoute(page, "**/charges/feed*", feed);
  await apiRoute(page, "**/stores", stores);
  await apiRoute(page, "**/cash-drops*", pendingDrops);
}

import { expect, test, type Page } from "@playwright/test";
import { ADMIN, PAGO, TIENDA } from "../../playwright.config";
import { ispActor, storeActor } from "../e2e/stubs";

/* Design-review captures for PRs #81–#83 (debt-truth + partial payment).
   The shared stubs in e2e/stubs.ts still speak the pre-#82 wire shape
   (monthlyFeeCents, no channel), so the states these PRs added carry
   their own fixtures here, in the post-#82 shape the apps actually read.
   Run just this file:
   pnpm exec playwright test --config playwright.review.config.ts tests/design/review-pr81-83.spec.ts */

const OUT = ".design/devolada/screenshots";

const envelope = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

function json(page: Page, match: (url: URL) => boolean, data: unknown) {
  return page.route(
    (url) => match(url),
    (route) =>
      route.request().resourceType() === "document"
        ? route.fallback()
        : route.fulfill(envelope(data)),
  );
}

/* ——— debt-truth fixtures: a customer carrying a balance ——— */

const janely = {
  wisphubId: 6,
  usuario: "greyes@wifiplus",
  name: "Janely Guadalupe Reyes",
  zone: "Zona dia 15",
  serviceStatus: "suspended",
  billingStatus: "due",
  invoiceCents: 49900,
  carriedBalanceCents: 15000,
  hasPhone: true,
};

const customers = {
  customers: [
    janely,
    {
      wisphubId: 9,
      usuario: "aflores@wifiplus",
      name: "Abraham Flores Montiel",
      zone: "Col. El Mirador",
      serviceStatus: "active",
      billingStatus: "due",
      invoiceCents: 39900,
      carriedBalanceCents: 0,
      hasPhone: true,
    },
  ],
};

const quote = {
  customer: janely,
  quote: { invoiceCents: 49900, carriedBalanceCents: 15000, serviceFeeCents: 1500, totalCents: 66400 },
  cap: { balanceCents: 91000, capCents: 500000, blocked: false },
};

/* ——— admin feed: a partial spei charge (withheld) beside a store
   charge that collected a carried balance ——— */

const at = Date.UTC(2026, 7, 24, 20, 30);

const feed = {
  charges: [
    {
      id: "ch-p1",
      folio: "DV-PARC01",
      channel: "spei",
      reconnectionStatus: "withheld",
      totalCents: 30000,
      invoiceCents: 49900,
      carriedBalanceCents: 0,
      serviceFeeCents: 1500,
      customerName: "Janely Guadalupe Reyes",
      storeName: null,
      createdAt: at,
      reconnectedAt: null,
      attempts: 1,
      lastError: null,
    },
    {
      id: "ch-s1",
      folio: "DV-FEED02",
      channel: "store",
      reconnectionStatus: "reconnected",
      totalCents: 66400,
      invoiceCents: 49900,
      carriedBalanceCents: 15000,
      serviceFeeCents: 1500,
      customerName: "Abraham Flores Montiel",
      storeName: "Abarrotes La Esquina",
      createdAt: at - 3_600_000,
      reconnectedAt: at - 3_500_000,
      attempts: 1,
      lastError: null,
    },
  ],
  nextCursor: null,
  today: { count: 2, totalCents: 96400, startedAtMs: Date.UTC(2026, 7, 24, 6) },
};

/* ——— pago: a link whose debt carries a balance ——— */

const link = {
  ispName: "WifiPlus",
  customerName: "Janely Reyes",
  status: "debt",
  invoiceCents: 49900,
  carriedBalanceCents: 15000,
  serviceFeeCents: 1500,
  totalCents: 66400,
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "WifiPlus SA de CV",
  reference: "greyes@wifiplus",
};

const partialStatus = {
  status: "partial",
  receivedCents: 49900,
  debtCents: 64900,
  missingCents: 15000,
  reconnectionStatus: "withheld",
  folio: "DV-PARC01",
  validationAttempts: 1,
  error: null,
  trackingKey: null,
  senderBank: null,
  transferDate: null,
  receiptStatus: null,
};

/* A reading whose gates pass but whose amount falls short of the debt:
   valid per partial-payment D1/D12, it submits and lands as `partial`. */
const shortReading = {
  source: "reader",
  isReceipt: true,
  amountCents: 49900,
  trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
  senderBank: "NUBANK",
  date: "2026-08-24",
  receiptStatus: "Aceptada",
  gate: { trackingKey: "ok", senderBank: "ok", amount: "ok" },
};

/* A reading claiming more than the debt: a misread, still refused. */
const overReading = { ...shortReading, amountCents: 80000 };

async function stubTienda(page: Page) {
  await json(page, (u) => u.pathname.endsWith("/auth/me"), storeActor);
  await json(page, (u) => /\/charges\/customers\/[^/]+$/.test(u.pathname), quote);
  await json(page, (u) => u.pathname.endsWith("/charges/customers"), customers);
}

const adminSettings = {
  serviceFeeCents: 1500,
  storeCommissionCents: 900,
  platformShareCents: 600,
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphub: { configured: true, keyTail: "9f3a" },
  spei: {
    clabe: "646180157000000004",
    bank: "STP",
    beneficiaryName: "WifiPlus SA de CV",
    serviceFeeCents: null,
    effectiveServiceFeeCents: 1500,
    bankUnknown: false,
    configured: true,
  },
  reconnection: { thresholdPercent: 100, floorCents: 0 },
};

async function stubAdmin(page: Page) {
  await json(page, (u) => u.pathname.endsWith("/auth/me"), ispActor);
  await json(page, (u) => u.pathname.includes("/charges/feed"), feed);
  await json(page, (u) => u.pathname.endsWith("/settings"), adminSettings);
  await json(page, (u) => u.pathname.endsWith("/settlement"), { months: [] });
}

async function stubPago(page: Page, reading: object = shortReading) {
  await json(page, (u) => /\/direct-payments\/links\/[^/]+$/.test(u.pathname), link);
  await json(page, (u) => u.pathname.endsWith("/proof"), { proofId: "lk-1/proof-1" });
  await json(page, (u) => u.pathname.endsWith("/read"), reading);
  await page.route(
    (u) => u.pathname.endsWith("/pay"),
    (route) =>
      route.request().resourceType() === "document"
        ? route.fallback()
        : route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
              success: true,
              data: { directPaymentId: "dp-rev-1", status: "validating", error: null },
            }),
          }),
  );
  await json(page, (u) => /\/direct-payments\/[^/]+\/status$/.test(u.pathname), partialStatus);
}

type Shot = {
  slug: string;
  url: string;
  stub: (page: Page) => Promise<void>;
  ready: string | RegExp;
  act?: (page: Page) => Promise<void>;
  widths: number[];
};

const shots: Shot[] = [
  {
    slug: "tienda-buscar-adeudo",
    url: TIENDA,
    stub: stubTienda,
    ready: "Buscar cliente",
    widths: [375],
    act: async (page) => {
      await page.getByLabel("Buscar cliente").fill("Janely");
      await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();
    },
  },
  {
    slug: "tienda-confirmar-adeudo",
    url: `${TIENDA}/charge/greyes%40wifiplus`,
    stub: stubTienda,
    ready: "Adeudo anterior",
    widths: [375, 768],
  },
  {
    slug: "admin-cobros-parcial",
    url: ADMIN,
    stub: stubAdmin,
    ready: "Sin reactivar",
    widths: [1280, 375],
    act: async (page) => {
      for (const trigger of await page.locator("ul button.group").all()) {
        await trigger.click();
      }
      await expect(page.getByText("Folio DV-PARC01")).toBeVisible();
    },
  },
  {
    /* partial-payment D2/D4: the dial, with its meaning in one sentence */
    slug: "admin-ajustes-reconexion",
    url: `${ADMIN}/settings`,
    stub: stubAdmin,
    ready: "Reconexión con pago incompleto",
    widths: [1280, 375],
  },
  {
    slug: "pago-transferir-adeudo",
    url: `${PAGO}/p/tok-review-transfer`,
    stub: stubPago,
    ready: "Adeudo anterior",
    widths: [375, 768],
  },
  {
    slug: "pago-parcial",
    url: `${PAGO}/p/tok-review-partial`,
    stub: stubPago,
    ready: "Haz tu transferencia",
    widths: [375, 768],
    act: async (page) => {
      await page.getByRole("button", { name: "Ya hice mi transferencia" }).click();
      await page.getByRole("button", { name: "No tengo el comprobante a la mano" }).click();
      await page.getByLabel("Clave de rastreo").fill("HSBC712057");
      await page.getByLabel("Banco desde el que pagaste").selectOption("NUBANK");
      await page.getByRole("button", { name: "Verificar mi pago" }).click();
      await expect(page.getByText("Pago incompleto")).toBeVisible();
    },
  },
  {
    /* Where "Ver los datos para transferir" actually lands: the payer's
       remembered step is `proof`, so the button opens the upload screen,
       not the transfer data it names. */
    slug: "pago-parcial-regreso",
    url: `${PAGO}/p/tok-review-back`,
    stub: stubPago,
    ready: "Haz tu transferencia",
    widths: [375],
    act: async (page) => {
      await page.getByRole("button", { name: "Ya hice mi transferencia" }).click();
      await page.getByRole("button", { name: "No tengo el comprobante a la mano" }).click();
      await page.getByLabel("Clave de rastreo").fill("HSBC712057");
      await page.getByLabel("Banco desde el que pagaste").selectOption("NUBANK");
      await page.getByRole("button", { name: "Verificar mi pago" }).click();
      await page.getByRole("button", { name: "Ver los datos para transferir" }).click();
      await expect(page.getByText("Haz tu transferencia")).toBeVisible();
    },
  },
  {
    /* A short receipt submits and lands as `partial` (D1/D12). */
    slug: "pago-recibo-corto-parcial",
    url: `${PAGO}/p/tok-review-short`,
    stub: stubPago,
    ready: "Haz tu transferencia",
    widths: [375],
    act: async (page) => {
      await page.getByRole("button", { name: "Ya hice mi transferencia" }).click();
      await page.setInputFiles('input[type="file"]', {
        name: "comprobante.png",
        mimeType: "image/png",
        buffer: Buffer.from("not-a-real-png"),
      });
      await page.getByRole("button", { name: "Enviar comprobante" }).click();
      await expect(page.getByText("Pago incompleto")).toBeVisible();
    },
  },
  {
    /* A receipt claiming more than the debt is a misread and stays
       refused, with both numbers on screen. */
    slug: "pago-recibo-mayor-rechazado",
    url: `${PAGO}/p/tok-review-over`,
    stub: (page: Page) => stubPago(page, overReading),
    ready: "Haz tu transferencia",
    widths: [375],
    act: async (page) => {
      await page.getByRole("button", { name: "Ya hice mi transferencia" }).click();
      await page.setInputFiles('input[type="file"]', {
        name: "comprobante.png",
        mimeType: "image/png",
        buffer: Buffer.from("not-a-real-png"),
      });
      await page.getByRole("button", { name: "Enviar comprobante" }).click();
      await expect(page.getByText(/es mayor que tu adeudo/)).toBeVisible();
    },
  },
];

for (const shot of shots) {
  const primary = shot.widths[0];
  for (const width of shot.widths) {
    for (const theme of width === primary ? (["light", "dark"] as const) : (["light"] as const)) {
      test(`${shot.slug} ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
        await page.emulateMedia({ colorScheme: theme });
        await shot.stub(page);
        await page.goto(shot.url);
        await expect(page.getByText(shot.ready).first()).toBeVisible({ timeout: 15_000 });
        await shot.act?.(page);
        await page.waitForTimeout(400);
        const suffix = theme === "dark" ? "-dark" : "";
        await page.screenshot({
          path: `${OUT}/review-${shot.slug}-${width}${suffix}.png`,
          fullPage: true,
        });
      });
    }
  }
}

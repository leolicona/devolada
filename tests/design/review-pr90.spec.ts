import { expect, test, type Page } from "@playwright/test";
import { ADMIN, PAGO } from "../../playwright.config";
import { ispActor } from "../e2e/stubs";

/* Design-review captures for PR #90 (claimed-amount, US-D13): the
   "Monto transferido" field on both forms, the overpay sentence that
   replaced the refusal, the hidden beneficiary row, and the optional
   beneficiary in the admin's SPEI card. Run just this file:
   pnpm exec playwright test --config playwright.review.config.ts tests/design/review-pr90.spec.ts */

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

const link = {
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

/* D5: an ISP that never configured the name — the row must simply not
   be there, with no gap where it was */
const { speiBeneficiaryName: _omitted, ...namelessLink } = link;

/* D2: a reading above the debt — informed at the confirmation, never
   refused */
const overReading = {
  source: "reader",
  isReceipt: true,
  amountCents: 60000,
  trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
  senderBank: "NUBANK",
  date: "2026-08-25",
  receiptStatus: "Aceptada",
  gate: { trackingKey: "ok", senderBank: "ok", amount: "ok" },
};

/* D3: a stuck not_found whose row claimed $400.00 — the correction form
   pre-fills that number, not the debt's */
const notFoundStatus = {
  status: "validating",
  validationAttempts: 1,
  nextValidationAt: Date.now() + 6 * 60 * 1000,
  error: "TRANSFER_NOT_FOUND",
  trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
  senderBank: "NUBANK",
  transferDate: "2026-08-25",
  claimedAmountCents: 40000,
  receiptStatus: null,
};

async function stubPago(page: Page, linkData: object = link, reading: object = overReading) {
  await json(page, (u) => /\/direct-payments\/links\/[^/]+$/.test(u.pathname), linkData);
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
              data: { directPaymentId: "dp-rev-90", status: "validating", error: null },
            }),
          }),
  );
  await json(page, (u) => /\/direct-payments\/[^/]+\/status$/.test(u.pathname), notFoundStatus);
}

const adminSettings = {
  serviceFeeCents: 1500,
  storeCommissionCents: 900,
  platformShareCents: 600,
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphub: { configured: true, keyTail: "9f3a" },
  /* D5: configured with clabe + bank alone — the name empty on purpose */
  spei: {
    clabe: "646180157000000004",
    bank: "STP",
    beneficiaryName: null,
    serviceFeeCents: null,
    effectiveServiceFeeCents: 1500,
    bankUnknown: false,
    configured: true,
  },
  reconnection: { thresholdPercent: 100, floorCents: 0 },
};

async function stubAdmin(page: Page) {
  await json(page, (u) => u.pathname.endsWith("/auth/me"), ispActor);
  await json(page, (u) => u.pathname.includes("/charges/feed"), {
    charges: [],
    nextCursor: null,
    today: { count: 0, totalCents: 0, startedAtMs: Date.UTC(2026, 7, 26, 6) },
  });
  await json(page, (u) => u.pathname.endsWith("/settings"), adminSettings);
  await json(page, (u) => u.pathname.endsWith("/settlement"), { months: [] });
}

async function submitReceipt(page: Page) {
  await page.getByRole("button", { name: "Ya hice mi transferencia" }).click();
  await page.setInputFiles('input[type="file"]', {
    name: "comprobante.png",
    mimeType: "image/png",
    buffer: Buffer.from("not-a-real-png"),
  });
  await page.getByRole("button", { name: "Enviar comprobante" }).click();
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
    /* D3: the manual door with the amount pre-filled — the exact payer
       confirms without touching it */
    slug: "pago-monto-manual",
    url: `${PAGO}/p/tok-review-monto`,
    stub: (page) => stubPago(page),
    ready: "Haz tu transferencia",
    widths: [375, 768],
    act: async (page) => {
      await page.getByRole("button", { name: "Ya hice mi transferencia" }).click();
      await page.getByRole("button", { name: "No tengo el comprobante a la mano" }).click();
      await expect(page.getByLabel("Monto transferido")).toHaveValue("514.00");
    },
  },
  {
    /* D2: the overpay sentence with both amounts, inside the
       confirmation — the old refusal screen is gone */
    slug: "pago-sobrante-confirmar",
    url: `${PAGO}/p/tok-review-sobrante`,
    stub: (page) => stubPago(page),
    ready: "Haz tu transferencia",
    widths: [375],
    act: async (page) => {
      await submitReceipt(page);
      await expect(page.getByText(/el sobrante quedará a favor/i)).toBeVisible();
      await expect(page.getByLabel("Monto transferido")).toHaveValue("600.00");
    },
  },
  {
    /* D3: the correction form's fourth field, pre-filled with the row's
       own claim ($400.00), not the debt ($514.00) */
    slug: "pago-corregir-monto",
    url: `${PAGO}/p/tok-review-corregir`,
    stub: (page) => stubPago(page),
    ready: "Haz tu transferencia",
    widths: [375],
    act: async (page) => {
      await page.getByRole("button", { name: "Ya hice mi transferencia" }).click();
      await page.getByRole("button", { name: "No tengo el comprobante a la mano" }).click();
      await page.getByLabel("Clave de rastreo").fill("NU3AGKMP3ASP8QQQ4U8J8F0K1E4K");
      await page.getByLabel("Banco desde el que pagaste").selectOption("NUBANK");
      await page.getByRole("button", { name: "Verificar mi pago" }).click();
      await expect(page.getByText("Validación en proceso")).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Ver los datos enviados" }).click();
      await page.getByRole("button", { name: "Corregir estos datos" }).click();
      await expect(page.getByLabel("Monto transferido")).toHaveValue("400.00");
    },
  },
  {
    /* D5: no beneficiary configured — the collapsible holds banco and
       concepto with no empty slot */
    slug: "pago-sin-beneficiario",
    url: `${PAGO}/p/tok-review-nameless`,
    stub: (page) => stubPago(page, namelessLink),
    ready: "Haz tu transferencia",
    widths: [375],
    act: async (page) => {
      await page.getByRole("button", { name: "Ver los demás datos" }).click();
      await expect(page.getByText("Concepto").first()).toBeVisible();
    },
  },
  {
    /* D5: the SPEI card says "(opcional)" and stays configured with the
       name empty */
    slug: "admin-ajustes-beneficiario",
    url: `${ADMIN}/settings`,
    stub: stubAdmin,
    ready: "Pago directo por SPEI",
    widths: [1280, 375],
  },
];

for (const shot of shots) {
  const primary = shot.widths[0];
  for (const width of shot.widths) {
    for (const theme of width === primary ? (["light", "dark"] as const) : (["light"] as const)) {
      test(`${shot.slug} ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 500 ? 812 : width < 1000 ? 900 : 800 });
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

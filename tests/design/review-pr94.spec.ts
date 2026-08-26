import { expect, test, type Page } from "@playwright/test";
import { PAGO } from "../../playwright.config";

/* Design-review captures for PR #94 (reading-check, US-D14): the three
   states the classifier added — calm backed by evidence, the dispute
   that asks about the receipt, and the pre-diagnosed expiry. Run just
   this file:
   pnpm exec playwright test --config playwright.review.config.ts tests/design/review-pr94.spec.ts */

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

const baseStatus = {
  status: "validating",
  validationAttempts: 1,
  nextValidationAt: Date.now() + 6 * 60 * 1000,
  error: "TRANSFER_NOT_FOUND",
  trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
  senderBank: "NUBANK",
  transferDate: "2026-08-26",
  claimedAmountCents: 51400,
  readingCheck: null as string | null,
  receiptStatus: null,
};

async function stubPago(page: Page, status: object) {
  await json(page, (u) => /\/direct-payments\/links\/[^/]+$/.test(u.pathname), link);
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
              data: { directPaymentId: "dp-rev-94", status: "validating", error: null },
            }),
          }),
  );
  await json(page, (u) => /\/direct-payments\/[^/]+\/status$/.test(u.pathname), status);
}

/* Reach the payment states through the manual door, like a payer would */
async function submitManual(page: Page) {
  await page.getByRole("button", { name: "Ya hice mi transferencia" }).click();
  await page.getByRole("button", { name: "No tengo el comprobante a la mano" }).click();
  await page.getByLabel("Clave de rastreo").fill("NU3AGKMP3ASP8QQQ4U8J8F0K1E4K");
  await page.getByLabel("Banco desde el que pagaste").selectOption("NUBANK");
  await page.getByRole("button", { name: "Verificar mi pago" }).click();
}

type Shot = {
  slug: string;
  status: object;
  ready: string | RegExp;
  act?: (page: Page) => Promise<void>;
  widths: number[];
};

const shots: Shot[] = [
  {
    /* D3: attempt 5 — the clock that used to open the form, retired by
       the agreement; the data still one free tap away */
    slug: "pago-evidencia-calma",
    status: { ...baseStatus, validationAttempts: 5, readingCheck: "agreed" },
    ready: "Revisamos tu comprobante dos veces",
    widths: [375, 768],
    act: async (page) => {
      await page.getByRole("button", { name: "Ver los datos enviados" }).click();
      await expect(page.getByText("NU3AGKMP3ASP8QQQ4U8J8F0K1E4K")).toBeVisible();
    },
  },
  {
    /* D4: the dispute — the clave empty, everything else pre-filled,
       the ask pointing at the receipt */
    slug: "pago-disputa-clave",
    status: {
      ...baseStatus,
      validationAttempts: 2,
      readingCheck: "disputed",
      disputedFields: ["trackingKey"],
    },
    ready: "Confirma tu clave de rastreo",
    widths: [375, 768],
  },
  {
    /* D4: the amount disputed instead — the peso field empties, the
       clave keeps its reading */
    slug: "pago-disputa-monto",
    status: {
      ...baseStatus,
      validationAttempts: 2,
      readingCheck: "disputed",
      disputedFields: ["amount"],
    },
    ready: "Confirma el monto transferido",
    widths: [375],
  },
  {
    /* D6: expiry with a diagnosis — the data matched, Banxico never
       published, and the ISP hears exactly that */
    slug: "pago-expira-diagnosticado",
    status: {
      ...baseStatus,
      status: "expired",
      validationAttempts: 8,
      nextValidationAt: null,
      error: null,
      readingCheck: "agreed",
    },
    ready: "Banxico no publicó la transferencia",
    widths: [375],
  },
];

for (const shot of shots) {
  const primary = shot.widths[0];
  for (const width of shot.widths) {
    for (const theme of width === primary ? (["light", "dark"] as const) : (["light"] as const)) {
      test(`${shot.slug} ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
        await page.emulateMedia({ colorScheme: theme });
        await stubPago(page, shot.status);
        await page.goto(`${PAGO}/p/tok-review-${shot.slug}`);
        await expect(page.getByText("Haz tu transferencia").first()).toBeVisible({
          timeout: 15_000,
        });
        await submitManual(page);
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

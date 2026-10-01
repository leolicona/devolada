import { expect, test, type Page } from "@playwright/test";
import { PAGO } from "../../playwright.config";

/* Design-review captures for PR #88 (validation-status-ux, US-D12):
   the three phases of "Verificando" over a not_found, the empty-date
   confirmation, and the doors. Run just this file:
   pnpm exec playwright test --config playwright.review.config.ts tests/design/review-pr88.spec.ts */

const OUT = ".design/screenshots";

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

/* The submitted transfer data every phase echoes back (D18/D2) */
const submitted = {
  trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
  senderBank: "NUBANK",
  transferDate: "2026-08-26",
  receiptStatus: null,
};

const notFoundStatus = (over: Record<string, unknown> = {}) => ({
  status: "validating",
  validationAttempts: 1,
  nextValidationAt: Date.now() + 6 * 60 * 1000,
  error: "TRANSFER_NOT_FOUND",
  ...submitted,
  ...over,
});

/* A reading whose only failed gate is the date (D6) */
const undatedReading = {
  source: "reader",
  isReceipt: true,
  amountCents: 51400,
  trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
  senderBank: "NUBANK",
  date: null,
  receiptStatus: "Aceptada",
  gate: { trackingKey: "ok", senderBank: "ok", amount: "ok" },
};

async function stubPago(page: Page, status: object, reading: object = undatedReading) {
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
              data: { directPaymentId: "dp-rev-88", status: "validating", error: null },
            }),
          }),
  );
  await json(page, (u) => /\/direct-payments\/[^/]+\/status$/.test(u.pathname), status);
}

/* Reach "Verificando" through the manual door, like a payer would */
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
  reading?: object;
  ready: string | RegExp;
  act?: (page: Page) => Promise<void>;
  widths: number[];
};

const shots: Shot[] = [
  {
    /* D1/D2: attempt 1 — calm copy, data behind the open collapsible,
       both doors visible */
    slug: "pago-verificando-calma",
    status: notFoundStatus(),
    ready: "Seguimos buscando tu transferencia",
    widths: [375, 768],
    act: async (page) => {
      await page.getByRole("button", { name: "Ver los datos enviados" }).click();
      await expect(page.getByText("NU3AGKMP3ASP8QQQ4U8J8F0K1E4K")).toBeVisible();
    },
  },
  {
    /* D2: the correction door opened from inside the calm phase */
    slug: "pago-verificando-corregir",
    status: notFoundStatus(),
    ready: "Seguimos buscando tu transferencia",
    widths: [375],
    act: async (page) => {
      await page.getByRole("button", { name: "Ver los datos enviados" }).click();
      await page.getByRole("button", { name: "Corregir estos datos" }).click();
      await expect(page.getByLabel("Clave de rastreo")).toBeVisible();
    },
  },
  {
    /* D3: the 45-minute attempt — form in the foreground */
    slug: "pago-verificando-45min",
    status: notFoundStatus({
      validationAttempts: 5,
      nextValidationAt: Date.now() + 75 * 60 * 1000,
    }),
    ready: "Está tardando más de lo normal",
    widths: [375],
  },
  {
    /* D4/D5: schedule exhausted, the late slot pending — the hour and
       the way to a human */
    slug: "pago-espera-larga",
    status: notFoundStatus({
      validationAttempts: 7,
      nextValidationAt: Date.now() + 6 * 60 * 60 * 1000,
    }),
    ready: "Está tardando más de lo esperado",
    widths: [375, 768],
  },
  {
    /* D1: "En proceso" holds the calm at attempt 5 */
    slug: "pago-en-proceso-tarde",
    status: notFoundStatus({ validationAttempts: 5, receiptStatus: "En proceso" }),
    ready: "tu banco todavía no libera",
    widths: [375],
  },
  {
    /* D6: the reading carried no date — the field arrives empty */
    slug: "pago-confirmar-sin-fecha",
    status: notFoundStatus(),
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
      await expect(page.getByText(/no pudimos sacar todos los datos/)).toBeVisible();
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
        await stubPago(page, shot.status, shot.reading);
        await page.goto(`${PAGO}/p/tok-review-${shot.slug}`);
        await expect(page.getByText("Haz tu transferencia").first()).toBeVisible({
          timeout: 15_000,
        });
        if (shot.slug !== "pago-confirmar-sin-fecha") {
          await submitManual(page);
        }
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

import { expect, test, type Page } from "@playwright/test";
import { ADMIN, PAGO } from "../../playwright.config";
import { businessActor } from "../e2e/stubs";

/* Design-review captures for PRs #104–#105 (provisional release, US-D15):
   the states the vote of confidence added — the service back at minute
   zero, the evidence-backed release, the protect face that never lies,
   the expired page offering its one retry, and the admin switch.
   Run just this file:
   pnpm exec playwright test --config playwright.review.config.ts tests/design/review-pr104-105.spec.ts */

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

const baseStatus = {
  status: "validating",
  validationAttempts: 1,
  nextValidationAt: Date.now() + 6 * 60 * 1000,
  error: "TRANSFER_NOT_FOUND",
  trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
  senderBank: "NUBANK",
  transferDate: "2026-08-27",
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
              data: { directPaymentId: "dp-rev-105", status: "validating", error: null },
            }),
          }),
  );
  await json(page, (u) => /\/direct-payments\/[^/]+\/status$/.test(u.pathname), status);
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
  /* D10: the new switch, shown ON so the state reads as a choice made */
  reconnection: { thresholdPercent: 100, floorCents: 0, provisionalReleaseEnabled: true },
};

async function stubAdmin(page: Page) {
  await json(page, (u) => u.pathname.endsWith("/auth/me"), businessActor);
  await json(page, (u) => u.pathname.includes("/payments/feed"), { charges: [] });
  await json(page, (u) => u.pathname.endsWith("/settings"), adminSettings);
  await json(page, (u) => u.pathname.endsWith("/settlement"), { months: [] });
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
  url?: string;
  admin?: boolean;
  status?: object;
  ready: string | RegExp;
  act?: (page: Page) => Promise<void>;
  widths: number[];
};

const shots: Shot[] = [
  {
    /* D1: pending at minute zero — the provider says the transfer
       exists, the internet is already back */
    slug: "pago-liberado-pendiente",
    status: {
      ...baseStatus,
      error: null,
      provisionalRelease: { evidence: "pending", kind: "reconnect" },
    },
    ready: "Tu transferencia está en camino y tu servicio ya volvió",
    widths: [375, 768],
  },
  {
    /* D9: agreed evidence fused with its consequence, at the attempt
       that used to open the form by clock */
    slug: "pago-liberado-evidencia",
    status: {
      ...baseStatus,
      validationAttempts: 5,
      readingCheck: "agreed",
      provisionalRelease: { evidence: "agreed", kind: "reconnect" },
    },
    ready: /los datos coinciden\. Tu servicio ya volvió/,
    widths: [375],
  },
  {
    /* D2/D9: the protect face — the service never left, and the page
       never claims it came back */
    slug: "pago-protegido",
    status: {
      ...baseStatus,
      error: null,
      provisionalRelease: { evidence: "pending", kind: "protect" },
    },
    ready: "Tu servicio sigue activo",
    widths: [375],
  },
  {
    /* D7: expiry after release — honest about the pause, offering the
       one retry to the payer who really paid */
    slug: "pago-expira-reintento",
    status: {
      ...baseStatus,
      status: "expired",
      validationAttempts: 8,
      nextValidationAt: null,
      error: null,
      readingCheck: "agreed",
      provisionalRelease: { evidence: "agreed", kind: "reconnect" },
      retryAvailable: true,
    },
    ready: "volvió a pausa",
    widths: [375, 768],
    act: async (page) => {
      await expect(page.getByRole("button", { name: "Reintentar ahora" })).toBeVisible();
    },
  },
  {
    /* D7: the retry spent — back to the diagnosed contact copy */
    slug: "pago-expira-reintento-gastado",
    status: {
      ...baseStatus,
      status: "expired",
      validationAttempts: 8,
      nextValidationAt: null,
      error: null,
      readingCheck: "agreed",
      provisionalRelease: { evidence: "agreed", kind: "reconnect" },
      retryAvailable: false,
    },
    ready: "puede registrar tu pago a mano",
    widths: [375],
  },
  {
    /* D10: the one switch, on, next to the threshold and floor it obeys */
    slug: "admin-ajustes-proteccion",
    admin: true,
    url: `${ADMIN}/settings`,
    ready: "Proteger el servicio mientras Banxico confirma",
    widths: [1280, 375],
  },
];

for (const shot of shots) {
  const primary = shot.widths[0];
  for (const width of shot.widths) {
    for (const theme of width === primary ? (["light", "dark"] as const) : (["light"] as const)) {
      test(`${shot.slug} ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
        await page.emulateMedia({ colorScheme: theme });
        if (shot.admin) {
          await stubAdmin(page);
          await page.goto(shot.url!);
        } else {
          await stubPago(page, shot.status!);
          await page.goto(`${PAGO}/p/tok-review-${shot.slug}`);
          await expect(page.getByText("Haz tu transferencia").first()).toBeVisible({
            timeout: 15_000,
          });
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

import { expect, test, type Page } from "@playwright/test";
import { ADMIN, PAGO } from "../../playwright.config";
import { ispActor } from "../e2e/stubs";

/* Closing captures for the US-D15 review cycle: the states the previous
   pass (review-pr104-105.spec.ts) did not photograph — the neutral
   "verificando" baseline the success Alert must outrank, the switch in
   its OFF state, and the switch's keyboard focus ring.
   Run just this file:
   pnpm exec playwright test --config playwright.review.config.ts tests/design/review-us-d15-close.spec.ts */

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
              data: { directPaymentId: "dp-rev-close", status: "validating", error: null },
            }),
          }),
  );
  await json(page, (u) => /\/direct-payments\/[^/]+\/status$/.test(u.pathname), status);
}

const adminSettings = (enabled: boolean) => ({
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
  reconnection: { thresholdPercent: 100, floorCents: 0, provisionalReleaseEnabled: enabled },
});

async function stubAdmin(page: Page, enabled: boolean) {
  await json(page, (u) => u.pathname.endsWith("/auth/me"), ispActor);
  await json(page, (u) => u.pathname.includes("/charges/feed"), { charges: [] });
  await json(page, (u) => u.pathname.endsWith("/settings"), adminSettings(enabled));
  await json(page, (u) => u.pathname.endsWith("/settlement"), { months: [] });
}

async function submitManual(page: Page) {
  await page.getByRole("button", { name: "Ya hice mi transferencia" }).click();
  await page.getByRole("button", { name: "No tengo el comprobante a la mano" }).click();
  await page.getByLabel("Clave de rastreo").fill("NU3AGKMP3ASP8QQQ4U8J8F0K1E4K");
  await page.getByLabel("Banco desde el que pagaste").selectOption("NUBANK");
  await page.getByRole("button", { name: "Verificar mi pago" }).click();
}

/* The neutral baseline: no release, no error — the plain sentence the
   success Alert exists to outrank. Hierarchy is only provable by
   comparing this capture with pago-liberado-pendiente. */
test("pago-verificando-base 375 light", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await stubPago(page, {
    status: "validating",
    validationAttempts: 1,
    nextValidationAt: Date.now() + 6 * 60 * 1000,
    error: null,
    trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
    senderBank: "NUBANK",
    transferDate: "2026-08-27",
    claimedAmountCents: 51400,
    readingCheck: null,
    receiptStatus: null,
  });
  await page.goto(`${PAGO}/p/tok-review-base`);
  await expect(page.getByText("Haz tu transferencia").first()).toBeVisible({ timeout: 15_000 });
  await submitManual(page);
  await expect(page.getByText(/Estamos verificando tu transferencia/).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/review-pago-verificando-base-375.png`, fullPage: true });
});

/* The switch OFF: the resting state most ISPs will meet first. The
   previous pass only photographed ON. */
test("admin-ajustes-proteccion-off 1280 light", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await stubAdmin(page, false);
  await page.goto(`${ADMIN}/settings`);
  await expect(
    page.getByText("Proteger el servicio mientras Banxico confirma").first(),
  ).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/review-admin-ajustes-proteccion-off-1280.png`, fullPage: true });
});

/* The switch's keyboard focus ring, after 5d1f219 removed the redundant
   aria-label: focus must be visible and the accessible name must come
   from the label above. */
test("admin-ajustes-proteccion-focus 1280 light", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await stubAdmin(page, true);
  await page.goto(`${ADMIN}/settings`);
  const sw = page.getByRole("switch", { name: "Proteger el servicio mientras Banxico confirma" });
  await expect(sw).toBeVisible({ timeout: 15_000 });
  /* Keyboard focus, not element.focus(): the ring is focus-visible, and
     only a real Tab reliably matches that selector in Chromium. */
  await sw.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(sw).toBeFocused();
  /* The ring is a box-shadow in Tailwind: prove it painted, not just
     that focus landed */
  const shadow = await sw.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe("none");
  await page.waitForTimeout(200);
  /* Clip a region around the switch so the ring is actually in frame */
  const box = (await sw.boundingBox())!;
  await page.screenshot({
    path: `${OUT}/review-admin-ajustes-proteccion-focus-1280.png`,
    clip: { x: box.x - 560, y: box.y - 40, width: 640, height: 120 },
  });
});

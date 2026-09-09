import { expect, test, type Page } from "@playwright/test";
import { PAGO } from "../../playwright.config";
import { longTrackingKey, stubPagoApi } from "./stubs";

/* docs/legacy/direct-payment/direct-payment.spec.md (D16, D18, D19) — the
   customer's page in a real browser.

   happy-dom applies no stylesheet and reports no layout, so everything
   here is a question the component tests cannot answer: whether the
   values this page asks people to proofread actually fit on a phone,
   and whether the two steps hold up at the 360px floor. */

const PHONE = { width: 360, height: 740 }; /* the floor FRONTEND.md sets */

async function open(page: Page) {
  await stubPagoApi(page);
  await page.setViewportSize(PHONE);
  await page.goto(`${PAGO}/p/tok123`);
  await page.getByRole("heading", { name: /haz tu transferencia/i }).waitFor();
}

/* A field whose content runs past its own box shows the payer a prefix
   and hides the rest behind a caret they have to drag. */
async function expectFullyVisible(page: Page, selector: string, what: string) {
  const overflow = await page.locator(selector).evaluate((el: HTMLInputElement) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    value: el.value,
  }));
  expect(
    overflow.scroll,
    `${what} is clipped: ${overflow.scroll}px of "${overflow.value}" in ${overflow.client}px`,
  ).toBeLessThanOrEqual(overflow.client + 1);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `page scrolls sideways: ${overflow.scrollWidth}px in ${overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe("US-D09: the payer can read what they are asked to confirm", () => {
  /* BUG-009. D18's whole point is that the human checks the machine's
     reading — and the field was showing about 24 of the 28 characters,
     so the tail nobody could see was the part most likely to be wrong. */
  test("the clave de rastreo fits its field at the 360px floor", async ({ page }) => {
    await open(page);

    await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "cep.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(120),
    });
    await page.getByRole("button", { name: /enviar comprobante/i }).click();

    const field = page.getByLabel(/clave de rastreo/i);
    await expect(field).toHaveValue(longTrackingKey);
    await expectFullyVisible(page, "#" + (await field.getAttribute("id"))!, "the clave de rastreo");
  });

  test("the same field fits when the payer types it by hand", async ({ page }) => {
    await open(page);

    await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
    await page.getByRole("button", { name: /no tengo el comprobante/i }).click();
    const field = page.getByLabel(/clave de rastreo/i);
    await field.fill(longTrackingKey);
    await expectFullyVisible(page, "#" + (await field.getAttribute("id"))!, "the clave de rastreo");
  });
});

test.describe("US-D01: the two steps hold at the phone floor (D19)", () => {
  test("step 1 does not scroll sideways, and every control is thumb-sized", async ({ page }) => {
    await open(page);
    await expectNoHorizontalScroll(page);
    /* The CLABE is 18 digits next to a copy button on a 360px screen */
    await expect(page.getByText("646180157000000004")).toBeVisible();

    await page.getByRole("button", { name: /ver los demás datos/i }).click();
    await expect(page.getByText("WifiPlus SA de CV")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("step 2's upload target is a real tap area, not the platform's control", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();

    /* The input is visually hidden; the label is what the thumb hits, and
       the native "Choose File" is what it exists to replace (D10). */
    const dropzone = page.locator('label[for]', { hasText: /toca para subir/i });
    const box = (await dropzone.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(64);
    await expectNoHorizontalScroll(page);
  });
});

/* design-foundations US1 (converge F4). The payer had no width coverage above
   360: this file checked the phone floor and tests/e2e/responsive.spec.ts
   imports ADMIN only. That was survivable until 001 wrapped every outcome
   branch in a Reveal carrying its own spacing — changing the DOM inside the
   status Card is exactly the edit that shifts layout at a width nobody looks
   at. FRONTEND floor 360, designed at 375, and the two widths above it. */
const WIDTHS = [
  { name: "375 (design width)", width: 375, height: 812 },
  { name: "768 (tablet)", width: 768, height: 1024 },
  { name: "1280 (desktop)", width: 1280, height: 900 },
] as const;

const envelope = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

/* Park the payer on the validating screen: the one 001 rebuilt. */
async function openWaiting(page: Page) {
  await stubPagoApi(page);
  await page.route("**/direct-payments/links/*/read", (route) =>
    route.fulfill(
      envelope({
        source: "reader",
        isReceipt: true,
        amountCents: 51400,
        trackingKey: longTrackingKey,
        senderBank: "STP",
        date: "2026-08-19",
        receiptStatus: "Aceptada",
        gate: { trackingKey: "ok", senderBank: "ok", amount: "ok" },
      }),
    ),
  );
  await page.route("**/direct-payments/links/*/pay", (route) =>
    route.fulfill(envelope({ directPaymentId: "dp-1", status: "validating", error: null })),
  );
  await page.route("**/direct-payments/*/status", (route) =>
    route.fulfill(
      envelope({
        status: "validating",
        validationAttempts: 1,
        nextValidationAt: null,
        error: null,
        receiptStatus: "Aceptada",
      }),
    ),
  );
  await page.goto(`${PAGO}/p/tok123`);
  await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "cep.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(120),
  });
  await page.getByRole("button", { name: /enviar comprobante/i }).click();
  await expect(page.getByText(/estamos verificando tu transferencia/i)).toBeVisible();
}

test.describe("design-foundations US1: the payer's page holds at all three widths", () => {
  for (const size of WIDTHS) {
    test(`the transfer step does not scroll sideways at ${size.name}`, async ({ page }) => {
      await stubPagoApi(page);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`${PAGO}/p/tok123`);
      await page.getByRole("heading", { name: /haz tu transferencia/i }).waitFor();
      await expectNoHorizontalScroll(page);
    });

    test(`the waiting screen does not scroll sideways at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openWaiting(page);
      await expectNoHorizontalScroll(page);
    });
  }
});

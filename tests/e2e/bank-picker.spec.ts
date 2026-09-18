import { expect, test } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { stubAdminApi } from "./stubs";

/* bug: bank-picker-unreachable.

   The defect was geometry, so only a browser can say it is gone: the popup
   had no height of its own and grew past the window, and Radix's scroll lock
   meant the page behind it could not move either — every name below the fold
   was unreachable. happy-dom reports no layout, so the component layer can
   only prove which names are offered (constitution IV). This proves the popup
   fits in the window, that it scrolls, and that the far end of the alphabet is
   reachable both ways: by scrolling and by typing. */

async function openPicker(page: import("@playwright/test").Page) {
  await stubAdminApi(page);
  await page.goto(`${ADMIN}/settings/direct-payment`);
  const field = page.getByRole("combobox", { name: "Banco" });
  await expect(field).toBeVisible();
  await field.click();
  return field;
}

const popupOf = (page: import("@playwright/test").Page) =>
  page.locator("[data-radix-popper-content-wrapper] > *").first();

test("the bank list is bounded by the window", async ({ page }) => {
  await openPicker(page);
  const popup = popupOf(page);
  await expect(popup).toBeVisible();

  const box = (await popup.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  /* One pixel of slack for sub-pixel rounding; anything more is the
     unbounded popup coming back. */
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
});

test("the list scrolls, and the end of the alphabet is reachable", async ({ page }) => {
  await openPicker(page);
  const popup = popupOf(page);

  const overflows = await popup.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(overflows).toBe(true);

  const last = page.getByRole("option", { name: "VOLKSWAGEN" });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await popup.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test("typing reaches a bank without scrolling at all", async ({ page }) => {
  const field = await openPicker(page);
  await field.fill("scotia");

  const options = page.getByRole("option");
  await expect(options).toHaveCount(1);
  await options.first().click();
  await expect(field).toHaveValue("SCOTIABANK");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

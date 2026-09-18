import { expect, test } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { stubAdminApi } from "./stubs";

/* searchable-picker US1.

   happy-dom applies no stylesheet and reports no layout, so the picker's
   geometry belongs here (constitution IV): its list opens inside the window,
   it scrolls, and the far end of the alphabet is reachable both ways — by
   scrolling, and in three keystrokes by typing (SC-001, SC-002).

   The panel's *other* dropdown, the one that could not be scrolled at all, has
   its own guard in dropdown.spec.ts (`bug: bank-picker-unreachable`). */

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

test("the list is bounded by the space it has, not by a number alone", async ({ page }) => {
  /* searchable-picker D5. `min(18rem, available)` is void as a whole if Radix
     never publishes the available height, and a voided max-height is exactly
     the unbounded popup this control was built away from. So both halves are
     read back from the browser rather than assumed: the variable has a real
     length, and the bound is the smaller of the two. */
  /* 360px tall is where the two halves disagree: measured 2026-09-18, Radix
     offers 155.8px of space there against the 18rem reading size. A window
     taller than that leaves both halves agreeing, and the test would pass
     against a fixed cap too — proving nothing. */
  await page.setViewportSize({ width: 1280, height: 360 });
  await openPicker(page);
  const popup = popupOf(page);
  await expect(popup).toBeVisible();

  const bound = await popup.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      maxHeight: style.maxHeight,
      available: style.getPropertyValue("--radix-popover-content-available-height").trim(),
    };
  });

  /* The variable is a real length — not empty, which would void the rule */
  expect(bound.available).toMatch(/^[\d.]+px$/);
  expect(bound.maxHeight).not.toBe("none");

  /* …and the bound is the smaller of the reading size and that space */
  const reading = 18 * 16;
  expect(parseFloat(bound.available)).toBeLessThan(reading);
  expect(parseFloat(bound.maxHeight)).toBeCloseTo(parseFloat(bound.available), 0);
  /* The space won, not the number — this is what a fixed cap would fail */
  expect(parseFloat(bound.maxHeight)).toBeLessThan(reading);

  const box = (await popup.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(360 + 1);
});

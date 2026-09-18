import { expect, test } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { businessActor, stubAdminApi } from "./stubs";

/* bug: bank-picker-unreachable.

   The defect was geometry, so only a browser can say it is gone: the panel's
   dropdown had no height of its own and grew past the window, with Radix's
   scroll lock holding the page still behind it — nothing below the fold could
   be reached. happy-dom applies no stylesheet and reports no layout, so this
   question belongs here (constitution IV).

   It is asked of the workspace switcher, not of the list it was reported on.
   The bank is a searchable picker now (specs/007-searchable-picker), and the
   switcher is the one dropdown whose length the product does not control:
   nothing caps how many businesses a person belongs to. A guard written
   against a list whose length is fixed in code would quietly stop proving
   anything the day that code changed. */

const businesses = Array.from({ length: 25 }, (_, i) =>
  i === 0
    ? { id: businessActor.id, orgId: businessActor.orgId, name: businessActor.name, role: "owner" }
    : { id: `business-${i + 1}`, orgId: `org_business-${i + 1}`, name: `ISP ${String(i + 1).padStart(2, "0")}`, role: "owner" },
);

test.beforeEach(async ({ page }) => {
  await stubAdminApi(page);
  /* Registered after the shared stub so it wins; documents still pass through,
     or the browser is handed JSON instead of the app. */
  await page.route("**/auth/me", (route) => {
    if (route.request().resourceType() === "document") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { ...businessActor, businesses } }),
    });
  });
  await page.goto(`${ADMIN}/payments`);
});

/* The content is what is bounded; the viewport inside it is what scrolls. */
const popupOf = (page: import("@playwright/test").Page) =>
  page.locator("[data-radix-popper-content-wrapper] > *").first();
const viewportOf = (page: import("@playwright/test").Page) =>
  page.locator("[data-radix-select-viewport]").first();

test("a dropdown longer than the window stays inside it", async ({ page }) => {
  await page.getByRole("combobox", { name: "Negocio" }).click();
  const popup = popupOf(page);
  await expect(popup).toBeVisible();

  const window = page.viewportSize()!;
  const box = (await popup.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  /* One pixel of slack for sub-pixel rounding; anything more is the
     unbounded popup coming back. */
  expect(box.y + box.height).toBeLessThanOrEqual(window.height + 1);
});

test("the popup is the scroll container, and really scrolls", async ({ page }) => {
  await page.getByRole("combobox", { name: "Negocio" }).click();
  const popup = popupOf(page);

  /* The rule, not one list: a popup bounded by the space it has, with a
     scroll container inside it, cannot hide a row whatever the list holds. */
  const maxHeight = await popup.evaluate((el) => getComputedStyle(el).maxHeight);
  expect(maxHeight).not.toBe("none");
  expect(parseFloat(maxHeight)).toBeLessThanOrEqual(page.viewportSize()!.height);

  const scroller = await viewportOf(page).evaluate((el) => ({
    overflowY: getComputedStyle(el).overflowY,
    overflows: el.scrollHeight > el.clientHeight + 1,
  }));
  expect(scroller.overflowY).toBe("auto");
  expect(scroller.overflows).toBe(true);
});

test("the last row is reachable", async ({ page }) => {
  await page.getByRole("combobox", { name: "Negocio" }).click();

  const last = page.getByRole("option", { name: "Crear negocio…" });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await viewportOf(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

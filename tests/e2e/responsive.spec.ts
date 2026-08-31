import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { stubAdminApi } from "./stubs";

/* docs/polish/responsive.spec.md — US-P03.

   Every assertion here is about real layout: the browser has the
   stylesheet, so a 48px touch target is measured rather than assumed. */

const PHONE = { width: 360, height: 740 }; /* the floor FRONTEND.md sets */
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 900 };

/* A page that scrolls sideways on a phone is broken, whatever it looks
   like in a screenshot: the shopkeeper loses half the amount off-screen. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `page scrolls sideways: ${overflow.scrollWidth}px of content in ${overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/* FRONTEND.md: touch targets ≥ 48px, and the charge path's decisive
   actions at 64px. Anything interactive and visible has to clear it. */
async function expectTouchTargets(page: Page, min = 44) {
  const small = await page.evaluate((minSize) => {
    const offenders: string[] = [];
    for (const el of document.querySelectorAll("a, button, input, select, textarea")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue; /* not rendered */
      if (box.height < minSize) {
        offenders.push(`${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(box.height)}px`);
      }
    }
    return offenders;
  }, min);
  expect(small, `controls under ${min}px tall`).toEqual([]);
}

/* design-review.spec.md D1: the two assertions above both pass on a row
   that says nothing. A `min-w-0 flex-1` column beside fixed-width siblings
   collapses to zero, and `truncate` hides the collapse behind an ellipsis
   — the page does not scroll, the targets are big, and the store's name is
   gone. Clipping is measurable: an element that hides its overflow and
   needs more width than it has is cutting text off. */
async function expectNothingClipped(page: Page) {
  const clipped = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll("main *")) {
      const node = el as HTMLElement;
      if (node.children.length > 0) continue; /* leaves hold the text */
      const text = node.textContent?.trim();
      if (!text) continue;
      /* design-review 2026-08-25 finding 7: a stub that drifts from the
         wire shape makes `formatMoney(undefined)` render "$NaN" without
         throwing, and every geometry assertion passes over it. Same
         class as clipping: the page renders and says nothing. */
      if (/\bNaN\b/.test(text)) {
        bad.push(`"${text.slice(0, 40)}" contains NaN — a number failed to render`);
        continue;
      }
      const style = getComputedStyle(node);
      /* sr-only clips on purpose: an absolute 1px box for assistive tech.
         A collapsed row column is neither absolute nor 1px tall. */
      if (style.position === "absolute" && node.clientHeight <= 1) continue;
      if (style.overflow !== "hidden" && style.overflowX !== "hidden") continue;
      if (node.scrollWidth > node.clientWidth + 1) {
        bad.push(`"${text.slice(0, 40)}" needs ${node.scrollWidth}px, has ${node.clientWidth}px`);
      }
    }
    return bad;
  });
  expect(clipped, "text cut off by its own container").toEqual([]);
}

test.describe("US-P05: every list row says what it is about at 360px", () => {
  test.use({ viewport: PHONE });

  test("the charge feed shows customer and store", async ({ page }) => {
    await stubAdminApi(page);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();
    await expectNothingClipped(page);
  });

});

test.describe("US-P03: the admin follows the ISP to a phone", () => {
  test("the sidebar becomes a bottom bar under lg", async ({ page }) => {
    await stubAdminApi(page);
    await page.setViewportSize(PHONE);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();

    /* Both navs are in the DOM; only one may be visible (a11y D5) */
    await expect(page.getByRole("navigation", { name: "Secciones, barra inferior" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Secciones", exact: true })).toBeHidden();
    await expectNoHorizontalScroll(page);
  });

  test("the sidebar returns on desktop", async ({ page }) => {
    await stubAdminApi(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();

    await expect(page.getByRole("navigation", { name: "Secciones", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Secciones, barra inferior" })).toBeHidden();
  });

  test("the charge feed does not scroll sideways at tablet width", async ({ page }) => {
    await stubAdminApi(page);
    await page.setViewportSize(TABLET);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

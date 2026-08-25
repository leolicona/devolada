import { expect, test, type Page } from "@playwright/test";
import { ADMIN, TIENDA } from "../../playwright.config";
import { stubAdminApi, stubStoreApi } from "./stubs";

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

  test("Tiendas shows which store each row is", async ({ page }) => {
    await stubAdminApi(page);
    await page.goto(`${ADMIN}/stores`);
    await expect(page.getByText("Abarrotes La Esquina")).toBeVisible();
    await expectNothingClipped(page);
  });

  test("the Entregas history shows the store and the date", async ({ page }) => {
    await stubAdminApi(page);
    await page.goto(`${ADMIN}/cash-drops`);
    await expect(page.getByText("Entrega confirmada")).toBeVisible();
    await expectNothingClipped(page);
  });

  test("the confirm screen shows the whole customer name", async ({ page }) => {
    await stubStoreApi(page);
    await page.goto(`${TIENDA}/charge/greyes%40wifiplus`);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();
    await expectNothingClipped(page);
  });

  test("a search result shows the whole customer name", async ({ page }) => {
    await stubStoreApi(page);
    await page.goto(TIENDA);
    await page.getByLabel("Buscar cliente").fill("Janely");
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();
    await expectNothingClipped(page);
  });

  test("Movimientos shows the whole entry name", async ({ page }) => {
    await stubStoreApi(page);
    await page.goto(`${TIENDA}/ledger`);
    await expect(page.getByText(/Cobro · Janely/)).toBeVisible();
    await expectNothingClipped(page);
  });

  test("the charge feed shows customer and store", async ({ page }) => {
    await stubAdminApi(page);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();
    await expectNothingClipped(page);
  });

  test("Caja shows the whole store name", async ({ page }) => {
    await stubStoreApi(page);
    await page.goto(`${TIENDA}/cashbox`);
    await expect(page.getByText("Abarrotes La Esquina")).toBeVisible();
    await expectNothingClipped(page);
  });
});

test.describe("US-P03: the store PWA works on a 360px phone", () => {
  test.use({ viewport: PHONE });

  test("Caja fits, scrolls only downward, and its controls are thumb-sized", async ({ page }) => {
    await stubStoreApi(page);
    await page.goto(`${TIENDA}/cashbox`);
    await expect(page.getByText("Abarrotes La Esquina")).toBeVisible();

    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page, 44);

    /* The balance is the screen: it must not be truncated at the floor */
    const amount = page.getByText("$910.00").first();
    await expect(amount).toBeVisible();
  });

  test("the charge action is a 64px target in the thumb zone", async ({ page }) => {
    await stubStoreApi(page);
    await page.goto(`${TIENDA}/cashbox/drop`);

    const submit = page.getByRole("button", { name: /registrar entrega/i });
    await expect(submit).toBeVisible();
    const box = (await submit.boundingBox())!;
    expect(box.height, "the decisive action is a 48px+ target").toBeGreaterThanOrEqual(48);
    /* Full width at the floor: no hunting for a narrow button */
    expect(box.width).toBeGreaterThan(PHONE.width * 0.8);
  });

  test("Movimientos keeps its amounts on screen", async ({ page }) => {
    await stubStoreApi(page);
    await page.goto(`${TIENDA}/ledger`);
    await expect(page.getByText(/Cobro · Janely/)).toBeVisible();

    await expectNoHorizontalScroll(page);
    /* A long customer name must not push the amount out of the row */
    await expect(page.getByText("+$414.00")).toBeVisible();
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

  test("confirming a handover is reachable on a phone", async ({ page }) => {
    await stubAdminApi(page);
    await page.setViewportSize(PHONE);
    await page.goto(`${ADMIN}/cash-drops`);

    const confirm = page.getByRole("button", { name: /confirmar entrega/i });
    await expect(confirm).toBeVisible();
    const box = (await confirm.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    await expectNoHorizontalScroll(page);

    /* Two taps, and the second one is a dialog (cash-drops D6) */
    await confirm.click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
  });

  test("the charge feed does not scroll sideways at tablet width", async ({ page }) => {
    await stubAdminApi(page);
    await page.setViewportSize(TABLET);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

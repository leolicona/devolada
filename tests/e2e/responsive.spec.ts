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
async function expectTouchTargets(page: Page, min = 44, within = "body") {
  const small = await page.evaluate(([minSize, scope]) => {
    const offenders: string[] = [];
    const root = document.querySelector(scope as string);
    if (!root) return [`scope "${scope}" not found`];
    for (const el of root.querySelectorAll("a, button, input, select, textarea")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue; /* not rendered */
      if (box.height < minSize) {
        offenders.push(`${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(box.height)}px`);
      }
    }
    return offenders;
  }, [min, within] as const);
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

  /* pagos-filtros review (2026-09-02): `expectTouchTargets` had never
     been called by anyone, while two specs claimed it proved the floor.
     It is wired here for the one region that round fixed; the rest of
     the admin is TD-019. The chip rail is a scroll container, and
     `overflow-x: auto` forces `overflow-y: auto`, which was slicing the
     3px focus ring off the top of every chip — the ring's room is a
     measurement, not a screenshot. */
  test("the Pagos filter bar clears 44px, and a focused chip keeps its ring", async ({ page }) => {
    await stubAdminApi(page);
    await page.setViewportSize(PHONE);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();

    await expectTouchTargets(page, 44, 'section[aria-label="Filtros"]');

    const rail = page.getByRole("tablist", { name: "Filtrar por estado" });
    await rail.getByRole("tab", { name: "En cola" }).focus();
    const room = await rail.evaluate((list) => {
      const chip = list.querySelector('[role="tab"][data-state], [role="tab"]:focus') as HTMLElement | null;
      const focused = (document.activeElement as HTMLElement) ?? chip;
      const a = list.getBoundingClientRect();
      const b = focused.getBoundingClientRect();
      return { above: b.top - a.top, below: a.bottom - b.bottom, overflowY: getComputedStyle(list).overflowY };
    });
    /* the ring is 3px (`--shadow-focus`); the rail clips at its padding box */
    expect(room.overflowY, "the rail is a scroll container, so it clips").not.toBe("visible");
    expect(room.above, "room above the chip for the focus ring").toBeGreaterThanOrEqual(3);
    expect(room.below, "room below the chip for the focus ring").toBeGreaterThanOrEqual(3);
    await expectNoHorizontalScroll(page);
  });
});

/* espaciado-y-tipografía review (2026-09-05, design-review.spec.md D11).
   The round found four things no assertion in this suite could see, all
   of them geometry the stylesheet decides: a page frame with no bottom
   padding, a list card that does not clip the hover fill painted over
   its corner, a skeleton 12px per row shorter than the list it stands
   in for, and three pages measuring three different gaps under their
   title. `PageFrame` settles them in one place; these are the numbers
   it settles, so they stop being a screenshot. */
const LIST_PAGES = [
  { name: "Pagos", path: "/", row: "Janely Guadalupe Reyes" },
  { name: "Cobros", path: "/payment-requests", row: "Janely Guadalupe Reyes" },
  { name: "Links", path: "/links", row: "Janely Guadalupe Reyes" },
] as const;

test.describe("US-P03: the three list pages share one frame", () => {
  test.use({ viewport: DESKTOP });

  test("every page ends with room under its last row, and its card clips", async ({ page }) => {
    await stubAdminApi(page);
    const gaps: number[] = [];

    for (const { name, path, row } of LIST_PAGES) {
      await page.goto(ADMIN + path);
      await expect(page.getByText(row).first()).toBeVisible({ timeout: 15_000 });

      const frame = await page.evaluate(() => {
        const main = document.querySelector("main");
        const title = main?.querySelector("h1");
        /* the first block under the title row, whatever the page puts there */
        const titleRow = title?.parentElement;
        const next = titleRow?.nextElementSibling;
        const card = document.querySelector("main ul")?.parentElement;
        return {
          paddingBottom: parseFloat(getComputedStyle(main!).paddingBottom),
          gapUnderTitle: next
            ? Math.round(next.getBoundingClientRect().top - titleRow!.getBoundingClientRect().bottom)
            : null,
          cardOverflow: card ? getComputedStyle(card).overflow : null,
        };
      });

      expect(frame.paddingBottom, `${name} ends on the viewport's last pixel`).toBeGreaterThanOrEqual(24);
      expect(frame.cardOverflow, `${name}'s list card must clip its corners`).toBe("hidden");
      if (frame.gapUnderTitle !== null) gaps.push(frame.gapUnderTitle);
    }

    expect(new Set(gaps).size, `three pages, ${gaps.join("/")}px under the title`).toBe(1);
  });

  test("the skeleton is the list's own shape, so nothing jumps when it loads", async ({ page }) => {
    await stubAdminApi(page);
    /* Hold the roster back long enough to measure the placeholder.
       Registered *after* the stubs on purpose: Playwright runs the most
       recent matching handler first, and `fallback()` hands the request
       down to the stub underneath. The other way round the stub answers
       at once and the delay is dead code. */
    await page.route("**/direct-payments/links/roster", async (route) => {
      if (route.request().resourceType() === "document") return route.fallback();
      await new Promise((r) => setTimeout(r, 1500));
      return route.fallback();
    });

    /* `clientHeight` is the padding box: it leaves out the 1px `divide-y`
       border, which a three-row skeleton has on its first row and a
       one-row list does not. The finding was 12px per row, not 1. */
    const rowHeight = () =>
      page.evaluate(() => {
        const first = document.querySelector("main ul > li, main .divide-y > div");
        return first ? (first as HTMLElement).clientHeight : null;
      });

    await page.goto(`${ADMIN}/links`);
    await page.waitForSelector("main .divide-y > div");
    const placeholder = await rowHeight();
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible({ timeout: 15_000 });
    const real = await rowHeight();

    expect(placeholder, "a skeleton row and a real row are the same height").toBe(real);
  });
});

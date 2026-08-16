import { expect, test, type Page } from "@playwright/test";
import { ADMIN, TIENDA } from "../../playwright.config";
import { stubAdminApi, stubStoreApi } from "./stubs";

/* docs/polish/accessibility.spec.md — US-P04, paying TD-010.

   The tab order needs a browser and a written expectation of the order.
   This is both: each flow's stops are spelled out, and every stop must
   show a visible focus indicator. "Visible" is measured, not assumed —
   the indicator has to APPEAR with the focus (an outline, a box-shadow
   or a border colour that differs from the element's resting state), so
   a static card shadow can never pass as a focus style.

   One browser quirk shapes the walks: blurring an element does not
   reset Chromium's sequential-navigation starting point, so a walk
   "from the top" is not a thing after the app has focused anything.
   Each walk therefore starts from a stop the flow really visits. */

type Stop = { label: string; focusVisible: boolean; indicator: boolean };

/* Snapshot every tabbable's resting styles so a focus indicator is
   recognizable as a change. Call with nothing focused. */
async function snapshotRestingStyles(page: Page): Promise<void> {
  await page.evaluate(() => {
    const all = document.querySelectorAll<HTMLElement>(
      "a, button, input, select, textarea, [tabindex]",
    );
    for (const el of all) {
      const s = getComputedStyle(el);
      el.dataset.restingShadow = s.boxShadow;
      el.dataset.restingBorder = s.borderColor;
    }
  });
}

const readStop = (page: Page): Promise<Stop | null> =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    const outlineVisible = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
    const ringAppeared = s.boxShadow !== "none" && s.boxShadow !== el.dataset.restingShadow;
    const borderChanged =
      el.dataset.restingBorder !== undefined && s.borderColor !== el.dataset.restingBorder;
    return {
      label: (
        el.getAttribute("aria-label") ??
        el.getAttribute("placeholder") ??
        el.textContent ??
        ""
      ).trim(),
      focusVisible: el.matches(":focus-visible"),
      indicator: outlineVisible || ringAppeared || borderChanged,
    };
  });

/* One Tab press; null once focus falls back to the body (end of page). */
async function nextStop(page: Page): Promise<Stop | null> {
  await page.keyboard.press("Tab");
  return readStop(page);
}

function expectRinged(stop: Stop | null, what: string): void {
  expect(stop, `${what}: nothing focused`).not.toBeNull();
  expect(stop!.focusVisible, `${what} ("${stop!.label}") is not :focus-visible`).toBe(true);
  expect(stop!.indicator, `${what} ("${stop!.label}") has no visible focus indicator`).toBe(true);
}

/* Walk the rest of the page and hold it against the written order. The
   BODY sentinel at the end is part of the claim: the screen is exactly
   these stops — an unreachable control or a stray extra one fails. */
async function expectTabOrder(page: Page, expected: RegExp[]): Promise<void> {
  const stops: Stop[] = [];
  for (let i = 0; i < expected.length + 5; i++) {
    const stop = await nextStop(page);
    if (stop === null) break;
    stops.push(stop);
  }
  expect(
    stops.map((s) => s.label),
    `tab order does not match the written expectation`,
  ).toHaveLength(expected.length);
  for (const [i, pattern] of expected.entries()) {
    expect(stops[i].label, `stop ${i + 1} should match ${pattern}`).toMatch(pattern);
    expectRinged(stops[i], `stop ${i + 1}`);
  }
}

test.describe("US-P04: the charge path is walkable by keyboard (TD-010)", () => {
  test("search opens focused and is reachable; results before tabs, every stop ringed", async ({
    page,
  }) => {
    await stubStoreApi(page);
    await page.goto(`${TIENDA}/`);

    /* customer-search: the input holds focus on open — the shopkeeper
       types the ID without touching anything first */
    const search = page.getByPlaceholder("ID, teléfono o nombre");
    await expect(search).toBeFocused();

    await search.fill("Janely");
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();

    /* Rest the page, then prove the input is IN the tab order — not
       only autofocused: Tab leaves it, Shift+Tab comes back, and the
       return shows a visible indicator against true resting styles. */
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await snapshotRestingStyles(page);
    await page.keyboard.press("Tab"); /* → Limpiar búsqueda */
    await page.keyboard.press("Shift+Tab"); /* → back into the input */
    const input = await readStop(page);
    expect(input?.label).toMatch(/ID, teléfono o nombre/);
    expectRinged(input, "the search input");

    /* From the input: clear → the result → the three tabs. The result
       comes before the navigation: content first, escape after. */
    await expectTabOrder(page, [
      /Limpiar búsqueda/,
      /Janely Guadalupe Reyes/,
      /^Cobrar$/,
      /^Caja$/,
      /^Movimientos$/,
    ]);
  });

  test("Enter on a result opens the confirm screen; one Tab reaches the money", async ({
    page,
  }) => {
    await stubStoreApi(page);
    await page.goto(`${TIENDA}/`);
    await page.getByPlaceholder("ID, teléfono o nombre").fill("Janely");
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();

    /* Keyboard only from here: Tab to the result, Enter to open it */
    await page.keyboard.press("Tab"); /* Limpiar búsqueda */
    await page.keyboard.press("Tab"); /* the result */
    await page.keyboard.press("Enter");

    /* The quote has to be on screen before the walk starts */
    const pay = page.getByRole("button", { name: /cobrar \$514\.00/i });
    await expect(pay).toBeVisible();

    /* The decisive action is the first stop of the new screen */
    await snapshotRestingStyles(page);
    const stop = await nextStop(page);
    expect(stop?.label).toMatch(/Cobrar \$514\.00/);
    expectRinged(stop, "the charge button");
  });
});

test.describe("US-P04: the admin's confirm flow is walkable by keyboard (TD-010)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Entregas: sections, session, then the pending card's two actions", async ({ page }) => {
    await stubAdminApi(page);
    await page.goto(`${ADMIN}/cash-drops`);
    await expect(page.getByRole("button", { name: /confirmar entrega/i })).toBeVisible();

    /* Sidebar first (the dashboard's spine), then the card's decisive
       pair — confirm before dispute, matching their visual order. */
    await snapshotRestingStyles(page);
    await expectTabOrder(page, [
      /^Cobros$/,
      /^Tiendas$/,
      /^Entregas/ /* carries the pending-count badge ("Entregas1") */,
      /^Configuración$/,
      /Cerrar sesión/,
      /Confirmar entrega/,
      /Marcar en disputa/,
    ]);
  });
});

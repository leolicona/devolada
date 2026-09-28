import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { stubAdminApi } from "./stubs";

/* docs/legacy/polish/accessibility.spec.md — US-P04, paying TD-010.

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

test.describe("US-P04: the admin's links flow is walkable by keyboard (TD-010)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Links: sections, session, then the search — the flow's first decision", async ({ page }) => {
    await stubAdminApi(page);
    await page.goto(`${ADMIN}/links`);
    await expect(page.getByPlaceholder(/buscar por nombre/i)).toBeVisible();
    /* links-on-demand-search FR-001: the first block is a provider read,
       so it does NOT arrive with the page — the walk waits for the rows
       rather than racing them */
    await expect(page.getByRole("button", { name: /whatsapp/i }).first()).toBeVisible();

    /* Sidebar first (the dashboard's spine), then the screen's controls
       in reading order: the search box is the first control on the
       screen — "Actualizar" retired with presence-freshness D1
       (2026-09-03), and the freshness label retired with it
       (links-on-demand-search FR-027 / D15), so nothing stands between
       the box and the first customer's actions. (The store-era walk
       retired with the network, 2026-08-31.) */
    await snapshotRestingStyles(page);
    await expectTabOrder(page, [
      /^Saldo:/ /* the credit chip (prepaid-credit D7) sits under the business name, before the spine */,
      /^Pagos$/,
      /* cobros-in-links FR-014: Cobros is no longer a section — its view is
         Links' Por cobrar chip, below */
      /^Links$/,
      /^Integraciones$/ /* the hub (integrations-hub D1), owner-only */,
      /Cuenta$/ /* the account hub (US-A05): the avatar (its initials precede the word) is the fifth section; the sidebar's Cerrar sesión lives inside it now */,
      /Todos/ /* cobros-in-links D14: the chip is one tab stop — the chosen tab; the arrow keys move between Todos and Por cobrar, as tabs do */,
      /Buscar por nombre/,
      /Copiar/ /* the first customer's actions — shown whether or not their link exists yet (FR-008) */,
      /WhatsApp/ /* one word for the channel (pilot-UX review) */,
      /Copiar/ /* automated-collections-api FR-011 (T076): the API link joins the same block, with the same two actions */,
      /WhatsApp/,
    ]);
  });
});

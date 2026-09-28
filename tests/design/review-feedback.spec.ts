import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { businessActor, cobros, feed, integrationsHub, customersBlock } from "../e2e/stubs";

/* feedback-vocabulary-rollout US1/US2 — the screens a reviewer should look at.

   These are new captures, so the first run has nothing to diff against; they
   are here to be READ, and to give scripts/review-diff.mjs a baseline for the
   next change. The surfaces review-foundations.spec.ts already covers (dialog,
   sheet, confirmation) are not repeated.

   Nothing here photographs an arrival. A fade is not a still image, and a
   capture taken mid-fade records whichever frame the scheduler happened to be
   on — that is the trap `001-design-foundations` fell into twice. Arrivals are
   asserted in tests/e2e/motion.spec.ts, on computed style. What a picture CAN
   answer is what the arrived surface looks like in both themes, and what a
   loading screen looks like while it waits. */

const OUT = ".design/screenshots";

const envelope = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

function json(page: Page, pattern: string, data: unknown) {
  return page.route(pattern, (route) =>
    route.request().resourceType() === "document" ? route.fallback() : route.fulfill(envelope(data)),
  );
}

async function stubAdmin(page: Page) {
  await json(page, "**/auth/me", businessActor);
  await json(page, "**/payments/feed*", feed);
  /* cobros-in-links D1: the block carries `?limit=` */
  await json(page, "**/payment-requests*", cobros);
  await json(page, "**/integrations", integrationsHub);
  await json(page, "**/direct-payments/customers*", customersBlock);
  /* cobros-in-links D12: the open invoices are a view of Links now, and
     every render of Links asks for the one-time cleanup's count */
  await json(page, "**/direct-payments/prune-notice", null);
}

/* The breath is an opacity animation, so a still frame of it is a coin toss.
   Removing it and pinning the value from the token gives the same picture
   every run, and the value is still the product's own rather than a number
   invented for the camera (baselines/README.md). */
async function pinBreath(page: Page, phase: "peak" | "trough") {
  await page.addStyleTag({
    content:
      phase === "peak"
        ? '[data-motion="breath"] { animation: none !important; opacity: 1 !important; }'
        : '[data-motion="breath"] { animation: none !important; opacity: var(--opacity-breath) !important; }',
  });
}

for (const theme of ["light", "dark"] as const) {
  const suffix = theme === "dark" ? "-dark" : "";

  for (const phase of ["peak", "trough"] as const) {
    test(`feedback-pending-${phase} 1280 ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.emulateMedia({ colorScheme: theme });
      await stubAdmin(page);

      /* Held open so the shape is on screen when the shutter fires. Registered
         after stubAdmin: Playwright checks route handlers in reverse order, so
         the later one wins for the same pattern. */
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      await page.route("**/payment-requests*", async (route) => {
        /* The SPA route and the API path share this name, so a document
           request must fall through or the browser is handed JSON instead of
           the app and nothing renders at all. */
        if (route.request().resourceType() === "document") return route.fallback();
        await held;
        return route.fulfill(envelope(cobros));
      });

      /* cobros-in-links D12: the open invoices are Links' Por cobrar view;
         the Cobros section's address is retired */
      await page.goto(`${ADMIN}/links?view=receivables`);
      await expect(page.locator('[data-motion="breath"]').first()).toBeVisible({ timeout: 15_000 });
      await pinBreath(page, phase);
      await page.screenshot({ path: `${OUT}/review-feedback-pending-${phase}-1280${suffix}.png` });
      release();
    });
  }

  test(`feedback-popover 1280 ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: theme });
    await stubAdmin(page);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Fechas" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    /* Past the arrival, so the picture is of the surface and not of a frame
       part-way through its fade. */
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/review-feedback-popover-1280${suffix}.png` });
  });
}

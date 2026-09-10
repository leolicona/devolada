import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { feed, holdApiRoute, stubAdminApi } from "./stubs";

/* feedback-vocabulary-rollout US1 — the questions a simulated DOM cannot answer.

   happy-dom reports no layout, so `invisible` and `hidden` look identical to
   it: it can prove which element rendered, never that the page stayed still.
   And it cannot tell a wait the operator started from one they did not, because
   that difference is a real refetch on a real focus event.

   Both live here. */

/* Everything the operator can actually see of a pending state: the breath is a
   class, but what matters is whether anything is PAINTED. `visibility` answers
   that where a display check would not — the whole point of holding the space
   is that the box is still there. */
async function paintedPendingRegions(page: Page): Promise<number> {
  return page.evaluate(() => {
    let painted = 0;
    for (const el of Array.from(document.querySelectorAll('[data-motion="breath"]'))) {
      if (getComputedStyle(el).visibility !== "hidden") painted++;
    }
    return painted;
  });
}

test.describe("feedback-vocabulary-rollout US1: a wait shorter than a glance leaves no trace", () => {
  test("nothing is painted, and nothing moves, when the answer beats the threshold", async ({
    page,
  }) => {
    await stubAdminApi(page);
    const release = await holdApiRoute(page, "**/payments/feed*", feed);

    await page.goto(ADMIN);
    /* The heading is not behind the query, so it is on screen while the feed
       is still out. Its box is the ruler: if the shape appeared and then gave
       way to rows, everything below it would jump. */
    const anchor = page.getByRole("heading", { level: 1 });
    await expect(anchor).toBeVisible();
    const before = await anchor.boundingBox();

    /* Well inside the flash threshold. */
    await page.waitForTimeout(120);
    expect(await paintedPendingRegions(page)).toBe(0);

    release();
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();

    const after = await anchor.boundingBox();
    expect(after?.y).toBe(before?.y);
    /* And it never appeared on the way, either: the assertion is that the
       signal was NEVER painted, not that it is gone by the end. A signal that
       flashes on and off inside a fifth of a second has already done the harm.
       */
    expect(await paintedPendingRegions(page)).toBe(0);
  });

  test("a wait the operator did not start stays silent (SC-011)", async ({ page }) => {
    await stubAdminApi(page);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();

    /* TanStack refetches on focus by default, and apps/admin/src/main.tsx
       builds `new QueryClient()` with no options, so this is the real thing —
       not a simulated one. */
    const held = await holdApiRoute(page, "**/payments/feed*", feed);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });

    /* Long past the threshold: if a refetch could raise a signal, it would
       have by now. */
    await page.waitForTimeout(600);
    expect(await paintedPendingRegions(page)).toBe(0);
    /* And the rows the operator was reading are still there. */
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();
    held();
  });

  test("a real wait does show, so the two tests above are not both vacuous", async ({ page }) => {
    /* Without this the pair could pass on a page that never renders a pending
       region at all — the failure mode 001 shipped four times. */
    await stubAdminApi(page);
    const release = await holdApiRoute(page, "**/payments/feed*", feed);

    await page.goto(ADMIN);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(400);

    expect(await paintedPendingRegions(page)).toBeGreaterThan(0);
    await expect(page.getByRole("status")).toContainText(/cargando/i);
    release();
  });
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { stubAdminApi } from "./stubs";

/* docs/polish/dark-and-contrast.spec.md, the half a token file cannot
   prove. contrast-lint measures the palette; this measures the pixels —
   an ink can pass on paper and still land on a surface nobody predicted,
   and only a browser knows which colours actually met. */

const screens = [
  { name: "Cobros", url: ADMIN, stub: stubAdminApi, ready: "Janely Guadalupe Reyes" },
  { name: "WispHub", url: `${ADMIN}/integrations/wisphub`, stub: stubAdminApi, ready: "Ejecutar acciones automáticamente" },
  /* account-hub (US-A05): the rail, the identity card and the door */
  { name: "Cuenta", url: `${ADMIN}/settings`, stub: stubAdminApi, ready: "Cerrar sesión" },
] as const;

for (const theme of ["light", "dark"] as const) {
  test.describe(`US-P02/US-P04: real contrast in ${theme}`, () => {
    for (const screen of screens) {
      test(`${screen.name} has no contrast violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await screen.stub(page);
        await page.goto(screen.url);
        await expect(page.getByText(screen.ready).first()).toBeVisible();

        const results = await new AxeBuilder({ page })
          /* Only the rules that need real rendering: the markup rules
             already run per-screen in the component layer. */
          .withRules(["color-contrast", "target-size"])
          .analyze();

        const readable = results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.failureSummary?.split("\n").slice(-1)[0]).join(" | ")}`,
        );
        expect(readable, `${screen.name} in ${theme}`).toEqual([]);
      });
    }
  });
}

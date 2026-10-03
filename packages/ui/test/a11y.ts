import axe from "axe-core";
import { expect } from "vitest";

/* Accessibility checks on rendered atoms, the same helper the apps keep in
   their own test/a11y.ts (docs/legacy/TESTING.md). The atoms that grew whole
   screens of their own — the código field, the activation step, the keys card
   (passwordless-access D12) — are checked here once, where they are defined,
   rather than only through whichever screen happens to render them.

   Contrast and target size are excluded on purpose: happy-dom applies no
   stylesheet and reports no layout, so any verdict on either would be
   invented. `scripts/contrast-lint.mjs` and the browser layer measure them. */

const DISABLED = ["color-contrast", "target-size"];

export async function expectNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: Object.fromEntries(DISABLED.map((id) => [id, { enabled: false }])),
  });

  if (results.violations.length) {
    const report = results.violations
      .map((v) => {
        const where = v.nodes.map((n) => `      ${n.html.slice(0, 120)}`).join("\n");
        return `  ${v.id} (${v.impact}): ${v.help}\n${where}`;
      })
      .join("\n");
    expect.fail(`axe found ${results.violations.length} violation(s):\n${report}`);
  }
}

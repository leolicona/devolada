import axe from "axe-core";
import { expect } from "vitest";

/* Accessibility checks on rendered screens (US-P04, docs/TESTING.md).

   axe runs against the DOM the component tests already produce, so a
   missing label or an unnamed control fails in CI instead of waiting for
   a screen reader to find it. Contrast is excluded on purpose: happy-dom
   does not apply our stylesheet, so any colour verdict here would be
   invented — `scripts/contrast-lint.mjs` measures the real palette. */

const DISABLED = [
  "color-contrast",
  /* happy-dom reports no layout, so anything geometric is guesswork */
  "target-size",
];

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

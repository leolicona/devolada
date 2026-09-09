#!/usr/bin/env node
/* Constitution VII: a test cites the user story it proves, so spec coverage
   can be traced with grep. Warning-only until the test infrastructure lands;
   becomes an error when TD-005 is paid.

   The other half of this gate — every <feature>.spec.md registered in an
   index — retired with the legacy corpus on 2026-09-09. It policed
   docs/legacy/SPEC.md, and a feature specified with Spec Kit is indexed by
   Spec Kit itself under specs/NNN-slug/, not by a hand-kept index. The corpus
   it used to enforce now lives in leolicona/devoladapago-legacy-documentation,
   read-only; the golden rule for anything rebuilt is Spec Kit's to enforce. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;

function walk(dir, filter, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, filter, acc);
    else if (filter(name)) acc.push(path);
  }
  return acc;
}

const tests = ["apps", "packages"]
  .map((d) => join(root, d))
  .flatMap((d) => {
    try {
      return walk(d, (n) => /\.(test|spec)\.[jt]sx?$/.test(n)).filter(
        (p) => !p.includes("node_modules"),
      );
    } catch {
      return [];
    }
  });

/* A citation must identify its story globally. Spec Kit numbers stories per
   feature (US1, US2), so the new form carries the feature slug with it
   ("direct-payment US1: ..."); a bare US1 is not a citation. A feature not yet
   rebuilt keeps the US-XNN it carries in the archive, so both forms are
   accepted while the migration runs. Drop the legacy branch when the last
   domain lands. */
const STORY_CITATION = /US-[A-Z]\d{2}|[a-z][a-z0-9-]*\s+US\d+\b/;

const withoutStory = tests.filter((t) => !STORY_CITATION.test(readFileSync(t, "utf8")));
if (withoutStory.length) {
  console.warn(
    "⚠ Tests without a cited story (US-XNN, or <feature-slug> US<n>) — becomes an error once TD-005 is paid:",
  );
  for (const t of withoutStory) console.warn(`  - ${relative(root, t)}`);
}

console.log(`✔ spec-lint: ${tests.length} test files checked`);

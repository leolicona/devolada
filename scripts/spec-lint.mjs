#!/usr/bin/env node
/* Golden-rule enforcement (docs/legacy/SPEC.md):
   1. Every docs/<domain>/<feature>.spec.md must be referenced in SPEC.md's index.
   2. Test files must cite user stories (US-...). Warning-only until the test
      infrastructure lands; becomes an error when TD-005 is paid. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
/* Spec Kit migration (docs/spec-kit-migration.eval.md): the corpus lives under
   docs/legacy/ until PR3 rebuilds it. The golden rule follows it there so the
   archive cannot rot while it is still the source PR3 reads. Delete this
   branch — and the directory — when legacy is emptied in the final PR. */
const legacyDir = join(root, "docs", "legacy");
const docsDir = existsSync(legacyDir) ? legacyDir : join(root, "docs");
const docsLabel = relative(root, docsDir);

function walk(dir, filter, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, filter, acc);
    else if (filter(name)) acc.push(path);
  }
  return acc;
}

const spec = readFileSync(join(docsDir, "SPEC.md"), "utf8");
const specFiles = walk(docsDir, (n) => n.endsWith(".spec.md"));

const orphans = specFiles.filter((path) => !spec.includes(relative(docsDir, path)));

if (orphans.length) {
  console.error(`✘ Specs not registered in ${docsLabel}/SPEC.md (golden rule):`);
  for (const o of orphans) console.error(`  - ${relative(root, o)}`);
  process.exit(1);
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

const withoutStory = tests.filter((t) => !/US-[A-Z]\d{2}/.test(readFileSync(t, "utf8")));
if (withoutStory.length) {
  console.warn("⚠ Tests without a cited story (US-XNN) — becomes an error once TD-005 is paid:");
  for (const t of withoutStory) console.warn(`  - ${relative(root, t)}`);
}

console.log(
  `✔ spec-lint: ${specFiles.length} specs registered under ${docsLabel}, ${tests.length} test files checked`,
);

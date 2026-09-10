#!/usr/bin/env node
/* Every word that says "we are working" must sit inside a region that shows it.
 *
 *   node scripts/pending-lint.mjs
 *
 * The instrument SC-001 was missing (feedback-vocabulary-rollout, converge
 * F1/F2/F4). The spec says "the count of operator-initiated waits that show no
 * pending treatment is zero", and nothing counted them — so nine controls
 * shipped a greyed-out button with a changed word and no signal, six of them on
 * the log-in and recovery screens. They survived every sweep because those
 * sweeps grepped for `isPending`, `Skeleton` and `ListError`, and a wait whose
 * state lives in a local `useState` boolean matches none of them.
 *
 * What it keys on instead is the product's own copy convention, which is
 * consistent across both surfaces: an in-progress label is a Spanish present
 * participle followed by an ellipsis — "Guardando…", "Enviando…", "Subiendo…".
 * That is a claim the screen makes to the person reading it, and it is exactly
 * the thing that must be accompanied by a visible signal.
 *
 * Deliberately NOT a general "did you use Pending" lint. It asks one question
 * with a clear yes or no, so it never cries wolf — the failure mode that gets a
 * gate skipped, and the reason `.specify/debt/no-literal-gate` is still open
 * rather than guessed at.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps/admin/src", "apps/pago/src", "packages/ui/src"];

/* A quoted string whose last word before the ellipsis is a present participle.
   "ana@wifiplus…" and "STP, BBVA, Banorte…" are ellipses too, and neither is a
   claim that something is happening — this is what tells them apart. */
const WAITING = /"[^"\n]*?(?:ando|endo)…"/g;

/* Comments are prose about the code, not copy the screen shows. This file's own
   sibling components explain the convention IN their comments — `never the word
   "Cargando…"` in skeleton.tsx — and a check that reads those flags the very
   documentation that describes it. Blanked to spaces rather than removed, so
   reported line numbers still point at the real line. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/* Character ranges covered by a <Pending …> … </Pending> block, nesting-aware.
   Ranges, not "does the file contain a Pending": a file with one covered wait
   and one bare one must fail, and a file-level check would pass it. */
function pendingRanges(src) {
  const ranges = [];
  const open = /<Pending[\s>]/g;
  const stack = [];
  const token = /<Pending[\s>]|<\/Pending>/g;
  let m;
  while ((m = token.exec(src))) {
    if (m[0] === "</Pending>") {
      const start = stack.pop();
      if (start !== undefined && stack.length === 0) ranges.push([start, m.index + m[0].length]);
    } else {
      stack.push(m.index);
    }
  }
  void open;
  return ranges;
}

const offenders = [];
let waits = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = stripComments(readFileSync(file, "utf8"));
    const ranges = pendingRanges(src);
    let m;
    WAITING.lastIndex = 0;
    while ((m = WAITING.exec(src))) {
      waits += 1;
      const covered = ranges.some(([a, b]) => m.index >= a && m.index < b);
      if (covered) continue;
      const line = src.slice(0, m.index).split("\n").length;
      offenders.push(`${file}:${line} — ${m[0]} is not inside a <Pending>`);
    }
  }
}

if (offenders.length) {
  console.error("✗ pending-lint: a wait says so in words but shows nothing:");
  for (const o of offenders) console.error(`  - ${o}`);
  console.error(
    "\n  Wrap the control in <Pending active={…} label=\"…\">, or change the copy" +
      "\n  if it is not really announcing work in progress.",
  );
  process.exit(1);
}

console.log(`✔ pending-lint: ${waits} in-progress labels, every one inside a pending region`);

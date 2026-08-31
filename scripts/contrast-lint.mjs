#!/usr/bin/env node
/* Contrast enforcement for the design tokens (docs/FRONTEND.md).

   The brief says minimum AA, with AAA as the target on amounts and
   statuses, and it says dark is its own palette rather than an
   inversion. Both claims were unverified until this script: a palette
   nobody measures is a palette that drifts one hex at a time.

   It reads tokens.css directly — the live file is the law — resolves
   the light and dark blocks, composites translucent colors over the
   surface they sit on, and checks the pairs the UI actually renders. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const css = readFileSync(`${root}packages/ui/src/styles/tokens.css`, "utf8");

const AA_NORMAL = 4.5;
const AA_LARGE = 3; /* also the floor for UI borders and icons */
const AAA = 7;

/* ---------- parsing ---------- */

function block(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`tokens.css has no ${selector} block`);
  const open = css.indexOf("{", start);
  const end = css.indexOf("\n}", open);
  const vars = {};
  for (const line of css.slice(open, end).split("\n")) {
    const m = /^\s*(--[\w-]+):\s*([^;]+);/.exec(line);
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}

const light = block(":root {");
const dark = { ...light, ...block('[data-theme="dark"]') };

/* ---------- color maths ---------- */

function parse(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+))?\s*\)$/i.exec(value);
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }
  return null;
}

/* A translucent badge background is not its own color: what the eye
   compares is the result of laying it over the surface behind it. */
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

function luminance({ r, g, b }) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg, bg) {
  const a = luminance(fg) + 0.05;
  const b = luminance(bg) + 0.05;
  return a > b ? a / b : b / a;
}

/* ---------- the pairs the UI actually renders ---------- */

const PAIRS = [
  /* Body and headings on every surface */
  { fg: "--color-text-primary", bg: "--color-bg-primary", min: AA_NORMAL, what: "body text on the page" },
  { fg: "--color-text-primary", bg: "--color-bg-secondary", min: AA_NORMAL, what: "body text on cards" },
  { fg: "--color-text-primary", bg: "--color-bg-tertiary", min: AA_NORMAL, what: "body text on wells" },
  { fg: "--color-text-secondary", bg: "--color-bg-primary", min: AA_NORMAL, what: "secondary text" },
  { fg: "--color-text-secondary", bg: "--color-bg-secondary", min: AA_NORMAL, what: "secondary text on cards" },
  { fg: "--color-text-link", bg: "--color-bg-primary", min: AA_NORMAL, what: "links" },
  { fg: "--color-text-inverse", bg: "--color-accent-primary", min: AA_NORMAL, what: "text on the accent button" },

  /* Statuses: the brief's AAA target, because they carry meaning */
  { fg: "--color-status-success", bg: "--color-status-success-bg", min: AA_NORMAL, aim: AAA, what: "success badge" },
  { fg: "--color-status-warning", bg: "--color-status-warning-bg", min: AA_NORMAL, aim: AAA, what: "warning badge" },
  { fg: "--color-status-error", bg: "--color-status-error-bg", min: AA_NORMAL, aim: AAA, what: "error badge" },
  { fg: "--color-status-info", bg: "--color-status-info-bg", min: AA_NORMAL, what: "info badge" },
  /* The same inks also appear as plain text on the page */
  { fg: "--color-status-success", bg: "--color-bg-primary", min: AA_NORMAL, aim: AAA, what: "success text (amounts)" },
  { fg: "--color-status-error", bg: "--color-bg-primary", min: AA_NORMAL, what: "error text" },

  /* Controls: WCAG 1.4.11 wants 3:1 for the boundary of anything you
     have to find and use. Card borders are decorative and exempt — an
     input is not, and ours sits on a fill the page barely differs from. */
  { fg: "--color-border-input", bg: "--color-bg-primary", min: AA_LARGE, what: "input border on the page" },
  { fg: "--color-border-input", bg: "--color-bg-secondary", min: AA_LARGE, what: "input border on cards" },
  { fg: "--color-border-input", bg: "--color-bg-tertiary", min: AA_LARGE, what: "input border against its own fill" },
  { fg: "--color-border-focus", bg: "--color-bg-primary", min: AA_LARGE, what: "focus ring" },
];

/* Translucent status backgrounds sit on the page, not in a vacuum */
const SURFACE_OF = {
  "--color-status-success-bg": "--color-bg-primary",
  "--color-status-warning-bg": "--color-bg-primary",
  "--color-status-error-bg": "--color-bg-primary",
  "--color-status-info-bg": "--color-bg-primary",
  "--color-accent-primary-subtle": "--color-bg-primary",
};

function resolve(vars, name) {
  const raw = vars[name];
  if (!raw) throw new Error(`token ${name} is not defined`);
  const color = parse(raw);
  if (!color) throw new Error(`token ${name} is not a color this script reads: ${raw}`);
  if (color.a === 1) return color;
  const surface = parse(vars[SURFACE_OF[name] ?? "--color-bg-primary"]);
  return over(color, surface);
}

let failures = 0;
let aimMisses = 0;

for (const [theme, vars] of [
  ["light", light],
  ["dark", dark],
]) {
  for (const pair of PAIRS) {
    const ratio = contrast(resolve(vars, pair.fg), resolve(vars, pair.bg));
    const rounded = Math.round(ratio * 100) / 100;
    if (ratio < pair.min) {
      failures++;
      console.error(`✘ ${theme}: ${pair.what} — ${rounded}:1, needs ${pair.min}:1 (${pair.fg} on ${pair.bg})`);
    } else if (pair.aim && ratio < pair.aim) {
      aimMisses++;
      console.warn(`⚠ ${theme}: ${pair.what} — ${rounded}:1, AA holds but the AAA target is ${pair.aim}:1`);
    }
  }
}

/* tokens.css declares the dark palette twice — once for the explicit
   [data-theme="dark"] toggle and once for the system preference. Two
   copies of the same truth drift, so they are compared here. */
const darkToggle = block('[data-theme="dark"]');
const darkSystem = block(":root:not([data-theme=\"light\"])");
for (const token of new Set([...Object.keys(darkToggle), ...Object.keys(darkSystem)])) {
  if (darkToggle[token] !== darkSystem[token]) {
    failures++;
    console.error(
      `✘ ${token} differs between the two dark blocks: ` +
        `${darkToggle[token] ?? "(missing)"} vs ${darkSystem[token] ?? "(missing)"}`,
    );
  }
}

/* Dark is its own palette, not an inversion: if a status ink is
   identical in both themes, nobody recalibrated it. */
for (const token of [
  "--color-status-success",
  "--color-status-warning",
  "--color-status-error",
  "--color-accent-primary",
]) {
  if (light[token] === dark[token]) {
    failures++;
    console.error(`✘ ${token} is the same in both themes — dark is a palette, not an inversion`);
  }
}

/* The other half of the same law: a color written straight into a
   component cannot follow the theme, so dark mode breaks one hex at a
   time. tokens.css is the only file allowed to name a color. */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;

function sources(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".wrangler") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, acc);
    else if (/\.(tsx?|css)$/.test(name) && !path.endsWith("tokens.css")) acc.push(path);
  }
  return acc;
}

for (const dir of ["apps/admin/src", "apps/pago/src", "packages/ui/src"]) {
  for (const file of sources(join(root, dir))) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      /* A url(data:image/svg+xml...) may legitimately carry a fill */
      if (COLOR_LITERAL.test(line) && !line.includes("url(")) {
        failures++;
        console.error(`✘ hardcoded color in ${relative(root, file)}:${i + 1} — tokens.css owns colors`);
      }
    });
  }
}

if (failures) {
  console.error(`\n✘ contrast-lint: ${failures} failing pair(s)`);
  process.exit(1);
}
console.log(
  `✔ contrast-lint: ${PAIRS.length * 2} pairs in both themes at AA, no hardcoded colors` +
    (aimMisses ? ` (${aimMisses} below the AAA target)` : ""),
);

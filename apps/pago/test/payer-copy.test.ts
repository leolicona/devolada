import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/* confirmation-hierarchy US4 (spec SC-006, FR-020, FR-021; plan D16) — the
   payer reads about their transfer, never about who checks it, and never
   that the business sells internet.

   Not a review: a scan of every string the payer page can render. Each
   `.ts`/`.tsx` file under `apps/pago/src` is parsed with the TypeScript
   compiler, and every string literal, template-literal chunk and piece of
   JSX text is read — plus the `<title>` of `index.html`, the browser tab.
   Comments are not strings, so the decision trail that explains Banxico
   in the code stays where it is. The first offender fails the test with
   its file, line and text. */

/* happy-dom gives `import.meta.url` an http origin, so the folder comes
   from Node: this file sits in `apps/pago/test` */
const root = join(import.meta.dirname, "..");
const src = join(root, "src");

/* The one string under `src` that names Banxico and is never rendered: the
   bank code `payer-banks.ts` filters OUT of every list the payer sees
   (D15). Named by file and text, so a second one fails. */
const NOT_COPY = new Set(["src/features/pago/payer-banks.ts:BANXICO"]);

const FORBIDDEN = /banxico|internet/i;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

type Found = { file: string; line: number; text: string };

function strings(path: string): Found[] {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const file = relative(root, path);
  const found: Found[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const value = ts.isJsxText(node) ? node.getText(source) : node.text;
      if (value.trim()) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push({ file, line: line + 1, text: value.trim() });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("confirmation-hierarchy US4: no payer-facing text names Banxico or says internet (T025, D16, SC-006)", () => {
  it("every string, template chunk and JSX text under apps/pago/src", () => {
    const all = files(src).flatMap(strings);
    /* the scan reads what the page says — a scan that read nothing would pass */
    expect(all.length).toBeGreaterThan(500);
    expect(all.some((s) => s.text.includes("Confirmar pago"))).toBe(true);
    const offenders = all
      .filter((s) => FORBIDDEN.test(s.text) && !NOT_COPY.has(`${s.file}:${s.text}`))
      .map((s) => `${s.file}:${s.line} ${JSON.stringify(s.text)}`);
    expect(offenders).toEqual([]);
  });

  it("the browser tab", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    expect(title).toBe("Tu pago");
    expect(title).not.toMatch(FORBIDDEN);
  });

  it("the scan sees what a sentence would hide in: a template literal and JSX text", () => {
    /* the instrument checked against itself, so a parser change that read
       nothing cannot pass silently */
    const probe = join(src, "features/pago/RootScreen.tsx");
    expect(strings(probe).some((s) => s.text === "Tu pago")).toBe(true);
    const sample = ts.createSourceFile(
      "probe.tsx",
      "const a = `Contacta a ${x} en Banxico`; const b = <p>tu internet</p>;",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const texts: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isTemplateTail(node) || ts.isJsxText(node)) texts.push(ts.isJsxText(node) ? node.getText(sample) : node.text);
      ts.forEachChild(node, visit);
    };
    visit(sample);
    expect(texts.filter((t) => FORBIDDEN.test(t))).toHaveLength(2);
  });
});

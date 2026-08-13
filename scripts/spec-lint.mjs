#!/usr/bin/env node
/* Enforcement de la regla de oro (docs/SPEC.md):
   1. Todo docs/<dominio>/<feature>.spec.md debe estar referenciado en el índice de SPEC.md.
   2. Los archivos de test deben citar historias (US-...). Advertencia mientras no
      exista infraestructura de tests; se volverá error al pagar TD-005. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;
const docsDir = join(raiz, "docs");

function buscar(dir, filtro, acc = []) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) buscar(ruta, filtro, acc);
    else if (filtro(nombre)) acc.push(ruta);
  }
  return acc;
}

const spec = readFileSync(join(docsDir, "SPEC.md"), "utf8");
const specsEncontrados = buscar(docsDir, (n) => n.endsWith(".spec.md"));

const huerfanos = specsEncontrados.filter(
  (ruta) => !spec.includes(relative(docsDir, ruta)),
);

if (huerfanos.length) {
  console.error("✘ Specs no registrados en docs/SPEC.md (regla de oro):");
  for (const h of huerfanos) console.error(`  - ${relative(raiz, h)}`);
  process.exit(1);
}

const tests = ["apps", "packages"]
  .map((d) => join(raiz, d))
  .flatMap((d) => {
    try {
      return buscar(d, (n) => /\.(test|spec)\.[jt]sx?$/.test(n)).filter(
        (r) => !r.includes("node_modules"),
      );
    } catch {
      return [];
    }
  });

const sinHistoria = tests.filter((t) => !/US-[A-Z]\d{2}/.test(readFileSync(t, "utf8")));
if (sinHistoria.length) {
  console.warn("⚠ Tests sin historia (US-XNN) citada — será error al pagar TD-005:");
  for (const t of sinHistoria) console.warn(`  - ${relative(raiz, t)}`);
}

console.log(
  `✔ spec-lint: ${specsEncontrados.length} specs registrados, ${tests.length} archivos de test revisados`,
);

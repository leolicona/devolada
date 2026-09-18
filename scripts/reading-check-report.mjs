/* two-eyes-receipt D10 (SC-008) — the ratio, as a query.

   The creator's question, asked before the feature was built: how often
   do the two machines agree, and how often does a payer still have to be
   asked? Guessing at it a month later is not an answer, so the record
   was designed to answer it from day one (D19) — this report is that
   answer printed.

   Read-only, like `cep-latency-report.mjs` beside it: it runs the five
   queries of `specs/005-two-eyes-receipt/data-model.md` and prints
   markdown. It writes nothing, decides nothing and has no screen (the
   spec puts one out of scope): a number an operator reads once a week
   does not need a page.

   Usage:  node scripts/reading-check-report.mjs [--env local|dev]
   Default env is local. `dev` reads the remote dev database with
   `wrangler d1 execute --remote` — reading is not deploying. */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV = process.argv.includes("--env")
  ? process.argv[process.argv.indexOf("--env") + 1]
  : "local";
if (!["local", "dev"].includes(ENV)) {
  console.error(`unknown --env "${ENV}" (use local or dev)`);
  process.exit(1);
}

const DB = { dir: "apps/api", local: "devolada-db", dev: "devolada-db-dev" };

function query(sql) {
  const args = ["wrangler", "d1", "execute", DB[ENV], "--json", "--command", sql];
  if (ENV === "local") args.splice(4, 0, "--local");
  else args.splice(4, 0, "--remote", "--env", "dev");
  const out = execFileSync("npx", args, {
    cwd: path.join(ROOT, DB.dir),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out)[0].results;
}

const table = (headers, rows) => {
  if (!rows.length) return "_no rows yet_\n";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map((c) => (c == null ? "—" : String(c))).join(" | ")} |`),
  ].join("\n") + "\n";
};

console.log(`# Reading check — ${ENV}\n`);
console.log(`_${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC_\n`);

/* ---- 1. What the two readings said, on the calls that compared them ---- */
console.log("## First calls, by what the two readings said\n");
console.log(
  "Every provider-first call that came back `not_found` compared both readings\n" +
    "on the spot (D5). `agreed` is the one that costs nobody anything: the next\n" +
    "attempt goes straight to the transfer door and no human is disturbed.\n",
);
console.log(
  table(
    ["reading_check", "blind_side", "calls"],
    query(
      `SELECT reading_check, blind_side, COUNT(*) AS n
       FROM extractions
       WHERE validation_id IS NOT NULL AND reading_check IS NOT NULL
       GROUP BY 1, 2 ORDER BY n DESC`,
    ).map((r) => [r.reading_check, r.blind_side, r.n]),
  ),
);

/* ---- 2. The legacy flow, identified by shape and never by attempt ---- */
console.log("## Legacy crosses still running (D16)\n");
console.log(
  "A payment born before the cut-over: `proof_mode = 'transfer'` with a proof\n" +
    "key and no parent — a shape no new row can have (research R10). Counted by\n" +
    "that shape and **never** by `reading_check_attempt = 2`, because a new-flow\n" +
    "row whose inline attempt died classifies at attempt 2 as well (FR-018).\n" +
    "When this reaches zero on dev and on prod, the branch can be removed\n" +
    "(`.specify/debt/legacy-minute-two-cross/`).\n",
);
console.log(
  table(
    ["status", "reading_check", "payments"],
    query(
      `SELECT status, reading_check, COUNT(*) AS n
       FROM payments
       WHERE proof_mode = 'transfer' AND proof_key IS NOT NULL
         AND supersedes_id IS NULL AND reading_check IS NOT NULL
       GROUP BY 1, 2 ORDER BY n DESC`,
    ).map((r) => [r.status, r.reading_check, r.n]),
  ),
);

/* ---- 3. The provider blind while we read the whole thing ---- */
console.log("## Provider blind while we read fully\n");
console.log(
  "The case FR-013 exists for: their OCR read nothing off the image and ours\n" +
    "read every field. These payments reach the transfer door on their next\n" +
    "attempt instead of asking the payer, and each one is a question this\n" +
    "product used to ask and no longer does.\n",
);
console.log(
  table(
    ["calls"],
    query(
      `SELECT COUNT(*) AS n FROM extractions
       WHERE blind_side = 'provider' AND gate_tracking_key = 'ok' AND amount_cents IS NOT NULL`,
    ).map((r) => [r.n]),
  ),
);

/* ---- 4. What was refused before a credit was spent ---- */
console.log("## Refused before spending, and what it cost\n");
console.log(
  "The two refusals of D2. `credits_spent` is the number that matters and it\n" +
    "must stay zero: `validation_id` is NULL on every refusal row, because a\n" +
    "refusal never reached the provider. A non-zero here is a bug, not a cost.\n",
);
console.log(
  table(
    ["outcome", "files", "credits_spent"],
    query(
      `SELECT outcome, COUNT(*) AS n, SUM(validation_id IS NOT NULL) AS billed
       FROM extractions WHERE outcome IN ('not_a_receipt', 'illegible')
       GROUP BY 1 ORDER BY n DESC`,
    ).map((r) => [r.outcome, r.n, r.billed]),
  ),
);

/* ---- 5. PDFs: read here, or handed over unread ---- */
console.log("## PDFs, read at the edge or handed over unread (D1, D15)\n");
console.log(
  "`reader` is a PDF whose text conversion worked and which therefore got the\n" +
    "same draft a photograph gets. `provider-ocr` with `raw_output = 'no-text'`\n" +
    "is a scanned PDF: silent by design, and the number that says how often the\n" +
    "conversion is worth its call.\n",
);
console.log(
  table(
    ["source", "outcome", "reason", "files"],
    query(
      `SELECT source, outcome,
              CASE WHEN source = 'provider-ocr' THEN raw_output END AS reason,
              COUNT(*) AS n
       FROM extractions WHERE media_type = 'application/pdf'
       GROUP BY 1, 2, 3 ORDER BY n DESC`,
    ).map((r) => [r.source, r.outcome, r.reason, r.n]),
  ),
);

/* ---- 6. The free measurement: who was right when they disagreed ---- */
console.log("## Reader wrong, provider right — and the other way round\n");
console.log(
  "A confirmed payment whose CEP names a different clave than the reading on\n" +
    "its own billed call. Free, because both numbers were already on the row\n" +
    "(D19), and it is the only honest answer to 'which pair of eyes is better'.\n",
);
console.log(
  table(
    ["accepted_from", "cep ≠ our reading", "cep ≠ their reading"],
    query(
      `SELECT COALESCE(p.accepted_from, 'none') AS src,
              SUM(e.tracking_key IS NOT NULL AND UPPER(e.tracking_key) <> UPPER(p.tracking_key)) AS ours_wrong,
              SUM(e.provider_tracking_key IS NOT NULL AND UPPER(e.provider_tracking_key) <> UPPER(p.tracking_key)) AS theirs_wrong
       FROM payments p JOIN extractions e ON e.validation_id = p.consta_validation_id
       WHERE p.status = 'confirmed' AND p.tracking_key IS NOT NULL
       GROUP BY 1`,
    ).map((r) => [r.src, r.ours_wrong, r.theirs_wrong]),
  ),
);

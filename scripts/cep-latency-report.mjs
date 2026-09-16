/* Phase 0 of learned-retry (docs/legacy/consta/learned-retry.spec.md, US-V16).

   Read-only report over ONE D1: how long does Banxico take to publish a
   CEP, per bank cell? It joins the product's `payments` with the
   engine's `validations` — the same database since consta-api-merge D14
   — by tracking key and prints, as markdown:

   Until that feature the report joined two databases (the API's and the
   Consta Worker's) by tracking key through two `wrangler d1 execute`
   calls, and its first statement had been dead since migrations 0018 and
   0019 renamed `direct_payments` → `payments` and `isps` → `businesses`:
   the report had not run since. Repaired on the way, as the constitution
   asks (FR-019: the report reads one database).

   - per-transfer intervals (last not_found, first valid], censored by
     the schedule's own slots (spec D4)
   - sample counts and candidate p50/p90 per ladder cell (spec D2)
   - passive evidence for gate 2: quota_remaining deltas between
     consecutive checks of one transfer (spec D7)
   - the gate-1 verdict: which cells reach the minimum n, if any

   Usage:  node scripts/cep-latency-report.mjs [--env local|dev]
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

/* Hypothesis from spec D4, to be confirmed by this very report */
const MIN_N = 30;

/* One database (consta-api-merge D14): the engine's log lives beside the
   payments it describes */
const DB = { dir: "apps/api", local: "devolada-db", dev: "devolada-db-dev" };

function query(sql) {
  const db = DB;
  const args = ["wrangler", "d1", "execute", db[ENV], "--json", "--command", sql];
  if (ENV === "local") args.splice(4, 0, "--local");
  else args.splice(4, 0, "--remote", "--env", "dev");
  const out = execFileSync("npx", args, {
    cwd: path.join(ROOT, db.dir),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  /* wrangler --json prints an array with one result set */
  return JSON.parse(out)[0].results;
}

/* timestamp_ms columns are integer milliseconds; guard seconds just in case */
const ms = (t) => (t == null ? null : t < 1e12 ? t * 1000 : t);
const min = (msDelta) => Math.round(msDelta / 60000);

const payments = query(
  `SELECT p.tracking_key, p.sender_bank, b.spei_bank AS receiver_bank,
          p.status, p.created_at, p.confirmed_at, p.validation_attempts
   FROM payments p JOIN businesses b ON b.id = p.business_id
   WHERE p.tracking_key IS NOT NULL`,
);

const attempts = query(
  `SELECT tracking_key, status, reason, cep_status, quota_remaining,
          amount_cents, transfer_date, created_at
   FROM validations WHERE tracking_key IS NOT NULL ORDER BY created_at`,
);

/* ---- join by tracking key ---- */

const byKey = new Map();
for (const a of attempts) {
  const list = byKey.get(a.tracking_key) ?? [];
  list.push(a);
  byKey.set(a.tracking_key, list);
}
const paymentByKey = new Map(payments.map((p) => [p.tracking_key, p]));

/* One measured transfer: the interval where the CEP appeared */
const measured = [];
/* Gate 2 passive evidence: quota deltas between consecutive checks */
const quotaDeltas = [];

for (const [key, rows] of byKey) {
  rows.sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const firstSeen = ms(rows[0].created_at);
  const firstValid = rows.find((r) => r.status === "valid");
  const before = firstValid
    ? rows.filter((r) => ms(r.created_at) < ms(firstValid.created_at))
    : rows;
  const lastMiss = [...before]
    .reverse()
    .find((r) => r.status === "pending" || (r.status === "invalid" && r.reason === "not_found"));

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    if (
      prev.quota_remaining != null &&
      rows[i].quota_remaining != null &&
      (prev.status === "pending" || prev.reason === "not_found")
    ) {
      quotaDeltas.push({
        key,
        gapMin: min(ms(rows[i].created_at) - ms(prev.created_at)),
        delta: prev.quota_remaining - rows[i].quota_remaining,
      });
    }
  }

  if (!firstValid) continue;
  const p = paymentByKey.get(key);
  /* D4 second amendment — the two population rules. Rule 2: only
     attempts that asked with the inputs that validated ("honest asks");
     rule 1: the first honest ask must have missed, or the transfer
     measures upload lag / correction time, not Banxico. */
  const honest = rows.filter(
    (r) => r.amount_cents === firstValid.amount_cents && r.transfer_date === firstValid.transfer_date,
  );
  const conditional = honest.length > 0 && honest[0].status !== "valid";
  measured.push({
    key,
    sender: firstValid.sender_bank ?? p?.sender_bank ?? "?",
    receiver: p?.receiver_bank ?? "?",
    lowerMin: lastMiss ? min(ms(lastMiss.created_at) - firstSeen) : 0,
    upperMin: min(ms(firstValid.created_at) - firstSeen),
    conditional,
    condUpperMin: conditional ? min(ms(firstValid.created_at) - ms(honest[0].created_at)) : null,
    attempts: rows.filter((r) => ms(r.created_at) <= ms(firstValid.created_at)).length,
  });
}

/* ---- ladder cells over upper bounds (spec D4: upper bound rules) ---- */

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
const cells = new Map();
const drop = (name, m) => {
  const c = cells.get(name) ?? [];
  c.push(m);
  cells.set(name, c);
};
for (const m of measured) {
  drop(`pair ${m.sender} → ${m.receiver}`, m);
  drop(`receiver → ${m.receiver}`, m);
  drop(`sender ${m.sender} →`, m);
  drop("global", m);
}

/* ---- report ---- */

const lines = [];
lines.push(`# CEP latency report — env: ${ENV}, generated by phase 0 of US-V16`);
lines.push("");
lines.push(`Transfers with a tracking key in the engine's log: ${byKey.size}.`);
lines.push(`Confirmed (reached \`valid\`): ${measured.length}. Payments matched in Devolada: ${paymentByKey.size}.`);
lines.push("");

lines.push("## Measured intervals (schedule-censored, minutes from first attempt)");
lines.push("");
if (measured.length === 0) {
  lines.push("_No transfer reached `valid` yet — nothing to measure._");
} else {
  lines.push("| tracking key | sender → receiver | CEP appeared in | attempts spent | counts? |");
  lines.push("|---|---|---|---|---|");
  for (const m of measured.sort((a, b) => a.upperMin - b.upperMin)) {
    lines.push(
      `| \`${m.key}\` | ${m.sender} → ${m.receiver} | (${m.lowerMin}, ${m.upperMin}] min | ${m.attempts} | ${m.conditional ? "✓" : "✗ first honest ask succeeded"} |`,
    );
  }
}
lines.push("");

lines.push("## Ladder cells — conditional population vs raw (D4, second amendment)");
lines.push("");
lines.push("| cell | n raw | n cond ​| p50 cond | p90 cond | p90 raw | median blur |");
lines.push("|---|---|---|---|---|---|---|");
for (const [name, list] of [...cells.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const uppers = list.map((m) => m.upperMin).sort((a, b) => a - b);
  const cond = list.filter((m) => m.conditional).map((m) => m.condUpperMin).sort((a, b) => a - b);
  const blurs = list.map((m) => m.upperMin - m.lowerMin).sort((a, b) => a - b);
  const open = cond.length >= MIN_N ? " ✅" : "";
  const c = (p) => (cond.length ? `${pct(cond, p)} min` : "—");
  lines.push(
    `| ${name} | ${list.length} | ${cond.length}${open} | ${c(0.5)} | ${c(0.9)} | ${pct(uppers, 0.9)} min | ±${pct(blurs, 0.5)} min |`,
  );
}
lines.push("");
lines.push(
  `Only "n cond" opens a cell: transfers whose first honest ask missed. The raw column stays to show the pollution — a receipt uploaded late validates "in 0 minutes" while measuring the upload lag, not Banxico (measured live 2026-08-28). "Median blur" is the interval width — the schedule's own slots censoring the measurement (spec D4).`,
);
lines.push("");

lines.push("## Gate 2 — passive evidence (do pending re-checks bill?)");
lines.push("");
if (quotaDeltas.length === 0) {
  lines.push("_No consecutive checks with `quota_remaining` on both sides — run the live experiment (spec D7 gate 2)._");
} else {
  lines.push("| tracking key | gap between checks | quota delta |");
  lines.push("|---|---|---|");
  for (const q of quotaDeltas) lines.push(`| \`${q.key}\` | ${q.gapMin} min | ${q.delta} |`);
  lines.push("");
  lines.push("_Suggestive only: other traffic shares the quota. A steady delta of 0 hints re-checks are free; the live experiment confirms._");
}
lines.push("");

const openCells = [...cells.entries()].filter(([, l]) => l.filter((m) => m.conditional).length >= MIN_N);
lines.push("## Gate 1 — verdict (conditional population)");
lines.push("");
lines.push(
  openCells.length > 0
    ? `${openCells.length} cell(s) reach conditional n ≥ ${MIN_N}: ${openCells.map(([n]) => n).join(", ")}. The suggestion has signal to operate on.`
    : `No cell reaches conditional n ≥ ${MIN_N} yet. The suggestion stays silent (cold-start guard) and waits for transfers whose first honest ask missed — that is a result, not a failure.`,
);
lines.push("");

console.log(lines.join("\n"));

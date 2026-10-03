/* How does each customer of ONE business pay — cash, transfer, other?
   Read-only, straight against WispHub, no Devolada in between: the
   measurement the product creator asked for on 2026-10-03, before any
   spec. The purpose is finding candidates (cash → the store network,
   transfer → the SPEI link), so a trend per customer is enough.

   What it rests on (measured 2026-10-01 on the demo, invoice #42): the
   method is recorded per payment, on the paid invoice, and the invoice
   list filters by it — `/facturas/?forma_pago=8` returned exactly the
   one transfer, the cash method's id returned the cash ones. So the walk
   goes method by method: every row a filter returns is known to be paid
   with that method, whatever shape the row's own field has. Two checks
   guard that reading: the per-method counts must add up to the paid
   total (a filter the installation ignores returns the whole list for
   every method, and the walk stops before reading it), and a row that
   carries its own `forma_pago` must agree with the filter.

   Which day they usually pay was asked the same day ("¿qué día suelen
   pagar?"): the day of the month and the day of the week, from the date
   WispHub recorded as `fecha_pago`. For cash at the office that is the
   day the money was handed over; for a transfer it may be the day the
   cashier registered it, which the weekday split per kind can show.

   The key is asked for at run time, never echoed, never written to disk
   and never printed — not even in an error; WISPHUB_API_KEY in the
   environment skips the prompt. Only GET is sent.

   Output, in a new folder (git-ignored — the usuarios are personal data;
   no name or phone is written):
     formas-de-pago.csv  each method: payments, share, amount, customers
     clientes.csv        each customer: payments per kind, usual kind,
                         usual day of the month and of the week
     pagos.csv           each paid invoice: the raw rows to pivot
     resumen.txt         the same summary the console prints

   Usage:
     node scripts/wisphub-payment-methods-probe.mjs [--host io|net] [--meses 3] [--salida <carpeta>]
   `io` (default) is api.wisphub.io, where the 6,509-customer ISP sits;
   `net` is api.wisphub.net, the demo's. WISPHUB_PROBE_BASE_URL points it
   anywhere else (a local mock). Node 22, no dependencies. */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const HOSTS = {
  io: "https://api.wisphub.io/api",
  net: "https://api.wisphub.net/api",
};

/* What the adapter has proven on the invoice list (pending-invoice-cap):
   `limit=100` honoured, `next` absolute and plain http:// — the path is
   rebuilt from `/facturas/` on, never followed as given. */
const PAGE = 100;
const MAX_PAGES = 3000;
const CALL_TIMEOUT_MS = 30_000;
const RETRIES = 4;

/* ---------- arguments ---------- */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

function fail(message) {
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
}

const hostName = arg("host", "io");
const BASE = process.env.WISPHUB_PROBE_BASE_URL || HOSTS[hostName];
if (!BASE) fail(`--host debe ser "io" o "net" (recibí "${hostName}").`);

const months = Number(arg("meses", "3"));
if (!Number.isInteger(months) || months < 1 || months > 24) fail("--meses debe ser un entero de 1 a 24.");

/* The window by payment date, in this machine's local day (the business's
   timezone when run in Mexico). `hasta` reaches tomorrow because WispHub
   stamps in the tenant's timezone (debt-truth D3). Never left to the
   provider: its default is the current month only (cobros-in-links
   FR-004). */
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const DESDE = ymd(new Date(now.getFullYear(), now.getMonth() - months, now.getDate()));
const HASTA = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

const stamp = `${ymd(now).replaceAll("-", "")}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const OUT = arg("salida", `wisphub-formas-de-pago-${stamp}`);

/* ---------- the key ---------- */

/* Raw mode, so nothing typed or pasted reaches the screen. Bracketed-paste
   markers are dropped in case the terminal sends them anyway. */
function askHidden(question) {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) fail("Sin terminal para pedir la key: pásala en WISPHUB_API_KEY.");
  stderr.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
    };
    const onData = (chunk) => {
      for (const ch of chunk.replace(/\x1b\[20[01]~/g, "")) {
        if (ch === "\u0003") {
          cleanup();
          process.exit(130);
        }
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          cleanup();
          resolve(value.trim());
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/* ---------- WispHub ---------- */

let KEY = "";
let calls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* GET only. Errors name the path and the status, never a header. A 429
   or a 5xx waits and retries; 401/403 stops at once, because WispHub
   answers the same 403 for a bad key and for a missing permission
   (the spike's finding, kept in client.ts). */
async function get(pathAndQuery) {
  for (let attempt = 1; ; attempt++) {
    calls++;
    let res;
    try {
      res = await fetch(`${BASE}${pathAndQuery}`, {
        headers: { Authorization: `Api-Key ${KEY}`, Accept: "application/json" },
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt < RETRIES) {
        await sleep(2000 * attempt);
        continue;
      }
      fail(`WispHub no respondió (${e?.name ?? "error de red"}) en ${pathAndQuery.split("?")[0]}.`);
    }
    if (res.status === 401 || res.status === 403) {
      fail(
        `WispHub rechazó la consulta (${res.status}) en ${pathAndQuery.split("?")[0]}: la key es incorrecta, ` +
          "es de otra instalación (prueba --host net / io) o su usuario no tiene permiso de " +
          "«Lista de Facturas» o «Formas de Pagos Facturas».",
      );
    }
    if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
      const after = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 3000 * attempt);
      continue;
    }
    if (!res.ok) fail(`WispHub respondió ${res.status} en ${pathAndQuery.split("?")[0]}.`);
    try {
      return await res.json();
    } catch {
      fail(`WispHub respondió algo que no es JSON en ${pathAndQuery.split("?")[0]}.`);
    }
  }
}

/* payment-method-per-channel D3: the list paged by limit/offset while the
   provider says there is more */
async function listMethods() {
  const out = [];
  for (let page = 0, offset = 0; page < 20; page++) {
    const data = await get(`/formas-de-pago/?limit=100&offset=${offset}`);
    const results = Array.isArray(data?.results) ? data.results : null;
    if (!results) fail("La lista de formas de pago llegó sin `results`.");
    for (const m of results) {
      if (typeof m?.id === "number" && typeof m?.nombre === "string") out.push({ id: m.id, nombre: m.nombre });
    }
    if (typeof data?.next !== "string" || results.length === 0) break;
    offset += results.length;
  }
  return out;
}

/* `estado=2` is Pagada and `tipo_fecha=fecha_pago` makes the window speak
   of the payment's date — both measured together on 2026-10-01 (the
   cashier filter). `desde`/`hasta` are the pending reads' window words
   (debt-truth D1); that they bind to the payment date here is checked
   below against the rows themselves. */
const PAID = `/facturas/?estado=2&tipo_fecha=fecha_pago&desde=${DESDE}&hasta=${HASTA}`;

const countOf = (data) =>
  typeof data?.count === "number" && Number.isSafeInteger(data.count) && data.count >= 0 ? data.count : null;

async function walk(filter, onPage) {
  let next = `${PAID}${filter}&limit=${PAGE}`;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const data = await get(next);
    const results = Array.isArray(data?.results) ? data.results : null;
    if (!results) fail("Una página de facturas llegó sin `results`.");
    onPage(results);
    if (typeof data?.next !== "string" || results.length === 0) break;
    const at = data.next.indexOf("/facturas/");
    next = at === -1 ? null : data.next.slice(at);
  }
}

/* ---------- reading the rows ---------- */

/* money.ts's string parser, copied (scripts import no app code): a JSON
   number is rendered with toFixed(2) and parsed as text, never × 100
   (constitution II) */
function toCents(value) {
  let text;
  if (typeof value === "number" && Number.isFinite(value)) text = value.toFixed(2);
  else if (typeof value === "string") text = value.trim();
  else return null;
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const cents = Number.parseInt(m[2], 10) * 100 + Number.parseInt((m[3] ?? "0").padEnd(2, "0"), 10);
  return m[1] === "-" ? -cents : cents;
}
const pesos = (cents) => (cents == null ? "" : (cents / 100).toFixed(2));

/* A date as YYYY-MM-DD. The adapter has only seen ISO days on this list
   (`fecha_emision`, `fecha_vencimiento`); `fecha_pago` on a GET was never
   measured, so a day-first date is read too, and anything else is counted
   and shown once in the summary instead of guessed */
function day(v) {
  if (typeof v !== "string") return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/* The row's own method, whatever shape it comes in (never measured on a
   GET: an id, a name, or an object with either) — used only to check the
   filter, never to classify */
function ownMethod(raw) {
  if (typeof raw === "number") return { id: raw };
  if (typeof raw === "string") return /^\d+$/.test(raw) ? { id: Number(raw) } : { nombre: raw };
  if (raw && typeof raw === "object") {
    const id = raw.id ?? raw.id_forma_pago;
    return { id: typeof id === "number" ? id : undefined, nombre: typeof raw.nombre === "string" ? raw.nombre : undefined };
  }
  return null;
}

const fold = (s) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/ ?([-.·]) ?/g, "$1")
    .trim();

/* A GUESS from the name the business typed — each business names its
   methods its own way, which is exactly what this run is meant to show.
   Devolada's two names first (payment-method-per-channel D1, D5: the same
   normalisation); a deposit is its own kind, because at a bank window or
   an OXXO the customer still hands over cash. */
const KINDS = ["efectivo", "transferencia", "deposito", "tarjeta_en_linea", "devolada", "otro"];
function kindOf(nombre) {
  const n = fold(nombre);
  if (n === "SPEI-LINK.DEVOLADAPAGO" || n === "CASH-RED.DEVOLADAPAGO") return "devolada";
  if (/TRANSF|SPEI|CLABE|CODI|DIMO/.test(n)) return "transferencia";
  if (/DEPOSIT|OXXO|VENTANILLA|PRACTICAJA|7-?ELEVEN|SORIANA|WALMART|FARMACIA/.test(n)) return "deposito";
  if (/EFECT|CASH|CONTADO|CAJA|OFICINA|MOSTRADOR/.test(n)) return "efectivo";
  if (/TARJETA|CARD|TERMINAL|TPV|CREDITO|DEBITO|PAYPAL|MERCADO ?PAGO|STRIPE|OPENPAY|CONEKTA|CLIP|PASARELA|EN LINEA|ONLINE/.test(n))
    return "tarjeta_en_linea";
  return "otro";
}

/* ---------- the day they pay ---------- */

/* Per customer, over the distinct dates WispHub recorded: two invoices
   paid at one visit are one date */
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const SHORT_WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DAY_MS = 86_400_000;
const yearOf = (date) => Number(date.slice(0, 4));
const monthOf = (date) => Number(date.slice(5, 7)) - 1;
const dayOfMonth = (date) => Number(date.slice(8, 10));
const weekdayOf = (date) => new Date(Date.UTC(yearOf(date), monthOf(date), dayOfMonth(date))).getUTCDay();

/* How far a date is from "day c" of its own month or a neighbour, in real
   calendar days. A month without day c counts its last day, so 31 means
   "the last day" and the 30th sits next to the 1st. */
function daysOff(date, c) {
  const y = yearOf(date);
  const m = monthOf(date);
  const at = Date.UTC(y, m, dayOfMonth(date));
  let best = Infinity;
  for (const k of [-1, 0, 1]) {
    const last = new Date(Date.UTC(y, m + k + 1, 0)).getUTCDate();
    best = Math.min(best, Math.abs(at - Date.UTC(y, m + k, Math.min(c, last))) / DAY_MS);
  }
  return best;
}

/* The usual day: the day of the month the dates land closest to. Least
   total distance decides, so one late month does not move it; least
   squared distance breaks a tie, so the 3rd and the 7th give the 5th.
   `spread` is the average distance in whole days — how far the day can
   be trusted. A measuring rule, not a product decision. */
function usualDay(dates) {
  let best = null;
  for (let c = 1; c <= 31; c++) {
    let s1 = 0;
    let s2 = 0;
    for (const date of dates) {
      const off = daysOff(date, c);
      s1 += off;
      s2 += off * off;
    }
    if (!best || s1 < best.s1 || (s1 === best.s1 && s2 < best.s2)) best = { c, s1, s2 };
  }
  return { day: best.c, spread: Math.round(best.s1 / dates.length) };
}

const REGULARITY = {
  fijo: "fijo (±2 días o menos)",
  aproximado: "aproximado (±3 a 5 días)",
  variable: "variable (más de ±5 días)",
  "una sola fecha": "una sola fecha en la ventana",
};
const regularityOf = (dates, spread) =>
  dates.length < 2 ? "una sola fecha" : spread <= 2 ? "fijo" : spread <= 5 ? "aproximado" : "variable";

/* The usual weekday: the one with more than half of the dates, the same
   rule as the usual kind; else "varía" */
function usualWeekday(dates) {
  const counts = new Array(7).fill(0);
  for (const date of dates) counts[weekdayOf(date)]++;
  const top = counts.indexOf(Math.max(...counts));
  return counts[top] * 2 > dates.length ? WEEKDAYS[top] : "varía";
}

/* ---------- CSV ---------- */

/* Excel-ready: UTF-8 BOM so accents survive, CRLF, and a text cell that
   would start a formula gets a leading apostrophe */
function csv(rows) {
  const cell = (v) => {
    if (v == null) return "";
    if (typeof v === "number") return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const fmt = (n) => n.toLocaleString("es-MX");

/* ---------- run ---------- */

process.stderr.write(
  `Destino: ${BASE}\nVentana por fecha de pago: ${DESDE} a ${HASTA} (${months} meses)\nSalida: ${path.resolve(OUT)}\n\n`,
);

KEY = (process.env.WISPHUB_API_KEY ?? "").trim() || (await askHidden("API key de WispHub (no se muestra ni se guarda): "));
if (!KEY) fail("Sin key; no se consultó nada.");

const methods = await listMethods();
if (!methods.length) fail("La instalación no tiene formas de pago; no hay nada que medir.");
process.stderr.write(`Formas de pago: ${methods.length}\n`);

/* Phase 1, one call each: the paid total, then each method's count. A
   filter the installation ignored would hand every method the whole
   total — caught here, before reading thousands of rows that would all
   be wrong. */
const total = countOf(await get(`${PAID}&limit=1`));
const counts = new Map();
for (const m of methods) counts.set(m.id, countOf(await get(`${PAID}&forma_pago=${m.id}&limit=1`)));
const known = [...counts.values()];
if (total != null && total > 0 && methods.length > 1 && known.filter((c) => c === total).length > 1) {
  fail(
    `El filtro por forma de pago no se aplicó: ${known.filter((c) => c === total).length} formas devuelven ` +
      `las ${fmt(total)} facturas pagadas. Con esta instalación no se puede medir así; no se leyó nada más.`,
  );
}
process.stderr.write(`Facturas pagadas en la ventana: ${total == null ? "(WispHub no dio el total)" : fmt(total)}\n`);

/* Phase 2: the walk, method by method */
const payments = [];
let disagreed = 0;
let withOwnMethod = 0;
let unreadableDates = 0;
let unreadableSample = null;
for (const m of methods) {
  const expected = counts.get(m.id);
  if (expected === 0) continue;
  const kind = kindOf(m.nombre);
  let read = 0;
  await walk(`&forma_pago=${m.id}`, (rows) => {
    for (const f of rows) {
      read++;
      const own = ownMethod(f?.forma_pago);
      if (own && (own.id !== undefined || own.nombre !== undefined)) {
        withOwnMethod++;
        if ((own.id !== undefined && own.id !== m.id) || (own.id === undefined && fold(own.nombre) !== fold(m.nombre)))
          disagreed++;
      }
      const paidOn = day(f?.fecha_pago);
      if (!paidOn && f?.fecha_pago != null && f.fecha_pago !== "") {
        unreadableDates++;
        unreadableSample ??= String(f.fecha_pago).slice(0, 40);
      }
      payments.push({
        invoice: typeof f?.id_factura === "number" ? f.id_factura : null,
        usuario: typeof f?.cliente?.usuario === "string" ? f.cliente.usuario : null,
        paidOn,
        methodId: m.id,
        method: m.nombre,
        kind,
        cents: toCents(f?.total),
      });
    }
    process.stderr.write(`\r  ${m.nombre}: ${fmt(read)}${expected == null ? "" : ` / ${fmt(expected)}`}   `);
  });
  process.stderr.write("\n");
}

/* An invoice is paid with one method, so the same invoice twice means two
   methods' filters overlapped */
const seen = new Set();
let repeated = 0;
for (const p of payments) {
  if (p.invoice == null) continue;
  if (seen.has(p.invoice)) repeated++;
  seen.add(p.invoice);
}

/* ---------- the three tables ---------- */

const byMethod = new Map(methods.map((m) => [m.id, { m, n: 0, cents: 0, customers: new Set() }]));
const byCustomer = new Map();
for (const p of payments) {
  const row = byMethod.get(p.methodId);
  row.n++;
  row.cents += p.cents ?? 0;
  if (p.usuario) row.customers.add(p.usuario);
  if (!p.usuario) continue;
  let c = byCustomer.get(p.usuario);
  if (!c) {
    c = { n: 0, kinds: Object.fromEntries(KINDS.map((k) => [k, 0])), methods: new Map(), paidOn: new Set() };
    byCustomer.set(p.usuario, c);
  }
  c.n++;
  c.kinds[p.kind]++;
  c.methods.set(p.method, (c.methods.get(p.method) ?? 0) + 1);
  if (p.paidOn) c.paidOn.add(p.paidOn);
}
for (const c of byCustomer.values()) {
  c.dates = [...c.paidOn].sort();
  c.usual = c.dates.length ? usualDay(c.dates) : null;
  c.regularity = c.usual ? regularityOf(c.dates, c.usual.spread) : null;
}

const read = payments.length;
const methodRows = [...byMethod.values()].sort((a, b) => b.n - a.n);

/* The usual kind: the one with MORE THAN HALF of the customer's payments
   in the window, else "mixto". A measuring rule, not a product decision. */
function habitOf(c) {
  const [kind, n] = Object.entries(c.kinds).sort((a, b) => b[1] - a[1])[0];
  return n * 2 > c.n ? kind : "mixto";
}

mkdirSync(OUT, { recursive: true });

writeFileSync(
  path.join(OUT, "formas-de-pago.csv"),
  csv([
    ["id_forma", "nombre", "tipo_sugerido", "pagos", "porcentaje_de_pagos", "monto_total", "clientes_distintos"],
    ...methodRows.map(({ m, n, cents, customers }) => [m.id, m.nombre, kindOf(m.nombre), n, pct(n, read), pesos(cents), customers.size]),
  ]),
);

const customerRows = [...byCustomer.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
writeFileSync(
  path.join(OUT, "clientes.csv"),
  csv([
    [
      "usuario",
      "pagos",
      ...KINDS,
      "forma_principal",
      "habito",
      "dia_habitual",
      "variacion_dias",
      "regularidad",
      "dias_de_pago",
      "dia_semana_habitual",
      "ultimo_pago",
    ],
    ...customerRows.map(([usuario, c]) => [
      usuario,
      c.n,
      ...KINDS.map((k) => c.kinds[k]),
      [...c.methods.entries()].sort((a, b) => b[1] - a[1])[0][0],
      habitOf(c),
      c.usual?.day,
      c.usual?.spread,
      c.regularity,
      c.dates.map(dayOfMonth).join(" · "),
      c.dates.length ? usualWeekday(c.dates) : null,
      c.dates.at(-1),
    ]),
  ]),
);

writeFileSync(
  path.join(OUT, "pagos.csv"),
  csv([
    [
      "id_factura",
      "usuario",
      "fecha_pago",
      "dia_del_mes",
      "dia_de_la_semana",
      "id_forma",
      "forma",
      "tipo_sugerido",
      "total_factura",
    ],
    ...payments
      .slice()
      .sort((a, b) => (a.paidOn ?? "").localeCompare(b.paidOn ?? "") || (a.invoice ?? 0) - (b.invoice ?? 0))
      .map((p) => [
        p.invoice,
        p.usuario,
        p.paidOn,
        p.paidOn ? dayOfMonth(p.paidOn) : null,
        p.paidOn ? WEEKDAYS[weekdayOf(p.paidOn)] : null,
        p.methodId,
        p.method,
        p.kind,
        pesos(p.cents),
      ]),
  ]),
);

/* ---------- summary ---------- */

const lines = [];
const say = (s = "") => lines.push(s);
const dated = payments.filter((p) => p.paidOn);
const paidDates = dated.map((p) => p.paidOn).sort();
const outside = paidDates.filter((d) => d < DESDE || d > HASTA).length;
const undated = payments.length - dated.length - unreadableDates;
const noCustomer = payments.filter((p) => !p.usuario).length;

say(`Instalación: ${BASE}`);
say(`Ventana por fecha de pago: ${DESDE} a ${HASTA} (${months} meses)`);
say(`Medido: ${now.toISOString()}  ·  ${fmt(calls)} consultas a WispHub`);
say();
say(`Facturas pagadas en la ventana: ${total == null ? "(WispHub no dio el total)" : fmt(total)}`);
say(`  leídas con su forma de pago: ${fmt(read)}`);
if (total != null && total !== read) say(`  sin forma de pago reconocida (o de una forma borrada): ${fmt(total - read)}`);
say();
say("Por forma de pago (el tipo es una suposición por el nombre):");
for (const { m, n } of methodRows) {
  say(`  ${String(m.id).padStart(7)}  ${m.nombre.slice(0, 34).padEnd(34)}  ${kindOf(m.nombre).padEnd(16)}  ${fmt(n).padStart(8)}  ${String(pct(n, read)).padStart(5)} %`);
}
say();
say("Por tipo:");
for (const k of KINDS) {
  const n = payments.filter((p) => p.kind === k).length;
  if (n) say(`  ${k.padEnd(16)}  ${fmt(n).padStart(8)}  ${String(pct(n, read)).padStart(5)} %`);
}
say();
say(`Clientes con al menos un pago: ${fmt(byCustomer.size)}`);
const habits = new Map();
for (const [, c] of byCustomer) habits.set(habitOf(c), (habits.get(habitOf(c)) ?? 0) + 1);
for (const [h, n] of [...habits.entries()].sort((a, b) => b[1] - a[1])) {
  say(`  suele pagar: ${h.padEnd(16)}  ${fmt(n).padStart(8)}  ${String(pct(n, byCustomer.size)).padStart(5)} %`);
}

if (dated.length) {
  say();
  say("Cuándo se paga (cada pago con fecha):");
  const perDay = new Array(32).fill(0);
  for (const p of dated) perDay[dayOfMonth(p.paidOn)]++;
  const span = (a, b) => perDay.slice(a, b + 1).reduce((s, n) => s + n, 0);
  const SPANS = [[1, 5], [6, 10], [11, 15], [16, 20], [21, 25], [26, 31]];
  say(`  por día del mes:      ${SPANS.map(([a, b]) => `${a}–${b} ${pct(span(a, b), dated.length)} %`).join(" · ")}`);
  const topDays = perDay
    .map((n, d) => [d, n])
    .filter(([d, n]) => d && n)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 5);
  say(`  días con más pagos:   ${topDays.map(([d, n]) => `${d} (${pct(n, dated.length)} %)`).join(" · ")}`);
  /* Per kind too: a transfer registered by the cashier on the next
     working day shows as a week with no weekend */
  const week = (rows) => {
    const counts = new Array(7).fill(0);
    for (const p of rows) counts[weekdayOf(p.paidOn)]++;
    return [1, 2, 3, 4, 5, 6, 0].map((w) => `${SHORT_WEEKDAYS[w]} ${pct(counts[w], rows.length)} %`).join(" · ");
  };
  say(`  por día de la semana: ${week(dated)}`);
  for (const k of KINDS) {
    const rows = dated.filter((p) => p.kind === k);
    if (rows.length && rows.length < dated.length) say(`    ${k.padEnd(18)}${week(rows)}`);
  }

  const withDates = [...byCustomer.values()].filter((c) => c.usual);
  say();
  say(`Clientes por día habitual de pago (${fmt(withDates.length)} con fecha):`);
  for (const [r, label] of Object.entries(REGULARITY)) {
    const n = withDates.filter((c) => c.regularity === r).length;
    if (n) say(`  ${label.padEnd(30)}  ${fmt(n).padStart(8)}  ${String(pct(n, withDates.length)).padStart(5)} %`);
  }
  const fixed = withDates.filter((c) => c.regularity === "fijo");
  if (fixed.length) {
    const perUsual = new Array(32).fill(0);
    for (const c of fixed) perUsual[c.usual.day]++;
    const topUsual = perUsual
      .map((n, d) => [d, n])
      .filter(([d, n]) => d && n)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 5);
    say(`  días habituales de los «fijos»: ${topUsual.map(([d, n]) => `${d} (${fmt(n)})`).join(" · ")}`);
  }
}

say();
say("Revisión de la medición:");
const top = methodRows[0];
if (read && top.n / read > 0.9) {
  say(`  ⚠ «${top.m.nombre}» concentra el ${pct(top.n, read)} % de los pagos: puede que el cajero no elija la forma de pago.`);
}
if (paidDates.length) {
  say(
    `  fechas de pago leídas: ${paidDates[0]} a ${paidDates.at(-1)}` +
      (outside ? ` — ⚠ ${fmt(outside)} fuera de la ventana` : " (todas dentro de la ventana)"),
  );
}
if (unreadableDates) {
  say(`  ⚠ ${fmt(unreadableDates)} pagos con fecha_pago en un formato que no se entendió, por ejemplo «${unreadableSample}»`);
}
if (undated) say(`  ⚠ ${fmt(undated)} pagos sin fecha_pago (no cuentan para el día)`);
say(
  withOwnMethod
    ? `  filas con su propia forma de pago: ${fmt(withOwnMethod)}; no coinciden con el filtro: ${fmt(disagreed)}${disagreed ? " ⚠" : ""}`
    : "  las filas no traen su propia forma de pago; se confía en el filtro",
);
if (repeated) say(`  ⚠ ${fmt(repeated)} facturas aparecen en dos formas de pago`);
if (noCustomer) say(`  ⚠ ${fmt(noCustomer)} pagos sin usuario de cliente (quedan en pagos.csv, no en clientes.csv)`);
say();
say("Hábito = el tipo con más de la mitad de los pagos del cliente en la ventana; si ninguno, «mixto».");
say("Día habitual = el día del mes al que caen más cerca sus fechas de pago, en días de calendario; 31 = el último día del mes.");
say("  Variación = cuántos días se alejan en promedio de ese día. Día de la semana habitual: más de la mitad de sus fechas; si no, «varía».");
say("La fecha es la que registró WispHub: en efectivo, el día en que se pagó; en transferencia, puede ser el día en que el cajero la registró.");

const summary = lines.join("\n") + "\n";
writeFileSync(path.join(OUT, "resumen.txt"), summary);
process.stdout.write(`\n${summary}\nArchivos en ${path.resolve(OUT)}\n`);

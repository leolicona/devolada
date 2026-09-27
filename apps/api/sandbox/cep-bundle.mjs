/* The sandbox's bundle of CEPs (cep-bundle-match T019), built once at
   startup in the layout the reader expects (research R3, R4, R18) and the
   tests' fixtures reproduce (`test/consta/bundle-fixtures.ts`): a ZIP whose
   entries carry their sizes in a data descriptor, one
   `CEP-<AAAAMMDD>-<clave>.pdf` per transfer, each a one-page PDF 1.5 with a
   WinAnsiEncoding font, text drawn as `Tm` + `Tj`, the four labels
   verbatim, and the cadena original printed over three lines — one break
   inside the beneficiary's name that eats its space, one inside the
   certificate number.

   Two synthetic transfers of $3.00 to the dev seed's CLABE, both from
   Azteca: tails 8301 (credited 07:11:20) and 4417 (credited 11:40:47), on
   the day the payer's receipt names. Every name, RFC and account here is
   invented. Plain JS on purpose: the sandbox runs under bare node. */

import { Zip, ZipPassThrough, zlibSync } from "fflate";

/* The dev seed's cuenta de cobro (routes/dev.ts) — the destination the
   matcher's integrity check ties each CEP to */
export const SANDBOX_BENEFICIARY = "646180157000000004";

const SENDER_NAME = "PAGADOR SINTETICO DOS";
const BENEFICIARY_NAME = "ISP DEMO SA DE CV";
const CERTIFICATE = "00001000000999999999";

const ddmmaaaa = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

function cadenaOf(t) {
  const fields = [
    "01",
    ddmmaaaa(t.operationDay),
    ddmmaaaa(t.creditDay),
    t.creditTime.replace(/:/g, ""),
    "90646",
    "AZTECA",
    SENDER_NAME,
    "40",
    t.senderAccount,
    "SIDP800101AB1",
    "STP",
    BENEFICIARY_NAME,
    "40",
    SANDBOX_BENEFICIARY,
    "IDE900101CD2",
    "PAGO DE SERVICIO",
    "0.00",
    "3.00",
    ...Array.from({ length: 24 }, () => "0"),
    CERTIFICATE,
  ];
  return `||${fields.join("|")}||`;
}

function cadenaLines(cadena) {
  const space = cadena.indexOf(" ", cadena.indexOf(BENEFICIARY_NAME));
  const cut = cadena.lastIndexOf("|", cadena.length - 3) + 1 + 10;
  return [cadena.slice(0, space), cadena.slice(space + 1, cut), cadena.slice(cut)];
}

const latin1 = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
const literal = (s) => `(${s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function cepPdf(t) {
  const seal = btoa(String.fromCharCode(...new Uint8Array(256).map((_, i) => (i * 31 + t.creditTime.length) % 256)));
  const lines = [
    "Comprobante Electrónico de Pago (CEP)",
    "Clave de rastreo",
    t.clave,
    "Cadena Original (información del pago):",
    ...cadenaLines(cadenaOf(t)),
    "Sello Digital (firma provista por la institución receptora del pago):",
    seal.slice(0, 172),
    seal.slice(172),
    "Número de Serie del Certificado de Seguridad de la institución receptora del pago",
    CERTIFICATE,
    "*La hora de abono corresponde al huso horario que rige en la Ciudad de México.",
  ];
  let y = 760;
  const content = concat(
    lines.map((line) => {
      const run = latin1(`BT\n/F1 7 Tf\n1 0 0 1 36 ${y} Tm\n${literal(line)} Tj\nET\n`);
      y -= 11;
      return run;
    }),
  );
  const page = zlibSync(content);
  const objects = [
    latin1("<</Type/Catalog/Pages 2 0 R>>"),
    latin1("<</Type/Pages/Kids[3 0 R]/Count 1>>"),
    latin1("<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>"),
    latin1("<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>"),
    concat([latin1(`<</Length ${page.length}/Filter/FlateDecode>>stream\n`), page, latin1("\nendstream")]),
  ];
  const parts = [latin1("%PDF-1.5\n")];
  const offsets = [];
  let at = parts[0].length;
  objects.forEach((body, i) => {
    const obj = concat([latin1(`${i + 1} 0 obj\n`), body, latin1("\nendobj\n")]);
    offsets.push(at);
    parts.push(obj);
    at += obj.length;
  });
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `),
    "trailer",
    `<</Size ${objects.length + 1}/Root 1 0 R>>`,
    "startxref",
    String(at),
    "%%EOF",
    "",
  ].join("\n");
  parts.push(latin1(xref));
  return concat(parts);
}

/* `day`: the printed day the payer's search asked (YYYY-MM-DD) */
export function sandboxBundle(day) {
  const transfers = [
    { clave: "MOCKAZT0000000008301", creditTime: "07:11:20", senderAccount: "127180123456683010" },
    { clave: "MOCKAZT0000000004417", creditTime: "11:40:47", senderAccount: "127180987654544171" },
  ].map((t) => ({ ...t, operationDay: day, creditDay: day }));
  const chunks = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    chunks.push(data);
  });
  for (const t of transfers) {
    const file = new ZipPassThrough(`CEP-${t.operationDay.replace(/-/g, "")}-${t.clave}.pdf`);
    zip.add(file);
    file.push(cepPdf(t), true);
  }
  zip.end();
  return concat(chunks);
}

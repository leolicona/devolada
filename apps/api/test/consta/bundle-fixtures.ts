import { Zip, ZipPassThrough, zlibSync } from "fflate";

/* cep-bundle-match research R18 — synthetic CEPs in the measured layout.

   Real CEPs carry the sender's and the beneficiary's names, RFCs and
   accounts, so they never enter the repo (the eight measured ones live on
   the creator's machine, and quickstart Step 0 re-reads them there). These
   builders reproduce what the reader leans on, as measured 2026-09-27:

   - the cadena original: version `01`, 43 pipe-separated fields, `||` at
     both ends, the clave and the reference not in it (R5);
   - the page: a PDF 1.5 with one WinAnsiEncoding font, text drawn as
     `Tm` + `Tj`/`TJ` runs, the four labels verbatim, the cadena printed
     over three lines — one break inside the beneficiary's name that eats
     its space, one inside the certificate number — and an image stream
     beside the page's (R4);
   - the page's stream compressed with zlib, optionally so that its last
     compressed byte is a line break: the failure of the first spike reader
     (R4);
   - the bundle: a ZIP whose entries carry their sizes in a data descriptor
     (flag 0x08) and are named `CEP-<AAAAMMDD>-<clave>.pdf` (R3);
   - the provider's three answers, in the shapes of R1.

   Every name, RFC and account below is synthetic. */

export const SYNTHETIC = {
  senderName: "PAGADOR SINTETICO UNO",
  senderRfc: "SIUP800101AB1",
  beneficiaryName: "NEGOCIO SINTETICO SA DE CV",
  beneficiaryRfc: "NSI900101CD2",
  /* Not the number the measured CEPs carry: a made-up one */
  certificateNumber: "00001000000999999999",
};

/* Two synthetic Azteca CLABEs, check digits valid. The first's account
   number — the digits before the check digit — ends 8301 while the CLABE
   ends 3010, as the measured payer's does (research R8); the second's
   ends 4417 */
export const SENDER_8301 = "127180123456683010";
export const SENDER_4417 = "127180987654544171";

export type CadenaFields = {
  version?: string;
  operationDay: string; // YYYY-MM-DD
  creditDay: string; // YYYY-MM-DD
  creditTime: string; // HH:MM:SS
  receiverSpeiCode?: string;
  senderBank?: string;
  senderName?: string;
  senderAccountType?: string;
  senderAccount: string;
  senderRfc?: string;
  receiverBank?: string;
  beneficiaryName?: string;
  beneficiaryAccountType?: string;
  beneficiaryAccount: string;
  beneficiaryRfc?: string;
  concept?: string;
  iva?: string;
  amount: string; // "3.00"
  certificateNumber?: string;
};

const ddmmaaaa = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

/* A 43-field version-01 cadena. Positions 19–42 are unmeasured here and
   read by no parser; they are filled so the count is the real one. */
export function cadenaOf(f: CadenaFields): string {
  const fields = [
    f.version ?? "01",
    ddmmaaaa(f.operationDay),
    ddmmaaaa(f.creditDay),
    f.creditTime.replace(/:/g, ""),
    f.receiverSpeiCode ?? "40012",
    f.senderBank ?? "AZTECA",
    f.senderName ?? SYNTHETIC.senderName,
    f.senderAccountType ?? "40",
    f.senderAccount,
    f.senderRfc ?? SYNTHETIC.senderRfc,
    f.receiverBank ?? "BBVA MEXICO",
    f.beneficiaryName ?? SYNTHETIC.beneficiaryName,
    f.beneficiaryAccountType ?? "40",
    f.beneficiaryAccount,
    f.beneficiaryRfc ?? SYNTHETIC.beneficiaryRfc,
    f.concept ?? "PAGO DE SERVICIO",
    f.iva ?? "0.00",
    f.amount,
    ...Array.from({ length: 24 }, () => "0"),
    f.certificateNumber ?? SYNTHETIC.certificateNumber,
  ];
  return `||${fields.join("|")}||`;
}

/* The printed cadena's three lines, as measured: the first break falls
   inside the beneficiary's name and eats the space there; the second falls
   inside the certificate number, with nothing eaten */
export function cadenaLines(cadena: string, beneficiaryName = SYNTHETIC.beneficiaryName): string[] {
  const nameAt = cadena.indexOf(beneficiaryName);
  const space = cadena.indexOf(" ", nameAt);
  const certificate = cadena.lastIndexOf("|", cadena.length - 3) + 1;
  const cut = certificate + 10;
  return [cadena.slice(0, space), cadena.slice(space + 1, cut), cadena.slice(cut)];
}

/* A base64 seal the size of an RSA-2048 signature (256 bytes) — random,
   because nothing verifies it (D2) */
export function syntheticSeal(seed = 1): string {
  const bytes = new Uint8Array(256).map((_, i) => (i * 37 + seed * 101) % 256);
  return btoa(String.fromCharCode(...bytes));
}

/* ---- the PDF ---- */

/* cp1252 for the text we print: Latin-1 covers every accented letter the
   labels carry (ó, ú, é, í) */
const cp1252 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* A literal PDF string with its three special characters escaped */
const literal = (s: string) => `(${s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;

export type CepPdfOptions = {
  clave: string;
  cadena: string;
  seal?: string;
  certificateNumber?: string;
  /* A clave printed on the page that is not the entry's */
  printedClave?: string;
  /* Leave one label out */
  omitLabel?: "clave" | "cadena" | "seal";
  /* Pad the page's stream until its last compressed byte is "\n" */
  lastByteLineBreak?: boolean;
  /* Write /Length as a reference to another object */
  indirectLength?: boolean;
  /* The beneficiary's name, where the first cadena line breaks */
  beneficiaryName?: string;
};

type Line = { text: string; tj?: boolean };

function pageLines(o: CepPdfOptions): Line[] {
  const lines: Line[] = [
    { text: "Comprobante Electrónico de Pago (CEP)" },
    { text: "Información de la operación" },
  ];
  if (o.omitLabel !== "clave") lines.push({ text: "Clave de rastreo", tj: true });
  lines.push({ text: o.printedClave ?? o.clave });
  lines.push({ text: "Referencia" }, { text: "9784417" });
  if (o.omitLabel !== "cadena") lines.push({ text: "Cadena Original (información del pago):" });
  for (const l of cadenaLines(o.cadena, o.beneficiaryName)) lines.push({ text: l });
  if (o.omitLabel !== "seal") lines.push({ text: "Sello Digital (firma provista por la institución receptora del pago):" });
  const seal = o.seal ?? syntheticSeal();
  for (let i = 0; i < seal.length; i += 172) lines.push({ text: seal.slice(i, i + 172) });
  lines.push({ text: "Número de Serie del Certificado de Seguridad de la institución receptora del pago" });
  lines.push({ text: o.certificateNumber ?? SYNTHETIC.certificateNumber });
  lines.push({ text: "*La hora de abono corresponde al huso horario que rige en la Ciudad de México." });
  return lines;
}

function contentStream(o: CepPdfOptions): Uint8Array {
  const parts: Uint8Array[] = [];
  let y = 760;
  for (const line of pageLines(o)) {
    parts.push(ascii(`BT\n/F1 7 Tf\n1 0 0 1 36 ${y} Tm\n`));
    if (line.tj) {
      /* One label as a kerned TJ array, the way OpenPDF writes some runs */
      const [a, b] = [line.text.slice(0, 9), line.text.slice(9)];
      parts.push(ascii("["), cp1252(literal(a)), ascii(" -12 "), cp1252(literal(b)), ascii("] TJ\n"));
    } else {
      parts.push(cp1252(literal(line.text)), ascii(" Tj\n"));
    }
    parts.push(ascii("ET\n"));
    y -= 11;
  }
  return concat(parts);
}

/* R4's failure, reproduced: pad with a comment until the zlib stream's
   last byte — the Adler-32's low byte — is a line break */
function compressed(content: Uint8Array, lastByteLineBreak: boolean): Uint8Array {
  if (!lastByteLineBreak) return zlibSync(content);
  for (let k = 0; k < 4096; k++) {
    const padded = concat([content, ascii(`% ${"x".repeat(k % 64)}${"y".repeat(Math.floor(k / 64))}\n`)]);
    const out = zlibSync(padded);
    if (out[out.length - 1] === 0x0a) return out;
  }
  throw new Error("no padding made the last compressed byte a line break");
}

export function buildCepPdf(o: CepPdfOptions): Uint8Array {
  const page = compressed(contentStream(o), Boolean(o.lastByteLineBreak));
  const image = zlibSync(Uint8Array.from({ length: 64 }, (_, i) => (i * 13) % 256));
  const objects: Uint8Array[] = [
    ascii("<</Type/Catalog/Pages 2 0 R>>"),
    ascii("<</Type/Pages/Kids[3 0 R]/Count 1>>"),
    ascii("<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>/XObject<</Im1 6 0 R>>>>/Contents 5 0 R>>"),
    ascii("<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>"),
    concat([
      ascii(`<</Length ${o.indirectLength ? "7 0 R" : page.length}/Filter/FlateDecode>>stream\n`),
      page,
      ascii("\nendstream"),
    ]),
    concat([
      ascii(`<</Type/XObject/Subtype/Image/Width 8/Height 8/BitsPerComponent 8/ColorSpace/DeviceGray/Length ${image.length}/Filter/FlateDecode>>stream\n`),
      image,
      ascii("\nendstream"),
    ]),
    ...(o.indirectLength ? [ascii(String(page.length))] : []),
  ];
  const parts: Uint8Array[] = [ascii("%PDF-1.5\n%"), Uint8Array.from([0xe2, 0xe3, 0xcf, 0xd3]), ascii("\n")];
  const offsets: number[] = [];
  let at = parts.reduce((n, p) => n + p.length, 0);
  objects.forEach((body, i) => {
    const obj = concat([ascii(`${i + 1} 0 obj\n`), body, ascii("\nendobj\n")]);
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
  parts.push(ascii(xref));
  return concat(parts);
}

/* ---- the bundle ---- */

/* The provider's entry name: the operation day and the clave (R3) */
export const entryName = (operationDay: string, clave: string) => `CEP-${operationDay.replace(/-/g, "")}-${clave}.pdf`;

/* A ZIP whose entries carry their sizes in a data descriptor, as measured
   (flag 0x08) — stored, because the provider's barely compresses PDFs */
export function buildBundleZip(entries: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    chunks.push(data);
  });
  for (const e of entries) {
    const file = new ZipPassThrough(e.name);
    zip.add(file);
    file.push(e.bytes, true);
  }
  zip.end();
  return concat(chunks);
}

/* One synthetic transfer, everything a CEP and a `valid` need */
export type SyntheticTransfer = {
  clave: string;
  operationDay: string;
  creditDay: string;
  creditTime: string;
  senderAccount: string;
  senderAccountType?: string;
  beneficiaryAccount: string;
  amount: string; // "3.00"
  senderBank?: string;
};

export const transferCadena = (t: SyntheticTransfer) =>
  cadenaOf({
    operationDay: t.operationDay,
    creditDay: t.creditDay,
    creditTime: t.creditTime,
    senderAccount: t.senderAccount,
    senderAccountType: t.senderAccountType,
    beneficiaryAccount: t.beneficiaryAccount,
    amount: t.amount,
    senderBank: t.senderBank,
  });

export const transferPdf = (t: SyntheticTransfer, over: Partial<CepPdfOptions> = {}) =>
  buildCepPdf({ clave: t.clave, cadena: transferCadena(t), ...over });

export const bundleOf = (transfers: SyntheticTransfer[]) =>
  buildBundleZip(transfers.map((t) => ({ name: entryName(t.operationDay, t.clave), bytes: transferPdf(t) })));

/* ---- the provider's three answers (research R1) ---- */

export function severalAnswer(url: string, over: Record<string, unknown> = {}) {
  return {
    validationId: "prov-several-1",
    status: "invalid",
    validation: { banxicoConfirmed: true, cepPreviouslyValidated: null },
    downloads: { cepPdf: url },
    processingTime: { ocr: "0ms", validation: "4.4s", total: "4.4s" },
    ...over,
  };
}

export function noneAnswer(over: Record<string, unknown> = {}) {
  return {
    validationId: "prov-none-1",
    status: "invalid",
    validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
    downloads: {},
    ...over,
  };
}

export function validAnswer(t: SyntheticTransfer, over: { previouslyValidated?: boolean | null; validationId?: string } = {}) {
  const pesos = Number(t.amount);
  return {
    validationId: over.validationId ?? "prov-valid-1",
    status: "valid",
    validation: {
      banxicoConfirmed: true,
      cepStatus: "LIQUIDADO",
      cepPreviouslyValidated: over.previouslyValidated === undefined ? false : over.previouslyValidated,
      cepDetails: {
        trackingKey: t.clave,
        amount: pesos,
        operationDate: t.operationDay,
        senderBank: t.senderBank ?? "AZTECA",
        senderName: SYNTHETIC.senderName,
        receiverBank: "BBVA MEXICO",
        beneficiaryName: SYNTHETIC.beneficiaryName,
        digitalSignature: syntheticSeal(7),
        beneficiaryAccount: t.beneficiaryAccount,
        beneficiaryAccountType: "40",
        processingTime: t.creditTime,
        cdaChain: transferCadena(t),
        senderAccountType: t.senderAccountType ?? "40",
        senderAccount: t.senderAccount,
        senderRfc: SYNTHETIC.senderRfc,
        beneficiaryRfc: SYNTHETIC.beneficiaryRfc,
        certificateNumber: SYNTHETIC.certificateNumber,
      },
    },
    downloads: { cepXml: "https://storage.apicep.cloud/x.xml", cepPdf: "https://storage.apicep.cloud/x.pdf" },
    processingTime: { ocr: "0ms", validation: "5.1s", total: "5.1s" },
  };
}

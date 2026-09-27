import { inflateSync, unzlibSync } from "fflate";

/* cep-bundle-match D3 (research R4) — reading one CEP, Banxico's one-page
   comprobante, by its own layout.

   Measured 2026-09-27 on the eight CEPs of three bundles: PDF 1.5 by
   JasperReports 6.20 over OpenPDF 1.3.30; one font, WinAnsiEncoding, no
   ToUnicode; two FlateDecode streams (the page and one image); text runs
   positioned with `Tm` and shown with `Tj`/`TJ`, decoded as cp1252. The
   labels, verbatim:

     "Clave de rastreo"
     "Cadena Original (información del pago):"
     "Sello Digital (firma provista por la institución receptora del pago):"
     "Número de Serie del Certificado de Seguridad de la institución
      receptora del pago"

   The cadena prints over three lines: one break falls inside the
   beneficiary's name (the break ate a space), one inside the certificate
   number (no space) — so its lines join WITHOUT spaces, which is exact for
   every field this feature keeps (R5): none holds a space.

   A first spike reader failed 1 of 8: it cut each stream at the line
   break before `endstream`, and that file's last compressed byte was a
   line break. A stream is sliced by its declared `/Length`, always.

   This is not a PDF library and does not try to be one: pdf.js would be a
   large bundle and a worker shim for one fixed document from one
   generator, and its text items would still need the label logic below
   (R4, alternatives). Anything unexpected — no label, no cadena, a clave
   that disagrees with the entry's name — makes the CEP `unreadable`, which
   fails toward asking the payer for the clave, never toward a wrong pick
   (FR-002). Pure: bytes in, text out. */

export type CepPdf = {
  clave: string;
  /* The cadena original, its printed lines joined without spaces */
  cadena: string;
  /* D2: the seal as printed (base64), kept and never verified */
  seal: string;
  /* The printed certificate number, when the page shows it apart from the
     cadena (whose last field carries it too) */
  certificateNumber: string | null;
};

export type CepPdfResult = CepPdf | { unreadable: string };

/* ---- cp1252, by table: Workers' TextDecoder is not promised to know it,
   and the eight CEPs need only it (one WinAnsiEncoding font) ---- */
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

export function cp1252(bytes: ArrayLike<number>): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += String.fromCharCode(CP1252_HIGH[b] ?? b);
  }
  return out;
}

/* The file as one byte-per-char string, for finding structure. Chunked:
   spreading 28 KB into one call is fine, 4 MB is not. */
function binary(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return s;
}

/* ---- the file's streams ---- */

type RawStream = { dict: string; data: Uint8Array };

/* The dictionary that ends right before `stream`: walk back over `>>` and
   `<<` pairs, so a nested dictionary (`/DecodeParms <<…>>`) stays inside */
function dictBefore(text: string, at: number): string | null {
  let end = at - 1;
  while (end >= 0 && /\s/.test(text[end])) end--;
  if (text[end] !== ">" || text[end - 1] !== ">") return null;
  let depth = 0;
  for (let i = end; i > 0; i--) {
    if (text[i] === ">" && text[i - 1] === ">") {
      depth++;
      i--;
    } else if (text[i] === "<" && text[i - 1] === "<") {
      depth--;
      i--;
      if (depth === 0) return text.slice(i, end + 1);
    }
  }
  return null;
}

/* `/Length` is either a number or a reference to an object holding one */
function lengthOf(dict: string, text: string): number | null {
  const m = /\/Length\s+(\d+)(?:\s+(\d+)\s+R)?/.exec(dict);
  if (!m) return null;
  if (m[2] === undefined) return Number(m[1]);
  const ref = new RegExp(`(?:^|\\s)${m[1]}\\s+${m[2]}\\s+obj\\s*(\\d+)\\s*endobj`).exec(text);
  return ref ? Number(ref[1]) : null;
}

function streams(bytes: Uint8Array): RawStream[] {
  const text = binary(bytes);
  const out: RawStream[] = [];
  const keyword = /stream(\r\n|\n)/g;
  let m: RegExpExecArray | null;
  while ((m = keyword.exec(text))) {
    /* `endstream` contains the keyword too */
    if (text.slice(Math.max(0, m.index - 3), m.index) === "end") continue;
    const dict = dictBefore(text, m.index);
    if (!dict) continue;
    const length = lengthOf(dict, text);
    const start = m.index + m[0].length;
    if (length === null || start + length > bytes.length) continue;
    out.push({ dict, data: bytes.subarray(start, start + length) });
    keyword.lastIndex = start + length;
  }
  return out;
}

function decoded(stream: RawStream): Uint8Array | null {
  if (!/\/Filter\s*(?:\[\s*)?\/FlateDecode/.test(stream.dict)) {
    return /\/Filter/.test(stream.dict) ? null : stream.data;
  }
  try {
    return unzlibSync(stream.data);
  } catch {
    /* A raw deflate body with no zlib wrapper, which some writers emit */
    try {
      return inflateSync(stream.data);
    } catch {
      return null;
    }
  }
}

/* ---- the page's text, run by run ---- */

/* A literal string's bytes: escapes, octal codes, nested parentheses and
   the backslash that continues a line */
function literal(src: string, at: number): { bytes: number[]; end: number } {
  const bytes: number[] = [];
  let depth = 1;
  let i = at + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      const n = src[i + 1];
      const simple: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
      if (n in simple) {
        bytes.push(simple[n]);
        i += 2;
      } else if (/[0-7]/.test(n)) {
        const oct = /^[0-7]{1,3}/.exec(src.slice(i + 1, i + 4))![0];
        bytes.push(Number.parseInt(oct, 8) & 0xff);
        i += 1 + oct.length;
      } else if (n === "\r" || n === "\n") {
        i += n === "\r" && src[i + 2] === "\n" ? 3 : 2;
      } else {
        if (n !== undefined) bytes.push(n.charCodeAt(0));
        i += 2;
      }
      continue;
    }
    if (c === "(") depth++;
    if (c === ")" && --depth === 0) return { bytes, end: i + 1 };
    bytes.push(c.charCodeAt(0));
    i++;
  }
  return { bytes, end: i };
}

function hex(src: string, at: number): { bytes: number[]; end: number } {
  const close = src.indexOf(">", at);
  const digits = src.slice(at + 1, close === -1 ? src.length : close).replace(/\s/g, "");
  const even = digits.length % 2 ? `${digits}0` : digits;
  const bytes: number[] = [];
  for (let i = 0; i < even.length; i += 2) bytes.push(Number.parseInt(even.slice(i, i + 2), 16));
  return { bytes, end: close === -1 ? src.length : close + 1 };
}

/* PDF whitespace and delimiters, by char code */
const isSpace = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
const isDelimiter = (c: number) =>
  isSpace(c) || c === 0x2f || c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x25;
const isLetter = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x27 || c === 0x22 || c === 0x2a;

/* The text runs of a content stream, in the order the page draws them.
   A run starts at every positioning operator (`BT`, `Tm`, `Td`, `TD`,
   `T*`, `'`, `"`); consecutive shows with no positioning between them join
   one run. Kerning numbers in a `TJ` array are dropped. */
function runsOf(content: Uint8Array): string[] {
  const src = binary(content);
  const runs: string[] = [];
  let current: number[] | null = null;
  /* the operands since the last operator: a string, or a TJ array's strings */
  let operands: (number[] | number[][])[] = [];
  const close = () => {
    if (current && current.length) runs.push(cp1252(current));
    current = null;
  };
  const show = (bytes: number[]) => {
    current = current ? current.concat(bytes) : [...bytes];
  };
  const code = (at: number) => src.charCodeAt(at);
  let i = 0;
  while (i < src.length) {
    const c = code(i);
    if (isSpace(c)) {
      i++;
    } else if (c === 0x25 /* % */) {
      while (i < src.length && code(i) !== 0x0a && code(i) !== 0x0d) i++;
    } else if (c === 0x2f /* / a name */) {
      i++;
      while (i < src.length && !isDelimiter(code(i))) i++;
    } else if (c === 0x28 /* ( */) {
      const s = literal(src, i);
      operands.push(s.bytes);
      i = s.end;
    } else if (c === 0x3c /* < */) {
      if (code(i + 1) === 0x3c) {
        i += 2; /* << — a dictionary operand, nothing to read in it */
      } else {
        const s = hex(src, i);
        operands.push(s.bytes);
        i = s.end;
      }
    } else if (c === 0x3e /* > */) {
      i += code(i + 1) === 0x3e ? 2 : 1;
    } else if (c === 0x5b /* [ a TJ array: its strings, in order */) {
      const parts: number[][] = [];
      i++;
      while (i < src.length && code(i) !== 0x5d) {
        if (code(i) === 0x28) {
          const s = literal(src, i);
          parts.push(s.bytes);
          i = s.end;
        } else if (code(i) === 0x3c) {
          const s = hex(src, i);
          parts.push(s.bytes);
          i = s.end;
        } else i++;
      }
      operands.push(parts);
      i++;
    } else if (isLetter(c)) {
      let j = i;
      while (j < src.length && isLetter(code(j))) j++;
      const op = src.slice(i, j);
      i = j;
      if (op === "BT" || op === "ET" || op === "Tm" || op === "Td" || op === "TD" || op === "T*") {
        close();
      } else if (op === "Tj" || op === "'" || op === '"') {
        if (op !== "Tj") close();
        const last = operands[operands.length - 1];
        if (Array.isArray(last) && !Array.isArray(last[0])) show(last as number[]);
      } else if (op === "TJ") {
        const last = operands[operands.length - 1];
        if (Array.isArray(last)) for (const part of last as number[][]) if (Array.isArray(part)) show(part);
      } else if (op === "ID") {
        /* inline image data runs to `EI`; nothing to read in it */
        const ei = src.indexOf("EI", i);
        i = ei === -1 ? src.length : ei + 2;
      }
      operands = [];
    } else {
      /* numbers and anything else an operator takes */
      i++;
    }
  }
  close();
  return runs;
}

/* ---- the labels ---- */

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
/* Labels match whatever the case and the accents: "Número" is one cp1252
   byte on every measured CEP, and a decomposed "u" must not unread one */
const plain = (s: string) =>
  norm(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const startsWith = (run: string, label: string) => plain(run).startsWith(plain(label));

const CLAVE_LABEL = "Clave de rastreo";
const CADENA_LABEL = "Cadena Original";
const SEAL_LABEL = "Sello Digital";
const CERTIFICATE_LABEL = "Número de Serie del Certificado";
const CLAVE = /^[A-Z0-9]{6,30}$/;
/* Version 01 of the cadena carries 43 fields (research R5) */
const CADENA_FIELDS = 43;
const BASE64 = /^[A-Za-z0-9+/=]+$/;

/* A label's last run: the label itself, or — when a long label wraps — the
   next run that closes it with a colon (within two more runs) */
function labelEnd(runs: string[], at: number): number {
  if (/:\s*$/.test(runs[at])) return at;
  for (let j = at + 1; j <= at + 2 && j < runs.length; j++) if (/:\s*$/.test(runs[j])) return j;
  return at;
}

/* `expectedClave`: the clave the bundle's entry name carries (D3). When
   given, the page must print exactly it, or the CEP is unreadable. When
   not (a bundle of one, served as a bare PDF), the clave is the value
   printed after its label. */
export function readCepPdf(bytes: Uint8Array, opts: { expectedClave?: string | null } = {}): CepPdfResult {
  if (!(bytes.length > 5 && binary(bytes.subarray(0, 5)) === "%PDF-")) return { unreadable: "not_pdf" };

  let runs: string[] = [];
  for (const stream of streams(bytes)) {
    /* The image, the object streams and the cross-reference hold no text */
    if (/\/Subtype\s*\/Image|\/Type\s*\/(?:XRef|ObjStm|XObject)/.test(stream.dict)) continue;
    const content = decoded(stream);
    if (content) runs = runs.concat(runsOf(content));
  }
  if (!runs.length) return { unreadable: "no_text" };

  /* The clave: its label must be there, and so must the clave itself */
  const claveAt = runs.findIndex((r) => startsWith(r, CLAVE_LABEL));
  if (claveAt === -1) return { unreadable: "no_clave_label" };
  let clave: string | null = null;
  if (opts.expectedClave) {
    const printed = runs.some((r) => norm(r).split(/[\s:]+/).includes(opts.expectedClave!));
    if (!printed) return { unreadable: "clave_mismatch" };
    clave = opts.expectedClave;
  } else {
    /* "Clave de rastreo: X" on one run, or X on one of the next runs */
    const inline = norm(runs[claveAt]).slice(CLAVE_LABEL.length).replace(/^[\s:]+/, "");
    const candidates = [inline, ...runs.slice(claveAt + 1, claveAt + 4).map(norm)];
    /* A reference is 1–7 digits, so a clave-shaped value of seven digits
       or fewer is never taken for the clave */
    clave = candidates.find((v) => CLAVE.test(v) && !/^\d{1,7}$/.test(v)) ?? null;
    if (!clave) return { unreadable: "no_clave" };
  }

  /* The cadena: from the first run after its label that opens with `||`,
     up to the seal's label — joined without spaces (R4) */
  const cadenaAt = runs.findIndex((r) => startsWith(r, CADENA_LABEL));
  const sealAt = runs.findIndex((r) => startsWith(r, SEAL_LABEL));
  if (cadenaAt === -1) return { unreadable: "no_cadena_label" };
  if (sealAt === -1 || sealAt < cadenaAt) return { unreadable: "no_seal_label" };
  const first = runs.findIndex((r, j) => j > cadenaAt && j < sealAt && r.trim().startsWith("||"));
  if (first === -1) return { unreadable: "no_cadena" };
  /* It ends where it closes: `||` with its 43 fields (R5) — so a stray run
     between the cadena and the seal's label is never glued onto it */
  let cadena = "";
  for (let j = first; j < sealAt; j++) {
    cadena += runs[j];
    const t = cadena.trim();
    if (t.length > 4 && t.endsWith("||") && t.slice(2, -2).split("|").length >= CADENA_FIELDS) break;
  }
  cadena = cadena.trim();
  if (!cadena.startsWith("||") || !cadena.endsWith("||")) return { unreadable: "no_cadena" };

  /* The seal: the base64 runs after its label, until the first that is not */
  const sealParts: string[] = [];
  for (let j = labelEnd(runs, sealAt) + 1; j < runs.length; j++) {
    const piece = runs[j].trim();
    if (!piece || !BASE64.test(piece)) break;
    sealParts.push(piece);
  }
  if (!sealParts.length) return { unreadable: "no_seal" };

  /* The certificate number, as printed apart from the cadena */
  const certificateAt = runs.findIndex((r) => startsWith(r, CERTIFICATE_LABEL));
  let certificateNumber: string | null = null;
  if (certificateAt !== -1) {
    for (let j = labelEnd(runs, certificateAt) + 1; j <= certificateAt + 4 && j < runs.length; j++) {
      const v = norm(runs[j]);
      if (/^\d{6,30}$/.test(v)) {
        certificateNumber = v;
        break;
      }
    }
  }

  return { clave, cadena, seal: sealParts.join(""), certificateNumber };
}

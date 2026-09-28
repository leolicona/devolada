import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { claveOfEntry, listEntries, readEntries, sniff } from "../../src/consta/bundle/zip";
import { readCepPdf } from "../../src/consta/bundle/cep-pdf";
import { parseCadena } from "../../src/consta/bundle/cadena";
import { wallClockMs } from "../../src/time/business-day";
import {
  buildBundleZip,
  buildCepPdf,
  cadenaLines,
  cadenaOf,
  entryName,
  SENDER_8301,
  SYNTHETIC,
  syntheticSeal,
  type CadenaFields,
} from "./bundle-fixtures";

/* cep-bundle-match US1 — the bundle is read: a ZIP served as a PDF is
   recognised by its bytes, each CEP is read by Banxico's layout, and the
   cadena gives the facts matching needs and nothing else (D3, D4;
   research R3–R5, R18). Synthetic CEPs only: real ones carry names. */

const BUSINESS_CLABE = "012180001234567897";
const FIELDS: CadenaFields = {
  operationDay: "2026-09-28",
  creditDay: "2026-09-26",
  creditTime: "07:11:20",
  senderAccount: SENDER_8301,
  beneficiaryAccount: BUSINESS_CLABE,
  amount: "3.00",
};
const CLAVE = "260928071156210101I";
const CADENA = cadenaOf(FIELDS);
const pdf = (over: Partial<Parameters<typeof buildCepPdf>[0]> = {}) => buildCepPdf({ clave: CLAVE, cadena: CADENA, ...over });

describe("cep-bundle-match US1: the bundle's bytes (zip.ts, D3)", () => {
  it("a ZIP served as a PDF is recognised by its first bytes; a real PDF is a bundle of one; garbage is nothing", () => {
    const zip = buildBundleZip([{ name: entryName("2026-09-28", CLAVE), bytes: pdf() }]);
    expect(sniff(zip)).toBe("zip");
    expect(sniff(pdf())).toBe("pdf");
    expect(sniff(new TextEncoder().encode("<html>no</html>"))).toBeNull();
    expect(sniff(new Uint8Array(0))).toBeNull();
  });

  it("the clave comes from both entry-name patterns, and a day never does", () => {
    expect(claveOfEntry("CEP-20260928-260928071156210101I.pdf")).toBe("260928071156210101I");
    expect(claveOfEntry("[2026-09-26]260928071156210101I.pdf")).toBe("260928071156210101I");
    expect(claveOfEntry("CEP-20260928-NU3AN02K6CS59GIBCF1CQ696SE8Q.pdf")).toBe("NU3AN02K6CS59GIBCF1CQ696SE8Q");
    for (const bad of ["CEP-2026092-X12345.pdf", "resumen.txt", "CEP-20260928-abc.pdf", "CEP-20260928-12345.pdf"]) {
      expect(claveOfEntry(bad)).toBeNull();
    }
  });

  it("the ZIP's entries are listed in order, with sizes from a data descriptor, and skipped entries are never inflated", () => {
    const keptName = entryName("2026-09-28", CLAVE);
    const skippedName = entryName("2026-09-28", "260928071158244710I");
    /* The skipped entry is deflated and then broken: its first byte made
       an invalid block type. Inflating it would throw. */
    const zip = zipSync({ [skippedName]: pdf(), [keptName]: pdf() }, { level: 6 });
    const nameBytes = new TextEncoder().encode(skippedName);
    let header = -1;
    for (let i = 0; i < zip.length - 4; i++) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x03 && zip[i + 3] === 0x04) {
        const nameLength = zip[i + 26] | (zip[i + 27] << 8);
        const name = zip.subarray(i + 30, i + 30 + nameLength);
        if (name.length === nameBytes.length && name.every((b, j) => b === nameBytes[j])) header = i;
      }
    }
    const extra = zip[header + 28] | (zip[header + 29] << 8);
    zip[header + 30 + nameBytes.length + extra] = 0xff;

    expect(listEntries(zip)).toEqual([skippedName, keptName]);
    const read = readEntries(zip, (name) => name === keptName);
    expect(read.map((e) => e.name)).toEqual([keptName]);
    expect(sniff(read[0].bytes)).toBe("pdf");
    expect(() => readEntries(zip, () => true)).toThrow();

    /* and the measured framing — sizes in a data descriptor — reads too */
    const measured = buildBundleZip([{ name: keptName, bytes: pdf() }]);
    expect(measured[6] & 0x08).toBe(0x08);
    expect(readEntries(measured, () => true)).toHaveLength(1);
  });
});

describe("cep-bundle-match US1: one CEP, read by its layout (cep-pdf.ts, D3)", () => {
  it("the cadena printed over three lines rejoins exactly, and the clave, the seal and the certificate are read", () => {
    const lines = cadenaLines(CADENA);
    expect(lines).toHaveLength(3);
    expect(lines.join("")).not.toBe(CADENA); // the break ate a space inside the name
    const read = readCepPdf(pdf(), { expectedClave: CLAVE });
    expect(read).toEqual({
      clave: CLAVE,
      cadena: lines.join(""),
      seal: syntheticSeal(),
      certificateNumber: SYNTHETIC.certificateNumber,
    });
    /* every field the feature keeps survives the join (R5) */
    expect(parseCadena("unreadable" in read ? null : read.cadena)).toMatchObject({
      creditDate: "2026-09-26",
      creditTime: "07:11:20",
      senderAccount: SENDER_8301,
      receiverAccount: BUSINESS_CLABE,
      amountCents: 300,
      certificateNumber: SYNTHETIC.certificateNumber,
    });
  });

  it("a stream whose last compressed byte is a line break reads — streams are sliced by /Length (R4)", () => {
    const bytes = pdf({ lastByteLineBreak: true });
    const marker = new TextEncoder().encode("\nendstream");
    let end = -1;
    for (let i = 0; i < bytes.length && end === -1; i++) if (marker.every((b, j) => bytes[i + j] === b)) end = i;
    /* the page's stream is the first; its last compressed byte is "\n" */
    expect(bytes[end - 1]).toBe(0x0a);
    expect(readCepPdf(bytes, { expectedClave: CLAVE })).toMatchObject({ clave: CLAVE });
    /* and a /Length written as a reference to another object */
    expect(readCepPdf(pdf({ indirectLength: true }), { expectedClave: CLAVE })).toMatchObject({ clave: CLAVE });
  });

  it("a missing label makes the CEP unreadable, whichever label it is", () => {
    expect(readCepPdf(pdf({ omitLabel: "clave" }), { expectedClave: CLAVE })).toEqual({ unreadable: "no_clave_label" });
    expect(readCepPdf(pdf({ omitLabel: "cadena" }), { expectedClave: CLAVE })).toEqual({ unreadable: "no_cadena_label" });
    expect(readCepPdf(pdf({ omitLabel: "seal" }), { expectedClave: CLAVE })).toEqual({ unreadable: "no_seal_label" });
    expect(readCepPdf(new TextEncoder().encode("PK not a pdf"))).toEqual({ unreadable: "not_pdf" });
  });

  it("a printed clave that differs from the entry's makes the CEP unreadable", () => {
    expect(readCepPdf(pdf({ printedClave: "260928071158244710I" }), { expectedClave: CLAVE })).toEqual({
      unreadable: "clave_mismatch",
    });
  });

  it("a bundle of one, with no entry name, takes the clave printed after its label — never the reference", () => {
    expect(readCepPdf(pdf())).toMatchObject({ clave: CLAVE });
  });
});

describe("cep-bundle-match US1: the cadena original (cadena.ts, D4)", () => {
  it("a bundle's cadena gives the facts matching needs, in cents and ISO days, with the Mexico City instant", () => {
    expect(parseCadena(CADENA)).toEqual({
      operationDate: "2026-09-28",
      creditDate: "2026-09-26",
      creditTime: "07:11:20",
      creditedAt: wallClockMs("America/Mexico_City", "2026-09-26", "07:11:20"),
      senderBank: "AZTECA",
      senderAccountType: "40",
      senderAccount: SENDER_8301,
      receiverSpeiCode: "40012",
      receiverAccountType: "40",
      receiverAccount: BUSINESS_CLABE,
      amountCents: 300,
      certificateNumber: SYNTHETIC.certificateNumber,
    });
    /* Mexico City is UTC−6 all year since 2022 */
    expect(parseCadena(CADENA)!.creditedAt).toBe(Date.UTC(2026, 8, 26, 13, 11, 20));
  });

  it("a valid's cdaChain — one line — reads the same way", () => {
    const chain = cadenaOf({ ...FIELDS, creditDay: "2026-09-25", creditTime: "07:19:52", amount: "1250.50" });
    expect(parseCadena(chain)).toMatchObject({ creditDate: "2026-09-25", creditTime: "07:19:52", amountCents: 125050 });
  });

  it("a 23:48:18 credit filed on the next operation day keeps its own credit day", () => {
    const night = parseCadena(cadenaOf({ ...FIELDS, operationDay: "2026-09-25", creditDay: "2026-09-24", creditTime: "23:48:18", amount: "5.00" }));
    expect(night).toMatchObject({ operationDate: "2026-09-25", creditDate: "2026-09-24", creditTime: "23:48:18" });
    expect(night!.creditedAt).toBe(Date.UTC(2026, 8, 25, 5, 48, 18));
  });

  it("anything not as measured is null: another version, a field short, a bad day, a masked account", () => {
    expect(parseCadena(cadenaOf({ ...FIELDS, version: "02" }))).toBeNull();
    expect(parseCadena(CADENA.replace("|0|", "|"))).toBeNull();
    expect(parseCadena(cadenaOf({ ...FIELDS, creditDay: "2026-02-30" }))).toBeNull();
    expect(parseCadena(cadenaOf({ ...FIELDS, senderAccount: "***8301" }))).toBeNull();
    expect(parseCadena(cadenaOf({ ...FIELDS, amount: "3,00" }))).toBeNull();
    expect(parseCadena(null)).toBeNull();
  });

  it("no field it returns is a name or an RFC (FR-006, FR-010)", () => {
    const values = Object.values(parseCadena(CADENA)!).map(String);
    for (const personal of [SYNTHETIC.senderName, SYNTHETIC.senderRfc, SYNTHETIC.beneficiaryName, SYNTHETIC.beneficiaryRfc]) {
      expect(values).not.toContain(personal);
      expect(values.join("|")).not.toContain(personal);
    }
  });
});

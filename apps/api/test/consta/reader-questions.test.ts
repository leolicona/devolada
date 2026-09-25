import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { paymentLinks } from "../../src/db/schema";
import type { Bindings } from "../../src/env";
import { consta, type ConstaRequest } from "../../src/consta";
import { gateReading, receivingBankTie } from "../../src/consta/extraction";
import { PROMPT, QUESTIONS_VERSION, readProof, TEXT_PROMPT } from "../../src/consta/extraction/reader";
import { proofReadingResponse } from "../../src/routes/direct-payments/schema";
import { app, fakeProofs, seedBusiness } from "../helpers";
import { aiReturning, extractions, PNG, putProof, seedOwner, type StubbedReading } from "./helpers";

/* receipt-reader-tuning US2 — the receipt is read right: the clave from
   its labelled field, both banks, every character (D12–D14). A stub
   proves the wording, the parsing, the recording and that nothing is
   altered — never accuracy, which only real models on the bench can
   measure (D20). */

const APICEP_ORIGIN = "https://api.apicep.cloud";
beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const db = () => drizzle(env.DB);
const PROOFS = fakeProofs();
const testEnv = (over: Partial<Bindings> = {}) => ({ ...env, PROOFS, ...over }) as typeof env & Bindings;
const DEFAULT = { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", label: "Default" };

/* An AZTECA CLABE (bank code 127) as the cuenta de cobro */
const AZTECA_CLABE = "127180001234567897";
const COBRO = { bank: "AZTECA", clabe: AZTECA_CLABE };

const BASE: StubbedReading = {
  esComprobante: true,
  legibilidad: "completa",
  claveDeRastreo: "260925071144368901I",
  monto: 350,
  fecha: "2026-09-25",
};

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* D12: the hash of the version-2 wording. A change to either prompt
   without bumping QUESTIONS_VERSION fails here — re-pin only together
   with a new version. */
const PINNED: Record<string, string> = {
  "2": "bc7d32bad24a24fa4f2e76027a5bf7363af1284891fede497d4e9f5dba12d02c",
};

describe("receipt-reader-tuning US2: the questions, version 2 (D12, D13)", () => {
  it("both prompts carry the clave-label rule, the final-letter rule, the sending-side rule and both bank keys", () => {
    for (const prompt of [PROMPT, TEXT_PROMPT]) {
      for (const label of ['"Folio"', '"Número de\n  autorización"', '"Número de operación"', '"Referencia"']) {
        expect(prompt).toContain(label);
      }
      expect(prompt).toContain('comes ONLY from a field labelled "Clave de rastreo"');
      expect(prompt).toContain('Banco Azteca\'s end in the\n  letter "I"');
      expect(prompt).toContain('"Cuenta origen"');
      expect(prompt).toContain('("Cuenta destino"');
      expect(prompt).toContain('"bancoEmisor"');
      expect(prompt).toContain('"bancoReceptor"');
      expect(prompt).not.toContain('"banco":');
      /* Unchanged: the reference and destination rules (receipt-triage D12, D24) */
      expect(prompt).toContain('"referenciaNumerica" is the numeric reference the sender typed');
      expect(prompt).toContain('"destino" is the account the money was sent TO');
    }
    expect(PROMPT).toContain('"legibilidad"');
    expect(TEXT_PROMPT).not.toContain('"legibilidad"');
  });

  it("the pin: sha256(PROMPT + newline + TEXT_PROMPT) is the hash pinned for QUESTIONS_VERSION", async () => {
    expect(QUESTIONS_VERSION).toBe("2");
    expect(await sha256(`${PROMPT}\n${TEXT_PROMPT}`)).toBe(PINNED[QUESTIONS_VERSION]);
  });
});

describe("receipt-reader-tuning US2: parsing both banks (D13)", () => {
  const proof = { bytes: PNG(), kind: "image" as const, mediaType: "image/png", sha256: "x" };
  it("bancoEmisor and bancoReceptor parse; a reading with only `banco` still gives the sender", async () => {
    const both = await readProof(aiReturning({ ...BASE, bancoEmisor: "AZTECA", bancoReceptor: "BBVA MEXICO" }), proof, DEFAULT);
    expect(both).toMatchObject({ senderBank: "AZTECA", receivingBank: "BBVA MEXICO", questionVersion: "2", fallbackFrom: null });
    const old = await readProof(aiReturning({ ...BASE, banco: "BANORTE" }), proof, DEFAULT);
    expect(old).toMatchObject({ senderBank: "BANORTE", receivingBank: null });
  });

  it("the receiving bank resolves through the vocabulary: a known name, an unknown one, and none", async () => {
    const gate = async (bancoReceptor: string | null) =>
      gateReading(await readProof(aiReturning({ ...BASE, bancoEmisor: "AZTECA", bancoReceptor }), proof, DEFAULT)).receiving;
    expect(await gate("Bbva Mexico")).toEqual({ bank: "BBVA MEXICO", verdict: "ok", sameBank: false });
    expect(await gate("Banco Inventado")).toEqual({ bank: null, verdict: "unknown", sameBank: false });
    expect(await gate(null)).toEqual({ bank: null, verdict: "missing", sameBank: false });
    expect(await gate("azteca")).toEqual({ bank: "AZTECA", verdict: "ok", sameBank: true });
  });

  it("the tie verdict: match, mismatch, and nothing when untied or unresolved", async () => {
    const gated = (bancoReceptor: string | null) =>
      gateReading({
        isReceipt: true, legibility: "full", trackingKey: null, senderBank: "AZTECA", receivingBank: bancoReceptor,
        amount: 350, date: null, time: null, status: null, referenceNumber: null,
        destination: { kind: "clabe", digits: "7897" }, raw: "", model: DEFAULT.id, questionVersion: "2", ms: 1, fallbackFrom: null,
      });
    const tie = { tied: COBRO };
    expect(receivingBankTie(gated("AZTECA"), tie)).toBe("match");
    expect(receivingBankTie(gated("BBVA MEXICO"), tie)).toBe("mismatch");
    expect(receivingBankTie(gated("AZTECA"), "unknown")).toBeNull();
    expect(receivingBankTie(gated(null), tie)).toBeNull();
  });
});

describe("receipt-reader-tuning US2: recording both banks, altering neither (D14, FR-012)", () => {
  async function seedAztecaLink() {
    const business = await seedBusiness({ speiClabe: AZTECA_CLABE, speiBank: "AZTECA", speiBeneficiaryName: "WifiPlus" });
    const [link] = await db()
      .insert(paymentLinks)
      .values({ businessId: business.id, token: "tok2345abcdefgh2", wisphubCustomerId: "6", customerUsuario: "greyes@wifiplus" })
      .returning();
    await PROOFS.put(`${link.id}/proof-1`, PNG(), { httpMetadata: { contentType: "image/png" } });
    return { business, link };
  }
  const read = async (linkId: string, reading: StubbedReading) =>
    (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/read",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proofId: `${linkId}/proof-1` }) },
      testEnv({ AI: aiReturning(reading) }),
    );

  it("Azteca → Azteca: same_bank is set, both banks are kept as read, and the payer's answer is unchanged in shape", async () => {
    const { link } = await seedAztecaLink();
    const res = await read(link.id, {
      ...BASE,
      bancoEmisor: "AZTECA",
      bancoReceptor: "AZTECA",
      destino: { tipo: "clabe", digitos: "7897" },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(proofReadingResponse.parse(data)).toBeTruthy();
    expect(data.senderBank).toBe("AZTECA");
    expect(JSON.stringify(data)).not.toContain("receiving");
    expect(JSON.stringify(data)).not.toContain("sameBank");

    const [row] = await db().select().from(extractions);
    expect(row).toMatchObject({
      senderBank: "AZTECA",
      gateSenderBank: "ok",
      receivingBank: "AZTECA",
      gateReceivingBank: "ok",
      sameBank: true,
      receivingBankTie: "match",
      questionVersion: "2",
    });
  });

  it("no sending bank shown and BBVA receiving: the receiver is never copied into the sender", async () => {
    const { link } = await seedAztecaLink();
    const res = await read(link.id, { ...BASE, bancoEmisor: null, bancoReceptor: "BBVA MEXICO", destino: { tipo: "clabe", digitos: "7897" } });
    const { data } = await res.json();
    expect(data.senderBank).toBeNull();
    const [row] = await db().select().from(extractions);
    expect(row).toMatchObject({
      senderBank: null,
      gateSenderBank: "missing",
      receivingBank: "BBVA MEXICO",
      sameBank: null,
      receivingBankTie: "mismatch",
    });
  });

  it("an untied destination records no tie verdict", async () => {
    const { link } = await seedAztecaLink();
    await read(link.id, { ...BASE, bancoEmisor: "AZTECA", bancoReceptor: "AZTECA", destino: { tipo: null, digitos: "12" } });
    const [row] = await db().select().from(extractions);
    expect(row.receivingBankTie).toBeNull();
    expect(row.sameBank).toBe(true);
  });
});

describe("receipt-reader-tuning US2: the receipt door and the reused draft (D14, D15)", () => {
  const PROOF_KEY = "link-1/receipt";
  const request = {
    receipt: { proofKey: PROOF_KEY },
    beneficiary: COBRO,
    receivingAccounts: [COBRO],
  } as unknown as ConstaRequest;
  const notFound = () =>
    fetchMock
      .get(APICEP_ORIGIN)
      .intercept({ method: "POST", path: "/validate-transfer" })
      .reply(
        200,
        JSON.stringify({ validationId: "prov-nf", status: "invalid", validation: { banxicoConfirmed: false, cepPreviouslyValidated: null }, extracted: {} }),
        { headers: { "Content-Type": "application/json" } },
      );
  const READING: StubbedReading = { ...BASE, bancoEmisor: "AZTECA", bancoReceptor: "AZTECA", destino: { tipo: "clabe", digitos: "7897" } };

  it("the receipt door writes the same columns on the paid call's row", async () => {
    const { key } = await seedOwner();
    await putProof(PROOFS, PROOF_KEY, PNG(), "image/png");
    notFound();
    await consta(testEnv({ AI: aiReturning(READING) }), db(), { businessId: key }).validate(request);
    const [row] = await db().select().from(extractions);
    expect(row.validationId).not.toBeNull();
    expect(row).toMatchObject({ receivingBank: "AZTECA", gateReceivingBank: "ok", sameBank: true, receivingBankTie: "match" });
  });

  it("the pay after /read rebuilds `receiving` from the draft and records the same three columns", async () => {
    const { key } = await seedOwner();
    await putProof(PROOFS, PROOF_KEY, PNG(), "image/png");
    const calls: unknown[] = [];
    const AI = aiReturning(READING, calls);
    await consta(testEnv({ AI }), db(), { businessId: key }).extract({ proofKey: PROOF_KEY, receivingAccounts: [COBRO] });
    notFound();
    await consta(testEnv({ AI }), db(), { businessId: key }).validate(request);
    expect(calls.filter((c) => (c as { model?: string }).model)).toHaveLength(1);
    const paid = (await db().select().from(extractions)).find((r) => r.validationId)!;
    expect(paid.rawOutput).toContain("reused from extraction");
    expect(paid).toMatchObject({ receivingBank: "AZTECA", gateReceivingBank: "ok", sameBank: true, receivingBankTie: "match" });
  });
});

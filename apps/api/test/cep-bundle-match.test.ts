import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { cepBundles, cepRecords, extractions, paymentLinks, payments, validations } from "../src/db/schema";
import { chooseAndClaim, sweepDirectPayments } from "../src/direct-payments/validation";
import { recordsFor } from "../src/consta/bundle/store";
import { resetShapeRules } from "../src/consta/extraction";
import type { Bindings } from "../src/env";
import { app, fakeProofs, seedBusiness } from "./helpers";
import {
  aiReturning,
  AZTECA_1858_READING,
  AZTECA_SECONDS_TAIL_READING,
  PNG,
  type StubbedReading,
} from "./consta/helpers";
import {
  buildBundleZip,
  bundleOf,
  entryName,
  noneAnswer,
  SENDER_4417,
  SENDER_8301,
  severalAnswer,
  transferPdf,
  validAnswer,
  type SyntheticTransfer,
} from "./consta/bundle-fixtures";

/* cep-bundle-match — the lifecycle of a search without a clave.

   A reference many transfers share (Azteca's default is the last seven
   digits of the receiving CLABE) comes back as a bundle of CEPs, and a
   single `valid` for such a search is no safer: both pass one matcher —
   integrity, used, the sender's tail, the time window — and one left
   confirms with no further call, while none or several leaves the payment
   undecided, asking the payer for the clave, with no slot and no expiry.

   apiCEP and its storage are intercepted at their pinned origins; the
   reader is stubbed at the binding with the readings of
   `consta/helpers.ts` — provisional until the bench measures version 3
   (tasks T015, debt cep-bundle-match-reader-unmeasured). WispHub answers
   the confirmation's debt re-check and reconnection at its own origin. */

const APICEP = "https://api.apicep.cloud";
const STORAGE = "https://storage.apicep.cloud";
const WISPHUB = "https://api.wisphub.net";
const BUNDLE_PATH = "/9784417-1790446947555.pdf";
const BUNDLE_URL = `${STORAGE}${BUNDLE_PATH}`;

const testEnv = { ...env, PROOFS: fakeProofs() } as typeof env & Bindings;
const readerEnv = (reading: StubbedReading) => ({ ...testEnv, AI: aiReturning(reading) }) as typeof testEnv;
const db = () => drizzle(env.DB);

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());
beforeEach(() => resetShapeRules());

/* The business: paid at a BBVA CLABE whose last seven digits are Azteca's
   default reference, 9784417 — so every Azteca payer shares it */
const BUSINESS_CLABE = "012180000089784417";
const ACCOUNT = { kind: "clabe", value: BUSINESS_CLABE, bank: "BBVA MEXICO" };
const REFERENCE = "9784417";

const transfer = (clave: string, creditDay: string, creditTime: string, senderAccount = SENDER_8301, over: Partial<SyntheticTransfer> = {}): SyntheticTransfer => ({
  clave,
  operationDay: "2026-09-28",
  creditDay,
  creditTime,
  senderAccount,
  beneficiaryAccount: BUSINESS_CLABE,
  amount: "3.00",
  ...over,
});
/* The measured Saturday: the payer's own 07:11:20 and another sender's 11:40:47 */
const MINE = transfer("260928071199000011I", "2026-09-26", "07:11:20");
const THEIRS = transfer("260928071199000012I", "2026-09-26", "11:40:47", SENDER_4417);
/* The Janely case: a Friday-morning transfer the receipt printed 18:58 is not */
const MORNING = transfer("260925071199000013I", "2026-09-25", "07:19:52", SENDER_8301, { operationDay: "2026-09-25" });

/* ---- WispHub: the debt re-check and the reconnection of a confirmation ---- */

const json = (body: unknown) => [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;
const wisphubCustomer = (estado = "Suspendido", usuario = "cliente@wifiplus") => ({
  id_servicio: 6,
  usuario,
  nombre: "Cliente Azteca",
  estado,
  estado_facturas: "Pendiente de Pago",
  precio_plan: "1.50",
  saldo: "0.00",
  zona: { id: 71342, nombre: "Zona dia 15" },
});

/* $1.50 owed plus the $1.50 fee: the $3.00 transfer settles it exactly */
/* `again`: a second confirmation of the same business in one test — WispHub's
   payment method is cached per tenant (provider-latency D3), so it is not
   asked twice */
function mockConfirmation(usuario = "cliente@wifiplus", opts: { again?: boolean } = {}) {
  const wh = () => fetchMock.get(WISPHUB);
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
    .reply(...json({ count: 1, results: [wisphubCustomer("Suspendido", usuario)] }));
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
    .reply(...json({ next: null, count: 1, results: [{ id_factura: 42, cliente: { usuario }, total: 1.5 }] }));
  wh().intercept({ method: "PATCH", path: "/api/clientes/6/" }).reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
  if (!opts.again) {
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  }
  wh()
    .intercept({ method: "POST", path: "/api/facturas/42/registrar-pago/" })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
    .reply(...json({ count: 1, results: [wisphubCustomer("Activo", usuario)] }));
}

/* ---- apiCEP and its storage ---- */

function mockApiCep(answer: unknown, seen?: (body: Record<string, unknown>) => void) {
  fetchMock
    .get(APICEP)
    .intercept({
      method: "POST",
      path: "/validate-transfer",
      body: (raw) => {
        seen?.(JSON.parse(String(raw)));
        return true;
      },
    })
    .reply(...json(answer));
}
function mockStorage(body: Uint8Array | string, status = 200) {
  fetchMock.get(STORAGE).intercept({ method: "GET", path: BUNDLE_PATH }).reply(status, body, {
    headers: { "Content-Type": "application/pdf" },
  });
}

/* ---- rows ---- */

async function seedAztecaBusiness(token = "tokazteca0000001", usuario = "cliente@wifiplus") {
  const business = await seedBusiness({
    /* unique per business: the auth user behind it is unique by email */
    email: `negocio-${crypto.randomUUID().slice(0, 8)}@devolada.test`,
    wisphubApiKey: "wh-key-1",
    serviceFeeCents: 150,
    speiClabe: BUSINESS_CLABE,
    speiBank: "BBVA MEXICO",
    speiBeneficiaryName: "WifiPlus SA de CV",
  });
  const link = await seedLink(business, token, usuario);
  return { business, link };
}

async function seedLink(business: { id: string }, token: string, usuario: string) {
  const [link] = await db()
    .insert(paymentLinks)
    .values({ businessId: business.id, token, wisphubCustomerId: "6", customerUsuario: usuario })
    .returning();
  return link;
}

/* A row born since receipt-triage: its account and the accounts registered
   at submission, the $3.00 the receipt said, due now */
async function seedRow(link: { id: string }, business: { id: string }, over: Partial<typeof payments.$inferInsert> = {}) {
  const [row] = await db()
    .insert(payments)
    .values({
      paymentLinkId: link.id,
      businessId: business.id,
      amountCents: 300,
      invoiceCents: 150,
      serviceFeeCents: 150,
      claimedAmountCents: 300,
      proofMode: "transfer",
      beneficiary: JSON.stringify(ACCOUNT),
      registeredAccounts: JSON.stringify([ACCOUNT]),
      nextValidationAt: new Date(Date.now() - 1000),
      ...over,
    })
    .returning();
  return row;
}

/* A capture on the receipt door, nothing typed: its first paid attempt is
   the provider's image door with our reading beside it */
/* Distinct bytes per capture: the engine reuses a reading of the same
   bytes for the same owner (two-eyes-receipt D14), and two payers' receipts
   are two files */
let captures = 0;
async function seedReceiptRow(link: { id: string }, business: { id: string }, over: Partial<typeof payments.$inferInsert> = {}) {
  const proofKey = `${link.id}/receipt-${crypto.randomUUID().slice(0, 8)}`;
  captures += 1;
  await testEnv.PROOFS.put(proofKey, PNG(64 + captures), { httpMetadata: { contentType: "image/png" } });
  return seedRow(link, business, { proofMode: "receipt", proofKey, claimedAmountCents: null, ...over });
}

/* A receipt whose two readings settled on the reference at an earlier
   attempt, which also kept the receipt's time and tail (D15): this slot
   takes the transfer door by reference */
async function seedSettledRow(
  link: { id: string },
  business: { id: string },
  side: { transferTime?: string | null; senderTail?: string | null; transferDate?: string },
  over: Partial<typeof payments.$inferInsert> = {},
) {
  return seedReceiptRow(link, business, {
    referenceNumber: REFERENCE,
    senderBank: "AZTECA",
    transferDate: side.transferDate ?? "2026-09-26",
    claimedAmountCents: 300,
    readingCheck: "agreed",
    acceptedFrom: "agreed",
    validationAttempts: 1,
    transferTime: side.transferTime ?? null,
    senderTail: side.senderTail ?? null,
    ...over,
  });
}

/* A typed submission by reference: the form asks for no time and no tail */
async function seedTypedRow(link: { id: string }, business: { id: string }, over: Partial<typeof payments.$inferInsert> = {}) {
  return seedRow(link, business, {
    proofMode: "transfer",
    referenceNumber: REFERENCE,
    senderBank: "AZTECA",
    transferDate: "2026-09-26",
    acceptedFrom: "human",
    ...over,
  });
}

const rowById = async (id: string) => (await db().select().from(payments).where(eq(payments.id, id)))[0];
const trailOf = (row: { matchTrail: string | null }) => JSON.parse(row.matchTrail!) as Record<string, unknown> & {
  candidates: Record<string, unknown>[];
};
const calls = async () => (await db().select().from(validations)).length;
const NOW = () => new Date();

describe("cep-bundle-match US1: the receipt's side reaches the payment (D15, analyze I1)", () => {
  it("the receipt door's first attempt keeps the reading's time and tail, whether it is answered valid or several", async () => {
    const { business, link } = await seedAztecaBusiness();
    const valid = await seedReceiptRow(link, business);
    /* a clave-less single valid it confirms: the receipt fits it */
    mockApiCep(validAnswer(MINE));
    mockConfirmation();
    await sweepDirectPayments(readerEnv(AZTECA_SECONDS_TAIL_READING), NOW());
    expect(await rowById(valid.id)).toMatchObject({ status: "confirmed", transferTime: "07:10:58", senderTail: "8301" });

    const { business: b2, link: l2 } = await seedAztecaBusiness("tokazteca0000002");
    const several = await seedReceiptRow(l2, b2);
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage("unavailable", 503);
    await sweepDirectPayments(readerEnv(AZTECA_SECONDS_TAIL_READING), NOW());
    expect(await rowById(several.id)).toMatchObject({ transferTime: "07:10:58", senderTail: "8301", lastError: "CEP_BUNDLE_PENDING" });
  });

  it("a typed row keeps both empty", async () => {
    const { business, link } = await seedAztecaBusiness();
    const typed = await seedTypedRow(link, business);
    mockApiCep(noneAnswer());
    await sweepDirectPayments(testEnv, NOW());
    expect(await rowById(typed.id)).toMatchObject({ transferTime: null, senderTail: null, lastError: "TRANSFER_NOT_FOUND" });
  });
});

describe("cep-bundle-match US1: a shared reference resolves to the payer's own transfer (D8, D9)", () => {
  it("(a) a receipt at 07:10:58 with tail 8301 against a ZIP of 8301 and 4417 confirms with the 8301 clave, one call, the action dispatched", async () => {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedSettledRow(link, business, { transferTime: "07:10:58", senderTail: "8301" });
    mockApiCep(severalAnswer(BUNDLE_URL), (body) => {
      expect((body.sender as Record<string, unknown>).referenceNumber).toBe(REFERENCE);
    });
    mockStorage(bundleOf([MINE, THEIRS]));
    mockConfirmation();

    await sweepDirectPayments(testEnv, NOW());
    const after = await rowById(row.id);
    expect(after).toMatchObject({
      status: "confirmed",
      trackingKey: MINE.clave,
      matchDistanceS: 22,
      lastError: null,
      actionOutcome: "done",
      receivedCents: 300,
    });
    expect(after.banxicoValidAt).not.toBeNull();
    const trail = trailOf(after);
    expect(trail).toMatchObject({ source: "several", decided: "chosen", by: "tail", reason: null, receipt: { time: "07:10:58", tail: "8301" } });
    expect(trail.candidates).toEqual([
      expect.objectContaining({ clave: MINE.clave, fate: "chosen", tail: "8301", creditTime: "07:11:20" }),
      expect.objectContaining({ clave: THEIRS.clave, fate: "dropped", why: "tail", tail: "4171" }),
    ]);
    const logged = await db().select().from(validations);
    expect(logged).toHaveLength(1);
    expect(logged[0].reason).toBe("several");
    /* the other sender's transfer is kept for when they upload theirs */
    expect((await db().select().from(cepRecords)).map((r) => r.clave).sort()).toEqual([MINE.clave, THEIRS.clave].sort());
  });

  it("(b) the tail leaves one: the time is not needed", async () => {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedSettledRow(link, business, { transferTime: null, senderTail: "8301" });
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(bundleOf([MINE, THEIRS]));
    mockConfirmation();
    await sweepDirectPayments(testEnv, NOW());
    const after = await rowById(row.id);
    expect(after).toMatchObject({ status: "confirmed", trackingKey: MINE.clave, matchDistanceS: null });
    expect(trailOf(after)).toMatchObject({ by: "tail" });
  });

  it("(c) one unreadable CEP is flagged in the trail, and the rest decide", async () => {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedSettledRow(link, business, { transferTime: "07:10:58", senderTail: "8301" });
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(
      buildBundleZip([
        { name: entryName(MINE.operationDay, MINE.clave), bytes: transferPdf(MINE) },
        { name: entryName(THEIRS.operationDay, THEIRS.clave), bytes: transferPdf(THEIRS, { omitLabel: "seal" }) },
      ]),
    );
    mockConfirmation();
    await sweepDirectPayments(testEnv, NOW());
    const after = await rowById(row.id);
    expect(after).toMatchObject({ status: "confirmed", trackingKey: MINE.clave });
    expect(trailOf(after).candidates).toContainEqual(
      expect.objectContaining({ clave: THEIRS.clave, cepId: null, fate: "dropped", why: "unreadable" }),
    );
  });

  it("(d) a CEP for another amount or another receiving account is dropped and named", async () => {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedSettledRow(link, business, { transferTime: null, senderTail: null });
    const otherAmount = transfer("260928071199000014I", "2026-09-26", "07:30:00", SENDER_8301, { amount: "5.00" });
    const otherAccount = transfer("260928071199000015I", "2026-09-26", "07:40:00", SENDER_8301, { beneficiaryAccount: "646180157000000004" });
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(bundleOf([MINE, otherAmount, otherAccount]));
    mockConfirmation();
    await sweepDirectPayments(testEnv, NOW());
    const after = await rowById(row.id);
    expect(after).toMatchObject({ status: "confirmed", trackingKey: MINE.clave });
    const candidates = trailOf(after).candidates;
    expect(candidates).toContainEqual(expect.objectContaining({ clave: otherAmount.clave, fate: "dropped", why: "amount" }));
    expect(candidates).toContainEqual(expect.objectContaining({ clave: otherAccount.clave, fate: "dropped", why: "account" }));
  });

  it("(e) the Janely case as it happened: a receipt printed 18:58 with no clave, answered by a single valid credited 07:19:52, does not confirm — the clave is asked (bug: reference-finds-other-transfer)", async () => {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedReceiptRow(link, business);
    mockApiCep(validAnswer(MORNING));

    await sweepDirectPayments(readerEnv(AZTECA_1858_READING), NOW());
    const after = await rowById(row.id);
    expect(after).toMatchObject({
      status: "validating",
      lastError: "CEP_UNDECIDED",
      disputedFields: JSON.stringify(["trackingKey"]),
      nextValidationAt: null,
      trackingKey: null,
      transferTime: "18:58",
      folio: null,
    });
    expect(after.banxicoValidAt).toBeNull();
    expect(trailOf(after)).toMatchObject({
      source: "single",
      decided: "undecided",
      reason: "none_fit",
      receipt: { time: "18:58" },
      candidates: [expect.objectContaining({ clave: MORNING.clave, fate: "dropped", why: "window" })],
    });
    /* the CEP is kept as a candidate: a later clave closes it with no call */
    expect(await recordsFor(db(), business.id, [MORNING.clave])).toHaveLength(1);
    const status = await (await app()).request(`/direct-payments/${row.id}/status`, {}, testEnv);
    const { data } = await status.json();
    expect(data).toMatchObject({ status: "validating", error: "CEP_UNDECIDED", disputedFields: ["trackingKey"], nextValidationAt: null });
  });

  it("(f) a single valid on a row with neither time nor tail confirms as today", async () => {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedTypedRow(link, business);
    mockApiCep(validAnswer(MINE));
    mockConfirmation();
    await sweepDirectPayments(testEnv, NOW());
    const after = await rowById(row.id);
    expect(after).toMatchObject({ status: "confirmed", trackingKey: MINE.clave, matchDistanceS: null });
    expect(trailOf(after)).toMatchObject({ source: "single", decided: "chosen", by: "none" });
  });

  it("(g) SC-003: after a several answer that did not decide, no sweep ever calls again — past every slot", async () => {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedSettledRow(link, business, { transferTime: null, senderTail: null });
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(bundleOf([MINE, THEIRS, transfer("260928071199000016I", "2026-09-26", "09:00:00")]));
    await sweepDirectPayments(testEnv, NOW());
    expect(await rowById(row.id)).toMatchObject({ lastError: "CEP_UNDECIDED", nextValidationAt: null });

    /* no interceptor: a provider call would fail the test */
    const report = await sweepDirectPayments(testEnv, new Date(Date.now() + 13 * 3600 * 1000));
    expect(report.claimed).toBe(0);
    expect(await calls()).toBe(1);
    expect(await rowById(row.id)).toMatchObject({ status: "validating", lastError: "CEP_UNDECIDED" });
  });

  it("(h) the same ZIP on the receipt door's first attempt is decided by the reading's tail — never no_signal", async () => {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedReceiptRow(link, business);
    mockApiCep(severalAnswer(BUNDLE_URL), (body) => expect(String(body.imageUrl)).toContain("receipt-"));
    mockStorage(bundleOf([MINE, THEIRS]));
    mockConfirmation();

    await sweepDirectPayments(readerEnv(AZTECA_SECONDS_TAIL_READING), NOW());
    const after = await rowById(row.id);
    expect(after).toMatchObject({ status: "confirmed", trackingKey: MINE.clave, matchDistanceS: 22 });
    expect(trailOf(after)).toMatchObject({ by: "tail", receipt: { time: "07:10:58", tail: "8301" } });
    expect(await calls()).toBe(1);
  });

  it("(i) D18: two payments of one bundle decided on the same stale `used` — the second re-matches to its own, and with none left it is all_used, never TRANSFER_ALREADY_USED", async () => {
    const { business, link } = await seedAztecaBusiness();
    const X = transfer("260928071199000021I", "2026-09-26", "11:43:20");
    const Y = transfer("260928071199000022I", "2026-09-26", "11:44:30");
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(bundleOf([X, Y]));
    /* the first payment reads the bundle and takes X */
    const first = await seedSettledRow(link, business, { transferTime: "11:43:00", senderTail: null });
    mockConfirmation();
    await sweepDirectPayments(testEnv, NOW());
    expect(await rowById(first.id)).toMatchObject({ trackingKey: X.clave, status: "confirmed" });

    /* the second had read `used` before X was written: both nearest to X */
    const other = await seedLink(business, "tokazteca0000009", "otro@wifiplus");
    const second = await seedSettledRow(other, business, { transferTime: "11:43:10", senderTail: null });
    const candidates = await recordsFor(db(), business.id, [X.clave, Y.clave]);
    const receipt = { time: "11:43:10", day: "2026-09-26", tail: null, amountCents: 300, accounts: [{ bank: "BBVA MEXICO", clabe: BUSINESS_CLABE }] };
    const chosen = await chooseAndClaim(db(), second.id, receipt, candidates, new Set());
    expect(chosen).toMatchObject({ decided: "chosen", chosen: { clave: Y.clave } });
    expect(await rowById(second.id)).toMatchObject({ trackingKey: Y.clave });

    /* a third, with nothing left: undecided, all used */
    const third = await seedSettledRow(await seedLink(business, "tokazteca0000010", "tercero@wifiplus"), business, {
      transferTime: "11:43:05",
    });
    const none = await chooseAndClaim(db(), third.id, receipt, candidates, new Set());
    expect(none).toMatchObject({ decided: "undecided", reason: "all_used" });
    expect(await rowById(third.id)).toMatchObject({ trackingKey: null, status: "validating" });
  });
});

describe("cep-bundle-match US1: the shared-reference stop, narrowed (D12, FR-015)", () => {
  async function twin(business: { id: string }) {
    /* another link's payment with the same reference, day, bank, amount and account */
    const other = await seedLink(business, "tokotherlink0001", "otro@wifiplus");
    await seedTypedRow(other, business, { status: "confirmed", nextValidationAt: null });
  }

  it("(a) with a time on the receipt, the second payment reaches the provider — at the lifecycle's stop", async () => {
    const { business, link } = await seedAztecaBusiness();
    await twin(business);
    const row = await seedSettledRow(link, business, { transferTime: "07:10:58", senderTail: null });
    mockApiCep(noneAnswer());
    await sweepDirectPayments(testEnv, NOW());
    expect(await calls()).toBe(1);
    expect((await rowById(row.id)).lastError).toBe("TRANSFER_NOT_FOUND");
  });

  it("(a) …at the engine's receipt door", async () => {
    const { business, link } = await seedAztecaBusiness();
    await twin(business);
    const row = await seedReceiptRow(link, business);
    mockApiCep(noneAnswer());
    await sweepDirectPayments(readerEnv(AZTECA_SECONDS_TAIL_READING), NOW());
    expect(await calls()).toBe(1);
    expect((await rowById(row.id)).lastError).not.toBe("REFERENCE_SHARED");
  });

  it("(a) …and at /read: no `shared` ask", async () => {
    const { business, link } = await seedAztecaBusiness();
    await twin(business);
    const proofId = `${link.id}/read-1`;
    await testEnv.PROOFS.put(proofId, PNG(), { httpMetadata: { contentType: "image/png" } });
    const res = await (await app()).request(
      `/direct-payments/links/${link.token}/read`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proofId }) },
      readerEnv(AZTECA_SECONDS_TAIL_READING),
    );
    const { data } = await res.json();
    expect(data.ask).toBeNull();
  });

  it("(b) with neither time nor tail, each of the three still asks for the clave with no call", async () => {
    const { business, link } = await seedAztecaBusiness();
    await twin(business);
    const settled = await seedSettledRow(link, business, { transferTime: null, senderTail: null });
    await sweepDirectPayments(testEnv, NOW());
    expect(await rowById(settled.id)).toMatchObject({ lastError: "REFERENCE_SHARED" });

    const noSignal: StubbedReading = { ...AZTECA_SECONDS_TAIL_READING, hora: null, cuentaOrigen: null };
    const other = await seedLink(business, "tokazteca0000003", "tres@wifiplus");
    const receipt = await seedReceiptRow(other, business);
    await sweepDirectPayments(readerEnv(noSignal), NOW());
    expect(await rowById(receipt.id)).toMatchObject({ lastError: "REFERENCE_SHARED" });

    const proofId = `${link.id}/read-2`;
    await testEnv.PROOFS.put(proofId, PNG(), { httpMetadata: { contentType: "image/png" } });
    const res = await (await app()).request(
      `/direct-payments/links/${link.token}/read`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proofId }) },
      readerEnv(noSignal),
    );
    expect((await res.json()).data.ask).toMatchObject({ reason: "no_key", shared: true });
    expect(await calls()).toBe(0);
  });
});

describe("cep-bundle-match US1: a validated-before flag our own search set (D13, FR-016)", () => {
  it("(c) the true owner of a clave the filter refused confirms when they find it by clave — not TRANSFER_ALREADY_USED", async () => {
    const { business, link } = await seedAztecaBusiness();
    /* Janely's search by reference found the morning transfer and refused it */
    const janely = await seedReceiptRow(link, business);
    mockApiCep(validAnswer(MORNING));
    await sweepDirectPayments(readerEnv(AZTECA_1858_READING), NOW());
    expect((await rowById(janely.id)).lastError).toBe("CEP_UNDECIDED");

    /* its owner uploads the morning receipt, clave printed: the provider
       says it was validated before — by our own search */
    const owner = await seedLink(business, "tokazteca0000004", "dueno@wifiplus");
    const row = await seedReceiptRow(owner, business);
    const withClave: StubbedReading = { ...AZTECA_1858_READING, claveDeRastreo: MORNING.clave, fecha: "2026-09-25", hora: "07:19" };
    mockApiCep(validAnswer(MORNING, { previouslyValidated: true, validationId: "prov-valid-2" }));
    mockConfirmation("dueno@wifiplus");
    await sweepDirectPayments(readerEnv(withClave), NOW());
    expect(await rowById(row.id)).toMatchObject({ status: "confirmed", trackingKey: MORNING.clave });
  });

  it("(c) …and when the refused transfer came in a bundle, the business's record is the trace", async () => {
    const { business, link } = await seedAztecaBusiness();
    const payer = await seedSettledRow(link, business, { transferTime: "07:10:58", senderTail: "8301" });
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(bundleOf([MINE, THEIRS]));
    mockConfirmation();
    await sweepDirectPayments(testEnv, NOW());
    expect((await rowById(payer.id)).trackingKey).toBe(MINE.clave);

    /* THEIRS' owner reads their clave off the receipt; the provider flags it */
    const owner = await seedLink(business, "tokazteca0000005", "dueno@wifiplus");
    const row = await seedReceiptRow(owner, business);
    const theirs: StubbedReading = { ...AZTECA_SECONDS_TAIL_READING, claveDeRastreo: THEIRS.clave, hora: "11:40:30", cuentaOrigen: "4417" };
    mockApiCep(validAnswer(THEIRS, { previouslyValidated: true, validationId: "prov-valid-3" }));
    mockConfirmation("dueno@wifiplus", { again: true });
    await sweepDirectPayments(readerEnv(theirs), NOW());
    expect(await rowById(row.id)).toMatchObject({ status: "confirmed", trackingKey: THEIRS.clave });
  });

  it("a flag no search of ours explains still refuses", async () => {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedTypedRow(link, business);
    mockApiCep(validAnswer(MINE, { previouslyValidated: true }));
    await sweepDirectPayments(testEnv, NOW());
    expect(await rowById(row.id)).toMatchObject({ status: "invalid", lastError: "TRANSFER_ALREADY_USED" });
  });
});

describe("cep-bundle-match US1: the bundle downloads on the next slot, never with a call (D16)", () => {
  it("a failed download is CEP_BUNDLE_PENDING; the next slot reads it with no provider call and decides", async () => {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedSettledRow(link, business, { transferTime: "07:10:58", senderTail: "8301" });
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage("unavailable", 503);
    await sweepDirectPayments(testEnv, NOW());
    const pending = await rowById(row.id);
    expect(pending).toMatchObject({ status: "validating", lastError: "CEP_BUNDLE_PENDING" });
    expect(pending.nextValidationAt).not.toBeNull();

    mockStorage(bundleOf([MINE, THEIRS]));
    mockConfirmation();
    await sweepDirectPayments(testEnv, new Date(pending.nextValidationAt!.getTime() + 1000));
    expect(await rowById(row.id)).toMatchObject({ status: "confirmed", trackingKey: MINE.clave });
    expect(await calls()).toBe(1);
    const [bundle] = await db().select().from(cepBundles);
    expect(bundle).toMatchObject({ status: "read", downloadAttempts: 2, url: null });
  });

  it("the third failed download is unreadable: undecided, the clave asked", async () => {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedSettledRow(link, business, { transferTime: "07:10:58", senderTail: "8301" });
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage("unavailable", 503);
    await sweepDirectPayments(testEnv, NOW());
    for (let i = 0; i < 2; i++) {
      const due = await rowById(row.id);
      mockStorage("unavailable", 500);
      await sweepDirectPayments(testEnv, new Date(due.nextValidationAt!.getTime() + 1000));
    }
    const after = await rowById(row.id);
    expect(after).toMatchObject({ lastError: "CEP_UNDECIDED", nextValidationAt: null });
    expect(trailOf(after)).toMatchObject({ reason: "unreadable" });
    expect(await calls()).toBe(1);
  });
});

/* keep the extraction rows honest: the receipt door wrote one per call */
describe("cep-bundle-match US1: the reading record of a several answer", () => {
  it("records the time and tail it read, and the paid call it bought", async () => {
    const { business, link } = await seedAztecaBusiness();
    await seedReceiptRow(link, business);
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(bundleOf([MINE, THEIRS]));
    mockConfirmation();
    await sweepDirectPayments(readerEnv(AZTECA_SECONDS_TAIL_READING), NOW());
    const [reading] = await db().select().from(extractions);
    expect(reading).toMatchObject({ transferTime: "07:10:58", senderTail: "8301" });
    expect(reading.validationId).not.toBeNull();
  });
});

describe("cep-bundle-match US2: the same payer twice on one day is told apart by time (D6)", () => {
  /* One account, two transfers of the same amount to the same reference:
     only the receipt's time can say which one it shows (research R7, F1) */
  const EARLY = transfer("260926114299000031I", "2026-09-26", "11:42:13");
  const LATE = transfer("260926114399000032I", "2026-09-26", "11:43:36");

  async function decide(side: { transferTime: string | null; senderTail: string | null; transferDate?: string }, bundle: SyntheticTransfer[], confirms: boolean) {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedSettledRow(link, business, side);
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(bundleOf(bundle));
    if (confirms) mockConfirmation();
    await sweepDirectPayments(testEnv, NOW());
    return rowById(row.id);
  }

  const expectUndecided = (row: Awaited<ReturnType<typeof rowById>>, reason: string) => {
    expect(row).toMatchObject({
      status: "validating",
      lastError: "CEP_UNDECIDED",
      disputedFields: JSON.stringify(["trackingKey"]),
      nextValidationAt: null,
      trackingKey: null,
    });
    expect(trailOf(row)).toMatchObject({ decided: "undecided", reason });
  };

  it("a receipt at 11:43:20 is the 11:43:36 credit; the 11:42:13 one is outside the window", async () => {
    const after = await decide({ transferTime: "11:43:20", senderTail: "8301" }, [EARLY, LATE], true);
    expect(after).toMatchObject({ status: "confirmed", trackingKey: LATE.clave, matchDistanceS: 16 });
    const trail = trailOf(after);
    expect(trail).toMatchObject({ decided: "chosen", by: "time" });
    expect(trail.candidates).toEqual([
      expect.objectContaining({ clave: EARLY.clave, fate: "dropped", why: "window", distanceS: -67 }),
      expect.objectContaining({ clave: LATE.clave, fate: "chosen", distanceS: 16 }),
    ]);
  });

  it("a receipt at 11:42:05 is the 11:42:13 credit, 8 s after it; the other was farther", async () => {
    const after = await decide({ transferTime: "11:42:05", senderTail: "8301" }, [EARLY, LATE], true);
    expect(after).toMatchObject({ status: "confirmed", trackingKey: EARLY.clave, matchDistanceS: 8 });
    const trail = trailOf(after);
    expect(trail).toMatchObject({ decided: "chosen", by: "time" });
    expect(trail.candidates).toEqual([
      expect.objectContaining({ clave: EARLY.clave, fate: "chosen" }),
      expect.objectContaining({ clave: LATE.clave, fate: "dropped", why: "farther", distanceS: 91 }),
    ]);
  });

  it("two credits 20 s apart are too close to call: undecided, the clave asked", async () => {
    const after = await decide(
      { transferTime: "11:43:20", senderTail: "8301" },
      [transfer("260926114399000033I", "2026-09-26", "11:43:25"), transfer("260926114399000034I", "2026-09-26", "11:43:45")],
      false,
    );
    expectUndecided(after, "too_close");
    expect(trailOf(after).candidates.map((c) => [c.fate, c.why])).toEqual([
      ["kept", "too_close"],
      ["kept", "too_close"],
    ]);
  });

  it("no time on the receipt, one account: nothing tells them apart — no_signal", async () => {
    expectUndecided(await decide({ transferTime: null, senderTail: "8301" }, [EARLY, LATE], false), "no_signal");
  });

  it("a receipt printed HH:MM with two credits inside that minute: too_close", async () => {
    const after = await decide(
      { transferTime: "11:43", senderTail: "8301" },
      [transfer("260926114399000035I", "2026-09-26", "11:43:05"), transfer("260926114399000036I", "2026-09-26", "11:43:50")],
      false,
    );
    expectUndecided(after, "too_close");
    /* both inside the printed minute: 0 s from it, as near as each other */
    expect(trailOf(after).candidates.map((c) => c.distanceS)).toEqual([0, 0]);
  });

  it("a receipt at 23:59:50 and a credit at 00:00:20 the next day: chosen across midnight", async () => {
    const midnight = transfer("260926235999000037I", "2026-09-27", "00:00:20", SENDER_8301, { operationDay: "2026-09-26" });
    const morning = transfer("260926071199000038I", "2026-09-26", "07:11:20", SENDER_8301, { operationDay: "2026-09-26" });
    const after = await decide({ transferTime: "23:59:50", senderTail: "8301", transferDate: "2026-09-26" }, [morning, midnight], true);
    expect(after).toMatchObject({ status: "confirmed", trackingKey: midnight.clave, matchDistanceS: 30 });
    expect(trailOf(after)).toMatchObject({ by: "time" });
  });
});

describe("cep-bundle-match US3: an undecided payment asks, waits without expiring, and a typed clave closes it (D10, D11)", () => {
  /* The payer's correction from the page (contracts/payment-page.md): the
     clave form with the other fields filled, sent with `supersedes` — the
     pay route reads the debt first, as for any submission */
  function mockSubmission(usuario = "cliente@wifiplus") {
    const wh = () => fetchMock.get(WISPHUB);
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
      .reply(...json({ count: 1, results: [wisphubCustomer("Suspendido", usuario)] }));
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
      .reply(...json({ next: null, count: 1, results: [{ id_factura: 42, cliente: { usuario }, total: 1.5 }] }));
  }
  const pay = async (token: string, body: unknown) =>
    (await app()).request(
      `/direct-payments/links/${token}/pay`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      testEnv,
    );
  const status = async (id: string) => (await (await (await app()).request(`/direct-payments/${id}/status`, {}, testEnv)).json()).data;

  /* An undecided row as the lifecycle leaves it: a settled receipt with
     neither time nor tail, and a bundle of MINE and THEIRS */
  async function undecided() {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedSettledRow(link, business, { transferTime: null, senderTail: null });
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(bundleOf([MINE, THEIRS]));
    await sweepDirectPayments(testEnv, NOW());
    const after = await rowById(row.id);
    expect(after).toMatchObject({ status: "validating", lastError: "CEP_UNDECIDED" });
    expect(trailOf(after)).toMatchObject({ reason: "no_signal" });
    return { business, link, row: after };
  }
  const correction = (supersedes: string, trackingKey: string) => ({
    transfer: { trackingKey, referenceNumber: REFERENCE, senderBank: "AZTECA", date: "2026-09-26", amountCents: 300 },
    supersedes,
  });

  it("every transfer found already paid another payment: the status says CEP_ALL_USED, the clave is asked", async () => {
    const { business, link } = await seedAztecaBusiness();
    /* both claves already confirmed two other payments of the business */
    for (const [i, t] of [MINE, THEIRS].entries()) {
      await seedRow(await seedLink(business, `tokheld000000${i}`, `pagado${i}@wifiplus`), business, {
        status: "confirmed",
        trackingKey: t.clave,
        nextValidationAt: null,
      });
    }
    const row = await seedSettledRow(link, business, { transferTime: "07:10:58", senderTail: "8301" });
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(bundleOf([MINE, THEIRS]));
    await sweepDirectPayments(testEnv, NOW());

    const after = await rowById(row.id);
    expect(after).toMatchObject({ status: "validating", lastError: "CEP_UNDECIDED", nextValidationAt: null });
    expect(trailOf(after)).toMatchObject({ reason: "all_used" });
    expect(await status(row.id)).toMatchObject({
      status: "validating",
      error: "CEP_ALL_USED",
      disputedFields: ["trackingKey"],
      nextValidationAt: null,
    });
  });

  it("three CEPs with no time and no tail: no_signal, and a sweep at +13 h leaves it validating with no new call", async () => {
    const { business, link } = await seedAztecaBusiness();
    const row = await seedSettledRow(link, business, { transferTime: null, senderTail: null });
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(bundleOf([MINE, THEIRS, transfer("260928090099000017I", "2026-09-26", "09:00:00")]));
    await sweepDirectPayments(testEnv, NOW());
    expect(trailOf(await rowById(row.id))).toMatchObject({ decided: "undecided", reason: "no_signal" });

    await sweepDirectPayments(testEnv, new Date(Date.now() + 13 * 3600 * 1000));
    expect(await rowById(row.id)).toMatchObject({ status: "validating", lastError: "CEP_UNDECIDED", nextValidationAt: null });
    expect(await calls()).toBe(1);
    expect(await status(row.id)).toMatchObject({ error: "CEP_UNDECIDED" });
  });

  it("D10: a row something re-armed goes back to wait — no call, no expiry", async () => {
    const { row } = await undecided();
    await db().update(payments).set({ nextValidationAt: new Date(Date.now() - 1000) }).where(eq(payments.id, row.id));
    /* no interceptor: a provider call would fail the test */
    await sweepDirectPayments(testEnv, new Date(Date.now() + 24 * 3600 * 1000));
    expect(await rowById(row.id)).toMatchObject({ status: "validating", lastError: "CEP_UNDECIDED", nextValidationAt: null });
    expect(await calls()).toBe(1);
  });

  it("D11: the payer types the clave with an O for a 0 — confirmed from the record with no provider call, by clave", async () => {
    const { row } = await undecided();
    const typed = MINE.clave.replace("0", "o").toLowerCase();
    expect(typed).not.toBe(MINE.clave);
    mockSubmission();
    mockConfirmation();
    const res = await pay("tokazteca0000001", correction(row.id, typed));
    expect(res.status).toBe(201);
    const { data } = await res.json();

    const fresh = await rowById(data.directPaymentId);
    expect(fresh).toMatchObject({ status: "confirmed", supersedesId: row.id, trackingKey: MINE.clave, receivedCents: 300 });
    expect(trailOf(fresh)).toMatchObject({ decided: "chosen", by: "clave" });
    expect(trailOf(fresh).candidates).toEqual([
      expect.objectContaining({ clave: MINE.clave, fate: "chosen" }),
      expect.objectContaining({ clave: THEIRS.clave, fate: "kept" }),
    ]);
    expect(await rowById(row.id)).toMatchObject({ status: "superseded" });
    /* the bundle's one paid call is the only one */
    expect(await calls()).toBe(1);
    expect(await status(fresh.id)).toMatchObject({ status: "confirmed", error: null });
  });

  it("D11: a clave that fits no candidate takes one ordinary clave call", async () => {
    const { row } = await undecided();
    mockSubmission();
    mockApiCep(noneAnswer(), (body) => expect((body.sender as Record<string, unknown>).trackingKey).toBe("ZZZ4417ZZZ9999"));
    const res = await pay("tokazteca0000001", correction(row.id, "ZZZ4417ZZZ9999"));
    const { data } = await res.json();
    expect(await rowById(data.directPaymentId)).toMatchObject({ trackingKey: "ZZZ4417ZZZ9999", lastError: "TRANSFER_NOT_FOUND" });
    expect(await calls()).toBe(2);
  });

  it("D11: a clave that fits two candidates is no answer — the ordinary call", async () => {
    const { row } = await undecided();
    /* one character short of both MINE and THEIRS */
    const typed = "26092807119900001I";
    mockSubmission();
    mockApiCep(noneAnswer(), (body) => expect((body.sender as Record<string, unknown>).trackingKey).toBe(typed));
    const res = await pay("tokazteca0000001", correction(row.id, typed));
    const { data } = await res.json();
    expect(await rowById(data.directPaymentId)).toMatchObject({ trackingKey: typed, lastError: "TRANSFER_NOT_FOUND" });
    expect(await calls()).toBe(2);
  });
});

describe("cep-bundle-match US4: other customers' CEPs in the bundle confirm their own pending payments (D14)", () => {
  /* Customer B paid too — their transfer is THEIRS — and typed its clave,
     which Banxico had not published when their first attempt ran */
  async function pendingB(business: { id: string }) {
    const link = await seedLink(business, "tokazteca0000011", "otro@wifiplus");
    return seedRow(link, business, {
      proofMode: "transfer",
      trackingKey: THEIRS.clave,
      senderBank: "AZTECA",
      transferDate: "2026-09-26",
      acceptedFrom: "human",
      validationAttempts: 1,
      lastError: "TRANSFER_NOT_FOUND",
      nextValidationAt: new Date(Date.now() + 30 * 60_000),
    });
  }

  it("A's bundle makes B due now, and the next sweep confirms B from the record with no provider call", async () => {
    const { business, link } = await seedAztecaBusiness();
    const b = await pendingB(business);
    const a = await seedSettledRow(link, business, { transferTime: "07:10:58", senderTail: "8301" });
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(bundleOf([MINE, THEIRS]));
    mockConfirmation();

    const now = NOW();
    await sweepDirectPayments(testEnv, now);
    expect(await rowById(a.id)).toMatchObject({ status: "confirmed", trackingKey: MINE.clave });
    /* nudged: due at A's attempt, not at its own slot half an hour away */
    expect((await rowById(b.id)).nextValidationAt!.getTime()).toBe(now.getTime());

    mockConfirmation("otro@wifiplus", { again: true });
    await sweepDirectPayments(testEnv, NOW());
    const after = await rowById(b.id);
    expect(after).toMatchObject({ status: "confirmed", trackingKey: THEIRS.clave, receivedCents: 300, actionOutcome: "done" });
    expect(after.banxicoValidAt).not.toBeNull();
    expect(trailOf(after)).toMatchObject({ decided: "chosen", by: "clave", source: "several" });
    /* A's several answer is the only paid call of the two payments */
    expect(await calls()).toBe(1);
  });

  it("a clave in no record calls the provider as today", async () => {
    const { business } = await seedAztecaBusiness();
    const link = await seedLink(business, "tokazteca0000012", "otro@wifiplus");
    const row = await seedRow(link, business, {
      proofMode: "transfer",
      trackingKey: "ZZZ4417ZZZ9999",
      senderBank: "AZTECA",
      transferDate: "2026-09-26",
      acceptedFrom: "human",
    });
    mockApiCep(noneAnswer(), (body) => expect((body.sender as Record<string, unknown>).trackingKey).toBe("ZZZ4417ZZZ9999"));
    await sweepDirectPayments(testEnv, NOW());
    expect(await rowById(row.id)).toMatchObject({ status: "validating", lastError: "TRANSFER_NOT_FOUND", matchTrail: null });
    expect(await calls()).toBe(1);
  });

  it("a record another business holds is never pulled (constitution V)", async () => {
    /* business one reads the bundle and keeps THEIRS … */
    const { business: one, link: oneLink } = await seedAztecaBusiness();
    await seedSettledRow(oneLink, one, { transferTime: "07:10:58", senderTail: "8301" });
    mockApiCep(severalAnswer(BUNDLE_URL));
    mockStorage(bundleOf([MINE, THEIRS]));
    mockConfirmation();
    await sweepDirectPayments(testEnv, NOW());
    /* … business two's payment with the same clave still asks Banxico */
    const { business: two } = await seedAztecaBusiness("tokazteca0000013");
    const row = await pendingB(two);
    await db().update(payments).set({ nextValidationAt: new Date(Date.now() - 1000) }).where(eq(payments.id, row.id));
    mockApiCep(noneAnswer());
    await sweepDirectPayments(testEnv, NOW());
    expect(await rowById(row.id)).toMatchObject({ status: "validating", lastError: "TRANSFER_NOT_FOUND" });
    expect(await calls()).toBe(2);
  });
});

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { benchReadings, benchReceipts, creditEntries, extractions, payments, validations } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { benchLimits, BENCH_TIMEOUT_MS, p90, tally } from "../src/platform/bench";
import {
  benchListResponse,
  benchReading as benchReadingSchema,
  benchReceiptDetail,
  benchTallyResponse,
} from "../src/routes/reader/schema";
import { app, fakeProofs, seedBusiness, seedMember, sessionCookieHeader } from "./helpers";
import { aiReturning, NOT_A_FILE, PDF, PNG, RECEIPT_TEXT, type StubbedReading } from "./consta/helpers";

/* receipt-reader-tuning US3 — the creator compares the models on a test
   bench (D16, D17). Every listed model reads an uploaded receipt in
   parallel with no fallback; the operator marks each field; the tally
   decides. fetchMock refuses every origin: the bench calls no provider,
   and nothing is written outside its own tables (FR-019). */

const DEFAULT = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const OTHER = "@cf/test/other";
const OPERATOR = "demo@devolada.app";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
  benchLimits.timeoutMs = BENCH_TIMEOUT_MS;
});

type Env = typeof env & Bindings;
const db = () => drizzle(env.DB);

const READING: StubbedReading = {
  esComprobante: true,
  legibilidad: "completa",
  claveDeRastreo: "QVSBGOD7L",
  referenciaNumerica: "250926",
  bancoEmisor: "NUBANK",
  bancoReceptor: "BBVA MEXICO",
  monto: 514,
  fecha: "2026-09-25",
  destino: { tipo: "clabe", digitos: "8195" },
};

function setup(ai: Record<string, unknown> | null, over: Partial<Bindings> = {}) {
  const calls: unknown[] = [];
  const PROOFS = fakeProofs();
  const bindings = {
    ...env,
    PROOFS,
    PLATFORM_OPERATOR_EMAILS: OPERATOR,
    ...(ai ? { AI: aiReturning(ai as never, calls, { pdfText: RECEIPT_TEXT }) } : {}),
    ...over,
  } as Env;
  const request = async (path: string, init: RequestInit = {}, cookieFor = OPERATOR) =>
    (await app()).request(
      path,
      { ...init, headers: { ...(init.headers ?? {}), Cookie: await sessionCookieHeader(cookieFor) } },
      bindings,
    );
  const upload = (bytes: Uint8Array, type = "image/png") => {
    const form = new FormData();
    form.append("file", new File([bytes], "receipt", { type }));
    return request("/platform/reader/bench", { method: "POST", body: form });
  };
  const mark = (readingId: string, marks: Record<string, string>) =>
    request(`/platform/reader/bench/readings/${readingId}/marks`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marks }),
    });
  const modelCalls = () => calls.filter((c) => (c as { model?: string }).model) as { model: string; input: unknown }[];
  return { bindings, PROOFS, calls, modelCalls, request, upload, mark };
}

const detailOf = async (res: Response) => benchReceiptDetail.parse((await res.json()).data);
const byModel = (d: { readings: { model: string }[] }, model: string) => d.readings.find((r) => r.model === model)!;

describe("receipt-reader-tuning US3: upload and read (D16)", () => {
  it("a PNG is read by both listed models in parallel; each reading has its time; the file sits under bench/", async () => {
    await seedBusiness();
    const t = setup({ [DEFAULT]: READING, [OTHER]: { ...READING, claveDeRastreo: null } });
    const res = await t.upload(PNG());
    expect(res.status).toBe(201);
    const detail = await detailOf(res);
    expect(t.modelCalls().map((c) => c.model).sort()).toEqual([DEFAULT, OTHER].sort());
    expect(detail.readings).toHaveLength(2);
    expect(detail.readings.every((r) => r.status === "read" && r.readerMs >= 0 && r.questionVersion === "2")).toBe(true);
    expect(byModel(detail, DEFAULT).reading).toMatchObject({
      trackingKey: "QVSBGOD7L",
      referenceNumber: "250926",
      senderBank: "NUBANK",
      receivingBank: "BBVA MEXICO",
      amountCents: 51400,
      destination: { kind: "clabe", digits: "8195" },
      sameBank: false,
    });
    expect(byModel(detail, OTHER).reading!.trackingKey).toBeNull();
    expect(detail.missing).toEqual([]);
    expect(detail.fileAvailable).toBe(true);
    const [receipt] = await db().select().from(benchReceipts);
    expect(receipt.proofKey).toBe(`bench/${receipt.id}`);
    expect(await t.PROOFS.head(receipt.proofKey)).not.toBeNull();
  });

  it("a model that fails is a failed column with its answer; no other model's reading replaces it", async () => {
    await seedBusiness();
    const t = setup({ [DEFAULT]: READING, [OTHER]: "No puedo leer este comprobante." });
    const detail = await detailOf(await t.upload(PNG()));
    const failed = byModel(detail, OTHER);
    expect(failed).toMatchObject({ status: "failed", failureCode: "READER_UNREADABLE", reading: null });
    expect(failed.rawOutput).toBe("No puedo leer este comprobante.");
    expect(byModel(detail, DEFAULT).status).toBe("read");
    /* No fallback on the bench: exactly one call per model */
    expect(t.modelCalls()).toHaveLength(2);
  });

  it("a model that throws is READER_UNAVAILABLE; one past the bench limit is TIMEOUT", async () => {
    await seedBusiness();
    benchLimits.timeoutMs = 40;
    const t = setup({ [DEFAULT]: { throws: "binding refused" }, [OTHER]: { waitsMs: 200, then: READING } });
    const detail = await detailOf(await t.upload(PNG()));
    expect(byModel(detail, DEFAULT)).toMatchObject({ status: "failed", failureCode: "READER_UNAVAILABLE" });
    expect(byModel(detail, DEFAULT).rawOutput).toContain("binding refused");
    expect(byModel(detail, OTHER)).toMatchObject({ status: "failed", failureCode: "TIMEOUT" });
  });

  it("a PDF is converted once and read by both models", async () => {
    await seedBusiness();
    const t = setup({ [DEFAULT]: READING, [OTHER]: READING });
    const res = await t.upload(PDF(), "application/pdf");
    expect(res.status).toBe(201);
    expect(t.calls.filter((c) => "toMarkdown" in (c as object))).toHaveLength(1);
    expect(t.modelCalls()).toHaveLength(2);
    const detail = await detailOf(res);
    expect(detail.mediaType).toBe("application/pdf");
    expect(byModel(detail, DEFAULT).reading!.legibility).toBeNull();
  });

  it("isolation: after uploads, no extraction, payment, validation or credit row exists, and no fetch left", async () => {
    await seedBusiness();
    const t = setup({ [DEFAULT]: READING, [OTHER]: READING });
    await t.upload(PNG());
    await t.upload(PNG(80));
    expect(await db().select().from(extractions)).toHaveLength(0);
    expect(await db().select().from(payments)).toHaveLength(0);
    expect(await db().select().from(validations)).toHaveLength(0);
    const credit = await db().select().from(creditEntries);
    /* The seeded business's welcome bonus is the only credit row there is */
    expect(credit.every((e) => e.kind === "welcome_bonus")).toBe(true);
  });
});

describe("receipt-reader-tuning US3: upload refusals (D16)", () => {
  it("413 over 1 MB; 415 for a declared text/plain and for bytes that are neither image nor PDF; 400 without a file", async () => {
    await seedBusiness();
    const t = setup({ [DEFAULT]: READING, [OTHER]: READING });
    expect((await t.upload(PNG(1_000_001))).status).toBe(413);
    const text = await t.upload(PNG(), "text/plain");
    expect(text.status).toBe(415);
    expect((await text.json()).error.code).toBe("PROOF_UNSUPPORTED_TYPE");
    expect((await t.upload(NOT_A_FILE(), "image/png")).status).toBe(415);
    const empty = await t.request("/platform/reader/bench", { method: "POST", body: new FormData() });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.code).toBe("VALIDATION_ERROR");
    expect(await db().select().from(benchReceipts)).toHaveLength(0);
  });

  it("503 READER_UNAVAILABLE with no AI binding, and nothing is stored", async () => {
    await seedBusiness();
    const t = setup(null);
    const res = await t.upload(PNG());
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("READER_UNAVAILABLE");
    expect(await db().select().from(benchReceipts)).toHaveLength(0);
    expect((await t.PROOFS.list({ prefix: "bench/" })).objects).toHaveLength(0);
  });

  it("the same bytes twice are one receipt: 200 with duplicate, and nothing is read again", async () => {
    await seedBusiness();
    const t = setup({ [DEFAULT]: READING, [OTHER]: READING });
    await t.upload(PNG());
    const again = await t.upload(PNG());
    expect(again.status).toBe(200);
    expect((await detailOf(again)).duplicate).toBe(true);
    expect(t.modelCalls()).toHaveLength(2);
    expect(await db().select().from(benchReceipts)).toHaveLength(1);
  });
});

describe("receipt-reader-tuning US3: read again, the file, the list (D16)", () => {
  it("a third listed model is the only thing read again; with nothing missing, nothing reads", async () => {
    await seedBusiness();
    const t = setup({ [DEFAULT]: READING, [OTHER]: READING, "@cf/test/third": READING });
    const { id } = await detailOf(await t.upload(PNG()));
    const three = JSON.stringify([
      { id: DEFAULT, label: "Default" },
      { id: OTHER, label: "Other" },
      { id: "@cf/test/third", label: "Third" },
    ]);
    const wider = { ...t.bindings, EXTRACTION_MODELS: three } as Env;
    const cookie = { Cookie: await sessionCookieHeader(OPERATOR) };
    const before = benchReceiptDetail.parse(
      (await (await (await app()).request(`/platform/reader/bench/${id}`, { headers: cookie }, wider)).json()).data,
    );
    expect(before.missing).toEqual([{ model: "@cf/test/third", questionVersion: "2" }]);

    const res = await (await app()).request(`/platform/reader/bench/${id}/read`, { method: "POST", headers: cookie }, wider);
    expect(res.status).toBe(200);
    const after = await detailOf(res);
    expect(after.readings).toHaveLength(3);
    expect(after.missing).toEqual([]);
    expect(t.modelCalls().map((c) => c.model)).toContain("@cf/test/third");
    expect(t.modelCalls()).toHaveLength(3);

    await (await app()).request(`/platform/reader/bench/${id}/read`, { method: "POST", headers: cookie }, wider);
    expect(t.modelCalls()).toHaveLength(3);
  });

  it("the file comes back with its sniffed type and no-store; once removed it is FILE_EXPIRED and the readings stay", async () => {
    await seedBusiness();
    const t = setup({ [DEFAULT]: READING, [OTHER]: READING });
    const { id } = await detailOf(await t.upload(PNG()));
    const file = await t.request(`/platform/reader/bench/${id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("image/png");
    expect(file.headers.get("Cache-Control")).toBe("no-store");
    expect(new Uint8Array(await file.arrayBuffer()).slice(0, 4)).toEqual(PNG().slice(0, 4));

    await t.PROOFS.delete(`bench/${id}`);
    const gone = await t.request(`/platform/reader/bench/${id}/file`);
    expect(gone.status).toBe(404);
    expect((await gone.json()).error.code).toBe("FILE_EXPIRED");
    const detail = await detailOf(await t.request(`/platform/reader/bench/${id}`));
    expect(detail.fileAvailable).toBe(false);
    expect(detail.readings).toHaveLength(2);
    expect((await t.request("/platform/reader/bench/nope")).status).toBe(404);
  });

  it("the list is newest first with a working cursor and per-reading summaries", async () => {
    await seedBusiness();
    const t = setup({ [DEFAULT]: READING, [OTHER]: READING });
    for (let i = 0; i < 27; i++) await t.upload(PNG(64 + i));
    const first = benchListResponse.parse((await (await t.request("/platform/reader/bench")).json()).data);
    expect(first.items).toHaveLength(25);
    expect(first.nextCursor).not.toBeNull();
    expect(first.items[0].readings).toHaveLength(2);
    expect(first.items[0].createdAt).toBeGreaterThanOrEqual(first.items[24].createdAt);
    const second = benchListResponse.parse(
      (await (await t.request(`/platform/reader/bench?cursor=${first.nextCursor}`)).json()).data,
    );
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.items, ...second.items].map((i) => i.id));
    expect(ids.size).toBe(27);
  }, 60_000);
});

describe("receipt-reader-tuning US3: marks and the tally (D17)", () => {
  it("marks save and replace; `absent` is judged against the reading — the folio read as a clave is wrong", async () => {
    await seedBusiness();
    const t = setup({ [DEFAULT]: READING, [OTHER]: { ...READING, claveDeRastreo: null } });
    const detail = await detailOf(await t.upload(PNG()));
    const folio = byModel(detail, DEFAULT);
    const honest = byModel(detail, OTHER);

    const saved = await t.mark(folio.id, { trackingKey: "absent", referenceNumber: "right", senderBank: "wrong" });
    expect(saved.status).toBe(200);
    const reading = benchReadingSchema.parse((await saved.json()).data);
    expect(reading.judged).toEqual({ trackingKey: "wrong", referenceNumber: "right", senderBank: "wrong" });
    expect(reading.markedAt).not.toBeNull();

    const other = benchReadingSchema.parse((await (await t.mark(honest.id, { trackingKey: "absent", isReceipt: "right" })).json()).data);
    expect(other.judged).toEqual({ trackingKey: "right", isReceipt: "right" });

    /* Replace, not merge */
    const replaced = benchReadingSchema.parse((await (await t.mark(folio.id, { amount: "right" })).json()).data);
    expect(replaced.marks).toEqual({ amount: "right" });
  });

  it("`absent` on isReceipt or legibility is 400; any mark on a failed reading is 400; an unknown reading is 404", async () => {
    await seedBusiness();
    const t = setup({ [DEFAULT]: READING, [OTHER]: { throws: "down" } });
    const detail = await detailOf(await t.upload(PNG()));
    const read = byModel(detail, DEFAULT);
    expect((await t.mark(read.id, { isReceipt: "absent" })).status).toBe(400);
    expect((await t.mark(read.id, { legibility: "absent" })).status).toBe(400);
    expect((await t.mark(read.id, { notAField: "right" })).status).toBe(400);
    expect((await t.mark(byModel(detail, OTHER).id, { amount: "right" })).status).toBe(400);
    expect((await t.mark("missing-id", { amount: "right" })).status).toBe(404);
  });

  it("the tally per (model, version): readings, failures, judged, right, wrong by field, p90 by nearest rank", async () => {
    await seedBusiness();
    const t = setup({ [DEFAULT]: READING, [OTHER]: { throws: "down" } });
    const a = await detailOf(await t.upload(PNG()));
    await t.upload(PNG(90));
    await t.mark(byModel(a, DEFAULT).id, { trackingKey: "absent", amount: "right", date: "right" });

    const res = await t.request("/platform/reader/bench/tally");
    expect(res.status).toBe(200);
    const body = benchTallyResponse.parse((await res.json()).data);
    expect(body.asOf).toBeGreaterThan(0);
    const def = body.rows.find((r) => r.model === DEFAULT)!;
    expect(def).toMatchObject({ modelLabel: "Default", questionVersion: "2", readings: 2, failures: 0, judged: 3, right: 2 });
    expect(def.wrongByField.trackingKey).toBe(1);
    expect(def.p90Ms).not.toBeNull();
    const other = body.rows.find((r) => r.model === OTHER)!;
    expect(other).toMatchObject({ readings: 2, failures: 2, judged: 0, p90Ms: null });
  });

  it("p90 is the nearest rank, and the tally counts nothing it cannot judge", () => {
    expect(p90([])).toBeNull();
    expect(p90([5])).toBe(5);
    expect(p90([10, 1, 9, 2, 8, 3, 7, 4, 6, 5])).toBe(9);
    expect(p90(Array.from({ length: 11 }, (_, i) => i + 1))).toBe(10);
    const rows = tally(
      [{ model: "m", modelLabel: "M", questionVersion: "2", status: "failed", readerMs: 9, reading: null, marks: { amount: "right" }, createdAt: 1 }],
      7,
    );
    expect(rows).toEqual({
      asOf: 7,
      rows: [expect.objectContaining({ readings: 1, failures: 1, judged: 0, right: 0, p90Ms: null })],
    });
  });
});

describe("receipt-reader-tuning US3: the guard (FR-021)", () => {
  it("every bench route refuses a non-operator with NOT_PLATFORM_OPERATOR", async () => {
    const business = await seedBusiness();
    await seedMember(business, "socio@isp.test", "owner");
    const t = setup({ [DEFAULT]: READING, [OTHER]: READING });
    const form = new FormData();
    form.append("file", new File([PNG()], "r", { type: "image/png" }));
    const routes: [string, RequestInit][] = [
      ["/platform/reader/bench", { method: "POST", body: form }],
      ["/platform/reader/bench", {}],
      ["/platform/reader/bench/tally", {}],
      ["/platform/reader/bench/x", {}],
      ["/platform/reader/bench/x/file", {}],
      ["/platform/reader/bench/x/read", { method: "POST" }],
      [
        "/platform/reader/bench/readings/x/marks",
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marks: {} }) },
      ],
    ];
    for (const [path, init] of routes) {
      const res = await t.request(path, init, "socio@isp.test");
      expect(res.status, path).toBe(403);
      expect((await res.json()).error.code).toBe("NOT_PLATFORM_OPERATOR");
    }
    expect(await db().select().from(benchReadings)).toHaveLength(0);
  });
});

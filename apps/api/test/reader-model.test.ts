import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { extractions, paymentLinks, platformSettings, user } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { consta, ConstaError, type ConstaRequest } from "../src/consta";
import { readerModels, resetReaderModelsWarning } from "../src/consta/extraction/models";
import { readerStateResponse } from "../src/routes/reader/schema";
import { app, fakeProofs, seedBusiness, seedMember, sessionCookieHeader } from "./helpers";
import { aiReturning, PDF, PNG, RECEIPT_TEXT } from "./consta/helpers";

/* receipt-reader-tuning US1 — the operator chooses which model reads
   receipts (D7–D11, D15). The reader is stubbed at the binding per model
   id (D20): these tests prove routing, recording and the fallback, never
   accuracy. The list is the one vitest.config.ts pins: the default
   (Mistral) and `@cf/test/other`. READER_TIMEOUT_MS is pinned to 50. */

const DEFAULT = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const OTHER = "@cf/test/other";
const OPERATOR = "demo@devolada.app";
const APICEP_ORIGIN = "https://api.apicep.cloud";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

type Env = typeof env & Bindings;
const PROOFS = fakeProofs();
const base = (over: Partial<Bindings> = {}) =>
  ({ ...env, PROOFS, PLATFORM_OPERATOR_EMAILS: OPERATOR, ...over }) as Env;
const db = () => drizzle(env.DB);

const READING = {
  esComprobante: true,
  legibilidad: "completa",
  claveDeRastreo: "MBAN01002609250012345678",
  bancoEmisor: "BBVA MEXICO",
  bancoReceptor: "STP",
  monto: 514,
  fecha: "2026-09-25",
} as const;

const asOperator = async (path: string, init: RequestInit = {}, bindings: Env = base()) =>
  (await app()).request(
    path,
    { ...init, headers: { ...(init.headers ?? {}), Cookie: await sessionCookieHeader(OPERATOR) } },
    bindings,
  );
const choose = (modelId: string, bindings?: Env) =>
  asOperator(
    "/platform/reader/model",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId }) },
    bindings,
  );
const state = async (bindings?: Env) => {
  const res = await asOperator("/platform/reader", {}, bindings);
  expect(res.status).toBe(200);
  return readerStateResponse.parse((await res.json()).data);
};

/* The engine's reading door — what `/read` calls for the link's business */
const PROOF_KEY = "link-1/receipt";
async function extractAs(businessId: string, AI: Ai, bindings: Env = base()) {
  return consta({ ...bindings, AI }, db(), { businessId }).extract({ proofKey: PROOF_KEY });
}
async function extractFailure(businessId: string, AI: Ai) {
  try {
    await extractAs(businessId, AI);
  } catch (e) {
    if (e instanceof ConstaError) return e;
    throw e;
  }
  throw new Error("expected a failure");
}
const modelCalls = (calls: unknown[]) => calls.filter((c) => (c as { model?: string }).model) as { model: string; input: Record<string, unknown> }[];

describe("receipt-reader-tuning US1: the allowed list (D7)", () => {
  it("unset → the default alone; the default missing from the list is prepended; duplicate ids → first wins", () => {
    expect(readerModels({}).list).toEqual([{ id: DEFAULT, label: DEFAULT }]);
    expect(readerModels({ EXTRACTION_MODEL: "@cf/x/one" }).list.map((m) => m.id)).toEqual(["@cf/x/one"]);

    const listed = readerModels({
      EXTRACTION_MODEL: DEFAULT,
      EXTRACTION_MODELS: [
        { id: OTHER, label: "Other" },
        { id: OTHER, label: "Other again" },
      ],
    });
    expect(listed.list).toEqual([
      { id: DEFAULT, label: DEFAULT },
      { id: OTHER, label: "Other" },
    ]);
    expect(listed.defaultModel.id).toBe(DEFAULT);

    /* A JSON var arrives parsed on a deploy and as text from a test binding */
    expect(readerModels({ EXTRACTION_MODELS: JSON.stringify([{ id: OTHER, label: "O" }]) }).list.map((m) => m.id)).toEqual([
      DEFAULT,
      OTHER,
    ]);
  });

  it("invalid JSON or shape → the default alone, and one warning per isolate (constitution VIII)", () => {
    resetReaderModelsWarning();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readerModels({ EXTRACTION_MODELS: "{not json" }).list.map((m) => m.id)).toEqual([DEFAULT]);
    expect(readerModels({ EXTRACTION_MODELS: [{ id: 3 }] }).list.map((m) => m.id)).toEqual([DEFAULT]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("receipt-reader-tuning US1: the operator's choice (D8, FR-003, FR-005)", () => {
  it("default with no row; a choice appends a row with its author and applies; history is latest first", async () => {
    const business = await seedBusiness();
    const before = await state();
    expect(before).toMatchObject({
      defaultModel: DEFAULT,
      activeModel: DEFAULT,
      choice: "default",
      staleChoice: null,
      history: [],
      fallbacksLast7Days: 0,
      questionVersion: "2",
      readerAvailable: false,
    });
    expect(before.models).toEqual([
      { id: DEFAULT, label: "Default" },
      { id: OTHER, label: "Other" },
    ]);

    const res = await choose(OTHER);
    expect(res.status).toBe(201);
    const after = readerStateResponse.parse((await res.json()).data);
    expect(after).toMatchObject({ activeModel: OTHER, choice: "applies" });

    await choose(DEFAULT);
    const back = await state();
    /* Choosing the default writes a row too: the history shows the switch back */
    expect(back.choice).toBe("applies");
    expect(back.history.map((h) => h.value)).toEqual([DEFAULT, OTHER]);
    /* FR-002: who chose it, as a person reads it — not a row id */
    expect(back.history.map((h) => h.authorEmail)).toEqual([OPERATOR, OPERATOR]);

    const rows = await db().select().from(platformSettings).where(eq(platformSettings.key, "reader_model"));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.authorUserId)).size).toBe(1);
    const [operator] = await db().select().from(user).where(eq(user.email, OPERATOR));
    expect(rows.every((r) => r.authorUserId === operator.id)).toBe(true);
    expect(business.email).toBe(OPERATOR);
  });

  it("an id outside the list is INVALID_MODEL and writes nothing", async () => {
    await seedBusiness();
    const res = await choose("@cf/not/listed");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_MODEL");
    expect(await db().select().from(platformSettings)).toHaveLength(0);
  });

  it("a stored id that left the list is stale, and the default reads", async () => {
    await seedBusiness();
    await choose(OTHER);
    const shrunk = base({ EXTRACTION_MODELS: JSON.stringify([{ id: DEFAULT, label: "Default" }]) });
    expect(await state(shrunk)).toMatchObject({ choice: "stale", staleChoice: OTHER, activeModel: DEFAULT });
  });

  it("readerAvailable follows the AI binding", async () => {
    await seedBusiness();
    expect((await state(base({ AI: aiReturning(READING) }))).readerAvailable).toBe(true);
  });

  it("a non-operator gets NOT_PLATFORM_OPERATOR on both routes", async () => {
    const business = await seedBusiness();
    await seedMember(business, "socio@isp.test", "admin");
    const cookie = await sessionCookieHeader("socio@isp.test");
    const get = await (await app()).request("/platform/reader", { headers: { Cookie: cookie } }, base());
    expect(get.status).toBe(403);
    expect((await get.json()).error.code).toBe("NOT_PLATFORM_OPERATOR");
    const post = await (await app()).request(
      "/platform/reader/model",
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ modelId: OTHER }) },
      base(),
    );
    expect(post.status).toBe(403);
    expect(await db().select().from(platformSettings)).toHaveLength(0);
  });
});

describe("receipt-reader-tuning US1: the next reading uses the choice (D9, SC-003)", () => {
  it("/read after a choice calls the chosen model, with the list entry's input merged in", async () => {
    const business = await seedBusiness({ speiClabe: "646180157000000004", speiBank: "STP", speiBeneficiaryName: "WifiPlus" });
    const [link] = await db()
      .insert(paymentLinks)
      .values({ businessId: business.id, token: "tok2345abcdefgh2", wisphubCustomerId: "6", customerUsuario: "greyes@wifiplus" })
      .returning();
    await PROOFS.put(`${link.id}/proof-1`, PNG(), { httpMetadata: { contentType: "image/png" } });
    const withInput = base({
      EXTRACTION_MODELS: JSON.stringify([
        { id: DEFAULT, label: "Default" },
        { id: OTHER, label: "Other", input: { chat_template_kwargs: { enable_thinking: false } } },
      ]),
    });
    await choose(OTHER, withInput);

    const calls: unknown[] = [];
    const res = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/read",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proofId: `${link.id}/proof-1` }) },
      { ...withInput, AI: aiReturning({ [OTHER]: READING, [DEFAULT]: { throws: "must not be called" } }, calls) },
    );
    expect(res.status).toBe(200);
    const [call] = modelCalls(calls);
    expect(call.model).toBe(OTHER);
    expect(call.input.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(call.input.max_tokens).toBe(400);

    const [row] = await db().select().from(extractions);
    expect(row).toMatchObject({ model: OTHER, questionVersion: "2", fallbackFrom: null });
    expect(row.readerMs).toBeGreaterThanOrEqual(0);
  });

  it("with no choice, exactly one call to the default and the row names it", async () => {
    const { id } = await seedBusiness();
    await PROOFS.put(PROOF_KEY, PNG(), { httpMetadata: { contentType: "image/png" } });
    const calls: unknown[] = [];
    await extractAs(id, aiReturning(READING, calls));
    expect(modelCalls(calls).map((c) => c.model)).toEqual([DEFAULT]);
    const [row] = await db().select().from(extractions);
    expect(row).toMatchObject({ model: DEFAULT, questionVersion: "2", fallbackFrom: null });
  });
});

describe("receipt-reader-tuning US1: a failing chosen model falls back to the default once (D11)", () => {
  const failures = {
    throws: { throws: "model unavailable" },
    "waits past the limit": { waitsMs: 300, then: READING },
    "answers with no JSON": "I cannot read this receipt.",
  } as const;

  for (const [name, behaviour] of Object.entries(failures)) {
    it(`picture: the chosen model ${name} → the default reads once, the answer is normal, the row says so`, async () => {
      const { id } = await seedBusiness();
      await choose(OTHER);
      await PROOFS.put(PROOF_KEY, PNG(), { httpMetadata: { contentType: "image/png" } });
      const calls: unknown[] = [];
      const reading = await extractAs(id, aiReturning({ [OTHER]: behaviour, [DEFAULT]: READING }, calls));
      expect(reading.trackingKey).toBe(READING.claveDeRastreo);
      expect(modelCalls(calls).map((c) => c.model)).toEqual([OTHER, DEFAULT]);
      const [row] = await db().select().from(extractions);
      expect(row).toMatchObject({ model: DEFAULT, fallbackFrom: OTHER, questionVersion: "2", outcome: "passed" });
      expect(row.readerMs).not.toBeNull();
    });
  }

  it("PDF: the text is converted once and read by the default after the chosen model throws", async () => {
    const { id } = await seedBusiness();
    await choose(OTHER);
    await PROOFS.put(PROOF_KEY, PDF(), { httpMetadata: { contentType: "application/pdf" } });
    const calls: unknown[] = [];
    await extractAs(id, aiReturning({ [OTHER]: { throws: "down" }, [DEFAULT]: READING }, calls, { pdfText: RECEIPT_TEXT }));
    expect(calls.filter((c) => "toMarkdown" in (c as object))).toHaveLength(1);
    expect(modelCalls(calls).map((c) => c.model)).toEqual([OTHER, DEFAULT]);
    /* Both calls read the same text */
    const texts = modelCalls(calls).map((c) => JSON.stringify(c.input));
    expect(texts.every((t) => t.includes("MBAN01002608190001234567"))).toBe(true);
    const [row] = await db().select().from(extractions);
    expect(row).toMatchObject({ model: DEFAULT, fallbackFrom: OTHER });
  });

  it("both fail: the reading door answers READER_UNAVAILABLE as today, and the row records fallback_from", async () => {
    const { id } = await seedBusiness();
    await choose(OTHER);
    await PROOFS.put(PROOF_KEY, PNG(), { httpMetadata: { contentType: "image/png" } });
    const err = await extractFailure(id, aiReturning({ [OTHER]: { throws: "down" }, [DEFAULT]: { throws: "down too" } }));
    expect(err.code).toBe("READER_UNAVAILABLE");
    const [row] = await db().select().from(extractions);
    expect(row).toMatchObject({ outcome: "refused", model: null, fallbackFrom: OTHER });
  });

  it("with the default chosen, a failure makes exactly one call and no fallback", async () => {
    const { id } = await seedBusiness();
    await choose(DEFAULT);
    await PROOFS.put(PROOF_KEY, PNG(), { httpMetadata: { contentType: "image/png" } });
    const calls: unknown[] = [];
    const err = await extractFailure(id, aiReturning({ [DEFAULT]: { throws: "down" }, [OTHER]: READING }, calls));
    expect(err.code).toBe("READER_UNAVAILABLE");
    expect(modelCalls(calls).map((c) => c.model)).toEqual([DEFAULT]);
    const [row] = await db().select().from(extractions);
    expect(row.fallbackFrom).toBeNull();
  });

  it("the default is never limited: a slow default still reads", async () => {
    const { id } = await seedBusiness();
    await PROOFS.put(PROOF_KEY, PNG(), { httpMetadata: { contentType: "image/png" } });
    const reading = await extractAs(id, aiReturning({ [DEFAULT]: { waitsMs: 120, then: READING } }));
    expect(reading.trackingKey).toBe(READING.claveDeRastreo);
  });

  it("fallbacksLast7Days counts only rows where the chosen model failed and the default read (constitution V, v1.6.0)", async () => {
    const { id } = await seedBusiness();
    await choose(OTHER);
    await PROOFS.put(PROOF_KEY, PNG(), { httpMetadata: { contentType: "image/png" } });
    await extractAs(id, aiReturning({ [OTHER]: { throws: "down" }, [DEFAULT]: READING }));
    await extractFailure(id, aiReturning({ [OTHER]: { throws: "down" }, [DEFAULT]: { throws: "down" } }));
    await extractAs(id, aiReturning({ [OTHER]: READING }));
    /* A fallback older than the window is not counted */
    await db()
      .insert(extractions)
      .values({ businessId: id, source: "reader", outcome: "passed", model: DEFAULT, fallbackFrom: OTHER, createdAt: new Date(Date.now() - 8 * 86_400_000) });
    expect((await state()).fallbacksLast7Days).toBe(1);
  });
});

describe("receipt-reader-tuning US1: on the receipt door, both models failing is today's degradation (FR-006, FR-007)", () => {
  it("the file still goes to the provider unread, and the paid call's row names the chosen model that failed first", async () => {
    const { id } = await seedBusiness();
    await choose(OTHER);
    await PROOFS.put(PROOF_KEY, PNG(), { httpMetadata: { contentType: "image/png" } });
    const calls: unknown[] = [];
    const AI = aiReturning({ [OTHER]: { throws: "down" }, [DEFAULT]: { throws: "down too" } }, calls);

    let sent: Record<string, unknown> | undefined;
    fetchMock
      .get(APICEP_ORIGIN)
      .intercept({
        method: "POST",
        path: "/validate-transfer",
        body: (raw) => {
          sent = JSON.parse(String(raw));
          return true;
        },
      })
      .reply(
        200,
        JSON.stringify({ validationId: "prov-nf", status: "invalid", validation: { banxicoConfirmed: false, cepPreviouslyValidated: null }, extracted: {} }),
        { headers: { "Content-Type": "application/json" } },
      );
    const request = {
      receipt: { proofKey: PROOF_KEY },
      beneficiary: { bank: "STP", clabe: "646180157000000004" },
    } as unknown as ConstaRequest;
    /* A reader that is down is our problem, never the payer's (two-eyes-receipt D15): no throw */
    await consta({ ...base(), AI }, db(), { businessId: id }).validate(request);

    /* The chosen model once, then the default once — no third try */
    expect(modelCalls(calls).map((c) => c.model)).toEqual([OTHER, DEFAULT]);
    /* The provider got the file itself, through the image door, and no reading of ours */
    expect(String(sent!.imageUrl)).toContain(`/direct-payments/proofs/${PROOF_KEY}?`);
    expect(sent!.sender).toBeUndefined();

    const rows = await db().select().from(extractions);
    expect(rows).toHaveLength(1);
    expect(rows[0].validationId).not.toBeNull();
    expect(rows[0]).toMatchObject({
      source: "provider-ocr",
      outcome: "routed",
      model: null,
      questionVersion: null,
      fallbackFrom: OTHER,
    });
    /* And it is not a fallback the panel counts: the default did not read (constitution V, v1.6.0) */
    expect((await state()).fallbacksLast7Days).toBe(0);
  });
});

describe("receipt-reader-tuning US1: a reused draft keeps the model that read it (D15, spec US1 scenario 6)", () => {
  it("the pay right after /read reuses the draft's model and version even after the choice changed", async () => {
    const { id } = await seedBusiness();
    await choose(OTHER);
    await PROOFS.put(PROOF_KEY, PNG(), { httpMetadata: { contentType: "image/png" } });
    const calls: unknown[] = [];
    const AI = aiReturning({ [OTHER]: READING, [DEFAULT]: READING }, calls);
    await extractAs(id, AI);
    await choose(DEFAULT);

    fetchMock
      .get(APICEP_ORIGIN)
      .intercept({ method: "POST", path: "/validate-transfer" })
      .reply(
        200,
        JSON.stringify({ validationId: "prov-nf", status: "invalid", validation: { banxicoConfirmed: false, cepPreviouslyValidated: null }, extracted: {} }),
        { headers: { "Content-Type": "application/json" } },
      );
    const request = {
      receipt: { proofKey: PROOF_KEY },
      beneficiary: { bank: "STP", clabe: "646180157000000004" },
    } as unknown as ConstaRequest;
    await consta({ ...base(), AI }, db(), { businessId: id }).validate(request);

    /* One model call in all: the paid attempt re-read nothing */
    expect(modelCalls(calls).map((c) => c.model)).toEqual([OTHER]);
    const rows = await db().select().from(extractions);
    const paid = rows.find((r) => r.validationId)!;
    expect(paid.rawOutput).toContain("reused from extraction");
    expect(paid).toMatchObject({ model: OTHER, questionVersion: "2" });
    expect(paid.readerMs).toBe(rows.find((r) => !r.validationId)!.readerMs);
  });
});

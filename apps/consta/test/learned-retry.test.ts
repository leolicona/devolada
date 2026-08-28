import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { app, db, seedApiKey, validations } from "./helpers";

/* docs/consta/learned-retry.spec.md (US-V16): the suggested retry moment
   on `not_found`/`pending`, learned from the log's own attempts. The
   distributions below are seeded straight into `validations` — the
   suggestion is arithmetic over the log, so the log is the fixture. */

const APICEP_ORIGIN = "https://api.apicep.cloud";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const notFoundReply = {
  validationId: "prov-nf",
  status: "invalid",
  validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
};
const pendingReply = {
  validationId: "prov-pn",
  status: "invalid",
  validation: { banxicoConfirmed: false, cepStatus: "EN PROCESO", cepPreviouslyValidated: null },
};

function mockApiCep(reply: unknown) {
  fetchMock
    .get(APICEP_ORIGIN)
    .intercept({ method: "POST", path: "/validate-transfer" })
    .reply(200, JSON.stringify(reply), { headers: { "Content-Type": "application/json" } });
}

function request(sender: string, receiver: string, trackingKey: string) {
  return {
    transfer: {
      date: new Date().toISOString().slice(0, 10),
      amountCents: 40000,
      senderBank: sender,
      trackingKey,
      beneficiary: { bank: receiver, clabe: "072180001234567895" },
    },
  };
}

async function postValidate(key: string, body: unknown) {
  return app.request(
    "/validate",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

/* One confirmed transfer in the log: a `not_found` at t0 when minutes>0,
   and the `valid` that ends its interval minutes later. Chunked inserts —
   D1 bounds the parameters per statement. */
async function seedConfirmed(
  apiKeyId: string,
  transfers: { key: string; sender: string; receiver: string; minutes: number }[],
) {
  const anchor = Date.now() - 6 * 60 * 60 * 1000;
  const rows = transfers.flatMap((t) => {
    const base = { apiKeyId, mode: "transfer" as const, trackingKey: t.key, senderBank: t.sender, beneficiaryBank: t.receiver };
    return [
      ...(t.minutes > 0
        ? [{ ...base, status: "invalid" as const, reason: "not_found" as const, createdAt: new Date(anchor) }]
        : []),
      { ...base, status: "valid" as const, createdAt: new Date(anchor + t.minutes * 60_000) },
    ];
  });
  for (let i = 0; i < rows.length; i += 10) {
    await db().insert(validations).values(rows.slice(i, i + 10));
  }
}

const many = (n: number, prefix: string, sender: string, receiver: string, minutes: number) =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${String(i).padStart(4, "0")}`, sender, receiver, minutes }));

const suggestedMinutes = (retryAfter: string, from = Date.now()) => (Date.parse(retryAfter) - from) / 60_000;

describe("US-V16: learned retryAfter on not_found/pending", () => {
  it("US-V16: cold start is silence — below the minimum n nothing is suggested, and the receiving bank is finally logged", async () => {
    const { id: keyId, key } = await seedApiKey();
    mockApiCep(notFoundReply);

    const res = await postValidate(key, request("NUBANK", "KLAR", "COLDSTART0000000000000001"));
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data.status).toBe("invalid");
    expect(data.retryAfter).toBeUndefined();

    /* D2: the column the ladder groups over exists from this row on */
    const rows = await db().select().from(validations).where(eq(validations.apiKeyId, keyId));
    expect(rows[0].beneficiaryBank).toBe("KLAR");
  });

  it("US-V16: past p50 the suggestion is p90, learned from the global cell and rounded up to the step grid", async () => {
    const { id: keyId, key } = await seedApiKey();
    /* Phase 0's measured shape: a fast mass and a slow tail. p50 = 0,
       p90 = 118 → rounded up to 120. The caller's bank pair has no
       samples, so the ladder falls through to the global cell. */
    await seedConfirmed(keyId, [
      ...many(24, "FAST", "NUBANK", "KLAR", 0),
      ...many(6, "SLOW", "NUBANK", "KLAR", 118),
    ]);
    mockApiCep(notFoundReply);

    const res = await postValidate(key, request("BBVA MEXICO", "BANORTE", "NEWKEY000000000000000001"));
    const { data } = (await res.json()) as { data: { retryAfter?: string } };
    expect(data.retryAfter).toBeDefined();
    /* elapsed ≈ 0 is already past p50 = 0, so the one jump is to p90 */
    expect(suggestedMinutes(data.retryAfter!)).toBeGreaterThan(118);
    expect(suggestedMinutes(data.retryAfter!)).toBeLessThan(122);
  });

  it("US-V16: before p50 the suggestion is p50, rounded up to the step grid", async () => {
    const { id: keyId, key } = await seedApiKey();
    /* Every transfer confirms at 22 min → p50 = p90 = 22, rounded to 25 */
    await seedConfirmed(keyId, many(30, "MID", "NUBANK", "KLAR", 22));
    mockApiCep(notFoundReply);

    const res = await postValidate(key, request("BBVA MEXICO", "BANORTE", "NEWKEY000000000000000002"));
    const { data } = (await res.json()) as { data: { retryAfter?: string } };
    expect(data.retryAfter).toBeDefined();
    expect(suggestedMinutes(data.retryAfter!)).toBeGreaterThan(23);
    expect(suggestedMinutes(data.retryAfter!)).toBeLessThan(27);
  });

  it("US-V16: past the learned range the field is omitted — the caller's static tail owns the outliers", async () => {
    const { id: keyId, key } = await seedApiKey();
    await seedConfirmed(keyId, [
      ...many(24, "FAST", "NUBANK", "KLAR", 0),
      ...many(6, "SLOW", "NUBANK", "KLAR", 118),
    ]);
    /* This transfer was first seen 125 min ago — beyond p90 = 120 */
    await db().insert(validations).values({
      apiKeyId: keyId,
      mode: "transfer",
      status: "invalid",
      reason: "not_found",
      trackingKey: "OLDKEY000000000000000001",
      senderBank: "BBVA MEXICO",
      beneficiaryBank: "BANORTE",
      createdAt: new Date(Date.now() - 125 * 60_000),
    });
    mockApiCep(notFoundReply);

    const res = await postValidate(key, request("BBVA MEXICO", "BANORTE", "OLDKEY000000000000000001"));
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data.status).toBe("invalid");
    expect(data.retryAfter).toBeUndefined();
  });

  it("US-V16: the ladder — a fast pair with its own samples is never poisoned by a slow rest of the world", async () => {
    const { id: keyId, key } = await seedApiKey();
    await seedConfirmed(keyId, [
      /* the world is slow… */
      ...many(30, "SLOW", "NUBANK", "KLAR", 118),
      /* …but this exact pair always confirms instantly */
      ...many(30, "FAST", "BBVA MEXICO", "BANORTE", 0),
    ]);
    mockApiCep(notFoundReply);
    mockApiCep(notFoundReply);

    /* The fast pair: p50 = p90 = 0, nothing left to suggest beyond the
       caller's own early attempts — the field stays silent */
    const fast = await postValidate(key, request("BBVA MEXICO", "BANORTE", "NEWKEY000000000000000003"));
    const fastData = ((await fast.json()) as { data: { retryAfter?: string } }).data;
    expect(fastData.retryAfter).toBeUndefined();

    /* The slow pair still gets its jump — cells do not bleed */
    const slow = await postValidate(key, request("NUBANK", "KLAR", "NEWKEY000000000000000004"));
    const slowData = ((await slow.json()) as { data: { retryAfter?: string } }).data;
    expect(slowData.retryAfter).toBeDefined();
    expect(suggestedMinutes(slowData.retryAfter!)).toBeGreaterThan(118);
  });

  it("US-V16: a `pending` verdict carries the suggestion too", async () => {
    const { id: keyId, key } = await seedApiKey();
    await seedConfirmed(keyId, many(30, "MID", "NUBANK", "KLAR", 22));
    mockApiCep(pendingReply);

    const res = await postValidate(key, request("BBVA MEXICO", "BANORTE", "NEWKEY000000000000000005"));
    const { data } = (await res.json()) as { data: { status: string; retryAfter?: string } };
    expect(data.status).toBe("pending");
    expect(data.retryAfter).toBeDefined();
  });
});

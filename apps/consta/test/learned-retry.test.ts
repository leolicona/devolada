import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { app, db, seedApiKey, validations } from "./helpers";

/* docs/legacy/consta/learned-retry.spec.md (US-V16): the suggested retry moment
   on `not_found`/`pending`, learned from the log's own attempts. The
   distributions below are seeded straight into `validations` — the
   suggestion is arithmetic over the log, so the log is the fixture.

   The population rules (D4, second amendment) are what most of these
   scenarios exercise: only transfers whose first attempt missed count,
   and only attempts that asked with the inputs that validated. */

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

const TODAY = new Date().toISOString().slice(0, 10);
const AMOUNT = 40000;

function request(sender: string, receiver: string, trackingKey: string) {
  return {
    transfer: {
      date: TODAY,
      amountCents: AMOUNT,
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

/* One transfer in the log. minutes > 0 → a `not_found` at t0 and the
   `valid` that ends its interval minutes later (a first attempt that
   missed — the measured population). minutes === 0 → `valid` on the
   first and only attempt, which D4's rules must EXCLUDE. Chunked
   inserts — D1 bounds the parameters per statement. */
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

/* A prior miss for the transfer the test is about to validate — same
   search inputs as request(), so the live anchor (rule 2) counts it */
async function seedPriorMiss(
  apiKeyId: string,
  key: string,
  sender: string,
  receiver: string,
  minutesAgo: number,
) {
  await db().insert(validations).values({
    apiKeyId,
    mode: "transfer",
    status: "invalid",
    reason: "not_found",
    trackingKey: key,
    senderBank: sender,
    beneficiaryBank: receiver,
    amountCents: AMOUNT,
    transferDate: TODAY,
    createdAt: new Date(Date.now() - minutesAgo * 60_000),
  });
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

  it("US-V16: a transfer valid on its first attempt never shapes the cells — it measures the upload lag, not Banxico", async () => {
    const { id: keyId, key } = await seedApiKey();
    /* Measured live 2026-08-28 (D4, second amendment): a receipt
       uploaded the morning after validates instantly and says nothing
       about publication delay. 35 of these must not open the cell. */
    await seedConfirmed(keyId, [
      ...many(35, "LATE", "NUBANK", "KLAR", 0),
      ...many(5, "SLOW", "NUBANK", "KLAR", 118),
    ]);
    mockApiCep(notFoundReply);

    const res = await postValidate(key, request("NUBANK", "KLAR", "NEWKEY000000000000000001"));
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data.retryAfter).toBeUndefined();
  });

  it("US-V16: a miss that asked with the wrong amount is our correction time, not Banxico's delay — it does not count", async () => {
    const { id: keyId, key } = await seedApiKey();
    await seedConfirmed(keyId, many(29, "MID", "NUBANK", "KLAR", 22));
    /* The thirtieth: missed asking with 100 cents, validated 300 min
       later asking with 200 — a misread amount, then a human fix. If
       this counted, the cell would open (n = 30) with a poisoned p90. */
    const anchor = Date.now() - 7 * 60 * 60 * 1000;
    await db().insert(validations).values([
      { apiKeyId: keyId, mode: "transfer", status: "invalid", reason: "not_found", trackingKey: "MISREAD00000000000000001", senderBank: "NUBANK", beneficiaryBank: "KLAR", amountCents: 100, transferDate: TODAY, createdAt: new Date(anchor) },
      { apiKeyId: keyId, mode: "transfer", status: "valid", trackingKey: "MISREAD00000000000000001", senderBank: "NUBANK", beneficiaryBank: "KLAR", amountCents: 200, transferDate: TODAY, createdAt: new Date(anchor + 300 * 60_000) },
    ]);
    mockApiCep(notFoundReply);

    const res = await postValidate(key, request("NUBANK", "KLAR", "NEWKEY000000000000000002"));
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data.retryAfter).toBeUndefined();
  });

  it("US-V16: before p50 the suggestion is p50, rounded up to the step grid", async () => {
    const { id: keyId, key } = await seedApiKey();
    /* Every measured transfer missed once and confirmed at 22 min →
       p50 = p90 = 22, rounded to 25 */
    await seedConfirmed(keyId, many(30, "MID", "NUBANK", "KLAR", 22));
    mockApiCep(notFoundReply);

    const res = await postValidate(key, request("BBVA MEXICO", "BANORTE", "NEWKEY000000000000000003"));
    const { data } = (await res.json()) as { data: { retryAfter?: string } };
    expect(data.retryAfter).toBeDefined();
    expect(suggestedMinutes(data.retryAfter!)).toBeGreaterThan(23);
    expect(suggestedMinutes(data.retryAfter!)).toBeLessThan(27);
  });

  it("US-V16: past p50 the suggestion is p90 — the phase-0 shape, measured conditionally", async () => {
    const { id: keyId, key } = await seedApiKey();
    /* 24 quick misses (confirm at 1 min) and 6 slow ones (118) →
       p50 = 1 → step 5; p90 = 118 → step 120 */
    await seedConfirmed(keyId, [
      ...many(24, "FAST", "NUBANK", "KLAR", 1),
      ...many(6, "SLOW", "NUBANK", "KLAR", 118),
    ]);
    /* This transfer already missed 10 min ago — past p50, so one jump */
    await seedPriorMiss(keyId, "RETRY0000000000000000001", "BBVA MEXICO", "BANORTE", 10);
    mockApiCep(notFoundReply);

    const res = await postValidate(key, request("BBVA MEXICO", "BANORTE", "RETRY0000000000000000001"));
    const { data } = (await res.json()) as { data: { retryAfter?: string } };
    expect(data.retryAfter).toBeDefined();
    /* anchored at the prior miss: firstSeen + 120 ≈ now + 110 */
    expect(suggestedMinutes(data.retryAfter!)).toBeGreaterThan(107);
    expect(suggestedMinutes(data.retryAfter!)).toBeLessThan(113);
  });

  it("US-V16: past the learned range the field is omitted — the caller's static tail owns the outliers", async () => {
    const { id: keyId, key } = await seedApiKey();
    await seedConfirmed(keyId, [
      ...many(24, "FAST", "NUBANK", "KLAR", 1),
      ...many(6, "SLOW", "NUBANK", "KLAR", 118),
    ]);
    /* First seen 125 min ago — beyond p90 = 120 */
    await seedPriorMiss(keyId, "OLDKEY000000000000000001", "BBVA MEXICO", "BANORTE", 125);
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
      /* …but this exact pair confirms a minute after its miss */
      ...many(30, "FAST", "BBVA MEXICO", "BANORTE", 1),
    ]);
    mockApiCep(notFoundReply);
    mockApiCep(notFoundReply);

    const fast = await postValidate(key, request("BBVA MEXICO", "BANORTE", "NEWKEY000000000000000004"));
    const fastData = ((await fast.json()) as { data: { retryAfter?: string } }).data;
    expect(fastData.retryAfter).toBeDefined();
    expect(suggestedMinutes(fastData.retryAfter!)).toBeLessThan(8);

    const slow = await postValidate(key, request("NUBANK", "KLAR", "NEWKEY000000000000000005"));
    const slowData = ((await slow.json()) as { data: { retryAfter?: string } }).data;
    expect(slowData.retryAfter).toBeDefined();
    expect(suggestedMinutes(slowData.retryAfter!)).toBeGreaterThan(110);
  });

  it("US-V16: a `pending` verdict carries the suggestion too", async () => {
    const { id: keyId, key } = await seedApiKey();
    await seedConfirmed(keyId, many(30, "MID", "NUBANK", "KLAR", 22));
    mockApiCep(pendingReply);

    const res = await postValidate(key, request("BBVA MEXICO", "BANORTE", "NEWKEY000000000000000006"));
    const { data } = (await res.json()) as { data: { status: string; retryAfter?: string } };
    expect(data.status).toBe("pending");
    expect(data.retryAfter).toBeDefined();
  });
});

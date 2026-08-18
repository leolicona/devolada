import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { app, db, seedApiKey, validations } from "./helpers";

/* docs/consta/validation.spec.md scenarios 1–5 and 7.
   apiCEP is mocked with the shapes read from its documentation (2026-08-17). */

const APICEP_ORIGIN = "https://api.apicep.cloud";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const directRequest = {
  transfer: {
    date: "2026-08-15",
    amountCents: 51400,
    senderBank: "BBVA MEXICO",
    trackingKey: "MBAN01002508150012345678",
    beneficiary: { bank: "BANORTE", clabe: "072180001234567895" },
  },
};

const settledResponse = {
  validationId: "prov-uuid-1",
  status: "valid",
  validation: {
    banxicoConfirmed: true,
    cepStatus: "LIQUIDADO",
    cepPreviouslyValidated: false,
    cepDetails: {
      trackingKey: "MBAN01002508150012345678",
      amount: 514.0,
      operationDate: "2026-08-15",
      senderBank: "BBVA MEXICO",
      senderName: "VALENTINA PEREZ",
      receiverBank: "BANORTE",
      beneficiaryName: "WIFIPLUS SA DE CV",
      digitalSignature: "abc123==",
    },
  },
  downloads: { cepXml: "https://storage.apicep.cloud/x.xml", cepPdf: "https://storage.apicep.cloud/x.pdf" },
};

function mockApiCep(reply: unknown, expectBody?: (body: Record<string, unknown>) => void) {
  fetchMock
    .get(APICEP_ORIGIN)
    .intercept({
      method: "POST",
      path: "/validate-transfer",
      body: (raw) => {
        expectBody?.(JSON.parse(raw as string));
        return true;
      },
    })
    .reply(200, JSON.stringify(reply), { headers: { "Content-Type": "application/json" } });
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

describe("POST /validate — transfer door", () => {
  it("US-V01, US-V05: a settled transfer comes back valid, mapped to cents, and logged under the key", async () => {
    const { id: keyId, key } = await seedApiKey();
    mockApiCep(settledResponse, (body) => {
      const sender = body.sender as Record<string, unknown>;
      expect(sender.amount).toBe(514); // cents → provider pesos (D7)
      expect(body.system).toBe("SPEI");
    });

    const res = await postValidate(key, directRequest);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data.status).toBe("valid");
    expect(data.alreadyValidated).toBe(false);
    expect((data.cep as Record<string, unknown>).amountCents).toBe(51400);
    expect((data.cep as Record<string, unknown>).senderName).toBe("VALENTINA PEREZ");

    const rows = await db().select().from(validations).where(eq(validations.apiKeyId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("valid");
    expect(rows[0].mode).toBe("transfer");
    expect(rows[0].providerValidationId).toBe("prov-uuid-1");
  });

  it("US-V03: a CEP still EN PROCESO reads as pending, never invalid", async () => {
    const { key } = await seedApiKey();
    mockApiCep({
      validationId: "prov-uuid-2",
      status: "invalid",
      validation: { banxicoConfirmed: false, cepStatus: "EN PROCESO", cepPreviouslyValidated: null },
    });

    const res = await postValidate(key, directRequest);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data.status).toBe("pending");
  });

  it("US-V04: a previously validated CEP is flagged but keeps its verdict", async () => {
    const { key } = await seedApiKey();
    mockApiCep({
      ...settledResponse,
      validation: { ...settledResponse.validation, cepPreviouslyValidated: true },
    });

    const res = await postValidate(key, directRequest);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data.status).toBe("valid");
    expect(data.alreadyValidated).toBe(true);
  });

  it("scenario 7: a provider error surfaces as 502 PROVIDER_ERROR and logs nothing", async () => {
    const { id: keyId, key } = await seedApiKey();
    fetchMock
      .get(APICEP_ORIGIN)
      .intercept({ method: "POST", path: "/validate-transfer" })
      .reply(503, JSON.stringify({ error: "Service temporarily unavailable" }));

    const res = await postValidate(key, directRequest);
    expect(res.status).toBe(502);
    const { error } = (await res.json()) as { error: { code: string } };
    expect(error.code).toBe("PROVIDER_ERROR");

    const rows = await db().select().from(validations).where(eq(validations.apiKeyId, keyId));
    expect(rows).toHaveLength(0);
  });
});

describe("POST /validate — receipt door", () => {
  it("US-V02: a receipt URL reaches the provider as OCR mode with the same verdict shape", async () => {
    const { key } = await seedApiKey();
    mockApiCep(settledResponse, (body) => {
      expect(body.imageUrl).toBe("https://example.com/recibo.jpg");
      expect(body.sender).toBeUndefined();
    });

    const res = await postValidate(key, {
      receiptUrl: "https://example.com/recibo.jpg",
      beneficiary: { bank: "BANORTE", clabe: "072180001234567895" },
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data.status).toBe("valid");
  });

  it("VALIDATION_ERROR: both doors at once is rejected before any provider call", async () => {
    const { key } = await seedApiKey();
    const res = await postValidate(key, {
      ...directRequest,
      receiptUrl: "https://example.com/recibo.jpg",
      beneficiary: { bank: "BANORTE", clabe: "072180001234567895" },
    });
    expect(res.status).toBe(400);
  });
});

describe("API keys (D5)", () => {
  it("scenario 5: a bad key and a revoked key both 401 without touching the provider", async () => {
    const res = await postValidate("ck_deadbeef", directRequest);
    expect(res.status).toBe(401);

    const { id, key } = await seedApiKey();
    const revoke = await app.request(
      `/admin/keys/${id}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${env.CONSTA_ADMIN_TOKEN}` } },
      env,
    );
    expect(revoke.status).toBe(200);

    const after = await postValidate(key, directRequest);
    expect(after.status).toBe(401);
  });
});

describe("US-V06: the OCR's confidence rides the verdict (D9)", () => {
  it("scenario 8: an unreadable receipt is `invalid` with a low score, not silence", async () => {
    const { key } = await seedApiKey();
    /* The 2026-08-18 failure, in the shape the provider actually
       returned: a verdict with no cepDetails at all. Byte-for-byte what
       a transfer that never happened looks like — except for the score. */
    mockApiCep({
      validationId: "prov-uuid-blur",
      status: "invalid",
      confidence: 0.12,
      validation: { banxicoConfirmed: false, cepStatus: null, cepPreviouslyValidated: null },
    });

    const res = await postValidate(key, {
      receiptUrl: "https://example.test/blurry.png",
      beneficiary: { bank: "BANORTE", clabe: "072180001234567895" },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("invalid");
    expect(data.confidence).toBe(0.12);
    /* Consta reports and does not act: a low score is still `invalid`,
       never a new verdict and never `pending` (D9) */
    expect(data.cep).toBeUndefined();

    const [row] = await db().select().from(validations);
    expect(row.confidence).toBe(0.12);
  });

  it("a settled transfer carries its score, and the log keeps it", async () => {
    const { key } = await seedApiKey();
    mockApiCep({ ...settledResponse, confidence: 1 });

    const res = await postValidate(key, directRequest);
    const { data } = await res.json();
    expect(data.status).toBe("valid");
    expect(data.confidence).toBe(1);

    const [row] = await db().select().from(validations);
    expect(row.confidence).toBe(1);
  });

  it("a provider that omits the score reports null, not a guess", async () => {
    const { key } = await seedApiKey();
    mockApiCep(settledResponse);

    const res = await postValidate(key, directRequest);
    const { data } = await res.json();
    expect(data.confidence).toBeNull();

    const [row] = await db().select().from(validations);
    expect(row.confidence).toBeNull();
  });
});

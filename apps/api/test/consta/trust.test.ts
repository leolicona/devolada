import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { consta, ConstaError, type ConstaRequest } from "../../src/consta";
import { db, engineEnv, seedOwner, validations } from "./helpers";

/* trust-layer spec (US-V15): the collection half and the computed block,
   carved out of validate.test.ts when the engine moved in-process
   (consta-api-merge D12, T039) — nine tests with their titles, citations
   and assertions, run through the engine's facade and scoped by business
   (D3). The three tests cited `consta-api-merge US3` are what the move
   added: isolation between businesses (SC-007), the platform's rows out
   of every business's evidence, and the chain in flight excluded. */

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
    },
  },
};

function mockApiCep(reply: unknown, opts: { status?: number; headers?: Record<string, string> } = {}) {
  fetchMock
    .get(APICEP_ORIGIN)
    .intercept({ method: "POST", path: "/validate-transfer" })
    .reply(opts.status ?? 200, JSON.stringify(reply), {
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    });
}

type Outcome = { ok: boolean; data: Record<string, unknown>; error: ConstaError | null };

async function postValidate(businessId: string, body: unknown): Promise<Outcome> {
  try {
    const data = await consta(engineEnv(), db(), { businessId }).validate(body as ConstaRequest);
    return { ok: true, data: data as unknown as Record<string, unknown>, error: null };
  } catch (e) {
    if (e instanceof ConstaError) return { ok: false, data: {}, error: e };
    throw e;
  }
}

/* trust-layer spec (US-V15) — the collection half: the opaque refs land
   on the log verbatim, on failures too, and an oversized ref is refused
   before a credit is spent. The computed block ships later (spec D7's
   split); these rows are what it will SUM over. */
describe("US-V15: the history refs (trust-layer D1)", () => {
  const refs = { customerRef: "a".repeat(64), paymentRef: "pay-123" };

  it("stores customerRef and paymentRef verbatim on the logged row", async () => {
    const { id: keyId, key } = await seedOwner();
    mockApiCep(settledResponse);

    const res = await postValidate(key, { ...directRequest, ...refs });
    expect(res.ok).toBe(true);

    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].customerRef).toBe(refs.customerRef);
    expect(rows[0].paymentRef).toBe("pay-123");
  });

  it("without refs nothing is collected — the opt-in is structural", async () => {
    const { id: keyId, key } = await seedOwner();
    mockApiCep(settledResponse);

    await postValidate(key, directRequest);

    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows[0].customerRef).toBeNull();
    expect(rows[0].paymentRef).toBeNull();
  });

  it("a ref past 128 chars is refused before any credit", async () => {
    const { id: keyId, key } = await seedOwner();

    const res = await postValidate(key, { ...directRequest, customerRef: "x".repeat(129) });
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe("REQUEST_REJECTED");

    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(0);
  });

  it("a billed failure keeps its refs — the chain must not lie about itself", async () => {
    const { id: keyId, key } = await seedOwner();
    /* The envelope-shaped 400: billed, logged with status null (D15) */
    mockApiCep(
      { validationId: "prov-billed-1", error: "Solicitud inválida" },
      { status: 400, headers: { "X-Processing-Time": "100ms" } },
    );

    const res = await postValidate(key, { ...directRequest, ...refs });
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe("REQUEST_REJECTED");

    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBeNull();
    expect(rows[0].customerRef).toBe(refs.customerRef);
    expect(rows[0].paymentRef).toBe("pay-123");
  });
});

/* trust-layer spec (US-V15 D3–D8) — the computed block: chains with
   outcomes, recency decay, the baseline that gives a rate its meaning,
   and the doctrine that Consta measures and never decides. */
describe("US-V15: the trust block", () => {
  const DAY = 24 * 3600 * 1000;
  const PAYER = "payer-hist-1";

  /* A closed, resolved chain: one valid validation, aged as asked */
  const seedChain = (
    businessId: string | null,
    over: Partial<typeof validations.$inferInsert> = {},
    daysAgo = 10,
  ) =>
    db()
      .insert(validations)
      .values({
        businessId,
        mode: "transfer",
        status: "valid",
        trackingKey: `SEED${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        customerRef: PAYER,
        paymentRef: `pay-${Math.random().toString(36).slice(2, 10)}`,
        createdAt: new Date(Date.now() - daysAgo * DAY),
        ...over,
      });

  const pendingReply = { validationId: "prov-trust-1", status: "pending" };

  it("scenario 1: the regular — chains counted, rate 1, decay discounting the old", async () => {
    const { id: keyId, key } = await seedOwner();
    await seedChain(keyId, {}, 10);
    await seedChain(keyId, {}, 10);
    /* a chain a half-life away weighs ~0.5 */
    await seedChain(keyId, {}, 90);
    mockApiCep(pendingReply);

    const res = await postValidate(key, {
      ...directRequest,
      customerRef: PAYER,
      paymentRef: "pay-in-flight",
    });
    const { data } = res;
    const trust = data.trust as Record<string, unknown>;
    expect(trust).toBeDefined();
    const sample = trust.sample as Record<string, number>;
    expect(sample.chains).toBe(3);
    expect(sample.halfLifeDays).toBe(90);
    /* 0.93 + 0.93 + 0.5 ≈ 2.4 — the n the rate really rests on */
    expect(sample.effectiveN).toBeGreaterThan(2.1);
    expect(sample.effectiveN).toBeLessThan(2.6);
    expect(trust.eventualValidRate).toBe(1);
    expect((trust.raw as Record<string, number>).resolvedValid).toBe(3);
    expect((trust.tenantBaseline as Record<string, number>).chains).toBe(3);
  });

  it("scenario 2: the stranger — zeros for the payer, the baseline still travels", async () => {
    const { id: keyId, key } = await seedOwner();
    await seedChain(keyId, {}, 10);
    mockApiCep(pendingReply);

    const res = await postValidate(key, {
      ...directRequest,
      customerRef: "recien-llegado",
      paymentRef: "pay-first-ever",
    });
    const { data } = res;
    const trust = data.trust as Record<string, unknown>;
    expect((trust.sample as Record<string, number>).chains).toBe(0);
    expect(trust.eventualValidRate).toBeNull();
    /* day-one value: about you I know nothing; your peers resolve fine */
    expect((trust.tenantBaseline as Record<string, number>).chains).toBe(1);
    expect((trust.tenantBaseline as Record<string, number>).eventualValidRate).toBe(1);
  });

  it("D3: the chain in flight never vouches for itself", async () => {
    const { id: keyId, key } = await seedOwner();
    await seedChain(keyId, { paymentRef: "pay-mine" }, 10);
    await seedChain(keyId, {}, 10);
    mockApiCep(pendingReply);

    /* revalidating the same payment: its own prior valid must not count */
    const res = await postValidate(key, {
      ...directRequest,
      customerRef: PAYER,
      paymentRef: "pay-mine",
    });
    const { data } = res;
    expect(
      ((data.trust as Record<string, unknown>).sample as Record<string, number>).chains,
    ).toBe(1);
  });

  it("scenarios 3–4: incidents surface and are never suppressed", async () => {
    const { id: keyId, key } = await seedOwner();
    await seedChain(keyId, {}, 20);
    /* a DEVUELTO chain and a reused-CEP attempt */
    await seedChain(keyId, { status: "invalid", reason: "contradicted" }, 5);
    await seedChain(keyId, { alreadyValidated: true }, 3);
    mockApiCep(pendingReply);

    const res = await postValidate(key, {
      ...directRequest,
      customerRef: PAYER,
      paymentRef: "pay-in-flight",
    });
    const { data } = res;
    const trust = data.trust as Record<string, unknown>;
    const raw = trust.raw as Record<string, number>;
    expect(raw.contradicted).toBe(1);
    expect(raw.alreadyUsedAttempts).toBe(1);
    expect(trust.lastIncidentAt).not.toBeNull();
    expect(trust.eventualValidRate as number).toBeLessThan(1);
  });

  it("D5: no block on a valid verdict, and none without a customerRef", async () => {
    const { id: keyId, key } = await seedOwner();
    await seedChain(keyId, {}, 10);

    mockApiCep(settledResponse);
    const valid = await postValidate(key, {
      ...directRequest,
      customerRef: PAYER,
      paymentRef: "pay-x",
    });
    expect("trust" in valid.data).toBe(false);

    mockApiCep(pendingReply);
    const noRef = await postValidate(key, directRequest);
    expect("trust" in noRef.data).toBe(false);
  });
});

/* consta-api-merge US3 — what the move added: the tenant is the
   business (D3), and the two reads the constitution names as
   cross-business (D4) are not this one. */
describe("consta-api-merge US3: the trust block is one business's evidence", () => {
  const DAY = 24 * 3600 * 1000;
  const PAYER = "same-usuario@both";
  const seedChain = (businessId: string | null, over: Partial<typeof validations.$inferInsert> = {}) =>
    db()
      .insert(validations)
      .values({
        businessId,
        mode: "transfer",
        status: "valid",
        trackingKey: `SEED${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        customerRef: PAYER,
        paymentRef: `pay-${Math.random().toString(36).slice(2, 10)}`,
        createdAt: new Date(Date.now() - 10 * DAY),
        ...over,
      });
  const pendingReply = { validationId: "prov-trust-iso", status: "pending" };
  const trustOf = (res: Outcome) => res.data.trust as Record<string, Record<string, number>>;

  it("the same customer_ref at two businesses never shares a chain (SC-007)", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    await seedChain(a.id);
    await seedChain(a.id);
    await seedChain(b.id, { status: "invalid", reason: "contradicted" });

    mockApiCep(pendingReply);
    const atA = await postValidate(a.key, { ...directRequest, customerRef: PAYER, paymentRef: "pay-a" });
    expect(trustOf(atA).sample.chains).toBe(2);
    expect(trustOf(atA).raw.contradicted).toBe(0);
    expect(trustOf(atA).tenantBaseline.chains).toBe(2);

    mockApiCep(pendingReply);
    const atB = await postValidate(b.key, { ...directRequest, customerRef: PAYER, paymentRef: "pay-b" });
    expect(trustOf(atB).sample.chains).toBe(1);
    expect(trustOf(atB).raw.contradicted).toBe(1);
    expect(trustOf(atB).tenantBaseline.chains).toBe(1);
  });

  it("a platform row (NULL owner) never enters any business's evidence", async () => {
    const { id, key } = await seedOwner();
    await seedChain(id);
    /* the platform's own top-ups carry no refs (prepaid-credit D6); a
       row that somehow did must still count for nobody */
    await seedChain(null);
    await seedChain(null, { status: "invalid", reason: "contradicted" });

    mockApiCep(pendingReply);
    const res = await postValidate(key, { ...directRequest, customerRef: PAYER, paymentRef: "pay-x" });
    expect(trustOf(res).sample.chains).toBe(1);
    expect(trustOf(res).tenantBaseline.chains).toBe(1);
    expect(trustOf(res).raw.contradicted).toBe(0);
  });

  it("the chain in flight is excluded from its own evidence (trust-layer D3), attributed or not", async () => {
    const { id, key } = await seedOwner();
    await seedChain(id, { paymentRef: "pay-mine" });
    await seedChain(id);

    mockApiCep(pendingReply);
    const res = await postValidate(key, { ...directRequest, customerRef: PAYER, paymentRef: "pay-mine" });
    expect(trustOf(res).sample.chains).toBe(1);
    /* the row this call just wrote belongs to the chain in flight too */
    const rows = await db().select().from(validations).where(eq(validations.businessId, id));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.businessId === id)).toBe(true);
  });
});

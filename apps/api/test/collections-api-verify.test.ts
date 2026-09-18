import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchMock } from "cloudflare:test";
import { sweepDirectPayments } from "../src/direct-payments/validation";
import { issueCredential } from "../src/api-clients/store";
import { apiPayment, apiPaymentList } from "../src/routes/v1/schema";
import {
  collectingCtx,
  db,
  mockApiCep,
  payerPost,
  seedApiBusiness,
  testEnv,
  TRANSFER,
  v1,
} from "./collections-api-helpers";

/* automated-collections-api US3 — the caller asks about a payment at any
   moment (spec scenarios 1–4, FR-019, FR-023, contracts/public-api.md).
   No address is registered in this suite on purpose: the read is the
   safety net under the webhook, so it must tell the whole truth to a
   caller that never received a message. Every business is a gym with
   NO integration row at all (research D5). */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const FEE = 1500;
const ASK = 49900;
const minutes = (n: number) => n * 60_000;

/* A configured gym, one reusable link, no webhook */
async function arrange(customerRef = "CLI-4471") {
  const { key, business } = await seedApiBusiness({ serviceFeeCents: FEE });
  const link = (await v1(key, "POST", "/payment-links", { customerRef, askCents: ASK, label: "Ana Ruiz" })).body.data!;
  return { key, business, link, token: String(link.url).split("/p/")[1] };
}

/* A claim with Banxico still silent: the row is `validating` */
async function submitValidating(token: string, trackingKey: string) {
  mockApiCep({ status: "pending" });
  const { ctx, settled } = collectingCtx();
  const submitted = await payerPost(token, TRANSFER(trackingKey, ASK + FEE), testEnv, ctx);
  await settled();
  expect(submitted.body.data).toMatchObject({ status: "validating" });
  return String(submitted.body.data!.directPaymentId);
}

describe("scenario 1: a payment under validation, and what it was asked to be", () => {
  it("by id and by reference: `validating`, the ask, the claim, the door — and nothing invented about the verdict", async () => {
    const { key, link, token } = await arrange();
    const paymentId = await submitValidating(token, "TRACK0004471");

    const byId = await v1(key, "GET", `/payments/${paymentId}`);
    expect(byId.status).toBe(200);
    expect(apiPayment.parse(byId.body.data)).toEqual({
      id: paymentId,
      paymentLinkId: link.id,
      customerRef: "CLI-4471",
      status: "validating",
      askedCents: ASK,
      claimedCents: ASK + FEE,
      proofDoor: "transfer",
      receivedCents: null,
      match: null,
      folio: null,
      confirmedAt: null,
      createdAt: expect.any(Number),
      isTest: false,
    });

    const byRef = await v1(key, "GET", "/payments?customerRef=CLI-4471");
    expect(byRef.status).toBe(200);
    expect(apiPaymentList.parse(byRef.body.data).payments).toEqual([byId.body.data]);
  });

  it("asking without a reference names the field (FR-025)", async () => {
    const { key } = await arrange();
    const res = await v1(key, "GET", "/payments");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
    expect(res.body.error!.message).toMatch(/customerRef/);
  });
});

describe("scenario 2: the same reference after confirmation", () => {
  it("`confirmed`, with the folio, the amount that arrived, the class and the moment of the verdict", async () => {
    const { key, token } = await arrange();
    const paymentId = await submitValidating(token, "TRACK0004471");

    /* Banxico answers on the sweep's next pass, with nobody listening */
    mockApiCep({ cep: { amountCents: ASK + FEE, trackingKey: "TRACK0004471" } });
    expect(await sweepDirectPayments(testEnv, new Date(Date.now() + minutes(3)))).toMatchObject({ claimed: 1, confirmed: 1 });

    const byId = await v1(key, "GET", `/payments/${paymentId}`);
    expect(byId.status).toBe(200);
    const payment = apiPayment.parse(byId.body.data);
    expect(payment).toMatchObject({
      id: paymentId,
      status: "confirmed",
      askedCents: ASK,
      claimedCents: ASK + FEE,
      receivedCents: ASK + FEE,
      match: "exact",
    });
    expect(payment.folio).toMatch(/^DV-/);
    expect(payment.confirmedAt).toEqual(expect.any(Number));
    expect(payment.confirmedAt!).toBeGreaterThanOrEqual(payment.createdAt);

    const byRef = await v1(key, "GET", "/payments?customerRef=CLI-4471");
    expect(apiPaymentList.parse(byRef.body.data).payments).toEqual([byId.body.data]);
  });

  it("every payment of the reference, newest first, each with its own verdict (`partial` is the row's word, `short` the class)", async () => {
    const { key, token } = await arrange();
    const first = await submitValidating(token, "TRACK000FIRST");
    mockApiCep({ cep: { amountCents: 40000, trackingKey: "TRACK000SHORT" } });
    const { ctx, settled } = collectingCtx();
    const short = await payerPost(token, TRANSFER("TRACK000SHORT", 40000), testEnv, ctx);
    /* two-eyes-receipt D4: the answer does not wait for the provider.
       The `partial` verdict is on the row — and on this door — once the
       deferred attempt has settled. */
    expect(short.body.data).toMatchObject({ status: "validating" });
    await settled();

    const byRef = await v1(key, "GET", "/payments?customerRef=CLI-4471");
    const list = apiPaymentList.parse(byRef.body.data).payments;
    expect(list.map((p) => [p.id, p.status, p.match, p.receivedCents])).toEqual([
      [String(short.body.data!.directPaymentId), "partial", "short", 40000],
      [first, "validating", null, null],
    ]);
  });
});

describe("scenario 3: a reference with nothing received", () => {
  it("answers an empty list, never an error — whether the reference has a link or was never heard of", async () => {
    const { key } = await arrange("CLI-4471");
    for (const customerRef of ["CLI-4471", "CLI-NEVER"]) {
      const res = await v1(key, "GET", `/payments?customerRef=${customerRef}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { payments: [] } });
    }
  });
});

describe("scenario 4: another business asks about this payment (FR-023)", () => {
  it("is told the payment does not exist, and nothing about it leaks", async () => {
    const { token } = await arrange();
    const paymentId = await submitValidating(token, "TRACK0004471");
    const other = await seedApiBusiness({ email: "otro@devolada.app", speiClabe: "646180157000000012" });

    const byId = await v1(other.key, "GET", `/payments/${paymentId}`);
    expect(byId.status).toBe(404);
    expect(byId.body).toEqual({ success: false, error: { code: "NOT_FOUND", retryable: false } });
    expect(JSON.stringify(byId.body)).not.toContain(paymentId);

    /* the same reference under the other business is simply empty */
    const byRef = await v1(other.key, "GET", "/payments?customerRef=CLI-4471");
    expect(byRef.status).toBe(200);
    expect(byRef.body.data).toEqual({ payments: [] });
  });

  it("research D12: a test credential of the same business does not see a real payment either", async () => {
    const { business, token } = await arrange();
    const paymentId = await submitValidating(token, "TRACK0004471");
    const test = await issueCredential(db(), business.id, { name: "sandbox", isTest: true });

    const byId = await v1(test.plaintext, "GET", `/payments/${paymentId}`);
    expect(byId.status).toBe(404);
    const byRef = await v1(test.plaintext, "GET", "/payments?customerRef=CLI-4471");
    expect(byRef.body.data).toEqual({ payments: [] });
  });
});

import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { charges, directPayments, ledgerEntries, paymentLinks } from "../src/db/schema";
import { sweepDirectPayments } from "../src/direct-payments/validation";
import { sweepReconnections } from "../src/reconnection/queue";
import { signedProofUrl, UPLOAD_HOURLY_BUDGET } from "../src/direct-payments/proofs";
import type { Bindings } from "../src/env";
import { app, seedIsp, sessionCookieHeader } from "./helpers";

/* docs/direct-payment/direct-payment.spec.md scenarios 1–12, 16–24
   (US-D01–US-D04). Consta and WispHub are fetch-mocked respecting
   their contracts (docs/consta/validation.spec.md,
   docs/integrations/wisphub.md). */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const CONSTA_ORIGIN = "https://consta.test";

/* In-memory R2: real R2 writes trip vitest-pool-workers' isolated
   storage (its snapshotter rejects the bucket's sqlite WAL files).
   D1 stays real — the "no database mocks" rule is about D1; the blob
   store is an implementation detail behind three calls. */
function fakeProofs(): R2Bucket {
  const store = new Map<string, { data: unknown; contentType?: string; uploaded: Date }>();
  return {
    async put(key: string, value: unknown, opts?: R2PutOptions) {
      const meta = (opts?.httpMetadata as { contentType?: string } | undefined)?.contentType;
      store.set(key, { data: value, contentType: meta, uploaded: new Date() });
      return {} as R2Object;
    },
    async head(key: string) {
      return store.has(key) ? ({} as R2Object) : null;
    },
    /* Enough of the real shape for the upload budget: prefix filter and
       an `uploaded` date per object (D13) */
    async list(opts?: R2ListOptions) {
      const prefix = opts?.prefix ?? "";
      return {
        objects: [...store.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, o]) => ({ key, uploaded: o.uploaded }) as R2Object),
        truncated: false,
      } as unknown as R2Objects;
    },
    async get(key: string) {
      const object = store.get(key);
      if (!object) return null;
      return {
        body: new Blob([object.data as BlobPart]).stream(),
        httpMetadata: { contentType: object.contentType },
      } as unknown as R2ObjectBody;
    },
  } as unknown as R2Bucket;
}

/* Consta config is env (a secret + a var CI injects); tests carry it
   themselves so the suite never depends on .dev.vars */
const testEnv = {
  ...env,
  PROOFS: fakeProofs(),
  CONSTA_BASE_URL: CONSTA_ORIGIN,
  CONSTA_API_KEY: "ck_test",
} as typeof env & Bindings;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const consta = () => fetchMock.get(CONSTA_ORIGIN);
const json = (body: unknown) => [
  200,
  JSON.stringify(body),
  { headers: { "Content-Type": "application/json" } },
] as const;

const wisphubCustomer = (estado = "Suspendido") => ({
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely",
  estado,
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  zona: { id: 71342, nombre: "Zona dia 15" },
});

function mockCustomerLookup(results: unknown[], times = 1) {
  wh()
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario="),
    })
    .reply(...json({ count: results.length, results }))
    .times(times);
}

function mockPendingInvoices(
  results: { id_factura: number; cliente: { usuario: string } }[] = [
    { id_factura: 42, cliente: { usuario: "greyes@wifiplus" } },
  ],
  times = 1,
) {
  wh()
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1"),
    })
    .reply(...json({ next: null, count: results.length, results }))
    .times(times);
}

/* The reconnection the confirmed payment triggers (D6): auto-activate →
   payment methods → pay the resolved invoice → verify. */
function mockReconnection(verifyEstado = "Activo", invoiceId = 42) {
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
    .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  wh()
    .intercept({ method: "POST", path: `/api/facturas/${invoiceId}/registrar-pago/` })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
  mockCustomerLookup([wisphubCustomer(verifyEstado)]);
}

type ConstaData = {
  status?: "valid" | "pending" | "invalid";
  alreadyValidated?: boolean;
  cep?: Record<string, unknown> | undefined;
};

/* Intercepts POST /validate and captures the request body for the
   assertions on what actually traveled to Consta. */
function mockConsta(data: ConstaData = {}) {
  const captured: { body?: Record<string, unknown> } = {};
  consta()
    .intercept({
      method: "POST",
      path: "/validate",
      body: (raw) => {
        captured.body = JSON.parse(String(raw));
        return true;
      },
    })
    .reply(
      ...json({
        success: true,
        data: {
          validationId: "v-1",
          status: "valid",
          alreadyValidated: false,
          cep: {
            trackingKey: "TRACK001XYZ",
            amountCents: 51400,
            date: new Date().toISOString().slice(0, 10),
            senderBank: "NUBANK",
            senderName: "JANELY REYES",
            receiverBank: "STP",
            beneficiaryName: "WifiPlus SA de CV",
          },
          ...data,
        },
      }),
    );
  return captured;
}

const SPEI_CONFIG = {
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "WifiPlus SA de CV",
};

async function seedLinkedIsp(overrides: Parameters<typeof seedIsp>[0] = {}) {
  const isp = await seedIsp({
    wisphubApiKey: "wh-key-1",
    serviceFeeCents: 1500,
    storeCommissionCents: 900,
    ...SPEI_CONFIG,
    ...overrides,
  });
  const [link] = await drizzle(env.DB)
    .insert(paymentLinks)
    .values({
      ispId: isp.id,
      token: "tok2345abcdefgh2",
      wisphubCustomerId: "6",
      customerUsuario: "greyes@wifiplus",
    })
    .returning();
  return { isp, link };
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const TRANSFER = {
  transfer: { trackingKey: "TRACK001XYZ", senderBank: "NUBANK", date: "2026-08-17" },
};

async function payTransfer(token = "tok2345abcdefgh2", body: unknown = TRANSFER) {
  return (await app()).request(`/direct-payments/links/${token}/pay`, post(body), testEnv);
}

describe("US-D01: the link answers with the live debt", () => {
  it("scenario 1: debt → total, SPEI instructions with the ISP's account", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();

    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("debt");
    expect(data.customerName).toBe("Janely");
    expect(data.monthlyFeeCents).toBe(49900);
    expect(data.serviceFeeCents).toBe(1500);
    expect(data.totalCents).toBe(51400);
    expect(data.speiClabe).toBe(SPEI_CONFIG.speiClabe);
    expect(data.speiBeneficiaryName).toBe(SPEI_CONFIG.speiBeneficiaryName);
  });

  it("uses the SPEI fee when configured (D3)", async () => {
    await seedLinkedIsp({ speiServiceFeeCents: 800 });
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();

    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.serviceFeeCents).toBe(800);
    expect(data.totalCents).toBe(50700);
  });

  it("scenario 2: no debt → sin adeudo, no SPEI data", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices([]);

    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.status).toBe("no_debt");
    expect(data.speiClabe).toBeUndefined();
    expect(data.totalCents).toBeUndefined();
  });

  it("scenario 3: unknown token → 404", async () => {
    await seedLinkedIsp();
    const res = await (await app()).request("/direct-payments/links/nope", {}, testEnv);
    expect(res.status).toBe(404);
  });

  it("scenario 23: ISP without SPEI → unavailable, no WispHub call", async () => {
    await seedLinkedIsp({ speiClabe: null, speiBank: null, speiBeneficiaryName: null });
    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.status).toBe("unavailable");
  });
});

describe("US-D02: submitting proof", () => {
  it("scenario 4: ISP without SPEI → SPEI_NOT_CONFIGURED on pay", async () => {
    await seedLinkedIsp({ speiClabe: null });
    const res = await payTransfer();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("SPEI_NOT_CONFIGURED");
  });

  it("scenario 6: transfer door — amount and beneficiary are server-supplied", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockConsta({ status: "pending", cep: undefined });

    const res = await payTransfer();
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("validating");

    const sent = captured.body!.transfer as Record<string, unknown>;
    expect(sent.trackingKey).toBe("TRACK001XYZ");
    expect(sent.amountCents).toBe(51400);
    expect(sent.beneficiary).toEqual({
      bank: "STP",
      clabe: SPEI_CONFIG.speiClabe,
      name: SPEI_CONFIG.speiBeneficiaryName,
    });

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.proofMode).toBe("transfer");
  });

  it("scenario 5: receipt door — upload lands in R2, Consta gets a signed URL", async () => {
    const { link } = await seedLinkedIsp();

    const form = new FormData();
    form.append("file", new File([new Uint8Array(1024)], "cep.png", { type: "image/png" }));
    const up = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/proof",
      { method: "POST", body: form },
      testEnv,
    );
    expect(up.status).toBe(200);
    const { data: upload } = await up.json();
    expect(upload.proofId.startsWith(`${link.id}/`)).toBe(true);
    expect(await testEnv.PROOFS.head(upload.proofId)).not.toBeNull();

    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockConsta({ status: "pending", cep: undefined });
    const res = await payTransfer("tok2345abcdefgh2", { proofId: upload.proofId });
    expect(res.status).toBe(201);
    expect(String(captured.body!.receiptUrl)).toContain(
      `/direct-payments/proofs/${upload.proofId}`,
    );

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.proofMode).toBe("receipt");
    expect(row.proofKey).toBe(upload.proofId);
  });

  it("rejects oversized and unreadable proofs (D12)", async () => {
    await seedLinkedIsp();
    const big = new FormData();
    big.append("file", new File([new Uint8Array(1_000_001)], "cep.png", { type: "image/png" }));
    const tooBig = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/proof",
      { method: "POST", body: big },
      testEnv,
    );
    expect(tooBig.status).toBe(413);

    /* Not "not an image": the door is what the provider can read, and a
       zip is not it */
    const zip = new FormData();
    zip.append("file", new File([new Uint8Array(10)], "cep.zip", { type: "application/zip" }));
    const unsupported = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/proof",
      { method: "POST", body: zip },
      testEnv,
    );
    expect(unsupported.status).toBe(415);
    expect((await unsupported.json()).error.code).toBe("PROOF_UNSUPPORTED_TYPE");
  });

  it("accepts a PDF comprobante — apiCEP reads them and banks issue them (D12)", async () => {
    const { link } = await seedLinkedIsp();
    const form = new FormData();
    form.append("file", new File([new Uint8Array(64)], "cep.pdf", { type: "application/pdf" }));
    const up = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/proof",
      { method: "POST", body: form },
      testEnv,
    );
    expect(up.status).toBe(200);
    const { data } = await up.json();
    expect(data.proofId.startsWith(`${link.id}/`)).toBe(true);

    /* And it survives the whole way: the pay path must not re-filter on
       image types and strand a proof it already accepted */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    const res = await payTransfer("tok2345abcdefgh2", { proofId: data.proofId });
    expect(res.status).toBe(201);
  });

  it("scenario 22: the sixth submission in an hour → 429, no provider call", async () => {
    const { isp, link } = await seedLinkedIsp();
    const db = drizzle(env.DB);
    for (let i = 0; i < 5; i++) {
      await db.insert(directPayments).values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        monthlyFeeCents: 49900,
        serviceFeeCents: 1500,
        status: "invalid",
        proofMode: "transfer",
      });
    }
    const res = await payTransfer();
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("TOO_MANY_ATTEMPTS");

    /* an exhausted pay budget also closes the upload door (D13) */
    const form = new FormData();
    form.append("file", new File([new Uint8Array(10)], "cep.png", { type: "image/png" }));
    const up = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/proof",
      { method: "POST", body: form },
      testEnv,
    );
    expect(up.status).toBe(429);
  });

  it("D13: uploads have their own hourly cap, with no submission behind them", async () => {
    await seedLinkedIsp();
    const upload = async () => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(10)], "cep.png", { type: "image/png" }));
      return (await app()).request(
        "/direct-payments/links/tok2345abcdefgh2/proof",
        { method: "POST", body: form },
        testEnv,
      );
    };

    /* Never submitting is the whole point: the pay budget counts
       `direct_payments` rows, and an upload creates none — so before
       this cap existed, a leaked link could fill R2 forever. */
    for (let i = 0; i < UPLOAD_HOURLY_BUDGET; i++) {
      expect((await upload()).status).toBe(200);
    }
    expect(await drizzle(env.DB).select().from(directPayments)).toHaveLength(0);

    const overBudget = await upload();
    expect(overBudget.status).toBe(429);
    expect((await overBudget.json()).error.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("NOTHING_DUE when the customer owes nothing at submission", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices([], 1);
    const res = await payTransfer();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("NOTHING_DUE");
  });
});

describe("US-D03: a valid transfer becomes a charge and reconnects", () => {
  it("scenario 7 + 21: confirmed → spei charge, no store, no ledger entries", async () => {
    const { isp } = await seedLinkedIsp();
    /* pay pre-check + validation debt re-check + reconnection verify */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta();
    mockReconnection("Activo");

    const res = await payTransfer();
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");
    expect(data.error).toBeNull();

    const db = drizzle(env.DB);
    const [payment] = await db.select().from(directPayments);
    expect(payment.status).toBe("confirmed");
    expect(payment.chargeId).not.toBeNull();

    const [charge] = await db.select().from(charges);
    expect(charge.channel).toBe("spei");
    expect(charge.storeId).toBeNull();
    expect(charge.totalCents).toBe(51400);
    expect(charge.reconnectionStatus).toBe("reconnected");
    /* D6: no commission, no store balance — nothing in the ledger */
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);

    /* scenario 21 (US-L01 interplay): the full service fee accrues to
       the platform's settlement — no commission to subtract */
    const asIsp = { headers: { Cookie: await sessionCookieHeader(isp.email) } };
    const settlement = await (await app()).request("/settlement", asIsp, testEnv);
    const { data: s } = await settlement.json();
    expect(s.months[0].shareCents).toBe(1500);
    expect(s.months[0].chargeCount).toBe(1);
  });

  it("scenario 12: a queued spei charge rides the reconnection sweep", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta();
    /* WispHub pays but the service has not flipped yet */
    mockReconnection("Suspendido");

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");
    const db = drizzle(env.DB);
    let [charge] = await db.select().from(charges);
    expect(charge.reconnectionStatus).toBe("queued");
    expect(charge.nextAttemptAt).not.toBeNull();

    /* the sweep re-verifies: payment already registered, service now up */
    mockCustomerLookup([wisphubCustomer("Activo")], 1);
    await sweepReconnections(testEnv, new Date(Date.now() + 5 * 60 * 1000));
    [charge] = await db.select().from(charges);
    expect(charge.reconnectionStatus).toBe("reconnected");
  });

  it("scenario 24: two months due → pays the oldest, then the next shows", async () => {
    await seedLinkedIsp();
    const twoInvoices = [
      { id_factura: 42, cliente: { usuario: "greyes@wifiplus" } },
      { id_factura: 41, cliente: { usuario: "greyes@wifiplus" } },
    ];
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(twoInvoices, 2);
    mockConsta();
    /* oldest first (D15): invoice 41, not 42 */
    mockReconnection("Activo", 41);

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");

    /* the page re-reads: one invoice left → still debt */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices([twoInvoices[0]], 1);
    const again = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data: link } = await again.json();
    expect(link.status).toBe("debt");
  });
});

describe("US-D04: pending CEPs re-validate, never a false rejection", () => {
  it("scenario 8: pending → validating, first D7 slot (+2 min)", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("validating");

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.status).toBe("validating");
    expect(row.constaStatus).toBe("pending");
    expect(row.validationAttempts).toBe(1);
    expect(row.nextValidationAt!.getTime() - row.createdAt.getTime()).toBe(2 * 60 * 1000);
  });

  it("scenario 9: the sweep picks it up and Consta now says valid", async () => {
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        monthlyFeeCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        constaStatus: "pending",
        validationAttempts: 1,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 2 * 60 * 1000),
      })
      .returning();

    mockConsta();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");

    const report = await sweepDirectPayments(testEnv, now);
    expect(report).toMatchObject({ claimed: 1, confirmed: 1 });
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.status).toBe("confirmed");
    expect(row.chargeId).not.toBeNull();

    /* US-D03: the page polls the status and sees the green moment */
    const status = await (await app()).request(`/direct-payments/${payment.id}/status`, {}, testEnv);
    const { data } = await status.json();
    expect(data.status).toBe("confirmed");
    expect(data.reconnectionStatus).toBe("reconnected");
    expect(data.folio).toMatch(/^DV-[0-9A-Z]{6}$/);
  });

  it("scenario 10: still pending past 6 h → expired", async () => {
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        monthlyFeeCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        constaStatus: "pending",
        validationAttempts: 6,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000),
      })
      .returning();

    mockConsta({ status: "pending", cep: undefined });
    const report = await sweepDirectPayments(testEnv, now);
    expect(report.expired).toBe(1);
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.status).toBe("expired");
    expect(row.nextValidationAt).toBeNull();
  });
});

describe("D8: one transfer pays once", () => {
  it("scenario 11: alreadyValidated with no local record → rejected, no charge", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ alreadyValidated: true });

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("invalid");
    expect(data.error).toBe("TRANSFER_ALREADY_USED");
    expect(await drizzle(env.DB).select().from(charges)).toHaveLength(0);
  });

  it("scenario 18: a second submission of the same transfer dies at the index", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    const first = await payTransfer();
    expect(first.status).toBe(201);

    /* same tracking key while the first is still alive: no WispHub
       call, no Consta call — the database refuses */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const second = await payTransfer();
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("TRANSFER_ALREADY_USED");
    expect(await drizzle(env.DB).select().from(directPayments)).toHaveLength(1);
  });

  it("scenario 19: a re-validation of the same row ignores the replay flag", async () => {
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        monthlyFeeCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        /* our own earlier attempt got a verdict — carve-out (a) */
        constaStatus: "pending",
        validationAttempts: 1,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 8 * 60 * 1000),
      })
      .returning();

    mockConsta({ alreadyValidated: true });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");

    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.status).toBe("confirmed");
  });
});

describe("D11: valid is necessary, not sufficient", () => {
  it("scenario 16: a real $1 receipt → AMOUNT_MISMATCH, no charge", async () => {
    const { link } = await seedLinkedIsp();
    await testEnv.PROOFS.put(`${link.id}/proof-1`, new Uint8Array(10));
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({
      cep: {
        trackingKey: "OTHERKEY99",
        amountCents: 100,
        date: new Date().toISOString().slice(0, 10),
      },
    });

    const res = await payTransfer("tok2345abcdefgh2", { proofId: `${link.id}/proof-1` });
    const { data } = await res.json();
    expect(data.status).toBe("invalid");
    expect(data.error).toBe("AMOUNT_MISMATCH");
    expect(await drizzle(env.DB).select().from(charges)).toHaveLength(0);
  });

  it("scenario 17: a CEP older than 30 days → STALE_TRANSFER", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    mockConsta({ cep: { trackingKey: "TRACK001XYZ", amountCents: 51400, date: old } });

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("invalid");
    expect(data.error).toBe("STALE_TRANSFER");
  });
});

describe("D14: a validated transfer with nothing left to pay", () => {
  it("scenario 20: paid at a store meanwhile → unapplied, no charge", async () => {
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        monthlyFeeCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        constaStatus: "pending",
        validationAttempts: 1,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 2 * 60 * 1000),
      })
      .returning();

    mockConsta();
    /* debt settled at a store while the CEP was pending */
    mockCustomerLookup([{ ...wisphubCustomer(), estado_facturas: "Pagadas" }], 1);
    mockPendingInvoices([], 1);

    const report = await sweepDirectPayments(testEnv, now);
    expect(report.unapplied).toBe(1);
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.status).toBe("unapplied");
    expect(row.chargeId).toBeNull();
    expect(await db.select().from(charges)).toHaveLength(0);
  });
});

describe("D12: proofs are private", () => {
  it("serves a proof only under a live signature", async () => {
    const { link } = await seedLinkedIsp();
    const key = `${link.id}/proof-1`;
    await testEnv.PROOFS.put(key, new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "image/png" },
    });

    const bare = await (await app()).request(`/direct-payments/proofs/${key}`, {}, testEnv);
    expect(bare.status).toBe(404);

    const signed = await signedProofUrl(testEnv, key, new Date());
    const path = signed.slice(signed.indexOf("/direct-payments"));
    const ok = await (await app()).request(path, {}, testEnv);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/png");
  });
});

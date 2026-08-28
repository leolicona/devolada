import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { charges, directPayments, ledgerEntries, paymentLinks, proofRejections } from "../src/db/schema";
import { sweepDirectPayments } from "../src/direct-payments/validation";
import { sweepReconnections } from "../src/reconnection/queue";
import { signedProofUrl, UPLOAD_HOURLY_BUDGET } from "../src/direct-payments/proofs";
import { customerRefFor } from "../src/consta/refs";
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
  /* provisional-release D4: with the secret set, every Consta call in
     this suite carries the opaque refs — extra fields the older
     assertions never look at, exactly like production */
  CUSTOMER_REF_SECRET: "test-ref-secret",
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
  saldo: "0.00",
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
  results: { id_factura: number; cliente: { usuario: string }; total: number }[] = [
    { id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 },
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
/* `verify: false` is the partial-payment D5 path: with `accion: 0` there
   is no router work and nothing to verify, so no second customer read
   happens — and the response carries `task_id: null` rather than an id. */
function mockReconnection(verifyEstado = "Activo", invoiceId = 42, verify = true) {
  const captured: { accion?: number; totalCobrado?: number } = {};
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
    .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  wh()
    .intercept({
      method: "POST",
      path: `/api/facturas/${invoiceId}/registrar-pago/`,
      body: (raw) => {
        const b = JSON.parse(String(raw));
        captured.accion = b.accion;
        captured.totalCobrado = b.total_cobrado;
        return true;
      },
    })
    .reply(
      ...json({
        messages: ["Se agrego correctamente el pago"],
        task_id: verify ? "t-1" : null,
      }),
    );
  if (verify) mockCustomerLookup([wisphubCustomer(verifyEstado)]);
  return captured;
}

type ConstaData = {
  status?: "valid" | "pending" | "invalid";
  reason?: "contradicted" | "not_found";
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
    expect(data.invoiceCents).toBe(49900);
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

  it("scenario 2 (debt-truth US-C08): a carried balance is a debt the page can see", async () => {
    /* The state a short payment leaves behind: the invoice closed as
       "Pagada", the pending list is empty, and the remainder lives in
       `saldo`. Before debt-truth D7 this page answered "Sin adeudo" to
       somebody who owed money and could not pay it. */
    await seedLinkedIsp();
    mockCustomerLookup([
      { ...wisphubCustomer(), estado_facturas: "Pagadas", saldo: "150.00" },
    ]);
    mockPendingInvoices([]);

    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.status).toBe("debt");
    expect(data.invoiceCents).toBe(0);
    expect(data.carriedBalanceCents).toBe(15000);
    expect(data.totalCents).toBe(15000 + 1500);
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

  it("scenario 35: an ISP whose bank is outside the vocabulary is unavailable too (BUG-008)", async () => {
    /* Found live on dev 2026-08-19: an ISP held `Klar` where apiCEP's list
       says `KLAR`. Every field was set, so the channel looked configured and
       took money it could never validate — and failed *retryably*, which is
       the six-hour silence rather than an honest refusal. D16 fixed the form;
       nothing checked the value already in the database. */
    await seedLinkedIsp({ speiBank: "Klar" });
    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.status).toBe("unavailable");
    /* No WispHub call: D4 decides before the lookup */
  });

  it("scenario 35: the exact spelling keeps the channel open", async () => {
    await seedLinkedIsp({ speiBank: "KLAR" });
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.status).toBe("debt");
    expect(data.speiBank).toBe("KLAR");
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
        invoiceCents: 49900,
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

describe("D16: what cannot validate never reaches the paid provider", () => {
  /* Measured 2026-08-19: apiCEP does not reject an unknown bank name — it
     answers `invalid` with no cepDetails, byte-identical to a transfer that
     never happened. A payer who really paid was told their transfer could not
     be verified, and nothing on the wire said why (BUG-007). The form now
     offers a list; these are the guards behind it.

     The refusals register no WispHub or Consta mock on purpose: with net
     connect disabled, a request that got past validation could not have
     answered 400, so "no paid call" is asserted by the absence itself. */

  it("US-D02: a bank name outside the vocabulary is refused, before WispHub or the provider", async () => {
    await seedLinkedIsp();

    /* The three names the old placeholder taught the payer to type. apiCEP
       spells them NUBANK, BBVA MEXICO and BANORTE. */
    for (const senderBank of ["Nu", "BBVA", "Banorte"]) {
      const res = await payTransfer("tok2345abcdefgh2", {
        transfer: { ...TRANSFER.transfer, senderBank },
      });
      expect(res.status).toBe(400);
    }

    expect(await drizzle(env.DB).select().from(directPayments)).toHaveLength(0);
  });

  it("US-D02: the exact spelling apiCEP accepts does get through", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });

    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TRANSFER.transfer, senderBank: "BBVA MEXICO" },
    });
    expect(res.status).toBe(201);
    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.senderBank).toBe("BBVA MEXICO");
  });

  it("BUG-006: a tracking key carrying a receipt's two-line wrap is refused", async () => {
    await seedLinkedIsp();

    /* The first one is the live failure: 29 characters, a space, and a
       Cyrillic З where a 3 belongs. It used to pass, spend $0.25 and land
       `invalid`. */
    for (const trackingKey of [
      "NU3AGKK16AH58LTOVUQH55PE З0AA",
      "NU3AGIFAMA9D9CNQ V487MGAVDE2C",
      "NU3AGIFAMA9D9CNQ\nV487MGAVDE2C",
      "SHORT",
    ]) {
      const res = await payTransfer("tok2345abcdefgh2", {
        transfer: { ...TRANSFER.transfer, trackingKey },
      });
      expect(res.status).toBe(400);
    }

    expect(await drizzle(env.DB).select().from(directPayments)).toHaveLength(0);
  });

  it("BUG-006: a ten-character key is accepted — the bound is a range, not Nu's 28", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });

    /* apiCEP's own documented example. A fixed 28 would lock out every bank
       that issues a shorter clave. */
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TRANSFER.transfer, senderBank: "HSBC", trackingKey: "HSBC712057" },
    });
    expect(res.status).toBe(201);
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

  it("scenario 24: two months due → one debt, one payment, nothing left (D21)", async () => {
    await seedLinkedIsp();
    const twoInvoices = [
      { id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 },
      { id_factura: 41, cliente: { usuario: "greyes@wifiplus" }, total: 499 },
    ];
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(twoInvoices, 2);
    /* D21 replaces D15: WispHub applies a payment to the customer, not to
       the invoice, so the page asks for both months at once — 998 + the
       15.00 fee. Asking for one of them would have asked for a number
       that reconnects nobody. */
    mockConsta({
      cep: {
        trackingKey: "TRACK001XYZ",
        amountCents: 101300,
        date: new Date().toISOString().slice(0, 10),
        senderBank: "NUBANK",
        senderName: "JANELY REYES",
        receiverBank: "STP",
        beneficiaryName: "WifiPlus SA de CV",
      },
    });
    /* The payment is registered against the oldest invoice and settles the
       whole running account (debt-truth D15) */
    mockReconnection("Activo", 41);

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");

    const [charge] = await drizzle(env.DB).select().from(charges);
    expect(charge.invoiceCents).toBe(99800);
    expect(charge.totalCents).toBe(101300);

    /* both months settled: the page now says there is nothing to pay */
    mockCustomerLookup([wisphubCustomer("Activo")], 1);
    mockPendingInvoices([], 1);
    const again = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data: link } = await again.json();
    expect(link.status).toBe("no_debt");
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
        invoiceCents: 49900,
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
        invoiceCents: 49900,
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

/* BUG-003 / D17: what happens when Consta cannot find the transfer.
   Found live on dev across two customers and three receipts: a real
   payment, exact amount, declared `invalid` and dead on the first try. */
describe("D17: a not-found is not a refusal", () => {
  it("scenario 36: `invalid` with reason not_found keeps the payment alive on the schedule", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "invalid", reason: "not_found", cep: undefined });

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("validating");
    expect(data.error).toBe("TRANSFER_NOT_FOUND");

    const db = drizzle(env.DB);
    const [row] = await db.select().from(directPayments);
    expect(row.status).toBe("validating");
    expect(row.lastError).toBe("TRANSFER_NOT_FOUND");
    /* The point of the fix: another attempt is booked, not skipped */
    expect(row.nextValidationAt).not.toBeNull();
    expect(await db.select().from(charges)).toHaveLength(0);
  });

  it("scenario 37: the CEP that appears late is caught by the very next sweep", async () => {
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        constaStatus: "invalid",
        lastError: "TRANSFER_NOT_FOUND",
        validationAttempts: 1,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 8 * 60 * 1000),
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
    expect(row.lastError).toBeNull();
  });

  it("scenario 38 (US-D12): not_found at the end of the schedule earns the late slot, not expiry", async () => {
    /* validation-status-ux D4 amends this scenario: the 6-hour wall now
       buys one last attempt at T+12h before the payment expires — one
       credit for the bank that releases a held transfer next morning. */
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        constaStatus: "invalid",
        validationAttempts: 6,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000),
      })
      .returning();

    mockConsta({ status: "invalid", reason: "not_found", cep: undefined });
    const report = await sweepDirectPayments(testEnv, now);
    expect(report.stillValidating).toBe(1);
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.status).toBe("validating");
    expect(row.lastError).toBe("TRANSFER_NOT_FOUND");
    expect(row.nextValidationAt?.getTime()).toBe(
      payment.createdAt.getTime() + 720 * 60 * 1000,
    );

    /* US-D12 D5: the page is told WHEN the late attempt runs, so it can
       promise an hour instead of news on a channel that does not exist */
    const status = await (await app()).request(`/direct-payments/${payment.id}/status`, {}, testEnv);
    const { data } = await status.json();
    expect(data.status).toBe("validating");
    expect(data.error).toBe("TRANSFER_NOT_FOUND");
    expect(data.nextValidationAt).toBe(row.nextValidationAt?.getTime());
  });

  it("scenario 39: `invalid` with reason contradicted is still terminal, on the first attempt", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "invalid", reason: "contradicted", cep: undefined });

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("invalid");
    expect(data.error).toBe("TRANSFER_CONTRADICTED");

    const db = drizzle(env.DB);
    const [row] = await db.select().from(directPayments);
    expect(row.nextValidationAt).toBeNull();
    expect(await db.select().from(charges)).toHaveLength(0);
  });

  it("scenario 40: an `invalid` with no reason at all is read as not_found, not as a refusal", async () => {
    /* Fail toward "we do not know": a Consta that predates D11, or one
       that grows a third reason, must never be able to turn silence
       back into an accusation. */
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "invalid", cep: undefined });

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("validating");

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.nextValidationAt).not.toBeNull();
  });
});

/* docs/direct-payment/validation-status-ux.spec.md (US-D12): the late
   slot (D4/D5) and the own-attempt carve-out across supersede (D8). */
describe("US-D12: the late slot and the own-attempt carve-out", () => {
  type Seed = Partial<typeof directPayments.$inferInsert>;
  const BASE_ROW = {
    amountCents: 51400,
    invoiceCents: 49900,
    serviceFeeCents: 1500,
    proofMode: "transfer",
    trackingKey: "TRACK001XYZ",
    senderBank: "NUBANK",
  } as const;
  async function insertPayment(
    link: { id: string },
    isp: { id: string },
    now: Date,
    over: Seed = {},
  ) {
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        ...BASE_ROW,
        transferDate: new Date().toISOString().slice(0, 10),
        nextValidationAt: new Date(now.getTime() - 1000),
        ...over,
      })
      .returning();
    return payment;
  }

  it("scenario 5: the late attempt still not_found → expired at last; found → the normal confirmation", async () => {
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);

    /* half one: T+12.5h, the 720 slot already ran out too */
    const first = await insertPayment(link, isp, now, {
      constaStatus: "invalid",
      lastError: "TRANSFER_NOT_FOUND",
      validationAttempts: 7,
      createdAt: new Date(now.getTime() - 12.5 * 60 * 60 * 1000),
    });
    mockConsta({ status: "invalid", reason: "not_found", cep: undefined });
    let report = await sweepDirectPayments(testEnv, now);
    expect(report.expired).toBe(1);
    let [row] = await db.select().from(directPayments).where(eq(directPayments.id, first.id));
    expect(row.status).toBe("expired");
    expect(row.lastError).toBe("TRANSFER_NOT_FOUND");

    /* D5: once terminal, the promised hour is gone from the status */
    const status = await (await app()).request(
      `/direct-payments/${first.id}/status`,
      {},
      testEnv,
    );
    const { data } = await status.json();
    expect(data.nextValidationAt).toBeNull();

    /* half two: the CEP the bank released overnight is found at T+12h
       and confirms like any other valid — the slot exists for exactly
       this payment. Same link: the expired row released its claim. */
    await db.delete(directPayments).where(eq(directPayments.id, first.id));
    const second = await insertPayment(link, isp, now, {
      constaStatus: "invalid",
      lastError: "TRANSFER_NOT_FOUND",
      validationAttempts: 7,
      createdAt: new Date(now.getTime() - 12 * 60 * 60 * 1000 - 30 * 1000),
    });
    mockConsta();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    report = await sweepDirectPayments(testEnv, now);
    expect(report).toMatchObject({ claimed: 1, confirmed: 1 });
    [row] = await db.select().from(directPayments).where(eq(directPayments.id, second.id));
    expect(row.status).toBe("confirmed");
  });

  it("scenario 6: a channel failure at the end of the schedule gets no late slot", async () => {
    /* D4: the T+12h attempt is for the transfer Banxico may still
       publish, never for our own outages */
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);
    const payment = await insertPayment(link, isp, now, {
      constaStatus: "pending",
      lastError: "CONSTA_UNAVAILABLE",
      validationAttempts: 6,
      createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000 - 1000),
    });
    consta().intercept({ method: "POST", path: "/validate" }).reply(
      503,
      JSON.stringify({
        success: false,
        error: { code: "PROVIDER_UNAVAILABLE", retryable: true },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
    const report = await sweepDirectPayments(testEnv, now);
    expect(report.expired).toBe(1);
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.status).toBe("expired");
    expect(row.lastError).toBe("CONSTA_UNAVAILABLE");
  });

  it("scenario 11: the replay flag traced through `supersedesId` is the payer's own retry, not a stranger", async () => {
    /* D8: a valid that reached the provider but died locally, then a
       corrected re-submission — the fresh row has zero attempts, and
       the flag must resolve on the verdict's merits anyway */
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);
    const [prior] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        status: "superseded",
        constaStatus: "valid",
        validationAttempts: 2,
        nextValidationAt: null,
      })
      .returning();
    const [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        supersedesId: prior.id,
        nextValidationAt: new Date(now.getTime() - 1000),
      })
      .returning();

    mockConsta({ alreadyValidated: true });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    const report = await sweepDirectPayments(testEnv, now);
    expect(report.confirmed).toBe(1);
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.status).toBe("confirmed");
    expect(row.lastError).toBeNull();
  });

  it("scenario 11b: on the receipt door the trace is the same link holding the same revealed key", async () => {
    /* D8: no supersedesId survives a terminal prior, but the tracking
       key the CEP reveals matches the payer's own dead attempt */
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);
    await db.insert(directPayments).values({
      paymentLinkId: link.id,
      ispId: isp.id,
      amountCents: 51400,
      invoiceCents: 49900,
      serviceFeeCents: 1500,
      proofMode: "transfer",
      trackingKey: "TRACK001XYZ",
      senderBank: "NUBANK",
      transferDate: new Date().toISOString().slice(0, 10),
      status: "expired",
      constaStatus: "valid",
      validationAttempts: 7,
      nextValidationAt: null,
    });
    const [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "receipt",
        proofKey: `${link.id}/proof-r1`,
        nextValidationAt: new Date(now.getTime() - 1000),
      })
      .returning();

    mockConsta({ alreadyValidated: true });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    const report = await sweepDirectPayments(testEnv, now);
    expect(report.confirmed).toBe(1);
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.status).toBe("confirmed");
  });

  it("scenario 12: a chain that never reached the provider does not soften the flag", async () => {
    /* D8 stands: the ancestor was superseded before any call landed, so
       the flag can only mean a validation outside this payment */
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);
    const [prior] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACKOLD9999",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        status: "superseded",
        validationAttempts: 0,
        nextValidationAt: null,
      })
      .returning();
    const [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        supersedesId: prior.id,
        nextValidationAt: new Date(now.getTime() - 1000),
      })
      .returning();

    mockConsta({ alreadyValidated: true });
    const report = await sweepDirectPayments(testEnv, now);
    expect(report.invalid).toBe(1);
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.status).toBe("invalid");
    expect(row.lastError).toBe("TRANSFER_ALREADY_USED");
    expect(await db.select().from(charges)).toHaveLength(0);
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

  it("scenario 18: resubmitting your own live transfer attaches to it (US-D12, D9)", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    const first = await payTransfer();
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.directPaymentId;

    /* Same clave while the first row is still validating: a deterministic
       misread re-uploaded, the payer racing only themselves. No second
       row, no Consta call — the answer is the row they already own. */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const second = await payTransfer();
    expect(second.status).toBe(200);
    const { data } = await second.json();
    expect(data.directPaymentId).toBe(firstId);
    expect(data.status).toBe("validating");
    expect(await drizzle(env.DB).select().from(directPayments)).toHaveLength(1);
  });

  it("scenario 18b: another customer's live clave still refuses at the index (US-D12, D9)", async () => {
    const { isp } = await seedLinkedIsp();
    await drizzle(env.DB)
      .insert(paymentLinks)
      .values({
        ispId: isp.id,
        token: "tok9876zyxwvut99",
        wisphubCustomerId: "7",
        customerUsuario: "otro@wifiplus",
      });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    expect((await payTransfer()).status).toBe(201);

    /* The same clave from a different payment link: the collision pool
       D18 warns about — same ISP, same day, another customer. Refused. */
    mockCustomerLookup([{ ...wisphubCustomer(), id_servicio: 7, usuario: "otro@wifiplus" }], 1);
    mockPendingInvoices([{ id_factura: 43, cliente: { usuario: "otro@wifiplus" }, total: 499 }], 1);
    const second = await payTransfer("tok9876zyxwvut99");
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("TRANSFER_ALREADY_USED");
    expect(await drizzle(env.DB).select().from(directPayments)).toHaveLength(1);
  });

  it("scenario 18d (US-D12 scenario 15): the same clave with different data supersedes the owning row", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    const first = await payTransfer();
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.directPaymentId;

    /* Same clave, corrected date: the payer is fixing the row they
       already own — attaching would discard the correction (found live
       2026-08-26: a stale row kept asking Banxico with the wrong data
       while the payer read "no los actualiza"). */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    const corrected = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TRANSFER.transfer, date: "2026-08-18" },
    });
    expect(corrected.status).toBe(201);
    const rows = await drizzle(env.DB).select().from(directPayments);
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.id === firstId)!;
    expect(old.status).toBe("superseded");
    const fresh = rows.find((r) => r.id !== firstId)!;
    expect(fresh.transferDate).toBe("2026-08-18");
    /* The chain survives, so D8's own-attempt carve-out still traces */
    expect(fresh.supersedesId).toBe(firstId);
  });

  it("scenario 18e (US-D12 scenario 16): a cross-link refusal restores the prior it had released", async () => {
    const { isp } = await seedLinkedIsp();
    await drizzle(env.DB)
      .insert(paymentLinks)
      .values({
        ispId: isp.id,
        token: "tok9876zyxwvut99",
        wisphubCustomerId: "7",
        customerUsuario: "otro@wifiplus",
      });
    /* Another customer's live payment owns clave TRACK002ABC */
    mockCustomerLookup([{ ...wisphubCustomer(), id_servicio: 7, usuario: "otro@wifiplus" }], 1);
    mockPendingInvoices([{ id_factura: 43, cliente: { usuario: "otro@wifiplus" }, total: 499 }], 1);
    mockConsta({ status: "pending", cep: undefined });
    expect(
      (
        await payTransfer("tok9876zyxwvut99", {
          transfer: { ...TRANSFER.transfer, trackingKey: "TRACK002ABC" },
        })
      ).status,
    ).toBe(201);

    /* The payer's own payment, about to be corrected */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    const first = await payTransfer();
    const firstId = (await first.json()).data.directPaymentId;

    /* The correction lands on the other customer's clave: refused — and
       the prior it had released must come back, schedule included */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const collided = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TRANSFER.transfer, trackingKey: "TRACK002ABC" },
      supersedes: firstId,
    });
    expect(collided.status).toBe(409);
    const db = drizzle(env.DB);
    const [prior] = await db.select().from(directPayments).where(eq(directPayments.id, firstId));
    expect(prior.status).toBe("validating");
    expect(prior.nextValidationAt).not.toBeNull();
  });

  it("scenario 18c: a terminal owner on the payer's own link still refuses (US-D12, D9)", async () => {
    const { isp, link } = await seedLinkedIsp();
    await drizzle(env.DB)
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        status: "confirmed",
      });

    /* The transfer already bought something: attaching would show a live
       "Verificando" over a consumed clave. The refusal is honest here. */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const res = await payTransfer();
    expect(res.status).toBe(409);
    const body = await res.json();
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
        invoiceCents: 49900,
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

  /* The 2026-08-18 spike found this live: apiCEP validated the CEP, the
     worker died before recording the verdict, and the honest retry was
     told TRANSFER_ALREADY_USED — for a transfer the customer had really
     made, with the money already in the ISP's account. */
  it("D7: the row is born owned by the sweep, before any verdict exists", async () => {
    const { link } = await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    /* The row has to be inspected while the provider is still thinking —
       once a verdict lands, every path writes a slot and the bug becomes
       invisible. A real validation takes ~15 s, so this window is the
       normal state of things, not an edge case. */
    consta()
      .intercept({ method: "POST", path: "/validate" })
      .reply(...json({ success: true, data: { validationId: "v-1", status: "pending", alreadyValidated: false } }))
      .delay(300);

    const inFlight = payTransfer();

    let row;
    for (let i = 0; i < 60 && !row; i++) {
      await new Promise((r) => setTimeout(r, 10));
      [row] = await drizzle(env.DB).select().from(directPayments);
    }
    expect(row, "the payment row should exist while the provider is still thinking").toBeDefined();
    expect(row!.paymentLinkId).toBe(link.id);
    expect(row!.constaStatus, "no verdict yet — that is the point").toBeNull();
    /* NULL here is what stranded the row live on 2026-08-18:
       sweepDirectPayments selects on isNotNull(nextValidationAt), so a
       row without a slot is invisible to it — never retried, and never
       expired either, because D7's 6-hour window only exists inside the
       sweep. The customer's money had moved and nothing would ever look
       at the payment again. */
    expect(row!.nextValidationAt, "born without a slot: the sweep can never see it").not.toBeNull();

    expect((await inFlight).status).toBe(201);
  });

  it("D8 carve-out (a): a call that never returned still counts as our own attempt", async () => {
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        /* Exactly the stranded row the spike produced: the attempt was
           recorded, the provider answered, and nothing came back to
           write `constaStatus`. Keying the carve-out on the verdict
           instead of the attempt is what made this a false rejection. */
        constaStatus: null,
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
    expect(row.lastError).toBeNull();
  });

  it("the attempt is recorded before the call, so a lost response leaves a trace", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    /* A provider that fails is the closest a test can get to one that
       never answers; both leave through the same catch. */
    consta().intercept({ path: "/validate", method: "POST" }).reply(502, "{}");

    const res = await payTransfer();
    expect(res.status).toBe(201);

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.status).toBe("validating");
    expect(row.constaStatus).toBeNull();
    /* The counter is the marker: written before the call, it is what
       tells the next attempt that a validation may already have landed. */
    expect(row.validationAttempts).toBe(1);
    expect(row.nextValidationAt).not.toBeNull();
  });
});

describe("D11: valid is necessary, not sufficient", () => {
  it("scenario 16 (partial-payment D1): a real $1 transfer is a real $1 payment, not a refusal", async () => {
    /* This asserted AMOUNT_MISMATCH and no charge. The money was already
       in the ISP's account, so the refusal discarded the only record it
       arrived. Now it settles $1 of the debt, earns no reconnection at
       the default threshold, and the ISP can see it. */
    const { link } = await seedLinkedIsp();
    await testEnv.PROOFS.put(`${link.id}/proof-1`, new Uint8Array(10));
    /* twice: the submission checks the debt, and the validation reads it
       again fresh before deciding what the money settles */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta({
      cep: {
        trackingKey: "OTHERKEY99",
        amountCents: 100,
        date: new Date().toISOString().slice(0, 10),
      },
    });
    /* accion 0: the money is registered and the cut stays (D5) */
    const sent = mockReconnection("Suspendido", 42, false);

    const res = await payTransfer("tok2345abcdefgh2", { proofId: `${link.id}/proof-1` });
    const { data } = await res.json();
    expect(data.status).toBe("partial");

    expect(sent.accion).toBe(0);
    expect(sent.totalCobrado).toBe(1);

    const [charge] = await drizzle(env.DB).select().from(charges);
    expect(charge.totalCents).toBe(100);
    expect(charge.reconnectionStatus).toBe("withheld");
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
        invoiceCents: 49900,
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

/* D18: the machine reads, the human confirms, the direct door validates.
   docs/direct-payment/direct-payment.spec.md scenarios 46–49. */
describe("D18: reading a proof so a human can confirm it", () => {
  const READING = {
    extractionId: "ex-1",
    source: "reader",
    isReceipt: true,
    trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
    senderBank: "NUBANK",
    amountCents: 51400,
    date: "2026-08-19",
    receiptStatus: "Aceptada",
    gate: { trackingKey: "ok", senderBank: "ok", amount: "ok" },
  };

  const mockExtract = (data: Record<string, unknown> = {}, status = 200) => {
    const captured: { body?: Record<string, unknown> } = {};
    consta()
      .intercept({
        method: "POST",
        path: "/extract",
        body: (raw) => {
          captured.body = JSON.parse(String(raw));
          return true;
        },
      })
      .reply(...json({ success: true, data: { ...READING, ...data } }, status));
    return captured;
  };

  const readProof = async (proofId: string, token = "tok2345abcdefgh2") =>
    (await app()).request(
      `/direct-payments/links/${token}/read`,
      post({ proofId }),
      testEnv,
    );

  it("scenario 46: the reading comes back with no provider credit spent", async () => {
    const { link } = await seedLinkedIsp();
    await testEnv.PROOFS.put(`${link.id}/proof-1`, new Uint8Array(10));
    const captured = mockExtract();

    const res = await readProof(`${link.id}/proof-1`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.trackingKey).toBe("NU3AGKMP3ASP8QQQ4U8J8F0K1E4K");
    /* Measured: apiCEP filters on `sender.amount`, so the caller needs
       the read amount to refuse a lookup that cannot succeed (D3) */
    expect(data.amountCents).toBe(51400);
    expect(data.senderBank).toBe("NUBANK");
    expect(data.source).toBe("reader");
    /* Consta fetches the image through a signed URL that expires — the
       bucket is never public (D12) */
    expect(String(captured.body?.receiptUrl)).toContain("/direct-payments/proofs/");
    expect(String(captured.body?.receiptUrl)).toContain("sig=");

    /* Reading is not paying: no `direct_payments` row exists yet */
    expect(await drizzle(env.DB).select().from(directPayments)).toHaveLength(0);
  });

  it("scenario 47: a field the gate refused arrives empty, never as a confirmable guess", async () => {
    const { link } = await seedLinkedIsp();
    await testEnv.PROOFS.put(`${link.id}/proof-1`, new Uint8Array(10));
    mockExtract({
      trackingKey: "NU3AGKMP3ASP8QQ4U8J8F0K1E4K",
      senderBank: null,
      gate: { trackingKey: "malformed", senderBank: "unknown", amount: "ok" },
    });

    const res = await readProof(`${link.id}/proof-1`);
    const { data } = await res.json();
    /* A malformed clave is worse than no clave: it looks confirmable,
       and a payer clicking through it spends a paid call to learn
       nothing (`not_found` says the same thing for four causes) */
    expect(data.trackingKey).toBeNull();
    expect(data.senderBank).toBeNull();
    expect(data.gate.trackingKey).toBe("malformed");
  });

  it("scenario 48: a proof from another link is not readable through this one", async () => {
    const { link } = await seedLinkedIsp();
    await testEnv.PROOFS.put("someone-elses-link/proof-1", new Uint8Array(10));

    /* Proofs are token-bound (D12): no cross-link reads, and no provider
       call spent finding out */
    expect((await readProof("someone-elses-link/proof-1")).status).toBe(404);
    /* a key that was never uploaded is indistinguishable from one that
       belongs to somebody else */
    expect((await readProof(`${link.id}/never-uploaded`)).status).toBe(404);
  });

  it("scenario 49: a confirmed reading pays through the transfer door, with the image kept", async () => {
    const { link } = await seedLinkedIsp();
    await testEnv.PROOFS.put(`${link.id}/proof-1`, new Uint8Array(10));
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockConsta({ status: "pending", cep: undefined });

    const res = await payTransfer("tok2345abcdefgh2", {
      proofId: `${link.id}/proof-1`,
      transfer: { trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K", senderBank: "NUBANK", date: "2026-08-19" },
    });
    expect(res.status).toBe(201);

    /* The transfer door is what validates — the door that has not missed
       once — and the receipt never reaches the provider at all */
    expect(captured.body?.transfer).toBeDefined();
    expect(captured.body?.receiptUrl).toBeUndefined();

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.proofMode).toBe("transfer");
    /* The image stays attached: it is the evidence the ISP will want */
    expect(row.proofKey).toBe(`${link.id}/proof-1`);
    expect(row.trackingKey).toBe("NU3AGKMP3ASP8QQQ4U8J8F0K1E4K");
  });
});

/* D18 continued: what a confirmation does to the row that preceded it.
   Scenarios 53–56. */
describe("D18: a correction supersedes, an unchanged confirmation costs nothing", () => {
  async function silentAttempt(transfer: Record<string, string>) {
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "invalid", reason: "not_found", cep: undefined });
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer,
      receiptStatus: "Aceptada",
    });
    const { data } = await res.json();
    return data.directPaymentId as string;
  }

  const READ = {
    trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
    senderBank: "NUBANK",
    date: "2026-08-19",
  };

  it("scenario 53: confirming the same three values keeps the row and spends no second credit", async () => {
    await seedLinkedIsp();
    const db = drizzle(env.DB);
    const first = await silentAttempt(READ);

    /* No wisphub and no consta interceptors registered on purpose: if
       this path spent a call, the test would fail on a missing mock. */
    const res = await payTransfer("tok2345abcdefgh2", { transfer: READ, supersedes: first });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.directPaymentId).toBe(first);

    const rows = await db.select().from(directPayments);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("validating");
    /* the schedule and the attempt count survive untouched */
    expect(rows[0].nextValidationAt).not.toBeNull();
    expect(rows[0].validationAttempts).toBe(1);
  });

  it("scenario 54: a corrected confirmation supersedes the first row and releases its clave", async () => {
    await seedLinkedIsp();
    const db = drizzle(env.DB);
    const first = await silentAttempt(READ);

    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...READ, trackingKey: "HSBC712057" },
      supersedes: first,
    });
    expect(res.status).toBe(201);

    const rows = await db.select().from(directPayments).orderBy(directPayments.createdAt);
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.id === first)!;
    const fresh = rows.find((r) => r.id !== first)!;
    expect(old.status).toBe("superseded");
    /* Released: the misread clave may belong to another customer of the
       same ISP, and D8's index would have blocked a payment they really
       made for six hours */
    expect(old.nextValidationAt).toBeNull();
    expect(fresh.trackingKey).toBe("HSBC712057");
    /* the pair (what was read, what was confirmed) stays recoverable */
    expect(fresh.supersedesId).toBe(first);
  });

  it("scenario 55: a superseded row is not swept and cannot be revived", async () => {
    await seedLinkedIsp();
    const db = drizzle(env.DB);
    const first = await silentAttempt(READ);
    await db
      .update(directPayments)
      .set({ status: "superseded", nextValidationAt: new Date(Date.now() - 1000) })
      .where(eq(directPayments.id, first));

    /* No consta interceptor: the sweep must not touch it */
    const report = await sweepDirectPayments(testEnv, new Date());
    expect(report.claimed).toBe(0);

    /* and it cannot be superseded a second time */
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...READ, trackingKey: "HSBC712057" },
      supersedes: first,
    });
    expect(res.status).toBe(404);
  });

  it("scenario 56: a confirmed payment records who Banxico says sent the money", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    mockConsta();

    await payTransfer();
    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.status).toBe("confirmed");
    /* Recorded and acted on by nothing: people pay for relatives, so a
       mismatch can only ever be a signal for the ISP (D18) */
    expect(row.cepSenderName).toBe("JANELY REYES");
  });

  it("scenario 58 (partial-payment D5): the receipt's amount is what travels to Banxico", async () => {
    /* This asserted a 409 and no row. The reasoning was right — a lookup
       asking with the expected amount could only come back faceless —
       and the conclusion was wrong: the fix is to ask with the amount the
       receipt actually shows, which is the transfer the payer made. */
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockConsta({ status: "pending", cep: undefined });

    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: READ,
      receiptAmountCents: 30000,
    });
    expect(res.status).toBe(201);
    const sent = captured.body as { transfer: { amountCents: number } };
    expect(sent.transfer.amountCents).toBe(30000);

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.claimedAmountCents).toBe(30000);
  });

  it("scenario 58b: the matching amount goes through, and omitting it changes nothing", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });

    /* 49900 + 1500 — the debt this seed produces */
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: READ,
      receiptAmountCents: 51400,
    });
    expect(res.status).toBe(201);
    /* It never decides what is charged: that is still computed here from
       a fresh WispHub read, so omitting the field cannot buy a cheaper
       payment — it only forfeits the instant answer. */
    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.amountCents).toBe(51400);
  });

  it("a supersedes pointing at another link's payment is refused", async () => {
    await seedLinkedIsp();
    const first = await silentAttempt(READ);
    const db = drizzle(env.DB);
    /* re-home the row on a link this token does not own */
    const [otherLink] = await db
      .insert(paymentLinks)
      .values({
        ispId: (await db.select().from(directPayments))[0].ispId,
        token: "tok9999zzzzzzzz9",
        wisphubCustomerId: "7",
        customerUsuario: "otro@wifiplus",
      })
      .returning();
    await db
      .update(directPayments)
      .set({ paymentLinkId: otherLink.id })
      .where(eq(directPayments.id, first));

    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...READ, trackingKey: "HSBC712057" },
      supersedes: first,
    });
    expect(res.status).toBe(404);
  });
});

/* TD-015 — the demo verdict. Temporary: deleted with the debt entry.
   Written as tests and not as a switch somebody remembers, because the
   second one below is the whole safety argument. */
describe("TD-015: a named link can be confirmed without Banxico (US-D03)", () => {
  const demoEnv = { ...testEnv, DEMO_LINK_TOKENS: "tok2345abcdefgh2" };

  async function payOnDemoLink(env: typeof testEnv) {
    return (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/pay",
      post(TRANSFER),
      env,
    );
  }

  it("the demo link confirms with no provider call at all", async () => {
    await seedLinkedIsp();
    /* pay pre-check + validation debt re-check + reconnection verify —
       the same WispHub traffic a real confirmation makes. No Consta
       interceptor: `assertNoPendingInterceptors` would not catch a call
       that never happens, but `disableNetConnect` fails the test if one
       does. That is the assertion. */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockReconnection("Activo");

    const res = await payOnDemoLink(demoEnv);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");

    const db = drizzle(env.DB);
    const [payment] = await db.select().from(directPayments);
    expect(payment.status).toBe("confirmed");
    expect(payment.constaValidationId?.startsWith("demo-")).toBe(true);
    /* The row says what it is, to anybody who reads it later */
    expect(payment.cepSenderName).toBe("PAGO SIMULADO (DEMO)");

    /* Everything downstream is real: charge, folio, reconnection */
    const [charge] = await db.select().from(charges);
    expect(charge.channel).toBe("spei");
    expect(charge.totalCents).toBe(51400);
    expect(charge.reconnectionStatus).toBe("reconnected");
  });

  it("the same token in prod goes to the provider like any other payment", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    /* Consumed or the afterEach fails: prod must reach Consta */
    mockConsta({ status: "pending", cep: undefined });

    const res = await payOnDemoLink({ ...demoEnv, ENVIRONMENT: "prod" });
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe("validating");
  });

  it("an unlisted link on dev is untouched by the allow-list", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });

    const res = await payOnDemoLink({ ...testEnv, DEMO_LINK_TOKENS: "some-other-token" });
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe("validating");
  });

  it("a provider refusal is still a refusal on a demo link — no failure ever becomes a success", async () => {
    /* The rule this whole file exists to protect: the demo verdict is
       decided in advance by configuration, never by something going
       wrong. With the allow-list empty, a contradicted CEP is invalid,
       exactly as D17 says. */
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "invalid", reason: "contradicted", cep: undefined });

    const res = await payOnDemoLink({ ...testEnv, DEMO_LINK_TOKENS: "" });
    const { data } = await res.json();
    expect(data.status).toBe("invalid");
    expect(data.error).toBe("TRANSFER_CONTRADICTED");
  });
});

/* docs/direct-payment/partial-payment.spec.md scenarios 1–7 — US-D10.
   A short transfer used to be refused with no row written, while the
   money was already in the ISP's account. */
describe("US-D10: a transfer that falls short", () => {
  const SHORT = { ...TRANSFER };

  /* The seed owes 49900 and charges a 1500 fee, so 51400 is the whole
     ask and the ISP's own debt is 49900. */
  function shortCep(amountCents: number) {
    return {
      cep: {
        trackingKey: "TRACK001XYZ",
        amountCents,
        date: new Date().toISOString().slice(0, 10),
        senderBank: "NUBANK",
        senderName: "JANELY REYES",
        receiverBank: "STP",
        beneficiaryName: "WifiPlus SA de CV",
      },
    };
  }

  it("scenario 1: below the threshold → partial, accion 0, the cut stays, a charge exists", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta(shortCep(30000));
    const sent = mockReconnection("Suspendido", 42, false);

    const res = await payTransfer("tok2345abcdefgh2", SHORT);
    const { data } = await res.json();
    expect(data.status).toBe("partial");
    /* D5: the money is registered either way — only the router is left
       alone. Devolada's fee takes nothing, because the ISP is paid first. */
    expect(sent.accion).toBe(0);
    expect(sent.totalCobrado).toBe(300);

    const [charge] = await drizzle(env.DB).select().from(charges);
    expect(charge.totalCents).toBe(30000);
    /* D14: the whole fee accrues even though the payer covered none of
       it. The money reached the ISP's bank, so the ISP owes it onward —
       the commission is never forgiven. */
    expect(charge.serviceFeeCents).toBe(1500);
    expect(charge.reconnectionStatus).toBe("withheld");

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.receivedCents).toBe(30000);
  });

  it("scenario 2: the same transfer with a lenient threshold → accion 1, still partial", async () => {
    /* D6: `partial` is about the debt, not the router. A payment can
       reconnect and still leave a balance. */
    await seedLinkedIsp({ reconnectionThresholdPercent: 60 });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta(shortCep(30000));
    const sent = mockReconnection("Activo", 42);

    const res = await payTransfer("tok2345abcdefgh2", SHORT);
    const { data } = await res.json();
    expect(data.status).toBe("partial");
    expect(sent.accion).toBe(1);
    const [charge] = await drizzle(env.DB).select().from(charges);
    expect(charge.reconnectionStatus).toBe("reconnected");
  });

  it("scenario 3: over the percentage but under the floor → still withheld", async () => {
    await seedLinkedIsp({ reconnectionThresholdPercent: 60, reconnectionFloorCents: 40000 });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta(shortCep(30000));
    const sent = mockReconnection("Suspendido", 42, false);

    await payTransfer("tok2345abcdefgh2", SHORT);
    expect(sent.accion).toBe(0);
  });

  it("scenario 4: the ISP's debt decides, never Devolada's fee", async () => {
    /* 49900 arrives against a 51400 ask: the mensualidad is covered and
       our 1500 is not. The customer is reconnected and we eat the fee —
       leaving somebody offline over it would cost more in one support
       call than the fee is worth (D3). */
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta(shortCep(49900));
    const sent = mockReconnection("Activo", 42);

    const res = await payTransfer("tok2345abcdefgh2", SHORT);
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");
    expect(sent.accion).toBe(1);
    expect(sent.totalCobrado).toBe(499);

    const [charge] = await drizzle(env.DB).select().from(charges);
    /* The payer covered the mensualidad and none of our fee. The ISP is
       made whole in WispHub, the customer is reconnected, and Devolada
       still accrues its 15.00 against the ISP (D14). */
    expect(charge.invoiceCents).toBe(49900);
    expect(charge.serviceFeeCents).toBe(1500);
  });

  it("scenario 6: more than the debt → confirmed, and the surplus travels on", async () => {
    /* D10: no special case. Our fee takes its part and the rest goes to
       WispHub, which turns it into a credit against the next cycle. */
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta(shortCep(60000));
    const sent = mockReconnection("Activo", 42);

    const res = await payTransfer("tok2345abcdefgh2", SHORT);
    expect((await res.json()).data.status).toBe("confirmed");
    /* 600.00 − 15.00 of fee = 585.00 registered; 86.00 over the debt */
    expect(sent.totalCobrado).toBe(585);
  });

  it("scenario 7: the three amounts reach the page in money, never a percentage", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta(shortCep(30000));
    mockReconnection("Suspendido", 42, false);

    const res = await payTransfer("tok2345abcdefgh2", SHORT);
    const { data } = await res.json();
    const status = await (await app()).request(
      `/direct-payments/${data.directPaymentId}/status`,
      {},
      testEnv,
    );
    const { data: s } = await status.json();
    expect(s.status).toBe("partial");
    expect(s.receivedCents).toBe(30000);
    expect(s.debtCents).toBe(49900);
    expect(s.missingCents).toBe(19900);
  });
});

/* partial-payment.spec.md D14 — the fee is a receivable, not a slice of
   the transfer. Every peso the payer sent landed in the ISP's own bank
   account, so what Devolada holds is a debt the ISP settles monthly. */
describe("US-D10 / US-L01: the commission is never forgiven", () => {
  it("a short payment still accrues the whole fee to the platform statement", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta({
      cep: {
        trackingKey: "TRACK001XYZ",
        amountCents: 20000,
        date: new Date().toISOString().slice(0, 10),
        senderBank: "NUBANK",
        senderName: "JANELY REYES",
        receiverBank: "STP",
        beneficiaryName: "WifiPlus SA de CV",
      },
    });
    mockReconnection("Suspendido", 42, false);

    await payTransfer("tok2345abcdefgh2", TRANSFER);

    const [charge] = await drizzle(env.DB).select().from(charges);
    /* 200.00 arrived and every peso of it went to the ISP's debt; the
       15.00 accrues anyway, because the ISP is the one who received the
       money and owes it onward. */
    expect(charge.invoiceCents).toBe(20000);
    expect(charge.serviceFeeCents).toBe(1500);
    /* `settlement` D1 derives the platform's share from exactly this
       column, and a spei charge carries no store commission (D6). */
    expect(charge.storeId).toBeNull();
  });
});

describe("US-D13: the amount the payer really sent", () => {
  /* The manual door's body once claimed-amount D3 ships: the payer's
     own number rides with the data they already typed. */
  const TYPED = {
    transfer: {
      trackingKey: "TRACK001XYZ",
      senderBank: "NUBANK",
      date: "2026-08-17",
      amountCents: 40000,
    },
  };

  it("scenario 2: the typed amount is what travels to Banxico", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockConsta({ status: "pending", cep: undefined });

    const res = await payTransfer("tok2345abcdefgh2", TYPED);
    expect(res.status).toBe(201);
    const [payment] = await drizzle(env.DB).select().from(directPayments);
    expect(payment.claimedAmountCents).toBe(40000);
    const sent = captured.body as { transfer: { amountCents: number } };
    expect(sent.transfer.amountCents).toBe(40000);
  });

  it("scenario 5: only a changed amount supersedes; four equal fields spend nothing", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    const first = await payTransfer("tok2345abcdefgh2", TYPED);
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.directPaymentId;

    /* Identical four fields → the row is kept before any WispHub or
       Consta call — no mocks are armed, so reaching one would fail */
    const same = await payTransfer("tok2345abcdefgh2", { ...TYPED, supersedes: firstId });
    expect(same.status).toBe(200);
    expect((await same.json()).data.directPaymentId).toBe(firstId);

    /* A new amount changes what Banxico is asked: a real correction */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    const edited = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TYPED.transfer, amountCents: 35000 },
      supersedes: firstId,
    });
    expect(edited.status).toBe(201);
    const rows = await drizzle(env.DB).select().from(directPayments);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === firstId)?.status).toBe("superseded");
    expect(rows.find((r) => r.id !== firstId)?.claimedAmountCents).toBe(35000);
  });

  it("scenario 6: the status answers with the claimed amount", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    const res = await payTransfer("tok2345abcdefgh2", TYPED);
    const { directPaymentId } = (await res.json()).data;

    const status = await (await app()).request(
      `/direct-payments/${directPaymentId}/status`,
      {},
      testEnv,
    );
    const { data } = await status.json();
    expect(data.claimedAmountCents).toBe(40000);
  });

  it("scenario 8: the claim cannot change the charge — the CEP decides", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta(); /* the CEP says 51400 arrived */
    mockReconnection("Activo");

    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TYPED.transfer, amountCents: 99900 },
    });
    expect((await res.json()).data.status).toBe("confirmed");
    const [charge] = await drizzle(env.DB).select().from(charges);
    expect(charge.totalCents).toBe(51400);
  });

  it("scenario 7: no beneficiary name — validation runs, the request omits it, the link hides it", async () => {
    await seedLinkedIsp({ speiBeneficiaryName: null });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    const captured = mockConsta();
    mockReconnection("Activo");

    const res = await payTransfer();
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe("confirmed");
    const sent = captured.body as { transfer: { beneficiary: Record<string, unknown> } };
    expect("name" in sent.transfer.beneficiary).toBe(false);

    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const link = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2",
      {},
      testEnv,
    );
    const { data } = await link.json();
    expect(data.status).toBe("debt");
    expect("speiBeneficiaryName" in data).toBe(false);
  });
});

describe("US-D14: the classifier at minute two", () => {
  /* A reader-sourced payment whose inline attempt found nothing: image
     stored, misread clave on the row, one attempt spent. */
  const CROSS_ROW = {
    amountCents: 51400,
    invoiceCents: 49900,
    serviceFeeCents: 1500,
    proofMode: "transfer",
    trackingKey: "NU3AMISREADQRNKJHK000000X8P",
    senderBank: "NUBANK",
    claimedAmountCents: 51400,
    proofKey: "lk-1/proof-1",
    validationAttempts: 1,
    lastError: "TRANSFER_NOT_FOUND",
  } as const;

  async function seedCross(over: Record<string, unknown> = {}) {
    const { isp, link } = await seedLinkedIsp();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: isp.id,
        ...CROSS_ROW,
        transferDate: new Date().toISOString().slice(0, 10),
        nextValidationAt: new Date(now.getTime() - 1000),
        ...over,
      })
      .returning();
    return { isp, link, payment, now, db };
  }

  const statusOf = async (id: string) => {
    const res = await (await app()).request(`/direct-payments/${id}/status`, {}, testEnv);
    return (await res.json()).data as Record<string, unknown>;
  };

  it("scenario 1: the cross sends the image with providerOcr, and a valid adopts the CEP's key", async () => {
    const { payment, now, db } = await seedCross();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    const captured = mockConsta({
      cep: {
        trackingKey: "NU3AREALQKRNKJHK00000000X8P",
        amountCents: 51400,
        date: new Date().toISOString().slice(0, 10),
        senderBank: "NUBANK",
        senderName: "JANELY REYES",
        receiverBank: "STP",
        beneficiaryName: "WifiPlus SA de CV",
      },
    });

    await sweepDirectPayments(testEnv, now);
    const sent = captured.body as Record<string, unknown>;
    expect(sent.providerOcr).toBe(true);
    expect(String(sent.receiptUrl)).toContain("proof");
    expect(sent.transfer).toBeUndefined();

    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.status).toBe("confirmed");
    /* reading-check D7: the index ends up holding the truth */
    expect(row.trackingKey).toBe("NU3AREALQKRNKJHK00000000X8P");
  });

  it("scenario 2: a matching reading writes agreed, and the ride keeps its schedule", async () => {
    const { payment, now, db } = await seedCross();
    mockConsta({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: {
        trackingKey: CROSS_ROW.trackingKey,
        amountCents: 51400,
        date: "2026-08-26",
        senderBank: "Nubank",
        referenceNumber: "260826",
      },
    });

    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.status).toBe("validating");
    expect(row.readingCheck).toBe("agreed");
    expect(row.disputedFields).toBeNull();
    expect((await statusOf(payment.id)).readingCheck).toBe("agreed");
  });

  it("scenario 3+5: a differing clave and amount write disputed, with the fields named", async () => {
    const { payment, now, db } = await seedCross();
    mockConsta({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: {
        trackingKey: "NU3AOTHERREADING00000000X8P",
        amountCents: 40000,
        date: "2026-08-26",
        senderBank: "Nubank",
        referenceNumber: null,
      },
    });

    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.readingCheck).toBe("disputed");
    const data = await statusOf(payment.id);
    expect(data.readingCheck).toBe("disputed");
    expect(data.disputedFields).toEqual(["trackingKey", "amount"]);
  });

  it("scenario 6: a blind cross stays null on the wire — no evidence is the same as no cross", async () => {
    const { payment, now, db } = await seedCross();
    mockConsta({ status: "invalid", reason: "not_found", cep: undefined });

    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    /* Internally recorded so the cross never repeats (D5)… */
    expect(row.readingCheck).toBe("blind");
    /* …and invisible to the page, which keeps today's behaviour */
    const data = await statusOf(payment.id);
    expect(data.readingCheck).toBeNull();
    expect("disputedFields" in data).toBe(false);
  });

  it("scenario 7: a bank-name difference alone raises nothing", async () => {
    const { payment, now, db } = await seedCross();
    mockConsta({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: {
        trackingKey: CROSS_ROW.trackingKey,
        amountCents: 51400,
        date: "2026-08-26",
        senderBank: "NU MEXICO",
        referenceNumber: null,
      },
    });

    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.readingCheck).toBe("agreed");
  });

  it("scenario 9: a manual-door payment (no image) never crosses", async () => {
    const { payment, now, db } = await seedCross({ proofKey: null });
    const captured = mockConsta({ status: "pending", cep: undefined });

    await sweepDirectPayments(testEnv, now);
    const sent = captured.body as Record<string, unknown>;
    expect(sent.transfer).toBeDefined();
    expect(sent.providerOcr).toBeUndefined();
    const [row] = await db.select().from(directPayments).where(eq(directPayments.id, payment.id));
    expect(row.readingCheck).toBeNull();
  });

  it("scenario 8: expiry keeps the agreement, so the page can pre-diagnose", async () => {
    const past = new Date(Date.now() - 13 * 60 * 60 * 1000);
    const { payment, now } = await seedCross({
      readingCheck: "agreed",
      validationAttempts: 7,
      createdAt: past,
    });
    mockConsta({ status: "invalid", reason: "not_found", cep: undefined });

    await sweepDirectPayments(testEnv, now);
    const data = await statusOf(payment.id);
    expect(data.status).toBe("expired");
    expect(data.readingCheck).toBe("agreed");
  });
});

/* provisional-release (US-D15) — the vote of confidence: per-transaction
   evidence buys a WispHub payment promise while Banxico confirms;
   history only revokes. */
function mockPromise() {
  const captured: { body?: Record<string, unknown> } = {};
  wh()
    .intercept({
      method: "POST",
      path: "/api/promesa-pago/",
      body: (raw) => {
        captured.body = JSON.parse(String(raw));
        return true;
      },
    })
    .reply(...json({ id_factura: 42, fecha_limite: "2026-01-01 00:00" }));
  return captured;
}

describe("US-D15: the provisional release", () => {
  it("scenario 1: a pending verdict at minute zero buys the promise with accion 1", async () => {
    await seedLinkedIsp({ provisionalReleaseEnabled: true });
    /* one customer+invoices round for the submit, one for the release */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta({ status: "pending", cep: undefined });
    const promise = mockPromise();

    const res = await payTransfer();
    expect(res.status).toBe(201);

    expect(promise.body!.id_factura).toBe(42);
    expect(promise.body!.accion).toBe(1);
    expect(String(promise.body!.fecha_limite)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.status).toBe("validating");
    expect(row.provisionalReleaseAt).not.toBeNull();
    expect(row.releaseEvidence).toBe("pending");
    /* the seed customer is Suspendido: the reconnect face, never protect */
    expect(row.releaseKind).toBe("reconnect");
  });

  it("scenario 8: toggle off — byte-identical to today, no WispHub round", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });

    const res = await payTransfer();
    expect(res.status).toBe(201);

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.provisionalReleaseAt).toBeNull();
    expect(row.releaseEvidence).toBeNull();
  });

  it("D1: the manual door's not_found releases on human evidence", async () => {
    await seedLinkedIsp({ provisionalReleaseEnabled: true });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta({ status: "invalid", reason: "not_found", cep: undefined });
    mockPromise();

    const res = await payTransfer();
    expect(res.status).toBe(201);

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.status).toBe("validating");
    expect(row.lastError).toBe("TRANSFER_NOT_FOUND");
    expect(row.releaseEvidence).toBe("human");
    expect(row.provisionalReleaseAt).not.toBeNull();
  });

  it("scenario 9: a burned ride revokes the fast lane — the road stays open", async () => {
    const { link } = await seedLinkedIsp({ provisionalReleaseEnabled: true });
    /* the prior released ride that expired and was never resolved */
    await drizzle(env.DB)
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: link.ispId,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        status: "expired",
        proofMode: "transfer",
        trackingKey: "OLDKEY001",
        provisionalReleaseAt: new Date(Date.now() - 10 * 24 * 3600 * 1000),
        releaseEvidence: "human",
      });

    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    /* no mockPromise: a promise call would leave a pending interceptor */

    const res = await payTransfer();
    expect(res.status).toBe(201);

    const rows = await drizzle(env.DB)
      .select()
      .from(directPayments)
      .where(eq(directPayments.trackingKey, "TRACK001XYZ"));
    expect(rows[0].status).toBe("validating");
    expect(rows[0].provisionalReleaseAt).toBeNull();
  });

  it("D2: a claim under the ISP's threshold buys nothing", async () => {
    await seedLinkedIsp({ provisionalReleaseEnabled: true });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta({ status: "pending", cep: undefined });

    /* the manual door's editable amount: a $10 claim against a $499 debt */
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TRANSFER.transfer, amountCents: 1000 },
    });
    expect(res.status).toBe(201);

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(row.provisionalReleaseAt).toBeNull();
  });

  it("D7/scenario 4: the retry that validates lifts the burned ride", async () => {
    const { link } = await seedLinkedIsp();
    /* the released ride that expired — Banxico was just late */
    const [ride] = await drizzle(env.DB)
      .insert(directPayments)
      .values({
        paymentLinkId: link.id,
        ispId: link.ispId,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        status: "expired",
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        provisionalReleaseAt: new Date(Date.now() - 7 * 3600 * 1000),
        releaseEvidence: "agreed",
        releaseKind: "reconnect",
      })
      .returning();

    /* D7: the expired page is offered exactly one retry for this clave */
    const st = await (await app()).request(`/direct-payments/${ride.id}/status`, {}, testEnv);
    expect((await st.json()).data.retryAvailable).toBe(true);

    /* the payer claims it next morning; the CEP has published by now */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockConsta();
    mockReconnection("Activo");

    const res = await payTransfer();
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");

    /* the vote of confidence was vindicated: the ride is no longer
       `expired`, so the D5 revocation lifts with it */
    const [old] = await drizzle(env.DB)
      .select()
      .from(directPayments)
      .where(eq(directPayments.id, ride.id));
    expect(old.status).toBe("superseded");
  });

  it("D6/scenario 7: another customer's clave is recorded at the edge and revokes", async () => {
    const { link, isp } = await seedLinkedIsp({ provisionalReleaseEnabled: true });
    /* a second customer on the same ISP whose payment owns the clave */
    const [otherLink] = await drizzle(env.DB)
      .insert(paymentLinks)
      .values({
        ispId: isp.id,
        token: "tok9999zzzzzzzz9",
        wisphubCustomerId: "9",
        customerUsuario: "arellano@wifiplus",
      })
      .returning();
    await drizzle(env.DB)
      .insert(directPayments)
      .values({
        paymentLinkId: otherLink.id,
        ispId: isp.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        status: "validating",
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
      });

    /* the double-spend attempt dies at the index, and now leaves a row */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const rejected = await payTransfer();
    expect(rejected.status).toBe(409);

    const marks = await drizzle(env.DB).select().from(proofRejections);
    expect(marks).toHaveLength(1);
    expect(marks[0].paymentLinkId).toBe(link.id);
    expect(marks[0].trackingKey).toBe("TRACK001XYZ");

    /* the next attempt with a clean clave rides — but the fast lane is shut */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockConsta({ status: "pending", cep: undefined });
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TRANSFER.transfer, trackingKey: "CLEANKEY99" },
    });
    expect(res.status).toBe(201);

    const rows = await drizzle(env.DB)
      .select()
      .from(directPayments)
      .where(eq(directPayments.trackingKey, "CLEANKEY99"));
    expect(rows[0].status).toBe("validating");
    expect(rows[0].provisionalReleaseAt).toBeNull();
  });
});

/* provisional-release D4 (US-D15) — the collection half: the opaque refs
   ride every Consta call from day one, toggle state irrespective, and
   the recognisable usuario never travels naked. */
describe("US-D15: the history refs travel always (D4)", () => {
  it("customerRef is the HMAC of the usuario, paymentRef is the payment id", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockConsta({ status: "pending", cep: undefined });

    const res = await payTransfer();
    expect(res.status).toBe(201);

    const [row] = await drizzle(env.DB).select().from(directPayments);
    expect(captured.body!.paymentRef).toBe(row.id);

    const ref = String(captured.body!.customerRef);
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
    expect(ref).not.toContain("greyes");
    expect(ref).toBe(await customerRefFor("test-ref-secret", "greyes@wifiplus"));
  });

  it("without the secret nothing travels and nothing blocks", async () => {
    await seedLinkedIsp();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockConsta({ status: "pending", cep: undefined });

    const res = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/pay",
      post(TRANSFER),
      { ...testEnv, CUSTOMER_REF_SECRET: undefined },
    );
    expect(res.status).toBe(201);
    expect(captured.body!.customerRef).toBeUndefined();
    expect(captured.body!.paymentRef).toBeUndefined();
  });
});

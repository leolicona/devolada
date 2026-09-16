import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { paymentLinks, payments } from "../../src/db/schema";
import { sweepDirectPayments } from "../../src/direct-payments/validation";
import { consta, type ConstaRequest } from "../../src/consta";
import type { Bindings } from "../../src/env";
import { app } from "../helpers";
import { aiReturning, db, engineEnv, extractions, PNG, putProof, seedBusiness } from "./helpers";

/* consta-api-merge US2 — one product to deploy, one credential to keep.
   The same app, given an env with and without the provider credential,
   flips the SPEI channel between available and unavailable with no code
   change (SC-005, FR-009): production becomes ABLE to validate the day
   the secret is planted, and says so until then. A payment already in
   flight when the credential is absent rides the schedule and never
   dies for it; an env without the reader's binding takes the provider's
   door rather than failing (constitution VIII). */

const APICEP_ORIGIN = "https://api.apicep.cloud";
const WISPHUB_ORIGIN = "https://api.wisphub.net";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const json = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

const SPEI = {
  wisphubApiKey: "wh-key-1",
  serviceFeeCents: 1500,
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "WifiPlus SA de CV",
};

async function seedLink() {
  const business = await seedBusiness(SPEI);
  const [link] = await drizzle(env.DB)
    .insert(paymentLinks)
    .values({ businessId: business.id, token: "tokavail00000001", wisphubCustomerId: "6", customerUsuario: "greyes@wifiplus" })
    .returning();
  return { business, link };
}

/* The page's debt read (direct-payment D1): the customer and the pending
   invoices, served only when the channel is available */
function mockWisphubDebt() {
  const wh = fetchMock.get(WISPHUB_ORIGIN);
  wh.intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") }).reply(
    ...json({
      count: 1,
      results: [
        { id_servicio: 6, usuario: "greyes@wifiplus", nombre: "Janely", estado: "Suspendido", estado_facturas: "Pendiente de Pago", precio_plan: "499.00", saldo: "0.00", zona: { id: 1, nombre: "Zona" } },
      ],
    }),
  );
  wh.intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") }).reply(
    ...json({ next: null, count: 1, results: [{ id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 }] }),
  );
}

const withToken = () => engineEnv();
const withoutToken = () => engineEnv({ APICEP_TOKEN: undefined });

describe("consta-api-merge US2: able, not on — the credential alone decides", () => {
  it("scenario 3 / SC-005: the same link answers `unavailable` without APICEP_TOKEN and `debt` with it", async () => {
    await seedLink();

    /* No credential: the channel says so, and asks WispHub nothing —
       no interceptor is armed, so a lookup would fail this test */
    const off = await (await app()).request("/direct-payments/links/tokavail00000001", {}, withoutToken() as unknown as typeof env);
    expect(off.status).toBe(200);
    expect((await off.json()).data.status).toBe("unavailable");

    /* The credential planted: the same code, the same row, the CLABE */
    mockWisphubDebt();
    const on = await (await app()).request("/direct-payments/links/tokavail00000001", {}, withToken() as unknown as typeof env);
    expect(on.status).toBe(200);
    const { data } = await on.json();
    expect(data.status).toBe("debt");
    expect(data.speiClabe).toBe(SPEI.speiClabe);
  });

  it("a payment already validating when the credential is absent is retried as PROVIDER_NOT_CONFIGURED and never dies", async () => {
    const { business, link } = await seedLink();
    const now = new Date();
    const [row] = await drizzle(env.DB)
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        status: "validating",
        trackingKey: "TRACKNOTOKEN01",
        senderBank: "NUBANK",
        transferDate: now.toISOString().slice(0, 10),
        constaStatus: "pending",
        validationAttempts: 1,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 3 * 60_000),
      })
      .returning();

    /* No provider interceptor: nothing may leave the product */
    const report = await sweepDirectPayments(withoutToken(), now);
    expect(report).toMatchObject({ claimed: 1, stillValidating: 1 });
    const [after] = await drizzle(env.DB).select().from(payments).where(eq(payments.id, row.id));
    expect(after.status).toBe("validating");
    /* consta-api-merge D6: the engine's own code, never the transport's */
    expect(after.lastError).toBe("PROVIDER_NOT_CONFIGURED");
    expect(after.nextValidationAt).not.toBeNull();
    expect(after.nextValidationAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("an env without the AI binding reads an image through the provider's door rather than failing", async () => {
    const business = await seedBusiness(SPEI);
    const bucketEnv = engineEnv({ AI: undefined });
    await putProof(bucketEnv.PROOFS, "link-x/receipt.png", PNG(), "image/png");
    fetchMock
      .get(APICEP_ORIGIN)
      .intercept({
        method: "POST",
        path: "/validate-transfer",
        body: (raw) => {
          const body = JSON.parse(String(raw)) as Record<string, unknown>;
          /* the provider's OCR gets the short-lived link (D12, D7) */
          expect(String(body.imageUrl)).toContain("/direct-payments/proofs/link-x/receipt.png");
          expect(body.sender).toBeUndefined();
          return true;
        },
      })
      .reply(...json({ validationId: "prov-ocr", status: "pending", validation: { cepPreviouslyValidated: false } }));

    const request: ConstaRequest = { receipt: { proofKey: "link-x/receipt.png" }, beneficiary: { bank: "STP", clabe: SPEI.speiClabe } };
    const verdict = await consta(bucketEnv, db(), { businessId: business.id }).validate(request);
    expect(verdict.status).toBe("pending");
    expect(verdict.source).toBe("provider-ocr");
    /* and with the reader bound, the same file is read here (D2) */
    expect((await db().select().from(extractions)).length).toBe(0);
    const readerEnv = { ...bucketEnv, AI: aiReturning({ esComprobante: true, claveDeRastreo: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K", banco: "NUBANK", monto: 514, fecha: "2026-08-19", estatus: "Aceptada" }) } as Bindings;
    fetchMock
      .get(APICEP_ORIGIN)
      .intercept({ method: "POST", path: "/validate-transfer" })
      .reply(...json({ validationId: "prov-direct", status: "pending", validation: { cepPreviouslyValidated: false } }));
    const read = await consta(readerEnv, db(), { businessId: business.id }).validate(request);
    expect(read.source).toBe("reader");
    expect((await db().select().from(extractions)).length).toBe(1);
  });
});

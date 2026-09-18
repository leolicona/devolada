import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { asc, eq } from "drizzle-orm";
import { creditEntries, extractions, paymentLinks, payments, topUps, user as userTable } from "../src/db/schema";
import { resetShapeRules } from "../src/consta/extraction";
import { releaseQueuedForCredit, sweepTopUps } from "../src/credit/topups";
import { sweepDirectPayments } from "../src/direct-payments/validation";
import type { Bindings } from "../src/env";
import { app, fakeProofs, seedBusiness, seedConfirmedPayment, seedMember, sessionCookieHeader } from "./helpers";
import { aiReturning, PNG } from "./consta/helpers";

/* docs/legacy/platform/prepaid-credit.spec.md scenarios 8–12 (US-B05, US-B06):
   the top-up through the platform's own account, and the pause. */

const APICEP_ORIGIN = "https://api.apicep.cloud";
const WISPHUB_ORIGIN = "https://api.wisphub.net";
const OPERATOR = "demo@devolada.app";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

/* The provider credential comes pinned from vitest.config.ts; the engine
   validates a top-up under the platform's own attribution
   (consta-api-merge D3), so there is no key to carry here. */
const testEnv = () =>
  ({
    ...(env as unknown as Bindings),
    PLATFORM_OPERATOR_EMAILS: OPERATOR,
  }) as Bindings;

const jsonReply = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

/* consta-api-merge D12: the engine is product code and is not mocked;
   apiCEP is, at its real origin, with the wire that produces the verdict
   the scenario names (`pending` → status "pending"; a valid CEP →
   status "valid" + cepDetails in pesos). */
function mockConsta(verdict: { status: string; cep?: Record<string, unknown> }) {
  const cep = verdict.cep;
  fetchMock
    .get(APICEP_ORIGIN)
    .intercept({ method: "POST", path: "/validate-transfer" })
    .reply(
      ...jsonReply({
        validationId: "v-1",
        status: verdict.status,
        validation: {
          cepPreviouslyValidated: false,
          ...(cep
            ? {
                cepStatus: "LIQUIDADO",
                cepDetails: {
                  trackingKey: cep.trackingKey,
                  amount: (cep.amountCents as number) / 100,
                  operationDate: cep.date,
                  senderBank: cep.senderBank,
                  senderName: cep.senderName,
                  receiverBank: cep.receiverBank,
                  beneficiaryName: cep.beneficiaryName,
                },
              }
            : {}),
        },
      }),
    );
}
const validCep = (amountCents: number, trackingKey = "TOPUP0001ABC") => ({
  status: "valid",
  cep: {
    trackingKey,
    amountCents,
    date: "2026-09-01",
    senderBank: "BBVA MEXICO",
    senderName: "WIFIPLUS SA DE CV",
    receiverBank: "STP",
    beneficiaryName: "Devolada",
  },
});

/* The payer's link needs WispHub's debt for the pay request (D1) */
function mockWisphubDebt() {
  const wh = fetchMock.get(WISPHUB_ORIGIN);
  wh.intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
    .reply(...jsonReply({
      count: 1,
      results: [{ id_servicio: 6, usuario: "greyes@wifiplus", nombre: "Janely", estado: "Suspendido", estado_facturas: "Pendiente de Pago", precio_plan: "499.00", saldo: "0.00", zona: { id: 1, nombre: "Zona" } }],
    }));
  wh.intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
    .reply(...jsonReply({ next: null, count: 1, results: [{ id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 }] }));
}

const asUser = async (email: string) => ({ headers: { Cookie: await sessionCookieHeader(email) } });
const call = async (email: string, path: string, init: RequestInit = {}) => {
  const { headers } = await asUser(email);
  return (await app()).request(
    path,
    { ...init, headers: { ...headers, "Content-Type": "application/json", ...(init.headers ?? {}) } },
    testEnv() as unknown as typeof env,
  );
};
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

async function platformAccountSet() {
  await call(OPERATOR, "/platform/settings/topup_clabe", post({ value: "646180157099999999" }));
  await call(OPERATOR, "/platform/settings/topup_bank", post({ value: "STP" }));
}

/* Below the cap: −$60.00 against a −$50.00 cap */
async function pause(businessId: string) {
  await drizzle(env.DB)
    .insert(creditEntries)
    .values({ businessId, kind: "adjustment", cents: -6000, reason: "test: pause", authorUserId: null });
}

async function seedLink(businessId: string, token = "toklinkpause00001") {
  const [link] = await drizzle(env.DB)
    .insert(paymentLinks)
    .values({ businessId, token, wisphubCustomerId: "6", customerUsuario: "greyes@wifiplus" })
    .returning();
  return link;
}

const spei = { speiClabe: "646180157000000004", speiBank: "STP", speiBeneficiaryName: "WifiPlus SA de CV", wisphubApiKey: "wh-key-1" };

describe("US-B06: the pause — what is new waits without spending", () => {
  it("scenario 8: a new proof under the cap is queued, no provider call; the payer reads the business's fault", async () => {
    const business = await seedBusiness(spei);
    await pause(business.id);
    const link = await seedLink(business.id);
    mockWisphubDebt();

    const res = await (await app()).request(
      `/direct-payments/links/${link.token}/pay`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transfer: { trackingKey: "QUEUED0001", senderBank: "NUBANK", date: "2026-09-01" } }) },
      testEnv() as unknown as typeof env,
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("queued_for_credit");

    const status = await (await app()).request(`/direct-payments/${data.directPaymentId}/status`, {}, testEnv() as unknown as typeof env);
    expect((await status.json()).data.status).toBe("queued_for_credit");

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.validationAttempts).toBe(0);
    expect(row.nextValidationAt).toBeNull();
    /* No fee: nothing was validated */
    expect((await drizzle(env.DB).select().from(creditEntries)).filter((e) => e.kind === "validation_fee")).toHaveLength(0);
  });

  it("scenario 8 (in flight): a payment already validating keeps its schedule while paused", async () => {
    const business = await seedBusiness(spei);
    await pause(business.id);
    await seedConfirmedPayment(business, {
      status: "validating",
      folio: null,
      proofMode: "transfer",
      trackingKey: "INFLIGHT01",
      senderBank: "NUBANK",
      transferDate: "2026-09-01",
      nextValidationAt: new Date(Date.now() - 60_000),
      actionOutcome: null,
    });
    mockConsta({ status: "pending" });
    const report = await sweepDirectPayments(testEnv());
    expect(report).toMatchObject({ claimed: 1, stillValidating: 1 });
    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.validationAttempts).toBe(1);
    expect(row.status).toBe("validating");
  });

  it("scenario 9 (release): queued proofs go back to validating in arrival order once the balance clears the cap", async () => {
    const business = await seedBusiness(spei);
    await pause(business.id);
    const db = drizzle(env.DB);
    const link = await seedLink(business.id);
    for (const [i, key] of ["Q1AAAAAA", "Q2BBBBBB"].entries()) {
      await db.insert(payments).values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: key,
        status: "queued_for_credit",
        createdAt: new Date(Date.now() - (2 - i) * 60_000),
      });
    }
    /* Still paused: nothing moves */
    expect(await releaseQueuedForCredit(testEnv())).toBe(0);

    await db.insert(creditEntries).values({ businessId: business.id, kind: "adjustment", cents: 20000, reason: "test: top up", authorUserId: null });
    expect(await releaseQueuedForCredit(testEnv())).toBe(2);
    const rows = await db.select().from(payments).orderBy(asc(payments.nextValidationAt));
    expect(rows.map((r) => [r.trackingKey, r.status])).toEqual([["Q1AAAAAA", "validating"], ["Q2BBBBBB", "validating"]]);
  });
});

describe("US-B05: the top-up through the platform's own account", () => {
  it("scenario 9: a valid CEP credits its amount and the balance leaves the pause; billed to nobody", async () => {
    const business = await seedBusiness();
    await platformAccountSet();
    await pause(business.id);
    mockConsta(validCep(25000));

    const res = await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0001ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } }));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ status: "credited", creditedCents: 25000, proofMode: "transfer" });

    const credit = await (await call(OPERATOR, "/credit")).json();
    expect(credit.data.balanceCents).toBe(19000);
    expect(credit.data.step).toBe("ok");
    const entries = await drizzle(env.DB).select().from(creditEntries);
    expect(entries.filter((e) => e.kind === "top_up")).toHaveLength(1);
    /* The platform's validation is nobody's fee */
    expect(entries.filter((e) => e.kind === "validation_fee")).toHaveLength(0);
  });

  it("scenario 10: the CEP's amount is credited, not the claimed one", async () => {
    const business = await seedBusiness();
    await platformAccountSet();
    mockConsta(validCep(8000));
    const res = await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0002ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 10000 } }));
    expect((await res.json()).data.creditedCents).toBe(8000);
    const [entry] = await drizzle(env.DB).select().from(creditEntries).where(eq(creditEntries.businessId, business.id));
    expect(entry.cents).toBe(8000);
  });

  it("scenario 11: below the minimum the form refuses, and nothing is stored", async () => {
    await seedBusiness();
    await platformAccountSet();
    const res = await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0003ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 2000 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BELOW_MINIMUM");
    expect(await drizzle(env.DB).select().from(topUps)).toHaveLength(0);
  });

  it("scenario 12: a reused tracking key is refused — one transfer credits once", async () => {
    await seedBusiness();
    await platformAccountSet();
    mockConsta(validCep(25000));
    expect((await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0001ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } }))).status).toBe(201);
    const again = await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "topup0001abc", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } }));
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("TRANSFER_ALREADY_USED");
  });

  it("a pending CEP rides the schedule and the sweep credits it later", async () => {
    await seedBusiness();
    await platformAccountSet();
    mockConsta({ status: "pending" });
    const res = await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0004ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } }));
    const { data } = await res.json();
    expect(data.status).toBe("validating");
    expect(data.nextValidationAt).not.toBeNull();

    const db = drizzle(env.DB);
    await db.update(topUps).set({ nextValidationAt: new Date(Date.now() - 1000) });
    mockConsta(validCep(25000, "TOPUP0004ABC"));
    expect(await sweepTopUps(testEnv())).toMatchObject({ claimed: 1, credited: 1 });
    const [row] = await db.select().from(topUps);
    expect(row).toMatchObject({ status: "credited", creditedCents: 25000 });
    const listed = await (await call(OPERATOR, "/credit/top-ups")).json();
    expect(listed.data.topUps[0]).toMatchObject({ id: row.id, status: "credited" });
  });

  it("only the owner tops up; without the platform's account the door says so", async () => {
    const business = await seedBusiness();
    await seedMember(business, "admin@wifiplus.mx", "admin");
    expect((await call("admin@wifiplus.mx", "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0005ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } }))).status).toBe(403);
    const unset = await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0005ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } }));
    expect(unset.status).toBe(409);
    expect((await unset.json()).error.code).toBe("TOPUP_NOT_CONFIGURED");
  });
});

/* two-eyes-receipt US1/D18 — a top-up takes the same door a payment does.

   The engine does the work, so the top-up lifecycle only has to store
   what the comparison settled on (research R9): the same three fields a
   payment stores, in a table that already had the columns. With no human
   to ask, a top-up the machines cannot decide keeps riding the receipt
   door on every slot, exactly as today. */
describe("two-eyes-receipt US1: a receipt top-up goes provider-first too", () => {
  const CLAVE = "TOPUP0009XYZABCDEFGH";
  const READING = {
    esComprobante: true,
    claveDeRastreo: CLAVE,
    banco: "BBVA MEXICO",
    monto: 250.0,
    fecha: "2026-09-01",
    estatus: "Aceptada",
  };

  /* The provider answers `not_found` *and* its own reading of the image:
     nothing in Banxico yet, but two pairs of eyes on the receipt. */
  function mockImageDoor(over: Record<string, unknown> = {}) {
    const captured: { body?: Record<string, unknown> } = {};
    fetchMock
      .get(APICEP_ORIGIN)
      .intercept({
        method: "POST",
        path: "/validate-transfer",
        body: (raw) => {
          captured.body = JSON.parse(String(raw));
          return true;
        },
      })
      .reply(
        ...jsonReply({
          validationId: "v-topup",
          status: "invalid",
          validation: { cepPreviouslyValidated: false },
          extracted: { trackingKey: CLAVE, amount: 250.0, date: "2026-09-01", senderBank: "BBVA MEXICO" },
          ...over,
        }),
      );
    return captured;
  }

  it("the first attempt sends the image, agreement is stored, and the next slot takes the transfer door", async () => {
    const business = await seedBusiness();
    await platformAccountSet();
    const db = drizzle(env.DB);
    const [owner] = await db.select().from(userTable).where(eq(userTable.email, OPERATOR));
    const proofKey = `topups/${business.id}/proof-1`;
    const proofEnv = { ...testEnv(), PROOFS: fakeProofs(), AI: aiReturning(READING) } as Bindings;
    await proofEnv.PROOFS.put(proofKey, PNG(), { httpMetadata: { contentType: "image/png" } });

    const [topUp] = await db
      .insert(topUps)
      .values({
        businessId: business.id,
        submittedByUserId: owner.id,
        claimedCents: 25000,
        proofMode: "receipt",
        proofKey,
        nextValidationAt: new Date(Date.now() - 1000),
      })
      .returning();

    const first = mockImageDoor();
    await sweepTopUps(proofEnv);
    expect(String(first.body!.imageUrl)).toContain(proofKey);
    expect(first.body!.sender).toBeUndefined();

    /* R9: the three fields the next attempt needs. `claimedCents` was
       always there — it is what the transfer door searches with. */
    let [row] = await db.select().from(topUps).where(eq(topUps.id, topUp.id));
    expect(row.status).toBe("validating");
    expect(row.readingCheck).toBe("agreed");
    expect(row.trackingKey).toBe(CLAVE);
    expect(row.senderBank).toBe("BBVA MEXICO");
    expect(row.transferDate).toBe("2026-09-01");

    /* D19: the classification lives on the reading record, under the
       platform's NULL owner — which is what makes top-ups countable
       without a payment row (prepaid-credit D6, consta-api-merge D3) */
    const [reading] = await db.select().from(extractions);
    expect(reading.businessId).toBeNull();
    expect(reading.readingCheck).toBe("agreed");
    expect(reading.providerTrackingKey).toBe(CLAVE);

    await db.update(topUps).set({ nextValidationAt: new Date(Date.now() - 1000) });
    const second = mockImageDoor({ status: "valid" });
    await sweepTopUps(proofEnv);
    expect(second.body!.imageUrl).toBeUndefined();
    expect((second.body!.sender as Record<string, unknown>).trackingKey).toBe(CLAVE);

    [row] = await db.select().from(topUps).where(eq(topUps.id, topUp.id));
    expect(row.validationAttempts).toBe(2);
  });

  it("D18: a top-up the machines cannot decide keeps the receipt door — there is nobody to ask", async () => {
    const business = await seedBusiness();
    await platformAccountSet();
    const db = drizzle(env.DB);
    const [owner] = await db.select().from(userTable).where(eq(userTable.email, OPERATOR));
    const proofKey = `topups/${business.id}/proof-2`;
    const proofEnv = { ...testEnv(), PROOFS: fakeProofs(), AI: aiReturning(READING) } as Bindings;
    await proofEnv.PROOFS.put(proofKey, PNG(), { httpMetadata: { contentType: "image/png" } });

    await db.insert(topUps).values({
      businessId: business.id,
      submittedByUserId: owner.id,
      claimedCents: 25000,
      proofMode: "receipt",
      proofKey,
      nextValidationAt: new Date(Date.now() - 1000),
    });

    /* Two different claves and no graduated shape for the bank: the
       machines have run out of ways to tell, and there is no operator
       form to send anybody to. */
    resetShapeRules();
    mockImageDoor({ extracted: { trackingKey: "TOPUPDIFFERENT000000", amount: 250.0, date: "2026-09-01", senderBank: "BBVA MEXICO" } });
    await sweepTopUps(proofEnv);

    let [row] = await db.select().from(topUps);
    expect(row.readingCheck).toBe("disputed");
    expect(row.trackingKey).toBeNull();

    await db.update(topUps).set({ nextValidationAt: new Date(Date.now() - 1000) });
    const again = mockImageDoor();
    await sweepTopUps(proofEnv);
    /* The same door as today, at the same cost as today */
    expect(String(again.body!.imageUrl)).toContain(proofKey);
    [row] = await db.select().from(topUps);
    expect(row.validationAttempts).toBe(2);
  });

  /* two-eyes-receipt D20 on the top-up path — the one place where "the
     same rule as a payment" (research R9) was not the same rule.

     Both machines read the clave and neither read a date: the readings
     agree, and `accepted` carries a null date (`compare.ts`). A payment
     asks its payer for that one field and keeps the receipt door until
     the answer comes; a top-up has nobody to ask, so the transfer door
     would be built with `now` — today's date, which nobody read. Banxico
     would be asked about the wrong day, answer a faceless `not_found`
     for a transfer that really happened, and the row would spend a
     credit per slot on a question that cannot be answered. So it keeps
     riding the receipt door, which is D18's answer whenever the machines
     cannot supply something here. */
  it("D20: agreement with no date on either side keeps the receipt door, never today's date", async () => {
    const business = await seedBusiness();
    await platformAccountSet();
    const db = drizzle(env.DB);
    const [owner] = await db.select().from(userTable).where(eq(userTable.email, OPERATOR));
    const proofKey = `topups/${business.id}/proof-3`;
    /* The same receipt as above with one field missing — the bank
       printed a date our reader could not make out. */
    const DATELESS = { esComprobante: true, claveDeRastreo: CLAVE, banco: "BBVA MEXICO", monto: 250.0, estatus: "Aceptada" };
    const proofEnv = { ...testEnv(), PROOFS: fakeProofs(), AI: aiReturning(DATELESS) } as Bindings;
    await proofEnv.PROOFS.put(proofKey, PNG(), { httpMetadata: { contentType: "image/png" } });

    await db.insert(topUps).values({
      businessId: business.id,
      submittedByUserId: owner.id,
      claimedCents: 25000,
      proofMode: "receipt",
      proofKey,
      nextValidationAt: new Date(Date.now() - 1000),
    });

    /* The provider read the same clave off the same image, and no date
       either: the agreeing row of the R3 table, minus one field. */
    const dateless = { trackingKey: CLAVE, amount: 250.0, senderBank: "BBVA MEXICO" };
    mockImageDoor({ extracted: dateless });
    await sweepTopUps(proofEnv);

    let [row] = await db.select().from(topUps);
    /* The agreement stands and is stored — a missing date is not a
       dispute, and the clave two machines settled on is still worth
       keeping (D20). */
    expect(row.readingCheck).toBe("agreed");
    expect(row.trackingKey).toBe(CLAVE);
    expect(row.senderBank).toBe("BBVA MEXICO");
    /* The hole stays a hole. Filling it with today is the bug. */
    expect(row.transferDate).toBeNull();

    await db.update(topUps).set({ nextValidationAt: new Date(Date.now() - 1000) });
    const again = mockImageDoor({ extracted: dateless });
    await sweepTopUps(proofEnv);
    /* The file again — never a `sender` block carrying a date nobody
       read, which would search the wrong day at a credit a slot. */
    expect(String(again.body!.imageUrl)).toContain(proofKey);
    expect(again.body!.sender).toBeUndefined();
    [row] = await db.select().from(topUps);
    expect(row.transferDate).toBeNull();
  });
});

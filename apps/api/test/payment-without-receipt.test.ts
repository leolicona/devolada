import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { businesses, cepRecords, payerReferenceCustomers, payerReferences, paymentLinks, payments } from "../src/db/schema";
import {
  customersResponse,
  directPaymentStatusResponse,
  linkStatusResponse,
} from "../src/routes/direct-payments/schema";
import { feedResponse, unmatchedTransfersResponse } from "../src/routes/payments/schema";
import { referenceOfLink } from "../src/direct-payments/payer-reference";
import { isRevoked } from "../src/direct-payments/provisional";
import { aiReturning, PNG } from "./consta/helpers";
import { app, sessionCookieHeader } from "./helpers";
import { SENDER_4417, SENDER_8301, type SyntheticTransfer } from "./consta/bundle-fixtures";
import {
  BUSINESS_CLABE,
  businessToday,
  db,
  linkRead,
  mockCustomer,
  mockFound,
  mockNotFound,
  mockPanelSettle,
  mockPendingInvoices,
  mockPhoneSearch,
  mockRateLimited,
  mockSeveral,
  pay,
  providerCalls,
  rowById,
  seedApiLink,
  seedPanelLink,
  seedReferenceBusiness,
  shiftDay,
  status,
  stepTo,
  searches,
  testEnv,
  WISPHUB,
} from "./payer-helpers";

/* payment-without-receipt — the payer's reference on every surface that
   shows a link (US1), and the confirmation with bank and day, its
   ladder and its learning (US2–US5). The lifecycle runs in workerd
   against a real D1; apiCEP and WispHub answer at their pinned origins. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const ANA = { usuario: "ana@isp", telefono: "55 1826 4039", nombre: "Ana", apellido: "López" };

/* The panel link's read: the customer, the open invoices, and — the
   first time — who shares the phone */
function mockPanelRead(customer = ANA, opts: { phoneSearch?: boolean; invoices?: boolean } = {}) {
  mockCustomer(customer);
  /* the page's invoice list is the 30-second display cache (provider-latency D3) */
  if (opts.invoices !== false) mockPendingInvoices([{ usuario: customer.usuario, total: 348.5 }]);
  if (opts.phoneSearch !== false) mockPhoneSearch("8264039", [customer]);
}

describe("payment-without-receipt US1: the reference on the payer's link read (T010, D1, D5, D22)", () => {
  it("a panel link answers the payer's reference, born on the first read and read back after", async () => {
    const business = await seedReferenceBusiness();
    const link = await seedPanelLink(business, ANA.usuario);
    mockPanelRead();
    const first = await linkRead(link.token);
    expect(first.status).toBe(200);
    const data = linkStatusResponse.parse(first.body.data);
    expect(data.payerReference).toEqual({ digits: "8264039", fromPhone: true, proven: false, previousDigits: null });
    expect(data.learnedBanks).toEqual([]);
    expect(data.bankOrder).toEqual([]);
    /* the concepto keeps its name and its meaning */
    expect(data.reference).toBe(ANA.usuario);

    /* the second read asks nobody who shares the phone */
    mockPanelRead(ANA, { phoneSearch: false, invoices: false });
    expect((await linkRead(link.token)).body.data!.payerReference.digits).toBe("8264039");
  });

  it("an API link answers an assigned number, never called the phone's", async () => {
    const business = await seedReferenceBusiness();
    const link = await seedApiLink(business, "gym-001");
    const data = linkStatusResponse.parse((await linkRead(link.token)).body.data);
    expect(data.payerReference).toMatchObject({ fromPhone: false, proven: false, previousDigits: null });
    expect(data.payerReference!.digits).toMatch(/^[1-9]\d{6}$/);
  });

  it("with the switch off the read is today's: no reference field, and nobody is asked who shares the phone", async () => {
    const business = await seedReferenceBusiness({ payByReference: false });
    const link = await seedPanelLink(business, ANA.usuario);
    mockPanelRead(ANA, { phoneSearch: false });
    const data = (await linkRead(link.token)).body.data!;
    expect(data.payerReference ?? null).toBeNull();
    expect(data.learnedBanks).toBeUndefined();
    expect(data.bankOrder).toBeUndefined();
  });
});

describe("payment-without-receipt US1: the reference where the business shares and reads a link (T010, FR-005, FR-006)", () => {
  it("the act that makes a link prepares a message carrying the digits", async () => {
    const business = await seedReferenceBusiness();
    mockCustomer(ANA);
    mockPhoneSearch("8264039", [ANA]);
    const res = await (await app()).request(
      "/direct-payments/links",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: await sessionCookieHeader(business.email) },
        body: JSON.stringify({ usuario: ANA.usuario }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { waLink: string } };
    expect(decodeURIComponent(data.waLink)).toContain("Tu referencia para transferir: 826 4039");
  });

  it("a customer row carries its reference and its origin, and nothing more; a row with no link carries none", async () => {
    const business = await seedReferenceBusiness();
    const link = await seedPanelLink(business, ANA.usuario);
    mockPanelRead();
    await linkRead(link.token);
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("offset=") })
      .reply(200, JSON.stringify({
        count: 2,
        next: null,
        results: [
          { id_servicio: 6, usuario: ANA.usuario, nombre: "Ana", telefono: ANA.telefono, estado: "Activo", estado_facturas: "Pendiente de Pago", precio_plan: "350.00", saldo: "0.00", zona: null },
          { id_servicio: 7, usuario: "sin-link@isp", nombre: "Beto", telefono: null, estado: "Activo", estado_facturas: "Pagadas", precio_plan: "350.00", saldo: "0.00", zona: null },
        ],
      }), { headers: { "Content-Type": "application/json" } });
    const res = await (await app()).request("/direct-payments/customers", { headers: { Cookie: await sessionCookieHeader(business.email) } }, env);
    const { results } = customersResponse.parse(((await res.json()) as { data: unknown }).data);
    const ana = results.find((r) => r.usuario === ANA.usuario)!;
    expect(ana.payerReference).toEqual({ digits: "8264039", origin: "phone" });
    expect(decodeURIComponent(ana.waLink!)).toContain("Tu referencia para transferir: 826 4039");
    expect(results.find((r) => r.usuario === "sin-link@isp")!.payerReference).toBeNull();
  });

  it("no link row ever holds a phone or a name (links-on-demand-search FR-010)", async () => {
    const business = await seedReferenceBusiness();
    const link = await seedPanelLink(business, ANA.usuario);
    mockPanelRead();
    await linkRead(link.token);
    const [row] = await db().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    expect(JSON.stringify(row)).not.toMatch(/1826|4039|López|Ana /);
  });
});

/* ---- US2 onwards: the confirmation ---- */

const TODAY = businessToday();
type Business = typeof businesses.$inferSelect;
type Link = typeof paymentLinks.$inferSelect;

let claves = 0;
/* A transfer Banxico holds for this business, as its CEP states it */
const transfer = (
  day: string,
  creditTime: string,
  amount = "351.50",
  senderAccount = SENDER_8301,
  over: Partial<SyntheticTransfer> = {},
): SyntheticTransfer => {
  claves += 1;
  return {
    clave: `REF${day.replace(/-/g, "")}${String(claves).padStart(6, "0")}I`,
    operationDay: day,
    creditDay: day,
    creditTime,
    senderAccount,
    beneficiaryAccount: BUSINESS_CLABE,
    amount,
    ...over,
  };
};

/* An API customer — a link asking $350.00 plus the $1.50 fee — and the
   reference its first read gives it. API links keep these suites off
   WispHub; the reference rules themselves are payer-reference.test.ts's. */
async function apiPayer(business: Business, customerRef = "gym-001", askCents = 35000) {
  const link = await seedApiLink(business, customerRef, { askCents });
  const read = await linkRead(link.token);
  return { link, digits: read.body.data!.payerReference.digits as string };
}

/* One person, two services (D4): a second customer joins the first's
   reference, as `ensurePayerReference` joins a phone's same name */
async function samePerson(business: Business, first: Link, customerRef: string, askCents = 35000) {
  const reference = await referenceOfLink(db(), first);
  const link = await seedApiLink(business, customerRef, { askCents });
  await db().insert(payerReferenceCustomers).values({
    businessId: business.id,
    referenceId: reference!.id,
    source: "api",
    customerKey: customerRef,
  });
  return link;
}

const confirm = (link: Link, over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  pay(link.token, { transfer: { referenceSource: "own", senderBank: "AZTECA", date: TODAY, ...over }, ...extra });

const asOwner = async (business: Business) => ({ headers: { Cookie: await sessionCookieHeader(business.email) } });

describe("payment-without-receipt US2: confirm with bank and day (T019, D8–D10, D14)", () => {
  it("(1) found on the day given: confirmed, the clave and the credit time kept, the action queued, one call", async () => {
    const business = await seedReferenceBusiness();
    const ANA_LINK = await seedPanelLink(business, ANA.usuario);
    mockPanelRead();
    const digits = (await linkRead(ANA_LINK.token)).body.data!.payerReference.digits as string;

    const found = transfer(TODAY, "07:11:20", "350.00");
    /* the submission reads the debt fresh; the verdict reads it again and reconnects */
    mockCustomer(ANA);
    mockPendingInvoices([{ usuario: ANA.usuario, total: 348.5 }]);
    mockFound(found);
    mockPanelSettle(ANA, 348.5);
    const res = await confirm(ANA_LINK, { referenceNumber: "1111111" });
    expect(res.status).toBe(201);
    const row = await rowById(res.body.data!.directPaymentId);
    expect(row).toMatchObject({
      status: "confirmed",
      referenceSource: "own",
      referenceNumber: digits,
      trackingKey: found.clave,
      actionOutcome: "done",
      ladderRound: 1,
    });
    /* the server searched the payer's own digits, not the ones sent */
    expect(await searches()).toEqual([{ referenceNumber: digits, date: TODAY, amountCents: 35000 }]);
    expect(await providerCalls()).toBe(1);
    const [record] = await db().select().from(cepRecords).where(eq(cepRecords.clave, found.clave));
    expect(record.creditTime).toBe("07:11:20");
    expect(JSON.parse(row.matchTrail!)).toMatchObject({ decided: "chosen", by: "earliest", candidates: [{ clave: found.clave, creditTime: "07:11:20" }] });
  });

  it("(2) nothing on the day given: the next slot searches the same day, and nothing is asked", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    mockNotFound();
    const res = await confirm(link);
    const id = res.body.data!.directPaymentId;
    expect((await status(id)).data).toMatchObject({ status: "validating", error: "TRANSFER_NOT_FOUND", ask: null, referenceSource: "own" });
    mockNotFound();
    await stepTo(id, 2);
    expect((await searches()).map((s) => s.date)).toEqual([TODAY, TODAY]);
    const after = directPaymentStatusResponse.parse((await status(id)).data);
    expect(after).toMatchObject({ ask: null, searchedDays: [TODAY] });
    expect((await rowById(id)).ladderRound).toBe(2);
  });

  it("(3) several on the payer's own reference: the earliest unused confirms and the other is kept — a second service of the same person takes it, never REFERENCE_SHARED", async () => {
    const business = await seedReferenceBusiness();
    const { link: home } = await apiPayer(business, "casa");
    const office = await samePerson(business, home, "oficina");
    const early = transfer(TODAY, "07:11:20");
    const late = transfer(TODAY, "07:13:02");

    mockSeveral([late, early]);
    const first = await confirm(home);
    expect(await rowById(first.body.data!.directPaymentId)).toMatchObject({ status: "confirmed", trackingKey: early.clave });
    const trail = JSON.parse((await rowById(first.body.data!.directPaymentId)).matchTrail!);
    expect(trail).toMatchObject({ source: "several", decided: "chosen", by: "earliest" });

    /* the other transfer is listed for the operator as received and unheld */
    const listed = await (await app()).request(`/payments/unmatched-transfers?from=${shiftDay(TODAY, -1)}`, await asOwner(business), env);
    const unmatched = unmatchedTransfersResponse.parse(((await listed.json()) as { data: unknown }).data);
    expect(unmatched.transfers.map((t) => t.clave)).toEqual([late.clave]);

    mockSeveral([late, early]);
    const second = await confirm(office);
    expect(second.status).toBe(201);
    expect(await rowById(second.body.data!.directPaymentId)).toMatchObject({ status: "confirmed", trackingKey: late.clave });
  });

  it("(4) a transfer already used: the payer hears it was their own payment's, day and amount — never another person's", async () => {
    const business = await seedReferenceBusiness();
    const { link: home } = await apiPayer(business, "casa");
    const office = await samePerson(business, home, "oficina");
    const once = transfer(TODAY, "07:11:20");
    mockFound(once);
    const paid = await confirm(home);
    expect((await rowById(paid.body.data!.directPaymentId)).status).toBe("confirmed");

    /* the same transfer, found again for the other service */
    mockFound(once, { previouslyValidated: true });
    const again = await confirm(office);
    const read = directPaymentStatusResponse.parse((await status(again.body.data!.directPaymentId)).data);
    expect(read.error).toBe("CEP_ALL_USED");
    expect(read.usedBy).toEqual({ day: TODAY, amountCents: 35150 });

    /* validated outside Devolada: refused, and nothing names a payment */
    const { link: stranger } = await apiPayer(business, "otro");
    mockFound(transfer(TODAY, "08:00:00"), { previouslyValidated: true });
    const outside = await confirm(stranger);
    const refused = directPaymentStatusResponse.parse((await status(outside.body.data!.directPaymentId)).data);
    expect(refused).toMatchObject({ status: "invalid", error: "TRANSFER_ALREADY_USED", usedBy: null });

    /* the transfer another person's payment used: no day, no amount */
    mockFound(once, { previouslyValidated: true });
    const theirs = await confirm(stranger);
    expect((await status(theirs.body.data!.directPaymentId)).data).toMatchObject({ error: "CEP_ALL_USED", usedBy: null });
  });

  it("(5) the misremembered day: round 3 searches the day before and the day after — never after today — and confirms where it is", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    const given = shiftDay(TODAY, -1);
    mockNotFound();
    const id = (await confirm(link, { date: given })).body.data!.directPaymentId;
    mockNotFound();
    await stepTo(id, 2);
    /* round 3: the day before has nothing; the day after — today — holds it */
    mockNotFound({ when: (s) => s.date === shiftDay(given, -1) });
    mockFound(transfer(TODAY, "00:03:10"), { when: (s) => s.date === TODAY });
    await stepTo(id, 8);
    expect((await searches()).map((s) => s.date)).toEqual([given, given, shiftDay(given, -1), TODAY]);
    const row = await rowById(id);
    expect(row).toMatchObject({ status: "confirmed", ladderRound: 3, validationAttempts: 4 });
    expect(JSON.parse(row.confirmation!).days).toEqual([given, shiftDay(given, -1), TODAY]);

    /* a confirmation for today asks no day after it */
    const { link: other } = await apiPayer(business, "otro");
    const before = (await searches()).length;
    mockNotFound();
    const today = (await confirm(other)).body.data!.directPaymentId;
    mockNotFound();
    await stepTo(today, 2);
    mockNotFound();
    await stepTo(today, 8);
    expect((await searches()).slice(before).map((s) => s.date)).toEqual([TODAY, TODAY, shiftDay(TODAY, -1)]);
    expect((await status(today)).data.ask).toBe("check_data");
  });

  it("(6) 'Pagué otra cantidad': the typed amount is searched, and a match settles by the partial rules", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    mockFound(transfer(TODAY, "07:11:20", "300.00"));
    const res = await confirm(link, { amountCents: 30000 });
    expect((await searches())[0].amountCents).toBe(30000);
    expect(await rowById(res.body.data!.directPaymentId)).toMatchObject({ status: "partial", receivedCents: 30000, claimedAmountCents: 30000 });
  });

  it("(7) proven is false until the payer's own reference confirms, then true on every service sharing it", async () => {
    const business = await seedReferenceBusiness();
    const { link: home } = await apiPayer(business, "casa");
    const office = await samePerson(business, home, "oficina");
    expect((await linkRead(office.token)).body.data!.payerReference.proven).toBe(false);
    mockFound(transfer(TODAY, "07:11:20"));
    await confirm(home);
    expect((await linkRead(home.token)).body.data!.payerReference.proven).toBe(true);
    expect((await linkRead(office.token)).body.data!.payerReference.proven).toBe(true);
  });

  it("(8) the provisional release: a confirmation is the payer's own evidence, released on the first not_found", async () => {
    const business = await seedReferenceBusiness({ provisionalReleaseEnabled: true });
    const link = await seedPanelLink(business, ANA.usuario);
    mockPanelRead();
    await linkRead(link.token);
    /* the submission's debt read, then the release's */
    mockCustomer({ ...ANA, estado: "Suspendido" }, 2);
    mockPendingInvoices([{ usuario: ANA.usuario, total: 348.5 }], 2);
    mockNotFound();
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "POST", path: "/api/promesa-pago/" })
      .reply(200, JSON.stringify({ id_factura: 42, fecha_limite: "2026-01-01 00:00" }), { headers: { "Content-Type": "application/json" } });
    const res = await confirm(link);
    const row = await rowById(res.body.data!.directPaymentId);
    expect(row).toMatchObject({ status: "validating", releaseEvidence: "human" });
    expect(row.provisionalReleaseAt).not.toBeNull();
  });

  it("the server ignores a reference sent with `own`; the feature off or no reference yet is REFERENCE_NOT_READY", async () => {
    const off = await seedReferenceBusiness({ payByReference: false });
    const offLink = await seedApiLink(off, "gym-001");
    expect((await confirm(offLink)).body.error?.code).toBe("REFERENCE_NOT_READY");

    const on = await seedReferenceBusiness();
    const unborn = await seedApiLink(on, "gym-002");
    expect((await confirm(unborn)).body.error?.code).toBe("REFERENCE_NOT_READY");
    expect(await db().select().from(payments)).toHaveLength(0);
  });

  it("the day is today − 30 … today in the business's timezone: tomorrow and 31 days ago are refused before any call", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    for (const date of [shiftDay(TODAY, 1), shiftDay(TODAY, -31)]) {
      const res = await confirm(link, { date });
      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("TRANSFER_DATE_OUT_OF_RANGE");
    }
    expect(await providerCalls()).toBe(0);
    mockNotFound();
    expect((await confirm(link, { date: shiftDay(TODAY, -30) })).status).toBe(201);
  });

  it("a 429 is not a round: ladder_round stays where it was", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    mockRateLimited("0");
    const id = (await confirm(link)).body.data!.directPaymentId;
    expect(await rowById(id)).toMatchObject({ status: "validating", ladderRound: 0, lastError: "PROVIDER_RATE_LIMITED" });
    expect((await status(id)).data.ask).toBeNull();
  });

  it("regression: a row without a reference_source keeps today's schedule and its REFERENCE_SHARED stop", async () => {
    const business = await seedReferenceBusiness();
    const mine = await seedApiLink(business, "a");
    const theirs = await seedApiLink(business, "b");
    const typedToday = { referenceNumber: "5550099", senderBank: "AZTECA", date: TODAY, amountCents: 35150 };
    mockNotFound();
    expect((await pay(theirs.token, { transfer: typedToday })).status).toBe(201);
    const res = await pay(mine.token, { transfer: typedToday });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("REFERENCE_SHARED");
  });
});

describe("payment-without-receipt US2: the feed says which path confirmed (T022, D23)", () => {
  it("answers referenceSource — own, typed, and nothing for a row searched by clave", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    mockFound(transfer(TODAY, "07:11:20"));
    await confirm(link);
    const [own] = await db().select().from(payments);
    await db().insert(payments).values({
      paymentLinkId: link.id,
      businessId: business.id,
      amountCents: 35150,
      invoiceCents: 35000,
      serviceFeeCents: 150,
      proofMode: "transfer",
      status: "confirmed",
      referenceSource: "typed",
      folio: "DV-TYPED",
      confirmedAt: new Date(),
      receivedCents: 35150,
    });
    await db().insert(payments).values({
      paymentLinkId: link.id,
      businessId: business.id,
      amountCents: 35150,
      invoiceCents: 35000,
      serviceFeeCents: 150,
      proofMode: "transfer",
      status: "confirmed",
      trackingKey: "CLAVEONLY0001",
      folio: "DV-CLAVE",
      confirmedAt: new Date(),
      receivedCents: 35150,
    });
    const res = await (await app()).request("/payments/feed", await asOwner(business), env);
    const feed = feedResponse.parse(((await res.json()) as { data: unknown }).data);
    const bySource = Object.fromEntries(feed.payments.map((p) => [p.folio, p.referenceSource ?? null]));
    expect(bySource).toEqual({ [own.folio!]: "own", "DV-TYPED": "typed", "DV-CLAVE": null });
  });
});

/* A payment of the customer confirmed on any path at any time — a
   receipt before this feature included (FR-016) */
async function seedPaid(business: Business, link: Link, over: Partial<typeof payments.$inferInsert> = {}) {
  const [row] = await db()
    .insert(payments)
    .values({
      paymentLinkId: link.id,
      businessId: business.id,
      amountCents: 35150,
      invoiceCents: 35000,
      serviceFeeCents: 150,
      proofMode: "receipt",
      status: "confirmed",
      receivedCents: 35150,
      folio: `DV-${crypto.randomUUID().slice(0, 6)}`,
      confirmedAt: new Date(),
      ...over,
    })
    .returning();
  return row;
}

describe("payment-without-receipt US3: Devolada remembers how each customer pays (T029, D7, D12, D13)", () => {
  it("(1) a receipt confirmed before the feature, from Azteca, is a learned bank", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    await seedPaid(business, link, { senderBank: "AZTECA", referenceSource: null });
    expect((await linkRead(link.token)).body.data!.learnedBanks).toEqual(["AZTECA"]);
  });

  it("(2) Azteca and Nu, the most recent first, across every service sharing the reference", async () => {
    const business = await seedReferenceBusiness();
    const { link: home } = await apiPayer(business, "casa");
    const office = await samePerson(business, home, "oficina");
    await seedPaid(business, home, { senderBank: "AZTECA", confirmedAt: new Date(Date.now() - 3 * 86_400_000) });
    await seedPaid(business, office, { senderBank: "NUBANK", confirmedAt: new Date(Date.now() - 86_400_000) });
    await seedPaid(business, office, { senderBank: "AZTECA", status: "invalid", confirmedAt: new Date() });
    expect((await linkRead(home.token)).body.data!.learnedBanks).toEqual(["NUBANK", "AZTECA"]);
  });

  it("(3) bankOrder counts this business's last 90 days only — another business's rows never move it", async () => {
    const business = await seedReferenceBusiness();
    const other = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    const theirs = await seedApiLink(other, "ajeno");
    for (const bank of ["KLAR", "KLAR", "SPIN BY OXXO"]) await seedPaid(business, link, { senderBank: bank });
    await seedPaid(business, link, { senderBank: "AZTECA", confirmedAt: new Date(Date.now() - 91 * 86_400_000) });
    for (let i = 0; i < 5; i++) await seedPaid(other, theirs, { senderBank: "BBVA MEXICO" });
    expect((await linkRead(link.token)).body.data!.bankOrder).toEqual(["KLAR", "SPIN BY OXXO"]);
  });

  it("(4) several on the own reference: the one from an account learned for THIS service confirms, even when not the earliest", async () => {
    const business = await seedReferenceBusiness();
    const { link: home } = await apiPayer(business, "casa");
    const office = await samePerson(business, home, "oficina");
    /* each service paid once before: home from 4417, office from 8301 */
    const homeBefore = transfer(shiftDay(TODAY, -20), "09:00:00", "351.50", SENDER_4417);
    mockFound(homeBefore);
    await confirm(home, { date: shiftDay(TODAY, -20) });
    const officeBefore = transfer(shiftDay(TODAY, -19), "09:00:00", "351.50", SENDER_8301);
    mockFound(officeBefore);
    await confirm(office, { date: shiftDay(TODAY, -19) });

    const early = transfer(TODAY, "07:11:20", "351.50", SENDER_8301);
    const late = transfer(TODAY, "11:40:47", "351.50", SENDER_4417);
    mockSeveral([early, late]);
    const res = await confirm(home);
    const row = await rowById(res.body.data!.directPaymentId);
    expect(row).toMatchObject({ status: "confirmed", trackingKey: late.clave });
    expect(JSON.parse(row.matchTrail!)).toMatchObject({ decided: "chosen", by: "learned_account" });
  });

  it("(5) a transfer from an account never seen confirms, and the next search of that service knows it", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    mockFound(transfer(shiftDay(TODAY, -2), "10:00:00", "351.50", SENDER_4417));
    const first = await confirm(link, { date: shiftDay(TODAY, -2) });
    expect((await rowById(first.body.data!.directPaymentId)).status).toBe("confirmed");

    const early = transfer(TODAY, "07:11:20");
    const known = transfer(TODAY, "11:40:47", "351.50", SENDER_4417);
    mockSeveral([early, known]);
    const next = await confirm(link);
    expect(await rowById(next.body.data!.directPaymentId)).toMatchObject({ trackingKey: known.clave });
  });

  it("(7) no payer-facing answer of the feature carries a digit run of a learned account", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    mockFound(transfer(TODAY, "07:11:20", "351.50", SENDER_4417));
    const paid = await confirm(link);
    const answers = JSON.stringify([
      paid.body,
      await status(paid.body.data!.directPaymentId),
      (await linkRead(link.token)).body,
    ]);
    for (const account of [SENDER_4417]) {
      for (let i = 0; i + 4 <= account.length; i++) expect(answers).not.toContain(account.slice(i, i + 8));
      expect(answers).not.toContain(account.slice(-4));
    }
  });
});

describe("payment-without-receipt US4: the read-back, the ladder and the corrections (T037, D14–D16, D25)", () => {
  it("a reference never found: nothing asked for three rounds, the data after round 3, the clave after round 4, two more rounds, then expired — seven calls", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    const askAt = async (id: string) => (await status(id)).data.ask;
    mockNotFound();
    const id = (await confirm(link, { date: shiftDay(TODAY, -1) })).body.data!.directPaymentId;
    expect(await askAt(id)).toBeNull();
    mockNotFound();
    await stepTo(id, 2);
    expect(await askAt(id)).toBeNull();
    /* round 3: the two neighbouring days */
    mockNotFound();
    mockNotFound();
    await stepTo(id, 8);
    expect(await rowById(id)).toMatchObject({ ladderRound: 3 });
    expect(await askAt(id)).toBe("check_data");
    mockNotFound();
    await stepTo(id, 20);
    expect(await askAt(id)).toBe("clave");
    /* after round 4, the 2-hour slot and the last one — nothing between */
    expect(await stepTo(id, 45)).toMatchObject({ claimed: 0 });
    mockNotFound();
    await stepTo(id, 120);
    expect(await stepTo(id, 360)).toMatchObject({ claimed: 0 });
    mockNotFound();
    await stepTo(id, 720);
    const row = await rowById(id);
    expect(row).toMatchObject({ status: "expired", ladderRound: 6, lastError: "TRANSFER_NOT_FOUND" });
    expect(await providerCalls()).toBe(7);
    expect((await status(id)).data.ask).toBeNull();
  });

  it("429s do not advance the asks: a slot with no answer is no round", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    mockNotFound();
    const id = (await confirm(link)).body.data!.directPaymentId;
    mockNotFound();
    await stepTo(id, 2);
    mockRateLimited("0");
    await stepTo(id, 8);
    expect(await rowById(id)).toMatchObject({ ladderRound: 2 });
    expect((await status(id)).data.ask).toBeNull();
    /* the next slot is round 3, the neighbouring day */
    mockNotFound();
    await stepTo(id, 20);
    expect((await rowById(id)).ladderRound).toBe(3);
    expect((await status(id)).data.ask).toBe("check_data");
  });

  it("a correction carries the chain's rounds, searches at once and, after round 3, is round 4; changing nothing spends nothing", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    mockNotFound();
    const id = (await confirm(link)).body.data!.directPaymentId;
    mockNotFound();
    await stepTo(id, 2);
    mockNotFound();
    await stepTo(id, 8);
    expect((await status(id)).data.ask).toBe("check_data");

    /* the same data again: the attempt in review answers, nothing is spent */
    const calls = await providerCalls();
    const same = await confirm(link, {}, { supersedes: id });
    expect(same.body.data!.directPaymentId).toBe(id);
    expect(await providerCalls()).toBe(calls);

    /* the bank corrected: searched at once, as round 4 of the chain */
    mockFound(transfer(TODAY, "07:11:20", "351.50", SENDER_8301, { senderBank: "BANORTE" }));
    const fixed = await confirm(link, { senderBank: "BANORTE" }, { supersedes: id });
    const row = await rowById(fixed.body.data!.directPaymentId);
    expect(row).toMatchObject({ status: "confirmed", ladderRound: 4, correctionCount: 1, supersedesId: id, senderBank: "BANORTE" });
    expect((await rowById(id)).status).toBe("superseded");
    /* a correction after the confirmation is refused, and the payment stays confirmed */
    const late = await confirm(link, { senderBank: "NUBANK" }, { supersedes: row.id });
    expect(late.status).toBe(404);
    expect((await rowById(row.id)).status).toBe("confirmed");
  });

  it("a fourth search-spending correction is CORRECTIONS_EXHAUSTED; a clave is still accepted and searched at once", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    mockNotFound();
    let id = (await confirm(link)).body.data!.directPaymentId;
    for (const bank of ["BANORTE", "NUBANK", "KLAR"]) {
      mockNotFound();
      id = (await confirm(link, { senderBank: bank }, { supersedes: id })).body.data!.directPaymentId;
    }
    expect((await rowById(id)).correctionCount).toBe(3);
    const refused = await confirm(link, { senderBank: "SPIN BY OXXO" }, { supersedes: id });
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("CORRECTIONS_EXHAUSTED");

    const clave = "MBAN01002609300000000001";
    mockFound(transfer(TODAY, "07:11:20", "351.50", SENDER_8301, { clave }));
    const byClave = await pay(link.token, { transfer: { trackingKey: clave, senderBank: "AZTECA", date: TODAY }, supersedes: id });
    expect(byClave.status).toBe(201);
    expect(await rowById(byClave.body.data!.directPaymentId)).toMatchObject({ status: "confirmed", trackingKey: clave, referenceSource: null });
  });

  it("D25: after a confirmation and three corrections, a clave and then a receipt are not refused by the hourly budget — and do not count toward it", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    mockNotFound();
    let id = (await confirm(link)).body.data!.directPaymentId;
    for (const bank of ["BANORTE", "NUBANK", "KLAR"]) {
      mockNotFound();
      id = (await confirm(link, { senderBank: bank }, { supersedes: id })).body.data!.directPaymentId;
    }
    mockNotFound();
    const byClave = await pay(link.token, {
      transfer: { trackingKey: "MBAN01002609300000000002", senderBank: "AZTECA", date: TODAY },
      supersedes: id,
    });
    expect(byClave.status).toBe(201);

    const reader = { ...testEnv, AI: aiReturning({ esComprobante: true, legibilidad: "completa", claveDeRastreo: null, banco: "AZTECA", monto: 351.5, fecha: TODAY }) } as typeof testEnv;
    const proofId = `${link.id}/receipt-${crypto.randomUUID().slice(0, 8)}`;
    await reader.PROOFS.put(proofId, PNG(80), { httpMetadata: { contentType: "image/png" } });
    const byReceipt = await pay(link.token, { proofId }, reader);
    expect(byReceipt.status).toBe(201);
    const receipt = await rowById(byReceipt.body.data!.directPaymentId);
    expect(receipt.proofKey).toBe(proofId);
    /* the receipt leaves no burned ride behind it */
    expect(await isRevoked(db(), receipt, new Date())).toBe(false);

    /* confirmations still count: the fifth one in the hour is the last */
    mockNotFound();
    expect((await confirm(link, { senderBank: "SPIN BY OXXO" })).status).toBe(201);
    const sixth = await confirm(link, { senderBank: "AZTECA", date: shiftDay(TODAY, -1) });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error?.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("with a release standing, the asks never withdraw it", async () => {
    const business = await seedReferenceBusiness({ provisionalReleaseEnabled: true });
    const link = await seedPanelLink(business, ANA.usuario);
    mockPanelRead();
    await linkRead(link.token);
    mockCustomer({ ...ANA, estado: "Suspendido" }, 2);
    mockPendingInvoices([{ usuario: ANA.usuario, total: 348.5 }], 2);
    mockNotFound();
    fetchMock
      .get(WISPHUB)
      .intercept({ method: "POST", path: "/api/promesa-pago/" })
      .reply(200, JSON.stringify({ id_factura: 42, fecha_limite: "2026-01-01 00:00" }), { headers: { "Content-Type": "application/json" } });
    const id = (await confirm(link)).body.data!.directPaymentId;
    mockNotFound();
    await stepTo(id, 2);
    mockNotFound();
    await stepTo(id, 8);
    const read = await status(id);
    expect(read.data).toMatchObject({ ask: "check_data", provisionalRelease: { evidence: "human" } });
    expect((await rowById(id)).provisionalReleaseAt).not.toBeNull();
  });
});

/* "No puse la referencia": a reference the payer typed */
const typed = (link: Link, referenceNumber: string, over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  pay(link.token, { transfer: { referenceSource: "typed", referenceNumber, senderBank: "AZTECA", date: TODAY, ...over }, ...extra });

/* A payment this service confirmed before, from `account` — what makes
   the account learned for it (D12, D13) */
async function learnedFrom(link: Link, account: string, daysAgo = 10) {
  const day = shiftDay(TODAY, -daysAgo);
  mockFound(transfer(day, "09:30:00", "351.50", account));
  const res = await confirm(link, { date: day });
  expect((await rowById(res.body.data!.directPaymentId)).status).toBe("confirmed");
}

/* Azteca's default reference: the business's own CLABE tail, which no
   person may hold (D3) — the shared reference strangers type */
const SHARED = BUSINESS_CLABE.slice(-7);

describe("payment-without-receipt US5: 'No puse la referencia' (T043, D11, D17)", () => {
  it("another person's reference is refused before anything is created; the payer's own, typed, is handled as their own", async () => {
    const business = await seedReferenceBusiness();
    const { digits: theirs } = await apiPayer(business, "otro");
    const { link, digits: mine } = await apiPayer(business, "yo");
    const refused = await typed(link, theirs, { senderTail: "8301" });
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("REFERENCE_OF_ANOTHER");
    expect(await db().select().from(payments)).toHaveLength(0);

    mockNotFound();
    const own = await typed(link, mine);
    expect(await rowById(own.body.data!.directPaymentId)).toMatchObject({ referenceSource: "own", referenceNumber: mine });
  });

  it.each([
    ["the business's own account tail", SHARED],
    ["a default-looking run", "1234567"],
    ["a leading zero", "0123999"],
  ])("digits no person holds (%s) go on as a shared reference — the four digits asked first, before any call", async (_label, reference) => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    const asked = await typed(link, reference);
    expect(asked.status).toBe(409);
    expect(asked.body.error?.code).toBe("SENDER_TAIL_NEEDED");
    expect(await db().select().from(payments)).toHaveLength(0);
    expect(await providerCalls()).toBe(0);

    mockNotFound();
    const searched = await typed(link, reference, { senderTail: "8301" });
    expect(searched.status).toBe(201);
    expect(await rowById(searched.body.data!.directPaymentId)).toMatchObject({ referenceSource: "typed", referenceNumber: reference, senderTail: "8301" });
  });

  it("a learned account ties one transfer: confirmed, nothing asked", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    await learnedFrom(link, SENDER_4417);
    const mine = transfer(TODAY, "11:40:47", "351.50", SENDER_4417);
    mockSeveral([transfer(TODAY, "07:11:20"), mine]);
    const res = await typed(link, SHARED);
    const row = await rowById(res.body.data!.directPaymentId);
    expect(row).toMatchObject({ status: "confirmed", trackingKey: mine.clave });
    expect(JSON.parse(row.matchTrail!)).toMatchObject({ by: "learned_account" });
  });

  it("four digits that fit one confirm; four that fit none confirm nothing and ask the clave (FR-033)", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    const mine = transfer(TODAY, "11:40:47", "351.50", SENDER_4417);
    mockSeveral([transfer(TODAY, "07:11:20"), mine]);
    const fits = await typed(link, SHARED, { senderTail: "4417" });
    const row = await rowById(fits.body.data!.directPaymentId);
    expect(row).toMatchObject({ status: "confirmed", trackingKey: mine.clave });
    expect(JSON.parse(row.matchTrail!)).toMatchObject({ by: "sender_tail" });

    const { link: other } = await apiPayer(business, "otro");
    mockSeveral([transfer(TODAY, "08:00:00"), transfer(TODAY, "12:00:00", "351.50", SENDER_4417)]);
    const none = await typed(other, SHARED, { senderTail: "9999" });
    const read = directPaymentStatusResponse.parse((await status(none.body.data!.directPaymentId)).data);
    expect(read).toMatchObject({ status: "validating", ask: "clave", referenceSource: "typed", senderTail: "9999" });
  });

  it("a learned account that ties nothing, and no digits: candidates kept, the four digits asked — and fitted with no call", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    await learnedFrom(link, "127180555555512344");
    const mine = transfer(TODAY, "11:40:47", "351.50", SENDER_4417);
    mockSeveral([transfer(TODAY, "07:11:20"), mine]);
    const res = await typed(link, SHARED);
    const id = res.body.data!.directPaymentId;
    expect(await rowById(id)).toMatchObject({ status: "validating", lastError: "CEP_UNDECIDED", nextValidationAt: null });
    expect((await status(id)).data.ask).toBe("sender_tail");

    const calls = await providerCalls();
    const answered = await typed(link, SHARED, { senderTail: "4417" }, { supersedes: id });
    expect(await rowById(answered.body.data!.directPaymentId)).toMatchObject({ status: "confirmed", trackingKey: mine.clave });
    expect(await providerCalls()).toBe(calls);
  });

  it("several that the four digits leave: the clave's last four characters are asked, and one fit confirms from the record with no call", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    const a = transfer(TODAY, "07:11:20", "351.50", SENDER_8301, { clave: "MBAN0100260930000000A7K" });
    const b = transfer(TODAY, "07:13:02", "351.50", SENDER_8301, { clave: "MBAN0100260930000000B9Q" });
    mockSeveral([a, b]);
    const res = await typed(link, SHARED, { senderTail: "8301" });
    const id = res.body.data!.directPaymentId;
    expect(await rowById(id)).toMatchObject({ lastError: "CEP_UNDECIDED" });
    expect((await status(id)).data.ask).toBe("clave_tail");

    const calls = await providerCalls();
    const answered = await typed(link, SHARED, { senderTail: "8301", claveTail: "0b9q" }, { supersedes: id });
    const row = await rowById(answered.body.data!.directPaymentId);
    expect(row).toMatchObject({ status: "confirmed", trackingKey: b.clave, claveTail: "0B9Q" });
    expect(JSON.parse(row.matchTrail!)).toMatchObject({ by: "clave_tail" });
    expect(await providerCalls()).toBe(calls);
  });

  it("two candidates sharing the four characters ask the whole clave", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    const a = transfer(TODAY, "07:11:20", "351.50", SENDER_8301, { clave: "MBAN0100260930000000A7K1" });
    const b = transfer(TODAY, "07:13:02", "351.50", SENDER_8301, { clave: "MBAN0100260930000000B7K1" });
    mockSeveral([a, b]);
    const id = (await typed(link, SHARED, { senderTail: "8301" })).body.data!.directPaymentId;
    const again = await typed(link, SHARED, { senderTail: "8301", claveTail: "07K1" }, { supersedes: id });
    const read = (await status(again.body.data!.directPaymentId)).data;
    expect(read).toMatchObject({ status: "validating", ask: "clave" });
  });

  it("a typed reference not found rides the same ladder as the payer's own", async () => {
    const business = await seedReferenceBusiness();
    const { link } = await apiPayer(business);
    mockNotFound();
    const id = (await typed(link, SHARED, { senderTail: "8301" })).body.data!.directPaymentId;
    mockNotFound();
    await stepTo(id, 2);
    mockNotFound();
    await stepTo(id, 8);
    expect((await status(id)).data.ask).toBe("check_data");
  });
});

describe("payment-without-receipt US5: while a reference changes hands (T055, D26, FR-041)", () => {
  /* Juan held 7815678 as an assigned number; a phone ending in it came,
     and the row passed to Ana: the state `ensurePayerReference` leaves
     (payer-reference.test.ts proves the pass itself) */
  async function handedOver(business: Business) {
    const { link: juan } = await apiPayer(business, "juan");
    await learnedFrom(juan, SENDER_8301);
    const juans = await referenceOfLink(db(), juan);
    const ana = await seedApiLink(business, "ana");
    const [passed] = await db()
      .insert(payerReferences)
      .values({
        businessId: business.id,
        digits: "7815678",
        origin: "phone",
        previousReferenceId: juans!.id,
        transitionEndsAt: new Date(Date.now() + 60 * 86_400_000),
        changedAt: new Date(),
      })
      .returning();
    await db().insert(payerReferenceCustomers).values({ businessId: business.id, referenceId: passed.id, source: "api", customerKey: "ana" });
    return { juan, ana, passed, juanDigits: juans!.digits };
  }

  it("Juan typing his previous digits is accepted and confirms only with an account learned for him", async () => {
    const business = await seedReferenceBusiness();
    const { juan } = await handedOver(business);
    expect((await linkRead(juan.token)).body.data!.payerReference.previousDigits).toBe("7815678");
    const his = transfer(TODAY, "07:11:20", "351.50", SENDER_8301);
    mockSeveral([his, transfer(TODAY, "11:40:47", "351.50", SENDER_4417)]);
    const res = await typed(juan, "7815678");
    expect(res.status).toBe(201);
    const row = await rowById(res.body.data!.directPaymentId);
    expect(row).toMatchObject({ status: "confirmed", trackingKey: his.clave, referenceSource: "typed" });
  });

  it("Ana's own search drops Juan's account, and holds one not yet known for her until she types its four digits", async () => {
    const business = await seedReferenceBusiness();
    const { ana } = await handedOver(business);
    const hers = transfer(TODAY, "11:40:47", "351.50", SENDER_4417);
    mockSeveral([transfer(TODAY, "07:11:20", "351.50", SENDER_8301), hers]);
    const id = (await confirm(ana)).body.data!.directPaymentId;
    const trail = JSON.parse((await rowById(id)).matchTrail!);
    expect(trail.candidates.find((c: { why: string }) => c.why === "excluded")).toBeTruthy();
    expect((await status(id)).data).toMatchObject({ status: "validating", ask: "sender_tail" });

    const answered = await confirm(ana, { senderTail: "4417" }, { supersedes: id });
    expect(await rowById(answered.body.data!.directPaymentId)).toMatchObject({ status: "confirmed", trackingKey: hers.clave });
  });

  it("Juan's first confirmation with his new number ends the transition; after it, Ana's unknown accounts confirm", async () => {
    const business = await seedReferenceBusiness();
    const { juan, ana, passed } = await handedOver(business);
    mockFound(transfer(TODAY, "06:00:00", "351.50", SENDER_8301));
    await confirm(juan);
    const [ended] = await db().select().from(payerReferences).where(eq(payerReferences.id, passed.id));
    expect(ended.transitionEndsAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await linkRead(juan.token)).body.data!.payerReference.previousDigits).toBeNull();

    const hers = transfer(TODAY, "11:40:47", "351.50", SENDER_4417);
    mockFound(hers);
    const res = await confirm(ana);
    expect(await rowById(res.body.data!.directPaymentId)).toMatchObject({ status: "confirmed", trackingKey: hers.clave });
  });
});

describe("payment-without-receipt US4: the provider's quota, for the platform operator only (T050, D19)", () => {
  it("a platform operator reads the latest remaining; a business's owner is refused", async () => {
    const business = await seedReferenceBusiness();
    const operator = { ...testEnv, PLATFORM_OPERATOR_EMAILS: business.email } as typeof testEnv;
    const read = async (bindings: typeof testEnv) =>
      (await app()).request("/platform/provider-quota", await asOwner(business), bindings);
    expect(((await (await read(operator)).json()) as { data: unknown }).data).toBeNull();

    const { link } = await apiPayer(business);
    mockNotFound({ headers: { "X-RateLimit-Remaining": "612" } });
    await confirm(link);
    const res = await read(operator);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({ provider: "apicep", remaining: 612, observedAt: expect.any(Number) });

    const refused = await read(testEnv);
    expect(refused.status).toBe(403);
  });
});

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { businesses, payerReferenceCustomers, payerReferences, paymentLinks } from "../src/db/schema";
import {
  backfillPayerReferences,
  BACKFILL_PER_BUSINESS,
  ensurePayerReference,
  personName,
  referenceOf,
  referenceOfLink,
  TRANSITION_DAYS,
} from "../src/direct-payments/payer-reference";
import { capabilitiesOf } from "../src/integrations/registry";
import { IntegrationError } from "../src/integrations/capabilities";
import { integrationOf } from "../src/integrations/store";
import { isGenericReference } from "../src/routes/direct-payments/schema";
import {
  db,
  linkRead,
  mockCustomer,
  mockPhoneSearch,
  mockPhoneSearchFails,
  seedApiLink,
  seedPanelLink,
  seedReferenceBusiness,
  testEnv,
} from "./payer-helpers";

/* payment-without-receipt US1 (tasks T005, T009) and US5 (T055) — the
   payer's reference: whose it is, and which seven digits.

   A reference is a person's: one phone and one name inside one business.
   The phone's last seven digits when they are safe, an assigned number
   otherwise; the first person to receive the digits keeps them; a phone
   beats an assigned number (D26). WispHub answers who shares a phone at
   its pinned origin; nothing here stores a phone or a name. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

type Business = typeof businesses.$inferSelect;

const ensure = async (
  business: Business,
  customer: { source: "panel" | "api"; key: string; phone: string | null },
  opts: Parameters<typeof ensurePayerReference>[6] = {},
  now = new Date(),
) => ensurePayerReference(db(), env, business, await integrationOf(db(), business.id), customer, now, opts);

const panel = (key: string, phone: string | null) => ({ source: "panel" as const, key, phone });

/* A forced draw: the numbers given, in order, then a fresh safe one */
const drawing = (...numbers: string[]) => {
  let i = 0;
  return () => numbers[i++] ?? `${4 + (i % 5)}${String(100000 + i * 7919).slice(-6)}`;
};

describe("payment-without-receipt US1: customersWithPhone, the adapter's capability (T005, D4)", () => {
  const lookupOf = async (business: Business) => capabilitiesOf(await integrationOf(db(), business.id), env).customersWithPhone!;

  it("keeps exact matches only — a phone ending the same in another area code is someone else — and returns names", async () => {
    const business = await seedReferenceBusiness();
    mockPhoneSearch("8264039", [
      { usuario: "ana@isp", telefono: "55 1826 4039", nombre: "Ana", apellido: "López" },
      { usuario: "otro@isp", telefono: "33 1826 4039", nombre: "Otro", apellido: "Lado" },
      { usuario: "ana2@isp", telefono: "+52 1 55 1826 4039", nombre: "ANA", apellido: "LOPEZ" },
    ]);
    const found = await (await lookupOf(business)).of("5518264039");
    expect(found).toEqual([
      { usuario: "ana@isp", firstName: "Ana", lastName: "López" },
      { usuario: "ana2@isp", firstName: "ANA", lastName: "LOPEZ" },
    ]);
  });

  it("reads two pages to the end", async () => {
    const business = await seedReferenceBusiness();
    const many = Array.from({ length: 60 }, (_, i) => ({ usuario: `c${i}@isp`, telefono: "5518264039", nombre: "Ana" }));
    const seen = new Set<string>();
    mockPhoneSearch("8264039", many, { seen });
    expect(await (await lookupOf(business)).of("5518264039")).toHaveLength(60);
    expect(seen.size).toBe(2);
  });

  it("a refused key throws IntegrationError, never WispHub's own error", async () => {
    const business = await seedReferenceBusiness();
    mockPhoneSearchFails("8264039", 403);
    const failed = await (await lookupOf(business)).of("5518264039").catch((e) => e);
    expect(failed).toBeInstanceOf(IntegrationError);
    expect(failed.code).toBe("INTEGRATION_AUTH_FAILED");
  });
});

describe("payment-without-receipt US1: whose reference (T009, D1–D6)", () => {
  it("(a) a phone alone gives its last seven digits, said to be the phone's, with one holder", async () => {
    const business = await seedReferenceBusiness();
    mockPhoneSearch("8264039", [{ usuario: "ana@isp", telefono: "55 1826 4039", nombre: "Ana", apellido: "López" }]);
    const ref = await ensure(business, panel("ana@isp", "55 1826 4039"));
    expect(ref).toMatchObject({ digits: "8264039", origin: "phone", previousDigits: null });
    const holders = await db().select().from(payerReferenceCustomers);
    expect(holders).toHaveLength(1);
  });

  it("(b) one phone and one name is one person — however the name is typed — and they share the phone's digits", async () => {
    expect(personName("José", "Pérez")).toBe(personName("JOSE ", " PEREZ"));
    const business = await seedReferenceBusiness();
    const people = [
      { usuario: "jose1@isp", telefono: "5518264039", nombre: "José", apellido: "Pérez" },
      { usuario: "jose2@isp", telefono: "5518264039", nombre: "JOSE ", apellido: " PEREZ" },
      { usuario: "jose3@isp", telefono: "55-1826-4039", nombre: "jose", apellido: "perez" },
    ];
    for (const person of people) {
      mockPhoneSearch("8264039", people);
      expect(await ensure(business, panel(person.usuario, person.telefono))).toMatchObject({ digits: "8264039", origin: "phone" });
    }
    expect(await db().select().from(payerReferences)).toHaveLength(1);
  });

  it("(c) one phone under two names: the first to receive a reference keeps the digits, the second gets its own", async () => {
    const business = await seedReferenceBusiness();
    const family = [
      { usuario: "mama@isp", telefono: "5518264039", nombre: "Rosa", apellido: "Díaz" },
      { usuario: "hijo@isp", telefono: "5518264039", nombre: "Luis", apellido: "Díaz" },
    ];
    mockPhoneSearch("8264039", family);
    expect(await ensure(business, panel("mama@isp", "5518264039"))).toMatchObject({ digits: "8264039", origin: "phone" });
    mockPhoneSearch("8264039", family);
    const second = await ensure(business, panel("hijo@isp", "5518264039"));
    expect(second).toMatchObject({ origin: "assigned" });
    expect(second!.digits).not.toBe("8264039");
  });

  it("(c) at switch-on the backfill takes the links oldest first, so the oldest customer keeps the phone's digits", async () => {
    const business = await seedReferenceBusiness();
    const family = [
      { usuario: "hijo@isp", telefono: "5518264039", nombre: "Luis", apellido: "Díaz" },
      { usuario: "mama@isp", telefono: "5518264039", nombre: "Rosa", apellido: "Díaz" },
    ];
    const older = await seedPanelLink(business, "mama@isp", 6);
    await db().update(paymentLinks).set({ createdAt: new Date(Date.now() - 86_400_000) }).where(eq(paymentLinks.id, older.id));
    await seedPanelLink(business, "hijo@isp", 7);
    mockCustomer(family[1]);
    mockPhoneSearch("8264039", family);
    mockCustomer(family[0]);
    mockPhoneSearch("8264039", family);
    expect(await backfillPayerReferences(testEnv)).toEqual({ businesses: 1, assigned: 2 });
    expect(await referenceOf(db(), business.id, { source: "panel", key: "mama@isp" })).toMatchObject({ digits: "8264039" });
    expect(await referenceOf(db(), business.id, { source: "panel", key: "hijo@isp" })).toMatchObject({ origin: "assigned" });
  });

  it("(d) a customer added later joins the person of its name; with a new name it gets its own, and the holder keeps the digits", async () => {
    const business = await seedReferenceBusiness();
    const first = { usuario: "ana@isp", telefono: "5518264039", nombre: "Ana", apellido: "López" };
    mockPhoneSearch("8264039", [first]);
    await ensure(business, panel("ana@isp", "5518264039"));

    const sameName = { usuario: "ana-oficina@isp", telefono: "5518264039", nombre: "ana", apellido: "lópez" };
    mockPhoneSearch("8264039", [first, sameName]);
    expect(await ensure(business, panel(sameName.usuario, sameName.telefono))).toMatchObject({ digits: "8264039" });

    const newName = { usuario: "renta@isp", telefono: "5518264039", nombre: "Renta", apellido: "Local" };
    mockPhoneSearch("8264039", [first, sameName, newName]);
    expect(await ensure(business, panel(newName.usuario, newName.telefono))).toMatchObject({ origin: "assigned" });
    expect(await referenceOf(db(), business.id, { source: "panel", key: "ana@isp" })).toMatchObject({ digits: "8264039" });
  });

  it("(e) no phone, or an API customer, gets an assigned number and asks WispHub nothing", async () => {
    const business = await seedReferenceBusiness();
    expect(await ensure(business, panel("sin-tel@isp", null))).toMatchObject({ origin: "assigned" });
    expect(await ensure(business, panel("fijo@isp", "12 3456"))).toMatchObject({ origin: "assigned" });
    expect(await ensure(business, { source: "api", key: "gym-001", phone: null })).toMatchObject({ origin: "assigned" });
  });

  it.each([
    ["a default-looking run", "5512345678"],
    ["one digit repeated", "5510000000"],
    ["a run down", "5517654321"],
    ["a leading zero", "5510123456"],
    ["the CLABE's own last seven", "5559784417"],
    ["the card's last seven", "5563621486"],
    ["the phone account's last seven", "3337654329"],
    ["a retired account's last seven", "5572345699"],
  ])("(f) D3: %s is never a reference — an assigned number instead", async (_label, phone) => {
    const business = await seedReferenceBusiness({
      speiCard: "4539578763621486",
      speiCardBank: "NUBANK",
      speiPhone: "5587654329",
      speiPhoneBank: "NUBANK",
      speiRetiredAccounts: JSON.stringify([{ kind: "clabe", value: "646180157012345699", bank: "STP", removedAt: 1 }]),
    });
    mockPhoneSearch(phone.slice(-7), [{ usuario: "c@isp", telefono: phone, nombre: "Cliente" }]);
    const ref = await ensure(business, panel("c@isp", phone));
    expect(ref).toMatchObject({ origin: "assigned" });
    expect(ref!.digits).not.toBe(phone.slice(-7));
  });

  it("(g) another phone whose last seven are already a reference gives an assigned number", async () => {
    const business = await seedReferenceBusiness();
    mockPhoneSearch("8264039", [{ usuario: "ana@isp", telefono: "5518264039", nombre: "Ana" }]);
    await ensure(business, panel("ana@isp", "5518264039"));
    mockPhoneSearch("8264039", [
      { usuario: "ana@isp", telefono: "5518264039", nombre: "Ana" },
      { usuario: "gdl@isp", telefono: "3318264039", nombre: "Pedro" },
    ]);
    expect(await ensure(business, panel("gdl@isp", "3318264039"))).toMatchObject({ origin: "assigned" });
  });

  it("(h, j) an assigned number: seven digits, first 1–9, not generic, not ending like the phone; a clash — digits ever held — draws again", async () => {
    const business = await seedReferenceBusiness();
    await ensure(business, { source: "api", key: "first", phone: null }, { draw: drawing("5829163") });
    /* 0123999 starts with 0; 2345678 is generic; 5829163 is held (the
       clash); 6150372 is free */
    const ref = await ensure(business, panel("nuevo@isp", null), { draw: drawing("0123999", "2345678", "5829163", "6150372") });
    expect(ref).toMatchObject({ digits: "6150372", origin: "assigned" });
    /* 5555555 is generic, so an assigned number: 7705555 would end like
       the phone and is drawn again */
    mockPhoneSearch("5555555", [
      { usuario: "a@isp", telefono: "5515555555", nombre: "A" },
      { usuario: "b@isp", telefono: "5515555555", nombre: "B" },
    ]);
    const patterned = await ensure(business, panel("b@isp", "5515555555"), { draw: drawing("7705555", "8150374") });
    expect(patterned!.digits).toBe("8150374");
    for (const digits of [ref!.digits, patterned!.digits]) {
      expect(digits).toMatch(/^[1-9]\d{6}$/);
      expect(isGenericReference(digits)).toBe(false);
    }
  });

  it("(i) WispHub away or a refused key: no reference, and nothing written", async () => {
    const business = await seedReferenceBusiness();
    mockPhoneSearchFails("8264039", 503);
    expect(await ensure(business, panel("ana@isp", "5518264039"))).toBeNull();
    mockPhoneSearchFails("8264039", 401);
    expect(await ensure(business, panel("ana@isp", "5518264039"))).toBeNull();
    expect(await db().select().from(payerReferences)).toHaveLength(0);
    expect(await db().select().from(payerReferenceCustomers)).toHaveLength(0);
  });

  it("(k) no phone and no name is written in any table", async () => {
    const business = await seedReferenceBusiness();
    mockPhoneSearch("8264039", [{ usuario: "ana@isp", telefono: "5518264039", nombre: "Ana María", apellido: "López Ortega" }]);
    await ensure(business, panel("ana@isp", "5518264039"));
    const stored = JSON.stringify([
      await db().select().from(payerReferences),
      await db().select().from(payerReferenceCustomers),
    ]);
    expect(stored).not.toContain("5518264039");
    expect(stored).not.toMatch(/Ana María|López/);
  });

  it("(l) a link pruned and made again finds the same reference", async () => {
    const business = await seedReferenceBusiness();
    const link = await seedPanelLink(business, "ana@isp");
    mockPhoneSearch("8264039", [{ usuario: "ana@isp", telefono: "5518264039", nombre: "Ana" }]);
    const born = await ensure(business, panel("ana@isp", "5518264039"));
    await db().delete(paymentLinks).where(eq(paymentLinks.id, link.id));
    const again = await seedPanelLink(business, "ana@isp");
    expect(await referenceOfLink(db(), again)).toMatchObject({ digits: born!.digits });
  });

  it("(m) the backfill assigns twenty links per business per minute, skips businesses with the switch off, and says nothing when idle", async () => {
    const on = await seedReferenceBusiness();
    const off = await seedReferenceBusiness({ payByReference: false });
    for (let i = 0; i < BACKFILL_PER_BUSINESS + 3; i++) await seedApiLink(on, `cliente-${i}`);
    await seedApiLink(off, "cliente-off");
    expect(await backfillPayerReferences(testEnv)).toEqual({ businesses: 1, assigned: BACKFILL_PER_BUSINESS });
    expect(await backfillPayerReferences(testEnv)).toEqual({ businesses: 1, assigned: 3 });
    expect(await backfillPayerReferences(testEnv)).toEqual({ businesses: 0, assigned: 0 });
    const offHolders = await db()
      .select()
      .from(payerReferenceCustomers)
      .where(eq(payerReferenceCustomers.businessId, off.id));
    expect(offHolders).toHaveLength(0);
  });

  it("(n) a customer who holds a reference keeps it, whatever the business edits in its records (FR-003)", async () => {
    const business = await seedReferenceBusiness();
    mockPhoneSearch("8264039", [{ usuario: "ana@isp", telefono: "5518264039", nombre: "Ana" }]);
    const born = await ensure(business, panel("ana@isp", "5518264039"));
    /* the phone and the name changed in WispHub: nothing is asked again */
    expect(await ensure(business, panel("ana@isp", "3312345098"))).toEqual(born);
  });

  it("the switch off: no reference is born", async () => {
    const business = await seedReferenceBusiness({ payByReference: false });
    expect(await ensure(business, { source: "api", key: "gym-001", phone: null })).toBeNull();
    expect(await db().select().from(payerReferences)).toHaveLength(0);
  });
});

describe("payment-without-receipt US5: a phone beats an assigned number (T055, D26, FR-040)", () => {
  it("the phone's owner takes the row; the previous holder moves to a new number with a 60-day transition, and their link says so", async () => {
    const business = await seedReferenceBusiness();
    const juanLink = await seedApiLink(business, "juan-001");
    const now = new Date();
    const juan = await ensure(business, { source: "api", key: "juan-001", phone: null }, { draw: drawing("7815678") }, now);
    expect(juan).toMatchObject({ digits: "7815678", origin: "assigned" });

    mockPhoneSearch("7815678", [{ usuario: "ana@isp", telefono: "5547815678", nombre: "Ana" }]);
    const ana = await ensure(business, panel("ana@isp", "5547815678"), { draw: drawing("4029185") }, now);
    expect(ana).toMatchObject({ id: juan!.id, digits: "7815678", origin: "phone" });

    const juanNow = await referenceOf(db(), business.id, { source: "api", key: "juan-001" }, now);
    expect(juanNow).toMatchObject({ digits: "4029185", origin: "assigned", previousDigits: "7815678" });

    const [passed] = await db()
      .select()
      .from(payerReferences)
      .where(and(eq(payerReferences.businessId, business.id), eq(payerReferences.digits, "7815678")));
    expect(passed.previousReferenceId).toBe(juanNow!.id);
    expect(passed.transitionEndsAt!.getTime()).toBe(now.getTime() + TRANSITION_DAYS * 86_400_000);
    expect(passed.changedAt!.getTime()).toBe(now.getTime());

    const read = await linkRead(juanLink.token);
    expect(read.body.data!.payerReference).toEqual({ digits: "4029185", fromPhone: false, proven: false, previousDigits: "7815678" });
  });

  it("after 60 days the previous digits are no longer shown", async () => {
    const business = await seedReferenceBusiness();
    const then = new Date(Date.now() - (TRANSITION_DAYS + 1) * 86_400_000);
    await ensure(business, { source: "api", key: "juan-001", phone: null }, { draw: drawing("7815678") }, then);
    mockPhoneSearch("7815678", [{ usuario: "ana@isp", telefono: "5547815678", nombre: "Ana" }]);
    await ensure(business, panel("ana@isp", "5547815678"), { draw: drawing("4029185") }, then);
    expect(await referenceOf(db(), business.id, { source: "api", key: "juan-001" })).toMatchObject({
      digits: "4029185",
      previousDigits: null,
    });
  });
});

import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  businesses,
  integrations,
  platformSettings,
  session as sessionTable,
  storeInvitations,
  storeLedger,
  stores,
  user as userTable,
} from "../src/db/schema";
import { createStoreResponse, platformLedgerResponse, storesListResponse } from "../src/routes/platform/schema";
import { seedStorePayment, seedStore, seedStoreChannel, storeSession } from "./store-helpers";
import type { Bindings } from "../src/env";
import { renderReceipt } from "../src/receipt";
import { DEFAULT_RECEIPT_TEMPLATE, receiptTemplateProblem } from "../src/receipt/template";
import { app, seedBusiness, seedMember, sessionCookieHeader } from "./helpers";

/* cash-at-stores US2 — the operator's side of the network: the fee and
   the receipt's message as platform rules (T023, D22, D31), then the
   stores, the invitation, the switch and the corrections (T034). */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const OPERATOR = "demo@devolada.app";
const opEnv = () => ({ ...(env as unknown as Bindings), PLATFORM_OPERATOR_EMAILS: OPERATOR }) as unknown as typeof env;
const db = () => drizzle(env.DB);

const asOperator = async (path: string, init: RequestInit = {}) =>
  (await app()).request(
    path,
    {
      ...init,
      headers: { "Content-Type": "application/json", Cookie: await sessionCookieHeader(OPERATOR), ...(init.headers ?? {}) },
    },
    opEnv(),
  );
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

describe("cash-at-stores US2 — the network fee and the receipt's message are platform rules (D22, D31)", () => {
  it("both are listed with their birth values: $15.00 and D31's default", async () => {
    await seedBusiness();
    const res = await asOperator("/platform/settings");
    const settings = (await res.json()).data.settings as { key: string; type: string; current: string | null }[];
    expect(settings.find((s) => s.key === "store_fee_cents")).toMatchObject({ type: "cents", current: "1500" });
    expect(settings.find((s) => s.key === "store_receipt_template")).toMatchObject({
      type: "template",
      current: DEFAULT_RECEIPT_TEMPLATE,
    });
  });

  it("a fee change keeps its author; the range is 0–5000", async () => {
    await seedBusiness();
    expect((await asOperator("/platform/settings/store_fee_cents", post({ value: 5001 }))).status).toBe(400);
    const res = await asOperator("/platform/settings/store_fee_cents", post({ value: 2000 }));
    expect(res.status).toBe(201);
    const [row] = await db().select().from(platformSettings).where(eq(platformSettings.key, "store_fee_cents"));
    const [owner] = await db().select().from(userTable).where(eq(userTable.email, OPERATOR));
    expect(row).toMatchObject({ value: "2000", authorUserId: owner.id });
  });

  it("the template's three refusals: the length, a missing {folio}, an unknown placeholder", async () => {
    await seedBusiness();
    const save = (value: string) => asOperator("/platform/settings/store_receipt_template", post({ value }));
    for (const value of [
      "Folio {folio}",
      "Comprobante de pago de {negocio}, gracias por tu pago.",
      "Comprobante de pago {folio} de {negocio} en {sucursal}.",
      `{folio} ${"x".repeat(1000)}`,
    ]) {
      const res = await save(value);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_SETTING");
    }
    const ok = await save("Pago {folio} recibido en {tienda} para {negocio}.\n{pendiente}");
    expect(ok.status).toBe(201);
    const [owner] = await db().select().from(userTable).where(eq(userTable.email, OPERATOR));
    const [row] = await db().select().from(platformSettings).where(eq(platformSettings.key, "store_receipt_template"));
    expect(row).toMatchObject({ authorUserId: owner.id });
  });

  it("the panel's check and the API's are one rule (receiptTemplateProblem)", () => {
    expect(receiptTemplateProblem(DEFAULT_RECEIPT_TEMPLATE)).toBeNull();
    expect(receiptTemplateProblem("Comprobante de pago de {negocio} sin folio")).toEqual({ kind: "missing_folio" });
    expect(receiptTemplateProblem("Comprobante {folio} en {sucursal} hoy")).toEqual({
      kind: "unknown_placeholder",
      name: "sucursal",
    });
    expect(receiptTemplateProblem("{folio}")).toEqual({ kind: "length" });
  });
});

describe("cash-at-stores US2 — renderReceipt fills the template (D31)", () => {
  const values = {
    negocio: "WiFi Plus",
    tienda: "Abarrotes Lupita",
    folio: "DV-7K2Q9M",
    cliente: "Guadalupe Reyes",
    montoCents: 79800,
    cargoCents: 1500,
    pendienteCents: 0,
    /* 2026-10-01 14:35 in Mexico City (UTC−6) */
    at: Date.UTC(2026, 9, 1, 20, 35),
    timezone: "America/Mexico_City",
    timeFormat: "24h" as const,
    estado: "Tu servicio ya está activo.",
  };

  it("the default says *Comprobante de pago*, formats money as es-MX pesos and the time on the business's clock", () => {
    const text = renderReceipt(DEFAULT_RECEIPT_TEMPLATE, values);
    expect(text).toContain("Comprobante de pago · WiFi Plus");
    expect(text).toContain("Folio: DV-7K2Q9M");
    expect(text).toContain("Pagaste: $798.00");
    expect(text).toContain("Cargo por servicio: $15.00");
    expect(text).toContain("Total: $813.00");
    expect(text).toContain("1 de octubre de 2026, 14:35");
    expect(text).not.toMatch(/cobro/i);
  });

  it("drops the {pendiente} line on a whole payment, and fills it after a short one", () => {
    const whole = renderReceipt(DEFAULT_RECEIPT_TEMPLATE, values);
    expect(whole).not.toContain("Queda por pagar");
    expect(whole).toContain("Total: $813.00\nTienda: Abarrotes Lupita");

    const short = renderReceipt(DEFAULT_RECEIPT_TEMPLATE, { ...values, montoCents: 50000, pendienteCents: 29800 });
    expect(short).toContain("Total: $515.00\nQueda por pagar: $298.00\nTienda: Abarrotes Lupita");
  });

  it("keeps the blank lines the operator wrote", () => {
    const text = renderReceipt("Pago {folio}\n\nGracias, {cliente}.", values);
    expect(text).toBe("Pago DV-7K2Q9M\n\nGracias, Guadalupe Reyes.");
  });
});

const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });
const NEW_STORE = { name: "Abarrotes Lupita", address: "Av. Juárez 12, Centro", shopkeeperName: "Lupita Hernández", phone: "55 1234-5678" };
const tokenOf = (url: string) => url.split("/invitacion/")[1];
const callStore = async (path: string, init: RequestInit = {}) =>
  (await app()).request(path, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } }, env);

describe("cash-at-stores US2 — the operator's stores (D4, D6, FR-001–FR-005)", () => {
  it("creates a store as *Invitada* with a phone of ten digits, and an invitation shown once", async () => {
    await seedBusiness();
    const res = await asOperator("/platform/stores", post(NEW_STORE));
    expect(res.status).toBe(201);
    const data = createStoreResponse.parse((await res.json()).data);
    expect(data.store).toMatchObject({ name: "Abarrotes Lupita", phone: "5512345678", status: "invited", collectsFor: [] });
    expect(data.invitation.url).toMatch(/^http:\/\/localhost:5177\/invitacion\/[A-Za-z0-9_-]{43}$/);
    expect(data.invitation.waLink).toMatch(/^https:\/\/wa\.me\/525512345678\?text=/);
    expect(data.invitation.expiresAt - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);

    /* D4: the DB keeps the hash, never the token */
    const token = tokenOf(data.invitation.url);
    const [row] = await db().select().from(storeInvitations);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(await db().select().from(storeInvitations))).not.toContain(token);

    const list = storesListResponse.parse((await (await asOperator("/platform/stores")).json()).data);
    expect(list.stores).toHaveLength(1);
  });

  it("a phone another store uses is PHONE_TAKEN, on create and on edit; a phone that is not ten digits is refused", async () => {
    await seedBusiness();
    await asOperator("/platform/stores", post(NEW_STORE));
    const again = await asOperator("/platform/stores", post({ ...NEW_STORE, name: "Otra tienda", phone: "5512345678" }));
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("PHONE_TAKEN");

    const short = await asOperator("/platform/stores", post({ ...NEW_STORE, phone: "551234567" }));
    expect(short.status).toBe(400);
    expect((await short.json()).error.code).toBe("VALIDATION_ERROR");

    const other = createStoreResponse.parse((await (await asOperator("/platform/stores", post({ ...NEW_STORE, phone: "5587654321" }))).json()).data);
    const edit = await asOperator(`/platform/stores/${other.store.id}`, patch({ phone: "+52 55 1234 5678" }));
    expect(edit.status).toBe(409);
    expect((await edit.json()).error.code).toBe("PHONE_TAKEN");
  });

  it("edits a store; on an accepted store a new phone is also the shopkeeper's sign-in name (FR-003)", async () => {
    await seedBusiness();
    const store = await seedStore({ phone: "5512345678" });
    const { userId } = await storeSession(store);
    const res = await asOperator(`/platform/stores/${store.id}`, patch({ name: "Abarrotes Lupita II", phone: "55-8765-4321" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ name: "Abarrotes Lupita II", phone: "5587654321" });
    const [user] = await db().select().from(userTable).where(eq(userTable.id, userId));
    expect(user).toMatchObject({ username: "5587654321", displayUsername: "5587654321" });
  });

  it("a resend replaces the open invitation: the old token answers invalid, the new one opens; an accepted store is ALREADY_ACCEPTED", async () => {
    await seedBusiness();
    const created = createStoreResponse.parse((await (await asOperator("/platform/stores", post(NEW_STORE))).json()).data);
    const first = tokenOf(created.invitation.url);
    const resend = await asOperator(`/platform/stores/${created.store.id}/invitation`, { method: "POST" });
    expect(resend.status).toBe(201);
    const second = tokenOf((await resend.json()).data.invitation.url);

    expect((await (await callStore(`/store/invitations/${first}`)).json()).data).toEqual({ state: "invalid" });
    const accept = await callStore(`/store/invitations/${first}/accept`, post({ email: "lupita@correo.mx", password: "secreta123" }));
    expect(accept.status).toBe(400);
    expect((await accept.json()).error.code).toBe("INVALID_INVITATION");
    expect((await (await callStore(`/store/invitations/${second}`)).json()).data).toMatchObject({ state: "open", phoneTail: "5678" });

    const [store] = await db().select().from(stores).where(eq(stores.id, created.store.id));
    await storeSession(store);
    const late = await asOperator(`/platform/stores/${created.store.id}/invitation`, { method: "POST" });
    expect(late.status).toBe(409);
    expect((await late.json()).error.code).toBe("ALREADY_ACCEPTED");
  });

  it("suspending refuses the shopkeeper's next action with STORE_SUSPENDED — the screen that says so — and ends that session; reactivating restores access (T077)", async () => {
    await seedBusiness();
    const store = await seedStore();
    const { userId, cookie } = await storeSession(store);
    const res = await asOperator(`/platform/stores/${store.id}`, patch({ status: "suspended" }));
    expect((await res.json()).data.status).toBe("suspended");
    const next = await callStore("/store/cashbox", { headers: { Cookie: cookie } });
    expect(next.status).toBe(403);
    expect((await next.json()).error.code).toBe("STORE_SUSPENDED");
    /* the refusal ended the session it answered */
    expect(await db().select().from(sessionTable).where(eq(sessionTable.userId, userId))).toHaveLength(0);

    const back = await asOperator(`/platform/stores/${store.id}`, patch({ status: "active" }));
    expect((await back.json()).data.status).toBe("active");
  });

  it("a store suspended before acceptance returns to *Invitada*, and its open invitation works again (M6)", async () => {
    await seedBusiness();
    const created = createStoreResponse.parse((await (await asOperator("/platform/stores", post(NEW_STORE))).json()).data);
    const token = tokenOf(created.invitation.url);
    await asOperator(`/platform/stores/${created.store.id}`, patch({ status: "suspended" }));
    expect((await (await callStore(`/store/invitations/${token}`)).json()).data).toEqual({ state: "invalid" });

    const back = await asOperator(`/platform/stores/${created.store.id}`, patch({ status: "active" }));
    expect((await back.json()).data.status).toBe("invited");
    expect((await (await callStore(`/store/invitations/${token}`)).json()).data.state).toBe("open");
  });

  it("a non-operator gets NOT_PLATFORM_OPERATOR on every store door", async () => {
    const business = await seedBusiness();
    await seedMember(business, "socio@wifiplus.mx", "owner");
    const cookie = await sessionCookieHeader("socio@wifiplus.mx");
    for (const [path, init] of [
      ["/platform/stores", {}],
      ["/platform/stores", post(NEW_STORE)],
      ["/platform/stores/x", patch({ name: "Nuevo" })],
      ["/platform/stores/x/invitation", { method: "POST" }],
      ["/platform/stores/x/ledger/y", {}],
      ["/platform/stores/x/ledger/y/corrections", post({ paymentId: "p", cents: 100, reason: "por error" })],
      [`/platform/businesses/${business.id}`, patch({ storeChannel: true })],
    ] as const) {
      const res = await (await app()).request(path, { ...init, headers: { "Content-Type": "application/json", Cookie: cookie } }, opEnv());
      expect(res.status, path).toBe(403);
      expect((await res.json()).error.code).toBe("NOT_PLATFORM_OPERATOR");
    }
  });
});

describe("cash-at-stores US2 — the switch, one capable business at a time (D7, FR-006, FR-007)", () => {
  it("refuses NOT_CAPABLE without the three capabilities, and names them on the row", async () => {
    const business = await seedBusiness();
    const res = await asOperator(`/platform/businesses/${business.id}`, patch({ storeChannel: true }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_CAPABLE");
    const row = (await (await asOperator(`/platform/businesses/${business.id}`)).json()).data;
    expect(row).toMatchObject({ capabilities: [], storeChannel: { on: false, since: null }, storeHeldCents: 0 });
  });

  it("switches on a capable business, refuses a second, and keeps `since` after switching off", async () => {
    const pilot = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const second = await seedBusiness({ email: "otro@isp.mx", wisphubApiKey: "wh-key-2" });
    const on = await asOperator(`/platform/businesses/${pilot.id}`, patch({ storeChannel: true }));
    expect(on.status).toBe(200);
    const row = (await on.json()).data;
    expect(row.storeChannel.on).toBe(true);
    expect(row.capabilities).toEqual(expect.arrayContaining(["customerSearch", "customerDebt", "paymentActions"]));
    const since = row.storeChannel.since;
    expect(since).toEqual(expect.any(Number));

    const refused = await asOperator(`/platform/businesses/${second.id}`, patch({ storeChannel: true }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe("ONE_BUSINESS_AT_A_TIME");

    const off = await asOperator(`/platform/businesses/${pilot.id}`, patch({ storeChannel: false }));
    expect((await off.json()).data.storeChannel).toEqual({ on: false, since });
    const again = await asOperator(`/platform/businesses/${pilot.id}`, patch({ storeChannel: true }));
    expect((await again.json()).data.storeChannel).toEqual({ on: true, since });
  });

  it("two switch-ons at the same moment: one business gets the channel, the other ONE_BUSINESS_AT_A_TIME (T090)", async () => {
    const a = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const b = await seedBusiness({ email: "otro@isp.mx", wisphubApiKey: "wh-key-2" });
    const [ra, rb] = await Promise.all([
      asOperator(`/platform/businesses/${a.id}`, patch({ storeChannel: true })),
      asOperator(`/platform/businesses/${b.id}`, patch({ storeChannel: true })),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect((await loser.json()).error.code).toBe("ONE_BUSINESS_AT_A_TIME");
    const on = await db().select({ id: businesses.id }).from(businesses).where(eq(businesses.storeChannelOn, true));
    expect(on).toHaveLength(1);
  });

  it("the fee override still patches alone", async () => {
    const business = await seedBusiness();
    const res = await asOperator(`/platform/businesses/${business.id}`, patch({ feeOverrideCents: 300 }));
    expect((await res.json()).data.feeOverrideCents).toBe(300);
    const [row] = await db().select().from(businesses).where(eq(businesses.id, business.id));
    expect(row.storeChannelOn).toBe(false);
  });
});

describe("cash-at-stores US2 — corrections in a store's cash book (D21, FR-030)", () => {
  it("a correction writes one movement with its author, moves the balance, and touches no payment", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    await seedStoreChannel(business);
    const store = await seedStore();
    await storeSession(store);
    const [fresh] = await db().select().from(stores).where(eq(stores.id, store.id));
    const payment = await seedStorePayment(business, fresh);
    await db().insert(storeLedger).values({ storeId: store.id, businessId: business.id, kind: "collection", cents: 49900, paymentId: payment.id });

    const res = await asOperator(
      `/platform/stores/${store.id}/ledger/${business.id}/corrections`,
      post({ paymentId: payment.id, cents: -49900, reason: "Cliente equivocado" }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ cents: -49900, reason: "Cliente equivocado" });

    const ledger = platformLedgerResponse.parse((await (await asOperator(`/platform/stores/${store.id}/ledger/${business.id}`)).json()).data);
    expect(ledger.heldCents).toBe(0);
    expect(ledger.rows[0]).toMatchObject({ kind: "correction", cents: -49900, paymentId: payment.id, authorEmail: OPERATOR, folio: payment.folio });

    const list = storesListResponse.parse((await (await asOperator("/platform/stores")).json()).data);
    expect(list.stores[0].collectsFor).toEqual([{ businessId: business.id, businessName: "ISP Demo", heldCents: 0 }]);

    /* the business's row reads the same SUM */
    const row = (await (await asOperator(`/platform/businesses/${business.id}`)).json()).data;
    expect(row.storeHeldCents).toBe(0);
  });

  it("a payment of another store, or of another business, is 404; a reason under 3 characters is refused", async () => {
    const business = await seedBusiness();
    const mine = await seedStore();
    const other = await seedStore();
    const payment = await seedStorePayment(business, other);
    const res = await asOperator(
      `/platform/stores/${mine.id}/ledger/${business.id}/corrections`,
      post({ paymentId: payment.id, cents: 100, reason: "por error" }),
    );
    expect(res.status).toBe(404);
    const short = await asOperator(`/platform/stores/${other.id}/ledger/${business.id}/corrections`, post({ paymentId: payment.id, cents: 100, reason: "x" }));
    expect(short.status).toBe(400);
    /* T091: the rest of FR-030's refusals — another business's book, a
       zero amount, a reason past 280 characters */
    const elsewhere = await seedBusiness({ email: "otro@isp.mx" });
    const foreign = await asOperator(
      `/platform/stores/${other.id}/ledger/${elsewhere.id}/corrections`,
      post({ paymentId: payment.id, cents: 100, reason: "por error" }),
    );
    expect(foreign.status).toBe(404);
    const zero = await asOperator(`/platform/stores/${other.id}/ledger/${business.id}/corrections`, post({ paymentId: payment.id, cents: 0, reason: "por error" }));
    expect(zero.status).toBe(400);
    const long = await asOperator(
      `/platform/stores/${other.id}/ledger/${business.id}/corrections`,
      post({ paymentId: payment.id, cents: 100, reason: "x".repeat(281) }),
    );
    expect(long.status).toBe(400);
    expect(await db().select().from(storeLedger)).toHaveLength(0);
    expect(integrations).toBeTruthy();
  });
});

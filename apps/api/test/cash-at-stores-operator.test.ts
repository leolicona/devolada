import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { platformSettings, user as userTable } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { renderReceipt } from "../src/receipt";
import { DEFAULT_RECEIPT_TEMPLATE, receiptTemplateProblem } from "../src/receipt/template";
import { app, seedBusiness, sessionCookieHeader } from "./helpers";

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

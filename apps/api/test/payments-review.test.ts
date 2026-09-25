import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, integrationEvents, paymentLinks, payments } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { app, seedBusiness, seedMember, sessionCookieHeader } from "./helpers";

/* receipt-triage US3 (plan D31, contracts/review.md) — a payment held for
   the business's decision: Banxico confirmed it, and it was paid to an
   account the business had removed (FR-020a) or confirmed by reference
   with no clave while the provider could not vouch for it (FR-006).
   Setup follows the "Ejecutar ahora" suite (integration-dispatch.test.ts):
   the accept dispatches exactly what the gate recorded. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";

const testEnv = { ...env } as typeof env & Bindings;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const asOwner = { Cookie: await sessionCookieHeader("demo@devolada.app") };
const db = () => drizzle(env.DB);
const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const json = (body: unknown) => [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

/* PATCH + formas + registrar + the verify lookup: the reconnection the
   accepted hypothesis dispatches */
function mockDispatch() {
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
    .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  wh()
    .intercept({ method: "POST", path: "/api/facturas/42/registrar-pago/" })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
    .reply(
      ...json({
        count: 1,
        results: [{ id_servicio: 6, usuario: "greyes@wifiplus", nombre: "Janely", estado: "Activo", saldo: "0.00" }],
      }),
    );
}

async function seedHeld(over: Partial<typeof payments.$inferInsert> = {}, businessOver: Parameters<typeof seedBusiness>[0] = {}) {
  const business = await seedBusiness({
    wisphubApiKey: "wh-key-1",
    speiClabe: "646180157000000004",
    speiBank: "STP",
    ...businessOver,
  });
  const [link] = await db()
    .insert(paymentLinks)
    .values({ businessId: business.id, token: `tok${crypto.randomUUID().slice(0, 12)}`, wisphubCustomerId: "6", customerUsuario: "greyes@wifiplus" })
    .returning();
  const [row] = await db()
    .insert(payments)
    .values({
      paymentLinkId: link.id,
      businessId: business.id,
      amountCents: 51400,
      invoiceCents: 49900,
      serviceFeeCents: 1500,
      proofMode: "receipt",
      status: "confirmed",
      folio: `DV-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      receivedCents: 51400,
      registeredCents: 49900,
      reconciliationClass: "exact",
      wisphubCustomerId: "6",
      customerUsuario: "greyes@wifiplus",
      customerName: "Janely",
      wisphubInvoiceId: 42,
      observedAction: "register_and_reconnect:reconnect",
      actionOutcome: "review",
      reviewReason: "retired_account",
      beneficiary: JSON.stringify({ kind: "card", value: "4000000000004321", bank: "NUBANK", retired: true }),
      confirmedAt: new Date(),
      ...over,
    })
    .returning();
  return { business, link, row };
}

const review = async (id: string, decision: "accept" | "reject", headers: Record<string, string> = asOwner) =>
  (await app()).request(
    `/payments/${id}/review`,
    { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ decision }) },
    testEnv,
  );

describe("receipt-triage US3: the business decides on a held payment (D31)", () => {
  it("the feed shows why it waits and which removed account received it, masked", async () => {
    await seedHeld();
    const res = await (await app()).request("/payments/feed", { headers: asOwner }, testEnv);
    const { data } = await res.json();
    expect(data.payments[0]).toMatchObject({
      actionOutcome: "review",
      reviewReason: "retired_account",
      reviewAccount: { kind: "card", last4: "4321" },
    });
    /* not counted as paid while it waits */
    expect(data.today.count).toBe(0);
  });

  it("accept dispatches what the gate recorded, as an accepted observation does, and records who decided", async () => {
    const { row } = await seedHeld();
    mockDispatch();
    const res = await review(row.id, "accept");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual({ status: "confirmed", actionOutcome: "done" });
    const [after] = await db().select().from(payments).where(eq(payments.id, row.id));
    expect(after.reviewedBy).not.toBeNull();
    expect(after.reviewedAt).not.toBeNull();
    const [event] = await db().select().from(integrationEvents);
    expect(event).toMatchObject({ action: "register_and_reconnect", status: "acked" });
  });

  it("accept, with the business's actions in observation: the row joins the ones it executes by hand", async () => {
    const { row } = await seedHeld({}, { actionsEnabled: false });
    const { data } = await (await review(row.id, "accept")).json();
    expect(data.actionOutcome).toBe("observation");
  });

  it("reject: invalid, REJECTED_BY_BUSINESS, no action — and nothing reaches WispHub", async () => {
    const { row } = await seedHeld({ reviewReason: "no_clave" });
    const res = await review(row.id, "reject");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: "invalid", actionOutcome: null });
    const [after] = await db().select().from(payments).where(eq(payments.id, row.id));
    expect(after).toMatchObject({ status: "invalid", lastError: "REJECTED_BY_BUSINESS", actionOutcome: null });
    expect(after.reviewedAt).not.toBeNull();
  });

  it("a row that is not held is NOT_REVIEWABLE (409)", async () => {
    const { row } = await seedHeld({ actionOutcome: "done", reviewReason: null });
    const res = await review(row.id, "accept");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_REVIEWABLE");
  });

  it("a role without payments/operate cannot decide", async () => {
    const { row } = await seedHeld();
    const [b] = await db().select().from(businesses);
    await seedMember({ orgId: b.orgId }, "lector@wifiplus.mx", "viewer");
    const res = await review(row.id, "accept", { Cookie: await sessionCookieHeader("lector@wifiplus.mx") });
    expect(res.status).toBe(403);
  });

  it("another business's held row is not found", async () => {
    await seedBusiness({ speiClabe: "646180157000000004", speiBank: "STP" });
    const other = await seedBusiness({ email: "otro@isp.mx", speiClabe: "646180157000000004", speiBank: "STP" });
    const [link] = await db()
      .insert(paymentLinks)
      .values({ businessId: other.id, token: "tokotro000000001", wisphubCustomerId: "6", customerUsuario: "x@otro" })
      .returning();
    const [row] = await db()
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: other.id,
        amountCents: 100,
        invoiceCents: 100,
        serviceFeeCents: 0,
        proofMode: "receipt",
        status: "confirmed",
        actionOutcome: "review",
        reviewReason: "no_clave",
      })
      .returning();
    const res = await review(row.id, "accept");
    expect(res.status).toBe(404);
  });

  it("a request with no decision is refused by the contract", async () => {
    const { row } = await seedHeld();
    const res = await (await app()).request(
      `/payments/${row.id}/review`,
      { method: "POST", headers: { "Content-Type": "application/json", ...asOwner }, body: JSON.stringify({ decision: "maybe" }) },
      testEnv,
    );
    expect(res.status).toBe(400);
  });
});

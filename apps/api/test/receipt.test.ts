import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { charges } from "../src/db/schema";
import { toWhatsAppPhone } from "../src/receipt";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/charges/receipt.spec.md scenarios 1–4. */

const asStore = { headers: { Cookie: await sessionCookieHeader("5512345678") } };

async function seedCharge(over: Partial<typeof charges.$inferInsert> = {}) {
  const isp = await seedIsp();
  const store = await seedStore(isp.id, { name: "Abarrotes La Esquina" });
  const db = drizzle(env.DB);
  const [charge] = await db
    .insert(charges)
    .values({
      ispId: isp.id,
      storeId: store.id,
      folio: "DV-RCPT01",
      wisphubCustomerId: "greyes@wifiplus",
      customerName: "Janely",
      customerPhone: "55 1234 5678",
      monthlyFeeCents: 39900,
      serviceFeeCents: 1500,
      totalCents: 41400,
      reconnectionStatus: "reconnected",
      ...over,
    })
    .returning();
  return { isp, store, charge, db };
}

const receiptOf = async (id: string, headers = asStore.headers) => {
  const res = await (await app()).request(`/charges/${id}/receipt`, { headers }, env);
  return { status: res.status, body: await res.json() };
};

describe("US-C05: the customer leaves with a folio they can keep", () => {
  it("carries the breakdown and a WhatsApp link to the customer", async () => {
    const { charge } = await seedCharge();

    const { status, body } = await receiptOf(charge.id);
    expect(status).toBe(200);
    const { data } = body;

    expect(data).toMatchObject({
      folio: "DV-RCPT01",
      customerName: "Janely",
      totalCents: 41400,
      phone: "525512345678",
    });
    /* The text is finished copy, not fields to assemble (D2) */
    expect(data.text).toContain("Folio: DV-RCPT01");
    expect(data.text).toContain("Mensualidad: $399.00");
    expect(data.text).toContain("Cargo por servicio: $15.00");
    expect(data.text).toContain("Total pagado: $414.00");
    expect(data.text).toContain("Abarrotes La Esquina");

    expect(data.waLink).toContain("https://wa.me/525512345678?text=");
    expect(decodeURIComponent(data.waLink.split("text=")[1])).toBe(data.text);
  });

  it("without a phone the link opens WhatsApp with no number (D3)", async () => {
    /* The common case on real data: WispHub's customers often have none */
    const { charge } = await seedCharge({ customerPhone: null, folio: "DV-RCPT02" });

    const { data } = (await receiptOf(charge.id)).body;
    expect(data.phone).toBeNull();
    expect(data.waLink.startsWith("https://wa.me/?text=")).toBe(true);
    expect(data.text).toContain("Folio: DV-RCPT02");
  });

  it("says what happened to the service, per status (D5)", async () => {
    const { charge, db } = await seedCharge({ reconnectionStatus: "queued", folio: "DV-RCPT03" });
    expect((await receiptOf(charge.id)).body.data.text).toContain("se reactiva en unos minutos");

    await db
      .update(charges)
      .set({ reconnectionStatus: "reconnected" })
      .where(eq(charges.id, charge.id));
    expect((await receiptOf(charge.id)).body.data.text).toContain("ya está activo");

    await db
      .update(charges)
      .set({ reconnectionStatus: "failed" })
      .where(eq(charges.id, charge.id));
    expect((await receiptOf(charge.id)).body.data.text).toContain("comunícate con tu proveedor");
  });

  it("a foreign charge is not readable, and an ISP session is refused", async () => {
    const { charge, isp } = await seedCharge();
    const other = await seedStore(isp.id, { phone: "5599998888", name: "Otra tienda" });
    const db = drizzle(env.DB);
    const [foreign] = await db
      .insert(charges)
      .values({
        ispId: isp.id,
        storeId: other.id,
        folio: "DV-OTHER1",
        wisphubCustomerId: "otro@wifiplus",
        customerName: "Otro",
        monthlyFeeCents: 39900,
        serviceFeeCents: 1500,
        totalCents: 41400,
      })
      .returning();

    expect((await receiptOf(foreign.id)).status).toBe(404);
    expect(
      (await receiptOf(charge.id, { Cookie: await sessionCookieHeader("demo@devolada.app") })).status,
    ).toBe(403);
  });
});

describe("US-C05: phone numbers arrive in whatever shape the ISP typed", () => {
  it("normalizes what it can and refuses what it cannot", () => {
    expect(toWhatsAppPhone("5512345678")).toBe("525512345678");
    expect(toWhatsAppPhone("55 1234 5678")).toBe("525512345678");
    expect(toWhatsAppPhone("+52 55 1234 5678")).toBe("525512345678");
    /* The old WhatsApp-only 1 that Mexico dropped */
    expect(toWhatsAppPhone("5215512345678")).toBe("525512345678");
    /* Better no link than a stranger's chat */
    expect(toWhatsAppPhone("123")).toBeNull();
    expect(toWhatsAppPhone("")).toBeNull();
    expect(toWhatsAppPhone(null)).toBeNull();
  });
});

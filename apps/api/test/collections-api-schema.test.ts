import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { paymentLinks, payments } from "../src/db/schema";
import { isUniqueViolation } from "../src/direct-payments/validation";
import { seedBusiness } from "./helpers";

/* automated-collections-api US1 — the migration's invariants (research
   D2, D3, D4; data-model.md). One `payment_links` table carries both
   collection channels: an API link needs no WispHub customer, a reusable
   link is unique per business and customer reference, and the panel's
   usuario namespace never collides with the API's reference namespace. */

const db = () => drizzle(env.DB);

const apiLink = (businessId: string, over: Partial<typeof paymentLinks.$inferInsert> = {}) => ({
  businessId,
  token: `tok${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
  source: "api" as const,
  mode: "reusable" as const,
  customerRef: "CLI-4471",
  askCents: 49900,
  ...over,
});

describe("D3: an API link row needs no WispHub customer", () => {
  it("inserts with source=api, a reference and an ask, and null WispHub columns", async () => {
    const business = await seedBusiness();
    const [row] = await db().insert(paymentLinks).values(apiLink(business.id)).returning();
    expect(row.source).toBe("api");
    expect(row.mode).toBe("reusable");
    expect(row.customerRef).toBe("CLI-4471");
    expect(row.askCents).toBe(49900);
    expect(row.wisphubCustomerId).toBeNull();
    expect(row.customerUsuario).toBeNull();
    expect(row.isTest).toBe(false);
    expect(row.expiresAt).toBeNull();
    expect(row.closedAt).toBeNull();
  });

  it("a panel row keeps its shape and defaults: source=panel, mode=reusable, no reference or ask", async () => {
    const business = await seedBusiness();
    const [row] = await db()
      .insert(paymentLinks)
      .values({ businessId: business.id, token: "tok1234567890abcd", wisphubCustomerId: "6", customerUsuario: "greyes@wifiplus" })
      .returning();
    expect(row.source).toBe("panel");
    expect(row.mode).toBe("reusable");
    expect(row.customerRef).toBeNull();
    expect(row.askCents).toBeNull();
  });

  it("a payment row carries the caller's reference, the asked amount and the test flag", async () => {
    const business = await seedBusiness();
    const [link] = await db().insert(paymentLinks).values(apiLink(business.id)).returning();
    const [payment] = await db()
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 49900,
        invoiceCents: 49900,
        serviceFeeCents: 0,
        proofMode: "transfer",
        customerRef: "CLI-4471",
        askedCents: 49900,
      })
      .returning();
    expect(payment.customerRef).toBe("CLI-4471");
    expect(payment.askedCents).toBe(49900);
    expect(payment.isTest).toBe(false);
  });
});

describe("D4: two partial unique indexes replace one", () => {
  it("a second reusable link for one customer_ref is rejected by the database", async () => {
    const business = await seedBusiness();
    await db().insert(paymentLinks).values(apiLink(business.id));
    const second = db().insert(paymentLinks).values(apiLink(business.id));
    await expect(second).rejects.toSatisfy(isUniqueViolation);
  });

  it("a one-time link for the same customer_ref is allowed — a customer can hold many", async () => {
    const business = await seedBusiness();
    await db().insert(paymentLinks).values(apiLink(business.id));
    const oneTime = apiLink(business.id, { mode: "one_time", expiresAt: new Date(Date.now() + 86_400_000) });
    await db().insert(paymentLinks).values(oneTime);
    await db().insert(paymentLinks).values({ ...oneTime, token: `tok${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}` });
    expect(await db().select().from(paymentLinks)).toHaveLength(3);
  });

  it("the same customer_ref is one link per business, not per platform", async () => {
    const a = await seedBusiness();
    const b = await seedBusiness({ email: "otro@business.mx" });
    await db().insert(paymentLinks).values(apiLink(a.id));
    await db().insert(paymentLinks).values(apiLink(b.id));
    expect(await db().select().from(paymentLinks)).toHaveLength(2);
  });

  it("a panel link and an API link may share the same string without colliding", async () => {
    const business = await seedBusiness();
    await db()
      .insert(paymentLinks)
      .values({ businessId: business.id, token: "tokpanel000000001", wisphubCustomerId: "6", customerUsuario: "CLI-4471" });
    await db().insert(paymentLinks).values(apiLink(business.id, { customerRef: "CLI-4471" }));
    const rows = await db().select().from(paymentLinks);
    expect(rows.map((r) => r.source).sort()).toEqual(["api", "panel"]);
  });

  it("the panel's own uniqueness survives the rebuild: one usuario, one link", async () => {
    const business = await seedBusiness();
    const panel = { businessId: business.id, token: "tokpanel000000001", wisphubCustomerId: "6", customerUsuario: "greyes@wifiplus" };
    await db().insert(paymentLinks).values(panel);
    await expect(db().insert(paymentLinks).values({ ...panel, token: "tokpanel000000002" })).rejects.toSatisfy(isUniqueViolation);
  });

  it("the migration recreated both partial indexes and dropped the old one (T009)", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'payment_links'",
    ).all<{ name: string; sql: string | null }>();
    const byName = new Map(results.map((r) => [r.name, r.sql]));
    expect(byName.get("payment_links_panel_usuario_idx")).toMatch(/WHERE source = 'panel'/);
    expect(byName.get("payment_links_api_ref_idx")).toMatch(/WHERE source = 'api' AND mode = 'reusable'/);
    expect(byName.has("payment_links_business_usuario_idx")).toBe(false);
    /* the rebuild left no scratch table behind */
    const stray = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '\\_\\_%payment_links' ESCAPE '\\'").all();
    expect(stray.results).toEqual([]);
  });
});

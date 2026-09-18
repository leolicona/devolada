import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { paymentLinks } from "../src/db/schema";
import {
  askAvailable,
  businessConfigured,
  channelGap,
  validationAvailable,
} from "../src/direct-payments/validation";
import { linkAcceptsPayments, linkState } from "../src/direct-payments/links";
import type { Bindings } from "../src/env";
import { app, fakeProofs, seedBusiness } from "./helpers";

/* automated-collections-api US1 — the gate split (research D5). Until
   2026-09-17 a business could not collect by SPEI without a WispHub key,
   because one predicate demanded it. Now the CLABE and bank are the
   business's gate, the provider token is the platform's, and the WispHub
   key is a panel link's. A business with no integration row at all can
   hold a link; a platform gap is never the business's fault; and a panel
   link without the key degrades exactly as it did before the split. */

beforeAll(() => {
  fetchMock.activate();
  /* No interceptor is armed in this file: any provider call fails the test */
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const SPEI = { speiClabe: "012345678901234567", speiBank: "BBVA MEXICO", speiBeneficiaryName: "ISP Demo SA" };
const testEnv = { ...env, PROOFS: fakeProofs() } as typeof env & Bindings;
const withoutToken = { ...testEnv, APICEP_TOKEN: undefined } as typeof env & Bindings;

describe("D5: businessConfigured — the business's own gate", () => {
  it("passes on a CLABE plus a known bank, with no integration row at all", async () => {
    const business = await seedBusiness(SPEI);
    expect(businessConfigured(business)).toBe(true);
    expect(channelGap(business)).toBeNull();
  });

  it("names the CLABE when it is missing", async () => {
    const business = await seedBusiness({ ...SPEI, speiClabe: null });
    expect(businessConfigured(business)).toBe(false);
    expect(channelGap(business)).toBe("clabe");
  });

  it("names the bank when it is missing or outside apiCEP's vocabulary (BUG-008)", async () => {
    expect(channelGap(await seedBusiness({ ...SPEI, speiBank: null }))).toBe("bank");
    expect(channelGap(await seedBusiness({ ...SPEI, speiBank: "Klar", email: "klar@business.mx" }))).toBe("bank");
  });

  it("a configured business with no WispHub integration can hold an API link row", async () => {
    const business = await seedBusiness(SPEI);
    const [link] = await drizzle(env.DB)
      .insert(paymentLinks)
      .values({ businessId: business.id, token: "tokapi00000000001", source: "api", customerRef: "CLI-1", askCents: 10000 })
      .returning();
    expect(link.businessId).toBe(business.id);
    expect(askAvailable(link, null)).toBe(true);
  });
});

describe("D5: validationAvailable — the platform's gate, never the business's", () => {
  it("is false without the provider token, while the business's own gate still passes", async () => {
    const business = await seedBusiness(SPEI);
    expect(validationAvailable(withoutToken)).toBe(false);
    expect(validationAvailable(testEnv)).toBe(true);
    /* the two gates are independent: a platform gap registers as no
       business gap — that is what lets /v1 create the link and attach a
       VALIDATION_UNAVAILABLE notice instead of refusing (FR-009) */
    expect(businessConfigured(business)).toBe(true);
    expect(channelGap(business)).toBeNull();
  });

  it("on the payer's page it is a state, not a refusal: 200 with `unavailable`, no provider call", async () => {
    const business = await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    await drizzle(env.DB)
      .insert(paymentLinks)
      .values({ businessId: business.id, token: "tokpanel000000001", wisphubCustomerId: "6", customerUsuario: "greyes@wifiplus" });
    const res = await (await app()).request("/direct-payments/links/tokpanel000000001", {}, withoutToken);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("unavailable");
  });
});

describe("D5: askAvailable — a panel link's gate, and nothing else's", () => {
  it("a panel link needs the WispHub key; an API link needs nothing more", () => {
    expect(askAvailable({ source: "panel" }, null)).toBe(false);
    expect(askAvailable({ source: "panel" }, { apiKey: null })).toBe(false);
    expect(askAvailable({ source: "panel" }, { apiKey: "wh-key-1" })).toBe(true);
    expect(askAvailable({ source: "api" }, null)).toBe(true);
  });

  it("a panel link without the WispHub key degrades exactly as before: GET `unavailable`, POST SPEI_NOT_CONFIGURED", async () => {
    /* SPEI configured, provider token present, no integration row */
    const business = await seedBusiness(SPEI);
    await drizzle(env.DB)
      .insert(paymentLinks)
      .values({ businessId: business.id, token: "tokpanel000000001", wisphubCustomerId: "6", customerUsuario: "greyes@wifiplus" });

    const get = await (await app()).request("/direct-payments/links/tokpanel000000001", {}, testEnv);
    expect(get.status).toBe(200);
    expect((await get.json()).data.status).toBe("unavailable");

    const post = await (await app()).request("/direct-payments/links/tokpanel000000001/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transfer: { trackingKey: "ABC123456789", senderBank: "BBVA MEXICO", date: "2026-09-17" } }),
    }, testEnv);
    expect(post.status).toBe(409);
    expect((await post.json()).error.code).toBe("SPEI_NOT_CONFIGURED");
  });
});

describe("D3: link state is derived from closed_at and expires_at", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  const later = new Date(now.getTime() + 60_000);
  const earlier = new Date(now.getTime() - 60_000);

  it("a reusable link is always open", () => {
    expect(linkState({ closedAt: null, expiresAt: null }, now)).toBe("open");
    expect(linkAcceptsPayments({ closedAt: null, expiresAt: null }, now)).toBe(true);
  });

  it("a one-time link is open until its deadline, expired after it, paid once closed", () => {
    expect(linkState({ closedAt: null, expiresAt: later }, now)).toBe("open");
    expect(linkState({ closedAt: null, expiresAt: now }, now)).toBe("expired");
    expect(linkState({ closedAt: null, expiresAt: earlier }, now)).toBe("expired");
    expect(linkState({ closedAt: earlier, expiresAt: later }, now)).toBe("paid");
    /* paid wins over a passed deadline: the money arrived before it */
    expect(linkState({ closedAt: earlier, expiresAt: earlier }, now)).toBe("paid");
    expect(linkAcceptsPayments({ closedAt: null, expiresAt: earlier }, now)).toBe(false);
    expect(linkAcceptsPayments({ closedAt: earlier, expiresAt: null }, now)).toBe(false);
  });
});

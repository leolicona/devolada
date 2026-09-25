import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { businesses, integrations } from "../src/db/schema";
import { app, seedBusiness, sessionCookieHeader } from "./helpers";

/* docs/legacy/admin/settings.spec.md scenarios 1–3. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const asBusiness = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };

const send = (path: string, method: string, body?: unknown): [string, RequestInit] => [
  path,
  {
    method,
    headers: { "Content-Type": "application/json", ...asBusiness.headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  },
];

describe("US-A04: the ISP reads its settings", () => {
  it("returns the business's own fields (the key and the dials left for the hub, integrations-hub D9)", async () => {
    await seedBusiness({ wisphubApiKey: "01q9K2Rf.SECRETKEY1234" });

    const res = await (await app()).request("/settings", asBusiness, env);
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data).toMatchObject({
      serviceFeeCents: 1500,
      timezone: "America/Mexico_City",
      timeFormat: "12h",
    });
    expect(data.wisphub).toBeUndefined();
    expect(data.reconnection).toBeUndefined();
    /* D1 still holds across the move: the key never travels back */
    expect(JSON.stringify(data)).not.toContain("SECRETKEY");
  });
});

describe("US-A04: saving the zone and the format", () => {
  it("saves the fields", async () => {
    await seedBusiness();
    const client = await app();

    const ok = await client.request(
      ...send("/settings", "PATCH", {
        timezone: "America/Hermosillo",
        timeFormat: "24h",
      }),
      env,
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({
      timezone: "America/Hermosillo",
      timeFormat: "24h",
    });

    /* An unknown zone would silently move a business day */
    const badZone = await client.request(
      ...send("/settings", "PATCH", { timezone: "Europe/Madrid" }),
      env,
    );
    expect(badZone.status).toBe(400);
  });

  it("D9 (BUG-017): the general fee is not patchable — the SPEI fee is the one control", async () => {
    await seedBusiness();
    const client = await app();

    const res = await client.request(
      ...send("/settings", "PATCH", { serviceFeeCents: 2000, speiServiceFeeCents: 900 }),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    /* the unknown key is dropped at the edge; the birth default stands */
    expect(data.serviceFeeCents).toBe(1500);
    expect(data.spei.serviceFeeCents).toBe(900);
    expect(data.spei.effectiveServiceFeeCents).toBe(900);
  });
});

describe("US-D05: the ISP configures its SPEI account and fee", () => {
  it("saves CLABE, bank, beneficiary and fee; null fee falls back", async () => {
    await seedBusiness();

    const res = await (await app()).request(
      ...send("/settings", "PATCH", {
        speiClabe: "646180157000000004",
        speiBank: "STP",
        speiBeneficiaryName: "WifiPlus SA de CV",
        speiServiceFeeCents: 800,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.spei).toMatchObject({
      clabe: "646180157000000004",
      bank: "STP",
      beneficiaryName: "WifiPlus SA de CV",
      serviceFeeCents: 800,
      effectiveServiceFeeCents: 800,
      configured: true,
    });

    /* clearing the fee falls back to the birth default (D3) — the API
       still takes null; the settings page never sends it (settings D9) */
    const cleared = await (await app()).request(
      ...send("/settings", "PATCH", { speiServiceFeeCents: null }),
      env,
    );
    const { data: after } = await cleared.json();
    expect(after.spei.serviceFeeCents).toBeNull();
    expect(after.spei.effectiveServiceFeeCents).toBe(after.serviceFeeCents);
  });

  it("US-D13 scenario 7: SPEI is configured without a beneficiary name", async () => {
    await seedBusiness();

    /* claimed-amount D5: clabe + a known bank are the whole requirement —
       the provider never asked for the name, only our gates did */
    const res = await (await app()).request(
      ...send("/settings", "PATCH", {
        speiClabe: "646180157000000004",
        speiBank: "STP",
      }),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.spei.configured).toBe(true);
    expect(data.spei.beneficiaryName).toBeNull();
  });

  it("rejects a malformed CLABE and stays unconfigured by default", async () => {
    await seedBusiness();

    const bad = await (await app()).request(
      ...send("/settings", "PATCH", { speiClabe: "12345" }),
      env,
    );
    expect(bad.status).toBe(400);

    const res = await (await app()).request("/settings", asBusiness, env);
    const { data } = await res.json();
    expect(data.spei.configured).toBe(false);
    expect(data.spei.effectiveServiceFeeCents).toBe(data.serviceFeeCents);
  });
});


/* receipt-triage US3 (contracts/settings.md; D26, D29, D30, D32): the
   three accounts and the cuenta de cobro. A Luhn-valid test card. */
const CARD = "4111111111111111";
const PHONE = "5512345678";

describe("receipt-triage US3: the accounts an ISP is paid at", () => {
  const patch = async (body: unknown, headers: Record<string, string> = asBusiness.headers) =>
    (await app()).request(
      "/settings",
      { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) },
      env,
    );
  const row = async () => (await drizzle(env.DB).select().from(businesses))[0];

  it("the owner saves a card and a phone, each with its bank, and makes the card the cuenta de cobro", async () => {
    await seedBusiness({ speiClabe: "646180157000000004", speiBank: "STP" });
    const res = await patch({ speiCard: CARD, speiCardBank: "NUBANK", speiPhone: PHONE, speiPhoneBank: "BBVA MEXICO", speiCollectKind: "card" });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.spei).toMatchObject({
      card: CARD,
      cardBank: "NUBANK",
      phone: PHONE,
      phoneBank: "BBVA MEXICO",
      collectKind: "card",
      configured: true,
    });
  });

  it.each([
    ["a failing check digit", { speiCard: "4111111111111112", speiCardBank: "NUBANK" }],
    ["15 digits", { speiCard: "411111111111111", speiCardBank: "NUBANK" }],
    ["17 digits", { speiCard: "41111111111111111", speiCardBank: "NUBANK" }],
    ["a 9-digit phone", { speiPhone: "551234567", speiPhoneBank: "NUBANK" }],
    ["a card without its bank", { speiCard: CARD }],
    ["a phone without its bank", { speiPhone: PHONE }],
    ["a bank outside the vocabulary", { speiCard: CARD, speiCardBank: "Banco Inventado" }],
    ["choosing an unregistered kind", { speiCollectKind: "phone" }],
  ])("%s is a VALIDATION_ERROR", async (_name, body) => {
    await seedBusiness({ speiClabe: "646180157000000004", speiBank: "STP" });
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect((await row()).speiCard).toBeNull();
  });

  it("clearing the cuenta de cobro while another account could take its place is refused", async () => {
    await seedBusiness({ speiClabe: "646180157000000004", speiBank: "STP", speiCard: CARD, speiCardBank: "NUBANK" });
    const res = await patch({ speiClabe: null, speiBank: null });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({ code: "VALIDATION_ERROR", reason: "COLLECT_ACCOUNT_CLEARED" });
    /* with the card chosen first, the CLABE may go (D32: no kind is required) */
    expect((await patch({ speiCollectKind: "card" })).status).toBe(200);
    expect((await patch({ speiClabe: null, speiBank: null })).status).toBe(200);
  });

  it("an ISP with only a card as its cuenta de cobro is configured — no CLABE needed (D32)", async () => {
    await seedBusiness();
    const { data } = await (await patch({ speiCard: CARD, speiCardBank: "NUBANK", speiCollectKind: "card" })).json();
    expect(data.spei.clabe).toBeNull();
    expect(data.spei.configured).toBe(true);
  });

  it("a CLABE-only business born before this feature reads collectKind clabe and today's configured (D29)", async () => {
    await seedBusiness({ speiClabe: "646180157000000004", speiBank: "STP" });
    const { data } = await (await (await app()).request("/settings", asBusiness, env)).json();
    expect(data.spei.collectKind).toBe("clabe");
    expect(data.spei.configured).toBe(true);
    expect((await row()).speiCollectKind).toBeNull();
  });

  it("changing or clearing a number retires the old one in the same write; setting it again takes it off (D30)", async () => {
    await seedBusiness({ speiClabe: "646180157000000004", speiBank: "STP", speiCard: CARD, speiCardBank: "NUBANK" });
    await patch({ speiCard: "5555555555554444", speiCardBank: "NUBANK" });
    let retired = JSON.parse((await row()).speiRetiredAccounts!);
    expect(retired).toEqual([{ kind: "card", value: CARD, bank: "NUBANK", removedAt: expect.any(Number) }]);

    await patch({ speiCard: null, speiCardBank: null });
    retired = JSON.parse((await row()).speiRetiredAccounts!);
    expect(retired.map((r: { value: string }) => r.value)).toEqual([CARD, "5555555555554444"]);

    await patch({ speiCard: CARD, speiCardBank: "NUBANK" });
    retired = JSON.parse((await row()).speiRetiredAccounts!);
    expect(retired.map((r: { value: string }) => r.value)).toEqual(["5555555555554444"]);
  });

  it("an admin cannot touch any account field (FORBIDDEN_FOR_ROLE); an operator reads them masked", async () => {
    const business = await seedBusiness({ speiClabe: "646180157000000004", speiBank: "STP", speiCard: CARD, speiCardBank: "NUBANK", speiPhone: PHONE, speiPhoneBank: "NUBANK" });
    const { seedMember } = await import("./helpers");
    await seedMember(business, "admin@wifiplus.mx", "admin");
    await seedMember(business, "operador@wifiplus.mx", "operator");
    const asAdmin = { Cookie: await sessionCookieHeader("admin@wifiplus.mx") };
    for (const body of [{ speiCard: null, speiCardBank: null }, { speiCollectKind: "card" }, { speiPhoneBank: "STP" }]) {
      const res = await patch(body, asAdmin);
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN_FOR_ROLE");
    }
    expect((await row()).speiCard).toBe(CARD);

    const asOperator = { headers: { Cookie: await sessionCookieHeader("operador@wifiplus.mx") } };
    const { data } = await (await (await app()).request("/settings", asOperator, env)).json();
    expect(data.spei).toMatchObject({ clabe: "••••0004", card: "••••1111", phone: "••••5678" });
  });
});

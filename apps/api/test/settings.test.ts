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


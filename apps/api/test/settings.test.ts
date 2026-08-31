import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { isps } from "../src/db/schema";
import { app, seedIsp, sessionCookieHeader } from "./helpers";

/* docs/admin/settings.spec.md scenarios 1–3. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const asIsp = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };

const send = (path: string, method: string, body?: unknown): [string, RequestInit] => [
  path,
  {
    method,
    headers: { "Content-Type": "application/json", ...asIsp.headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  },
];

/* One customer query is the test WispHub answers (D2) */
function mockWispHub(reply: { status: number; body?: unknown }) {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({ method: "GET", path: /\/api\/clientes\/.*/ })
    .reply(reply.status, JSON.stringify(reply.body ?? {}), {
      headers: { "Content-Type": "application/json" },
    });
}

const oneCustomer = {
  results: [
    {
      id_servicio: 1,
      usuario: "greyes@wifiplus",
      nombre: "G. Reyes",
      estado: "Activo",
      estado_facturas: "Pagadas",
      precio_plan: "399.00",
      saldo: "0.00",
      zona: { nombre: "Centro" },
    },
  ],
};

describe("US-A04: the ISP reads its settings without reading its key", () => {
  it("returns the split and only the key's tail", async () => {
    await seedIsp({ wisphubApiKey: "01q9K2Rf.SECRETKEY1234" });

    const res = await (await app()).request("/settings", asIsp, env);
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data).toMatchObject({
      serviceFeeCents: 1500,
      timezone: "America/Mexico_City",
      timeFormat: "12h",
      wisphub: { configured: true, keyTail: "1234" },
    });
    /* D1: the key itself never travels back */
    expect(JSON.stringify(data)).not.toContain("SECRETKEY");
  });

});

describe("US-A04: saving the fee, the zone and the format", () => {
  it("saves the fields", async () => {
    await seedIsp();
    const client = await app();

    const ok = await client.request(
      ...send("/settings", "PATCH", {
        serviceFeeCents: 2000,
        timezone: "America/Hermosillo",
        timeFormat: "24h",
      }),
      env,
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({
      serviceFeeCents: 2000,
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

  it("re-tests a key on save and reports the result without blocking it (D3)", async () => {
    await seedIsp();
    mockWispHub({ status: 403 });

    const res = await (await app()).request(
      ...send("/settings", "PATCH", { wisphubApiKey: "bad-key-000000" }),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    /* Saved anyway — the ISP is told, not stopped */
    expect(data.wisphub).toEqual({ configured: true, keyTail: "0000" });
    expect(data.wisphubTest).toEqual({ ok: false, code: "WISPHUB_AUTH_FAILED" });

    const db = drizzle(env.DB);
    const [isp] = await db.select().from(isps);
    expect(isp.wisphubApiKey).toBe("bad-key-000000");
  });
});

describe("US-A04: the connection test speaks for WispHub", () => {
  it("tests a typed key without saving it, and keeps the two failures apart", async () => {
    await seedIsp();
    const client = await app();

    mockWispHub({ status: 200, body: oneCustomer });
    const good = await client.request(
      ...send("/settings/wisphub/test", "POST", { apiKey: "candidate-key-1" }),
      env,
    );
    expect((await good.json()).data).toEqual({
      ok: true,
      code: null,
      sampleCustomerCount: 1,
    });

    /* D2: testing is not saving */
    const db = drizzle(env.DB);
    const [isp] = await db.select().from(isps);
    expect(isp.wisphubApiKey).toBeNull();

    /* An outage is not a bad key (D3) */
    mockWispHub({ status: 500 });
    const down = await client.request(
      ...send("/settings/wisphub/test", "POST", { apiKey: "candidate-key-1" }),
      env,
    );
    expect((await down.json()).data).toMatchObject({ ok: false, code: "WISPHUB_UNAVAILABLE" });

    /* Nothing stored, nothing typed */
    const none = await client.request(...send("/settings/wisphub/test", "POST", {}), env);
    expect((await none.json()).data).toMatchObject({ ok: false, code: "WISPHUB_NOT_CONFIGURED" });
  });
});

/* docs/direct-payment/direct-payment.spec.md scenario 13. */
describe("US-D05: the ISP configures its SPEI account and fee", () => {
  it("saves CLABE, bank, beneficiary and fee; null fee falls back", async () => {
    await seedIsp();

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

    /* clearing the fee falls back to the store fee (D3) */
    const cleared = await (await app()).request(
      ...send("/settings", "PATCH", { speiServiceFeeCents: null }),
      env,
    );
    const { data: after } = await cleared.json();
    expect(after.spei.serviceFeeCents).toBeNull();
    expect(after.spei.effectiveServiceFeeCents).toBe(after.serviceFeeCents);
  });

  it("US-D13 scenario 7: SPEI is configured without a beneficiary name", async () => {
    await seedIsp();

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
    await seedIsp();

    const bad = await (await app()).request(
      ...send("/settings", "PATCH", { speiClabe: "12345" }),
      env,
    );
    expect(bad.status).toBe(400);

    const res = await (await app()).request("/settings", asIsp, env);
    const { data } = await res.json();
    expect(data.spei.configured).toBe(false);
    expect(data.spei.effectiveServiceFeeCents).toBe(data.serviceFeeCents);
  });
});

/* docs/direct-payment/partial-payment.spec.md D2/D4 (US-D10): the two
   numbers that decide whether a short payment buys the service back. */
describe("US-D10: the ISP sets the reconnection threshold and floor", () => {
  it("reads the defaults (100 / $0) and saves both numbers", async () => {
    await seedIsp();
    const client = await app();

    const before = await client.request("/settings", asIsp, env);
    expect((await before.json()).data.reconnection).toEqual({
      thresholdPercent: 100,
      floorCents: 0,
      provisionalReleaseEnabled: false,
    });

    const saved = await client.request(
      ...send("/settings", "PATCH", {
        reconnectionThresholdPercent: 70,
        reconnectionFloorCents: 20000,
      }),
      env,
    );
    expect(saved.status).toBe(200);
    expect((await saved.json()).data.reconnection).toEqual({
      thresholdPercent: 70,
      floorCents: 20000,
      provisionalReleaseEnabled: false,
    });

    const [isp] = await drizzle(env.DB).select().from(isps);
    expect(isp.reconnectionThresholdPercent).toBe(70);
    expect(isp.reconnectionFloorCents).toBe(20000);
  });

  it("US-D15 D10: the provisional-release switch saves, and off is the default", async () => {
    await seedIsp();
    const client = await app();

    const saved = await client.request(
      ...send("/settings", "PATCH", { provisionalReleaseEnabled: true }),
      env,
    );
    expect(saved.status).toBe(200);
    expect((await saved.json()).data.reconnection.provisionalReleaseEnabled).toBe(true);

    const [isp] = await drizzle(env.DB).select().from(isps);
    expect(isp.provisionalReleaseEnabled).toBe(true);
  });

  it("refuses a percentage outside 0–100 and a negative floor", async () => {
    await seedIsp();
    const client = await app();

    const over = await client.request(
      ...send("/settings", "PATCH", { reconnectionThresholdPercent: 101 }),
      env,
    );
    expect(over.status).toBe(400);

    const negative = await client.request(
      ...send("/settings", "PATCH", { reconnectionFloorCents: -1 }),
      env,
    );
    expect(negative.status).toBe(400);

    /* the refusals changed nothing */
    const res = await client.request("/settings", asIsp, env);
    expect((await res.json()).data.reconnection).toEqual({
      thresholdPercent: 100,
      floorCents: 0,
      provisionalReleaseEnabled: false,
    });
  });

});

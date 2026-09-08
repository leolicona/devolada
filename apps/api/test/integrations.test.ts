import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { integrations } from "../src/db/schema";
import { app, seedBusiness, seedMember, sessionCookieHeader } from "./helpers";

/* docs/legacy/integrations/integrations-hub.spec.md scenarios 1, 2 (API half),
   10 and 12 (US-I01–I03) — plus the key flow moved verbatim from
   settings D1–D3 (integrations-hub D9). */

const WISPHUB_ORIGIN = "https://api.wisphub.net";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const asBusiness = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };

const send = (path: string, method: string, body?: unknown, headers = asBusiness.headers): [string, RequestInit] => [
  path,
  {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  },
];

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

const db = () => drizzle(env.DB);

describe("US-I01 scenario 1: connecting is being born observing", () => {
  it("with no row the card reads Sin conectar with the birth values", async () => {
    await seedBusiness();
    const res = await (await app()).request("/integrations", asBusiness, env);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.wisphub).toEqual({
      provider: "wisphub",
      configured: false,
      keyTail: null,
      actionsEnabled: false,
      mapping: { exact: "register_and_reconnect", short: "register_and_reconnect", over: "register_and_reconnect" },
      thresholdPercent: 100,
      floorCents: 0,
      provisionalReleaseEnabled: false,
    });
  });

  it("saving a key creates the row OBSERVING, re-tests it, and only the tail travels back", async () => {
    await seedBusiness();
    mockWispHub({ status: 200, body: oneCustomer });

    const res = await (await app()).request(
      ...send("/integrations/wisphub", "PATCH", { wisphubApiKey: "01q9K2Rf.SECRETKEY1234" }),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.wisphub.configured).toBe(true);
    expect(data.wisphub.keyTail).toBe("1234");
    /* D4: a NEW integration is born with actions OFF — the trust ramp */
    expect(data.wisphub.actionsEnabled).toBe(false);
    expect(data.wisphubTest).toEqual({ ok: true, code: null });
    expect(JSON.stringify(data)).not.toContain("SECRETKEY");

    const [row] = await db().select().from(integrations);
    expect(row.apiKey).toBe("01q9K2Rf.SECRETKEY1234");
    expect(row.actionsEnabled).toBe(false);
  });

  it("a failed test never blocks the save (settings D3, moved)", async () => {
    await seedBusiness();
    mockWispHub({ status: 403 });
    const res = await (await app()).request(
      ...send("/integrations/wisphub", "PATCH", { wisphubApiKey: "bad-key-000000" }),
      env,
    );
    const { data } = await res.json();
    expect(data.wisphub.keyTail).toBe("0000");
    expect(data.wisphubTest).toEqual({ ok: false, code: "WISPHUB_AUTH_FAILED" });
  });
});

describe("US-I02: the mapping and the dials save to the row", () => {
  it("persists the three rows, the threshold and both switches", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const res = await (await app()).request(
      ...send("/integrations/wisphub", "PATCH", {
        shortAction: "register_only",
        thresholdPercent: 70,
        floorCents: 20000,
        provisionalReleaseEnabled: true,
        actionsEnabled: false,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.wisphub.mapping.short).toBe("register_only");
    expect(data.wisphub.thresholdPercent).toBe(70);
    expect(data.wisphub.provisionalReleaseEnabled).toBe(true);
    expect(data.wisphub.actionsEnabled).toBe(false);

    const [row] = await db().select().from(integrations);
    expect(row.businessId).toBe(business.id);
    expect(row.shortAction).toBe("register_only");
    expect(row.floorCents).toBe(20000);
  });

  it("refuses a percentage outside 0–100 and a negative floor", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const over = await (await app()).request(
      ...send("/integrations/wisphub", "PATCH", { thresholdPercent: 101 }),
      env,
    );
    expect(over.status).toBe(400);
    const negative = await (await app()).request(
      ...send("/integrations/wisphub", "PATCH", { floorCents: -1 }),
      env,
    );
    expect(negative.status).toBe(400);
  });
});

describe("US-I01: the connection test speaks for WispHub (settings D2, moved)", () => {
  it("tests a typed key without saving, and the stored one when omitted", async () => {
    await seedBusiness({ wisphubApiKey: "stored-key-0001" });
    const client = await app();

    mockWispHub({ status: 200, body: oneCustomer });
    const typed = await client.request(
      ...send("/integrations/wisphub/test", "POST", { apiKey: "candidate-key-1" }),
      env,
    );
    expect((await typed.json()).data).toEqual({ ok: true, code: null, sampleCustomerCount: 1 });
    /* testing is not saving */
    const [row] = await db().select().from(integrations);
    expect(row.apiKey).toBe("stored-key-0001");

    mockWispHub({ status: 500 });
    const stored = await client.request(...send("/integrations/wisphub/test", "POST", {}), env);
    expect((await stored.json()).data).toEqual({
      ok: false,
      code: "WISPHUB_UNAVAILABLE",
      sampleCustomerCount: null,
    });
  });
});

describe("scenario 10/12: the hub is owner/admin territory, per tenant", () => {
  it("an operator gets 403 (hide, never disable — there is nothing here for them)", async () => {
    const business = await seedBusiness();
    await seedMember(business, "operador@wifiplus.mx", "operator");
    const asOperator = { Cookie: await sessionCookieHeader("operador@wifiplus.mx") };
    const res = await (await app()).request("/integrations", { headers: asOperator }, env);
    expect(res.status).toBe(403);
  });

  it("another business reads its own empty card, never this one's key", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-secret" });
    await seedBusiness({ email: "otro@business.mx" });
    const asOther = { headers: { Cookie: await sessionCookieHeader("otro@business.mx") } };
    const res = await (await app()).request("/integrations", asOther, env);
    const { data } = await res.json();
    expect(data.wisphub.configured).toBe(false);
    expect(data.wisphub.keyTail).toBeNull();
  });
});

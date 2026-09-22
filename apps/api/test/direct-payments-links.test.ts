import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { paymentLinks } from "../src/db/schema";
import { app, seedBusiness, sessionCookieHeader } from "./helpers";

/* links-on-demand-search US1 — what survives of the roster's own file.

   This was `US-D07: the roster hands every customer their link`. The
   roster is retired (D12) and most of what it proved went with it: the
   lazy batch insert, the thirty-second display cache, the chunked write
   of 150 links in one read. Those were all the same fact — *listing is
   what creates links* — and FR-008 ends it.

   Three things here outlived the door they were written for, and one
   moved rather than went:

   - `bug: links-refused-key`. A key the installation refused is SETUP,
     not weather: 503 with the adapter's own code, so the screen can
     send the operator to Integraciones instead of offering a Reintentar
     that re-sends the same key to the same place. And the key itself
     never reaches the body.
   - The door is the ISP's, and a session is what opens it.
   - A customer without a usuario is nobody a link can be made for, so
     they never appear.
   - The country-code cases and the recycled-id case moved to
     `links-create-on-act.test.ts`, where the phone and the numeric id
     are now read — the act is what carries both (D16, D8). */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const SPEI = { speiClabe: "646180157000000004", speiBank: "STP" };

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const json = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

const customer = (over: Record<string, unknown> = {}) => ({
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely",
  telefono: "5512345678",
  estado: "Activo",
  estado_facturas: "Pagadas",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: { nombre: "Centro" },
  ...over,
});

function mockBlock(results: unknown[]) {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") })
    .reply(...json({ count: results.length, next: null, results }));
}

const asBusiness = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };
const read = async () => (await app()).request("/direct-payments/customers", asBusiness, env);

/* bug: links-refused-key — the panel hears the adapter's own code, so
   the screen can send a refused key to Integraciones instead of a
   Reintentar. The 403 is what wisphub.net answers a wisphub.io key
   (provider-address-per-isp D5). */
describe("US1 (bug: links-refused-key): a refused key is a setup problem, not an outage", () => {
  it("answers 503 with WISPHUB_AUTH_FAILED, and never puts the key in the body", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-io" });
    fetchMock
      .get(WISPHUB_ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") })
      .reply(403, JSON.stringify({ detail: "Invalid API key" }), {
        headers: { "Content-Type": "application/json" },
      });

    const res = await read();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: { code: "WISPHUB_AUTH_FAILED" } });
    /* 007 FR-013: the detail is a status, never the credential */
    expect(JSON.stringify(body)).not.toContain("wh-key-io");
  });
});

describe("US1: the customers door is the ISP's own", () => {
  it("requires a session", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    const res = await (await app()).request("/direct-payments/customers", {}, env);
    expect(res.status).toBe(401);
  });

  it("a customer without a usuario never appears, and no link is made for them", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    mockBlock([
      customer({ id_servicio: 20, usuario: null }),
      customer({ id_servicio: 7, usuario: "mcolunga@wifiplus" }),
    ]);

    const { data } = await (await read()).json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].usuario).toBe("mcolunga@wifiplus");
    /* FR-008: nor for the one who did appear — reading creates nothing */
    expect(await drizzle(env.DB).select().from(paymentLinks)).toHaveLength(0);
  });
});

import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { paymentLinks } from "../src/db/schema";
import { app, seedIsp, sessionCookieHeader } from "./helpers";

/* docs/direct-payment/admin-links-view.spec.md (US-D07) */

const WISPHUB_ORIGIN = "https://api.wisphub.net";

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

function mockSearch(results: unknown[]) {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") })
    .reply(...json({ count: results.length, results }));
}

const asIsp = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };
const search = async (q = "janely") =>
  (await app()).request(`/direct-payments/links/search?q=${q}`, asIsp, env);

describe("US-D07: the ISP finds a customer and gets their link", () => {
  it("returns the joined result and creates the link lazily", async () => {
    await seedIsp({ wisphubApiKey: "wh-key-1" });
    mockSearch([customer()]);

    const res = await search();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      wisphubId: 6,
      usuario: "greyes@wifiplus",
      name: "Janely",
      phone: "5512345678",
    });
    expect(data.results[0].url).toMatch(/\/p\/[a-z0-9]+$/);
    expect(data.results[0].url).not.toContain("undefined");

    expect(await drizzle(env.DB).select().from(paymentLinks)).toHaveLength(1);
  });

  it("a second search reuses the same permanent token (D1)", async () => {
    await seedIsp({ wisphubApiKey: "wh-key-1" });
    mockSearch([customer()]);
    const firstUrl = (await (await search()).json()).data.results[0].url;

    mockSearch([customer()]);
    expect((await (await search()).json()).data.results[0].url).toBe(firstUrl);
    expect(await drizzle(env.DB).select().from(paymentLinks)).toHaveLength(1);
  });

  /* The route sits under the public /links/:token prefix: if the
     registration order ever changed, an anonymous caller would reach it. */
  it("requires an ISP session and is not shadowed by the public token route", async () => {
    await seedIsp({ wisphubApiKey: "wh-key-1" });
    const res = await (await app()).request("/direct-payments/links/search?q=janely", {}, env);
    expect(res.status).toBe(401);
  });

  it("503s when the ISP has no WispHub key", async () => {
    await seedIsp();
    const res = await search();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("WISPHUB_NOT_CONFIGURED");
  });
});

/* D3 — the share link is the feature; a wrong number is worse than none.
   Built server-side with the receipt spec's helper, so a 10-digit
   Mexican phone cannot go out as wa.me/55… (Brazil). */
describe("US-D07: the WhatsApp link carries the country code", () => {
  it("puts 52 in front of a plain 10-digit phone", async () => {
    await seedIsp({ wisphubApiKey: "wh-key-1" });
    mockSearch([customer()]);

    const { data } = await (await search()).json();
    const wa = new URL(data.results[0].waLink);
    expect(wa.origin + wa.pathname).toBe("https://wa.me/525512345678");
    expect(wa.searchParams.get("text")).toContain(data.results[0].url);
  });

  it("accepts the shapes an ISP actually types", async () => {
    await seedIsp({ wisphubApiKey: "wh-key-1" });
    mockSearch([
      customer({ id_servicio: 6, usuario: "a@x", telefono: "+52 55 1234 5678" }),
      customer({ id_servicio: 7, usuario: "b@x", telefono: "5215512345678" }),
    ]);

    const { data } = await (await search()).json();
    for (const result of data.results) {
      expect(new URL(result.waLink).pathname).toBe("/525512345678");
    }
  });

  it("an unreadable phone opens the contact picker instead of a stranger", async () => {
    await seedIsp({ wisphubApiKey: "wh-key-1" });
    mockSearch([customer({ telefono: "55 1234 5678 ext 3" })]);

    const { data } = await (await search()).json();
    /* no number in the path: WhatsApp asks the ISP to pick the contact */
    expect(new URL(data.results[0].waLink).pathname).toBe("/");
    expect(data.results[0].waLink).toContain("text=");
  });

  it("a customer with no phone still gets a shareable message", async () => {
    await seedIsp({ wisphubApiKey: "wh-key-1" });
    mockSearch([customer({ telefono: "" })]);

    const { data } = await (await search()).json();
    expect(data.results[0].phone).toBeNull();
    expect(new URL(data.results[0].waLink).pathname).toBe("/");
  });
});

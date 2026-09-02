import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { paymentLinks } from "../src/db/schema";
import { resetProviderCaches } from "../src/wisphub/cache";
import { app, seedBusiness, sessionCookieHeader } from "./helpers";

/* docs/direct-payment/admin-links-view.spec.md (US-D07), amended by the
   pilot-UX round: the roster replaced the parameter-guessing search. */

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

function mockList(results: unknown[]) {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") })
    .reply(...json({ count: results.length, results }));
}

const asBusiness = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };
const search = async () =>
  (await app()).request(`/direct-payments/links/roster`, asBusiness, env);

describe("US-D07: the roster hands every customer their link", () => {
  it("returns the joined rows, creates links lazily, and says when it read", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockList([customer()]);

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
    expect(data.complete).toBe(true);
    expect(data.readAt).toBeGreaterThan(0);

    expect(await drizzle(env.DB).select().from(paymentLinks)).toHaveLength(1);
  });

  it("a second read reuses the same permanent token (D1) — and the 30s cache, one provider call", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockList([customer()]);
    const firstUrl = (await (await search()).json()).data.results[0].url;

    /* no second interceptor: within the window the cache answers */
    expect((await (await search()).json()).data.results[0].url).toBe(firstUrl);
    expect(await drizzle(env.DB).select().from(paymentLinks)).toHaveLength(1);

    /* past the cache, still the same token */
    resetProviderCaches();
    mockList([customer()]);
    expect((await (await search()).json()).data.results[0].url).toBe(firstUrl);
  });

  /* The route sits under the public /links/:token prefix: if the
     registration order ever changed, an anonymous caller would reach it. */
  it("requires an ISP session and is not shadowed by the public token route", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const res = await (await app()).request("/direct-payments/links/roster", {}, env);
    expect(res.status).toBe(401);
  });

  it("503s when the ISP has no WispHub key", async () => {
    await seedBusiness();
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
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockList([customer()]);

    const { data } = await (await search()).json();
    const wa = new URL(data.results[0].waLink);
    expect(wa.origin + wa.pathname).toBe("https://wa.me/525512345678");
    expect(wa.searchParams.get("text")).toContain(data.results[0].url);
  });

  it("accepts the shapes an ISP actually types", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockList([
      customer({ id_servicio: 6, usuario: "a@x", telefono: "+52 55 1234 5678" }),
      customer({ id_servicio: 7, usuario: "b@x", telefono: "5215512345678" }),
    ]);

    const { data } = await (await search()).json();
    for (const result of data.results) {
      expect(new URL(result.waLink).pathname).toBe("/525512345678");
    }
  });

  it("an unreadable phone opens the contact picker instead of a stranger", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockList([customer({ telefono: "55 1234 5678 ext 3" })]);

    const { data } = await (await search()).json();
    /* no number in the path: WhatsApp asks the ISP to pick the contact */
    expect(new URL(data.results[0].waLink).pathname).toBe("/");
    expect(data.results[0].waLink).toContain("text=");
  });

  it("a customer with no phone still gets a shareable message", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockList([customer({ telefono: "" })]);

    const { data } = await (await search()).json();
    expect(data.results[0].phone).toBeNull();
    expect(new URL(data.results[0].waLink).pathname).toBe("/");
  });
});

/* D5 — the link's identity is the usuario; the numeric id is a cache.
   Measured live on dev (2026-08-30): the demo tenant reseeds daily and
   recycles ids, so old links answered no_debt for customers that owed. */
describe("US-D07 D5: the usuario is the identity, the numeric id is a cache", () => {
  it("a new usuario on a recycled id gets a new token; the old link keeps its own", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    /* yesterday's tenant: id 13 belongs to 0011 */
    mockList([customer({ id_servicio: 13, usuario: "0011@wifiplus", nombre: "Leo Licona" })]);
    const oldUrl = (await (await search()).json()).data.results[0].url;

    /* reseeded tenant: id 13 now belongs to Esteban, a different person.
       Past the display cache — a reseed does not happen inside 30s. */
    resetProviderCaches();
    mockList([customer({ id_servicio: 13, usuario: "esteban@wifiplus", nombre: "Esteban" })]);
    const { data } = await (await search()).json();
    expect(data.results[0].usuario).toBe("esteban@wifiplus");
    /* the stranger's token is never handed over */
    expect(data.results[0].url).not.toBe(oldUrl);

    /* the dead link survives with its token: its payment history points at it */
    const rows = await drizzle(env.DB).select().from(paymentLinks);
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.customerUsuario === "0011@wifiplus");
    expect(oldUrl.endsWith(`/p/${old?.token}`)).toBe(true);
  });

  it("a re-seen usuario keeps its token while its numeric id refreshes", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockList([customer({ id_servicio: 6, usuario: "greyes@wifiplus" })]);
    const firstUrl = (await (await search()).json()).data.results[0].url;

    resetProviderCaches();
    mockList([customer({ id_servicio: 99, usuario: "greyes@wifiplus" })]);
    expect((await (await search()).json()).data.results[0].url).toBe(firstUrl);

    const rows = await drizzle(env.DB).select().from(paymentLinks);
    expect(rows).toHaveLength(1);
    expect(rows[0].wisphubCustomerId).toBe("99");
  });

  it("a customer without usuario gets no link and no empty row (the review's open item)", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockList([
      customer({ id_servicio: 20, usuario: null }),
      customer({ id_servicio: 7, usuario: "mcolunga@wifiplus" }),
    ]);

    const { data } = await (await search()).json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].usuario).toBe("mcolunga@wifiplus");

    const rows = await drizzle(env.DB).select().from(paymentLinks);
    expect(rows).toHaveLength(1);
    expect(rows[0].customerUsuario).toBe("mcolunga@wifiplus");
  });

  it("the batch generator follows the same rule on a recycled id", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockList([customer({ id_servicio: 13, usuario: "0011@wifiplus" })]);
    await search();

    /* GET /links lists through the same lazy batch insert */
    mockList([customer({ id_servicio: 13, usuario: "esteban@wifiplus" })]);
    const res = await (await app()).request("/direct-payments/links", asBusiness, env);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const usuarios = data.links.map((l: { usuario: string }) => l.usuario);
    expect(usuarios).toContain("0011@wifiplus");
    expect(usuarios).toContain("esteban@wifiplus");
    const tokens = new Set(data.links.map((l: { url: string }) => l.url));
    expect(tokens.size).toBe(2);
  });
});

import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { paymentLinks } from "../src/db/schema";
import { app, seedBusiness, sessionCookieHeader } from "./helpers";

/* links-on-demand-search US1 (FR-010): the link associates an identity
   and nothing else.

   This is the creator's own rule, and it is a decision NOT to store —
   which is why it needs a test of its own rather than a column. A panel
   link carries `customer_usuario` and Devolada's operational fields, and
   no name, no phone, no service state. To operate, all three are read
   fresh from WispHub, every time.

   The second case is the one that makes it matter: a customer whose name
   changed at the provider. If the row held a name, a later act would
   either write a second copy or serve a stale one. It holds none, so
   there is nothing to go stale. */

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
  nombre: "Janely Reyes",
  telefono: "5512345678",
  estado: "Activo",
  estado_facturas: "Pagadas",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: { nombre: "Centro" },
  ...over,
});

function mockCustomer(results: unknown[]) {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
    .reply(...json({ count: results.length, next: null, results }));
}

const ownerCookie = await sessionCookieHeader("demo@devolada.app");
const act = async (usuario: string) =>
  (await app()).request(
    "/direct-payments/links",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5174", Cookie: ownerCookie },
      body: JSON.stringify({ usuario }),
    },
    env,
  );

describe("US1 (FR-010): the row knows who, and nothing about them", () => {
  it("writes the usuario and Devolada's own fields, and no customer data at all", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    mockCustomer([customer()]);
    await act("greyes@wifiplus");

    const [row] = await drizzle(env.DB).select().from(paymentLinks);
    expect(row.customerUsuario).toBe("greyes@wifiplus");
    /* The numeric id is a cache WispHub may recycle; it keys nothing
       (direct-payment D5) */
    expect(row.wisphubCustomerId).toBe("6");
    /* Devolada's own fields, and the API channel's fields left empty */
    expect(row.source).toBe("panel");
    expect(row.mode).toBe("reusable");
    expect(row.isTest).toBe(false);
    expect(row.customerRef).toBeNull();
    expect(row.askCents).toBeNull();
    expect(row.label).toBeNull();
    expect(row.concept).toBeNull();
    expect(row.expiresAt).toBeNull();
    expect(row.closedAt).toBeNull();

    /* Whatever the shape of the table becomes, the person is not in it:
       no name, no phone, no service state, anywhere on the row */
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("Janely");
    expect(stored).not.toContain("5512345678");
    expect(stored).not.toContain("Activo");
  });

  it("a second act on a customer whose name changed writes no name either", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    mockCustomer([customer()]);
    const born = (await (await act("greyes@wifiplus")).json()).data;

    /* The provider now answers a different name and a different phone */
    mockCustomer([customer({ nombre: "Janely Reyes Domínguez", telefono: "5599887766" })]);
    const again = (await (await act("greyes@wifiplus")).json()).data;

    /* Same link — the identity did not change */
    expect(again.token).toBe(born.token);
    /* And the fresh read is what the answer carries, not a stored copy */
    expect(again.waLink).toContain("wa.me/525599887766");

    const rows = await drizzle(env.DB).select().from(paymentLinks);
    expect(rows).toHaveLength(1);
    const stored = JSON.stringify(rows[0]);
    expect(stored).not.toContain("Domínguez");
    expect(stored).not.toContain("5599887766");
  });
});

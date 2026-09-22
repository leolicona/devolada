import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { paymentLinks } from "../src/db/schema";
import { app, seedBusiness, seedMember, sessionCookieHeader } from "./helpers";

/* links-on-demand-search US1: the link is born on the act.

   FR-008 in one file. A link comes into existence when an operator
   presses Copiar or WhatsApp — never because a customer was listed,
   searched, shown or read, and never from background work (SC-009). The
   act is idempotent: pressing twice returns the same permanent link,
   because the usuario is the identity and the link is theirs while it
   exists (FR-005, FR-009).

   The gates in front of it are the ones sharing has always had
   (FR-016): the right to operate payments, and a CLABE — a link nobody
   can pay is not shared. */

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

/* D4/D8: identity is not a search — the act asks the exact `usuario=`
   filter, which is also the half of `bug: customer-lookup-misses` the
   parameter guess used to get wrong. */
function mockCustomer(results: unknown[], times = 1) {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
    .reply(...json({ count: results.length, next: null, results }))
    .times(times);
}

const ownerCookie = await sessionCookieHeader("demo@devolada.app");

const act = async (usuario: string, cookie = ownerCookie) =>
  (await app()).request(
    "/direct-payments/links",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5174", Cookie: cookie },
      body: JSON.stringify({ usuario }),
    },
    env,
  );

const links = () => drizzle(env.DB).select().from(paymentLinks);

describe("US1 (FR-008): the act creates the link, and nothing else does", () => {
  it("creates it on the first press and returns the same one on the second", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    mockCustomer([customer()], 2);

    const first = await act("greyes@wifiplus");
    expect(first.status).toBe(200);
    const born = (await first.json()).data;
    expect(born.created).toBe(true);
    expect(born.url).toContain(`/p/${born.token}`);
    /* D16/FR-028: the phone rode along on the read the link needed
       anyway, so WhatsApp opens the customer's own chat */
    expect(born.waLink).toContain("wa.me/525512345678");

    const second = await act("greyes@wifiplus");
    const again = (await second.json()).data;
    expect(again.created).toBe(false);
    expect(again.token).toBe(born.token);
    /* FR-009: one permanent link per customer, never a second */
    expect(await links()).toHaveLength(1);
  });

  it("keeps the identity as the key, and refreshes only the numeric id (D5)", async () => {
    const business = await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    mockCustomer([customer()]);
    const born = (await (await act("greyes@wifiplus")).json()).data;

    /* WispHub recycled the numeric id to the same usuario */
    mockCustomer([customer({ id_servicio: 99 })]);
    const again = (await (await act("greyes@wifiplus")).json()).data;
    expect(again.token).toBe(born.token);

    const [row] = await drizzle(env.DB)
      .select()
      .from(paymentLinks)
      .where(eq(paymentLinks.businessId, business.id));
    expect(row.wisphubCustomerId).toBe("99");
  });

  it("a viewer cannot share, and is refused by the role, not by the button (FR-016)", async () => {
    const business = await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    await seedMember(business, "mirona@devolada.app", "viewer");

    const res = await act("greyes@wifiplus", await sessionCookieHeader("mirona@devolada.app"));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_FOR_ROLE");
    /* The refusal happens before any link exists */
    expect(await links()).toHaveLength(0);
  });

  it("a business with no CLABE is refused: a link nobody can pay is not shared (FR-016)", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });

    const res = await act("greyes@wifiplus");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("SPEI_NOT_CONFIGURED");
    expect(await links()).toHaveLength(0);
  });

  it("a usuario the provider does not know is CUSTOMER_NOT_FOUND, not a link", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    mockCustomer([]);

    const res = await act("fantasma@wifiplus");
    expect(res.status).toBe(404);
    /* A new code on purpose: the area's NOT_FOUND means "no such link or
       route", and the panel must tell that apart from "the provider has
       no such customer" — which an operator can act on */
    expect((await res.json()).error.code).toBe("CUSTOMER_NOT_FOUND");
    expect(await links()).toHaveLength(0);
  });

  it("a business with no WispHub cannot make a panel link at all", async () => {
    await seedBusiness({ ...SPEI });
    const res = await act("greyes@wifiplus");
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("WISPHUB_NOT_CONFIGURED");
  });

  it("SC-009: browsing and searching a whole screenful moves the link count by zero", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    fetchMock
      .get(WISPHUB_ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") })
      .reply(...json({ count: 1, next: null, results: [customer()] }))
      .persist();

    const browse = await (await app()).request("/direct-payments/customers", { headers: { Cookie: ownerCookie } }, env);
    expect(browse.status).toBe(200);
    const searched = await (await app()).request(
      "/direct-payments/customers?q=jane",
      { headers: { Cookie: ownerCookie } },
      env,
    );
    expect(searched.status).toBe(200);

    expect(await links()).toHaveLength(0);
    fetchMock.get(WISPHUB_ORIGIN).cleanMocks();
  });
});

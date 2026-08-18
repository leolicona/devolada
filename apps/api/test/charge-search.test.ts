import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/charges/customer-search.spec.md scenarios 1–6 and
   docs/charges/debt-truth.spec.md scenario 3 (US-C06).
   WispHub is mocked with the shapes verified in the spike. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

/* One demo customer as WispHub returns it (spike shapes, extra fields included
   on purpose: the allow-list mapping must drop them). */
const wisphubCustomer = {
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely",
  estado: "Activo",
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  zona: { id: 71342, nombre: "Zona dia 15" },
  direccion: "Calle Falsa 123",
  telefono: "5511122233",
  ip: "192.168.7.5",
};

function mockWispHubList(expectedParam: string, results: unknown[] = [wisphubCustomer]) {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/clientes/") && p.includes(expectedParam),
    })
    .reply(200, JSON.stringify({ count: results.length, results }), {
      headers: { "Content-Type": "application/json" },
    });
}

/* Debt truth (debt-truth spec D6): a non-empty search also fetches the
   pending-invoice list and marks every result from it. */
function mockPendingInvoices(
  results: { id_factura: number; cliente: { usuario: string } }[] = [
    { id_factura: 42, cliente: { usuario: "greyes@wifiplus" } },
  ],
) {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1"),
    })
    .reply(200, JSON.stringify({ next: null, count: results.length, results }), {
      headers: { "Content-Type": "application/json" },
    });
}

async function seedStoreWithKey() {
  const isp = await seedIsp({ wisphubApiKey: "wh-key-1" });
  await seedStore(isp.id);
  return isp;
}

const asStore = { headers: { Cookie: await sessionCookieHeader("5512345678") } };

describe("US-C01: the query type is detected, not selected", () => {
  it("digits query calls WispHub with ?telefono=", async () => {
    await seedStoreWithKey();
    mockWispHubList("telefono=5511122233");
    mockPendingInvoices();
    const res = await (await app()).request("/charges/customers?q=5511122233", asStore, env);
    expect(res.status).toBe(200);
  });

  it("name query uses ?nombre= and @ query uses ?usuario=", async () => {
    await seedStoreWithKey();
    mockWispHubList("nombre=Janely");
    mockPendingInvoices();
    const byName = await (await app()).request("/charges/customers?q=Janely", asStore, env);
    expect(byName.status).toBe(200);

    mockWispHubList("usuario=greyes%40wifiplus");
    mockPendingInvoices();
    const byUser = await (await app()).request(
      "/charges/customers?q=greyes@wifiplus",
      asStore,
      env,
    );
    expect(byUser.status).toBe(200);
  });
});

describe("US-C01: the response is minimum identity only", () => {
  it("maps cents, status and zone; extra WispHub fields never leak", async () => {
    await seedStoreWithKey();
    mockWispHubList("nombre=Janely");
    mockPendingInvoices();
    const res = await (await app()).request("/charges/customers?q=Janely", asStore, env);
    const { data } = await res.json();

    expect(data.customers).toHaveLength(1);
    expect(data.customers[0]).toEqual({
      wisphubId: 6,
      usuario: "greyes@wifiplus",
      name: "Janely",
      zone: "Zona dia 15",
      serviceStatus: "active",
      billingStatus: "due",
      monthlyFeeCents: 49900,
      /* customer-phone D4: whether a number exists, never the number */
      hasPhone: true,
    });
    /* The allow-list: address and phone must not be in the payload */
    expect(JSON.stringify(data)).not.toContain("Calle Falsa");
    expect(JSON.stringify(data)).not.toContain("5511122233");
  });

  it("unknown estado values map to 'unknown' and do not break", async () => {
    await seedStoreWithKey();
    mockWispHubList("nombre=Janely", [{ ...wisphubCustomer, estado: "En Revision" }]);
    mockPendingInvoices();
    const res = await (await app()).request("/charges/customers?q=Janely", asStore, env);
    expect((await res.json()).data.customers[0].serviceStatus).toBe("unknown");
  });
});

describe("US-C06: the pending invoices decide billingStatus, not the label", () => {
  /* debt-truth spec scenario 3, both stale directions at once — one
     customer per direction, marked from a single pending-list fetch. */
  it("overrides the label in both directions", async () => {
    await seedStoreWithKey();
    mockWispHubList("nombre=Janely", [
      /* Label says Pagadas, but a pending invoice exists → due */
      { ...wisphubCustomer, estado_facturas: "Pagadas" },
      /* Label says due, but nothing is owed → paid */
      {
        ...wisphubCustomer,
        id_servicio: 7,
        usuario: "jcobos@wifiplus",
        nombre: "Juan Fernando",
        estado_facturas: "Pendiente de Pago",
      },
    ]);
    mockPendingInvoices([{ id_factura: 42, cliente: { usuario: "greyes@wifiplus" } }]);

    const res = await (await app()).request("/charges/customers?q=Janely", asStore, env);
    const { data } = await res.json();
    expect(data.customers[0].billingStatus).toBe("due");
    expect(data.customers[1].billingStatus).toBe("paid");
  });
});

describe("US-C01: WispHub failures have two distinct codes", () => {
  it("ISP without API key returns 503 WISPHUB_NOT_CONFIGURED", async () => {
    const isp = await seedIsp({ wisphubApiKey: null });
    await seedStore(isp.id);
    const res = await (await app()).request("/charges/customers?q=Janely", asStore, env);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("WISPHUB_NOT_CONFIGURED");
  });

  it("a rejected key returns 503 WISPHUB_NOT_CONFIGURED (setup, not outage)", async () => {
    await seedStoreWithKey();
    fetchMock
      .get(WISPHUB_ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") })
      .reply(403, JSON.stringify({ detail: "Usted no tiene permiso para realizar esta acción." }));
    const res = await (await app()).request("/charges/customers?q=Janely", asStore, env);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("WISPHUB_NOT_CONFIGURED");
  });

  it("WispHub errors return 503 WISPHUB_UNAVAILABLE", async () => {
    await seedStoreWithKey();
    fetchMock
      .get(WISPHUB_ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") })
      .reply(500, "boom");
    const res = await (await app()).request("/charges/customers?q=Janely", asStore, env);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("WISPHUB_UNAVAILABLE");
  });
});

describe("US-C01: store sessions only", () => {
  it("no session returns 401; ISP session returns 403", async () => {
    await seedIsp();
    const anonymous = await (await app()).request("/charges/customers?q=Janely", {}, env);
    expect(anonymous.status).toBe(401);

    const asIsp = await (await app()).request(
      "/charges/customers?q=Janely",
      { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } },
      env,
    );
    expect(asIsp.status).toBe(403);
  });

  it("a query shorter than 2 chars returns 400", async () => {
    await seedStoreWithKey();
    const res = await (await app()).request("/charges/customers?q=J", asStore, env);
    expect(res.status).toBe(400);
  });
});

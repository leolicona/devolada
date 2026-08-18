import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { charges, customerContacts } from "../src/db/schema";
import { app, seedIsp, seedStore, sessionCookieHeader } from "./helpers";

/* docs/charges/customer-phone.spec.md scenarios 1–6 (US-C07).
   WispHub cannot store the number back — probed, see
   docs/integrations/wisphub.md — so everything here is our own table. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

/* The common case the spec exists for: telefono empty, as every customer
   on the demo tenant has it. */
const wisphubCustomer = (telefono = "") => ({
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely",
  telefono,
  estado: "Suspendido",
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  zona: { id: 71342, nombre: "Zona dia 15" },
});

const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const json = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

function mockCustomerLookup(results: unknown[], times = 1) {
  wh()
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario="),
    })
    .reply(...json({ count: results.length, results }))
    .times(times);
}

function mockPendingInvoices(
  results: { id_factura: number; cliente: { usuario: string } }[] = [
    { id_factura: 42, cliente: { usuario: "greyes@wifiplus" } },
  ],
) {
  wh()
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1"),
    })
    .reply(...json({ next: null, count: results.length, results }));
}

/* The happy reconnection, same shape as charge-record's.
   `paymentMethodCached`: after the first charge of a test the cash
   payment-method id is held for the tenant (provider-latency spec D5),
   so later charges make no `formas-de-pago` call to mock. */
function mockReconnection(telefono = "", paymentMethodCached = false) {
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
  if (!paymentMethodCached) {
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  }
  wh()
    .intercept({ method: "POST", path: "/api/facturas/42/registrar-pago/" })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
  mockCustomerLookup([{ ...wisphubCustomer(telefono), estado: "Activo" }]);
}

async function seedChargeableStore() {
  const isp = await seedIsp({
    wisphubApiKey: "wh-key-1",
    serviceFeeCents: 1500,
    storeCommissionCents: 900,
  });
  const store = await seedStore(isp.id);
  return { isp, store };
}

const asStore = { headers: { Cookie: await sessionCookieHeader("5512345678") } };
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...asStore.headers },
  body: JSON.stringify(body),
});

/* One full charge with WispHub mocked end to end */
async function charge(body: Record<string, unknown>, telefono = "", paymentMethodCached = false) {
  mockCustomerLookup([wisphubCustomer(telefono)]);
  /* Always fresh: the charge guard never reads the display cache
     (provider-latency D3), which is what debt-truth D5 rests on. */
  mockPendingInvoices();
  mockReconnection(telefono, paymentMethodCached);
  return (await app()).request("/charges", post({ usuario: "greyes@wifiplus", ...body }), env);
}

describe("US-C07: the number is captured once and kept", () => {
  it("scenario 1: captured at the charge, the receipt links to the chat", async () => {
    await seedChargeableStore();
    const db = drizzle(env.DB);

    /* Before: nobody has a number, so the confirm screen must ask */
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    const quote = await (await app()).request("/charges/customers/greyes@wifiplus", asStore, env);
    expect((await quote.json()).data.customer.hasPhone).toBe(false);

    const res = await charge({ customerPhone: "5551234567" });
    expect(res.status).toBe(201);
    const { data } = await res.json();

    const [row] = await db.select().from(charges);
    expect(row.customerPhone).toBe("5551234567");

    /* The receipt is the whole point: it opens the customer's chat */
    const receipt = await (await app()).request(`/charges/${data.id}/receipt`, asStore, env);
    const body = (await receipt.json()).data;
    expect(body.phone).toBe("525551234567");
    expect(body.waLink).toContain("wa.me/525551234567");
  });

  it("scenario 2: the next charge already knows it, without asking again", async () => {
    await seedChargeableStore();
    const db = drizzle(env.DB);
    await charge({ customerPhone: "5551234567" });

    /* The quote no longer asks for a number... */
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    const quote = await (await app()).request("/charges/customers/greyes@wifiplus", asStore, env);
    expect((await quote.json()).data.customer.hasPhone).toBe(true);

    /* ...and the search says the same for the whole page */
    wh()
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/api/clientes/") && p.includes("nombre="),
      })
      .reply(...json({ count: 1, results: [wisphubCustomer()] }));
    /* No pending-list mock: the quote above just filled the display
       cache for this tenant (provider-latency D3). */
    const search = await (await app()).request("/charges/customers?q=Janely", asStore, env);
    expect((await search.json()).data.customers[0].hasPhone).toBe(true);

    /* A second charge that submits nothing still carries the phone */
    const res = await charge({}, "", true);
    expect(res.status).toBe(201);
    const rows = await db.select().from(charges);
    expect(rows).toHaveLength(2);
    expect(rows[1].customerPhone).toBe("5551234567");
  });

  it("scenario 5: a new number replaces the old one, and there is only ever one row", async () => {
    const { isp } = await seedChargeableStore();
    const db = drizzle(env.DB);
    await charge({ customerPhone: "5551234567" });
    await charge({ customerPhone: "5559998877" }, "", true);

    const contacts = await db.select().from(customerContacts);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      ispId: isp.id,
      wisphubCustomerId: "6",
      phone: "5559998877",
    });

    /* the correction applies from the next charge on */
    const res = await charge({}, "", true);
    const rows = await db.select().from(charges);
    expect(res.status).toBe(201);
    expect(rows[2].customerPhone).toBe("5559998877");
  });
});

describe("US-C07: WispHub wins, and the field is never required", () => {
  it("scenario 3: with a WispHub phone, a submitted number is ignored", async () => {
    await seedChargeableStore();
    const db = drizzle(env.DB);

    mockCustomerLookup([wisphubCustomer("5511122233")]);
    mockPendingInvoices();
    const quote = await (await app()).request("/charges/customers/greyes@wifiplus", asStore, env);
    expect((await quote.json()).data.customer.hasPhone).toBe(true);

    const res = await charge({ customerPhone: "5551234567" }, "5511122233");
    expect(res.status).toBe(201);

    const [row] = await db.select().from(charges);
    expect(row.customerPhone).toBe("5511122233");
    /* nothing of ours shadows the ISP's own data */
    expect(await db.select().from(customerContacts)).toHaveLength(0);
  });

  it("scenario 4: no number, no problem — the charge is recorded and the receipt opens the picker", async () => {
    await seedChargeableStore();
    const db = drizzle(env.DB);

    const res = await charge({});
    expect(res.status).toBe(201);
    const { data } = await res.json();

    const [row] = await db.select().from(charges);
    expect(row.customerPhone).toBeNull();
    expect(await db.select().from(customerContacts)).toHaveLength(0);

    const receipt = await (await app()).request(`/charges/${data.id}/receipt`, asStore, env);
    const body = (await receipt.json()).data;
    expect(body.phone).toBeNull();
    expect(body.waLink).toContain("wa.me/?text=");
  });

  it("scenario 6: a number that is not 10 digits is rejected before anything is recorded", async () => {
    await seedChargeableStore();
    const db = drizzle(env.DB);

    const res = await (await app()).request(
      "/charges",
      post({ usuario: "greyes@wifiplus", customerPhone: "55512" }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await db.select().from(charges)).toHaveLength(0);
    expect(await db.select().from(customerContacts)).toHaveLength(0);
  });
});

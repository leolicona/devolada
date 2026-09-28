import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { app, seedBusiness, seedMember, sessionCookieHeader } from "./helpers";
import { paymentLinks, wisphubPages, wisphubSweeps } from "../src/db/schema";
import { resetProviderCaches } from "../src/wisphub/cache";
import { pendingWindow, PENDING_LIVE_PAGES } from "../src/wisphub/client";
import { wisphubAt } from "../src/wisphub/factory";
import { debtOf } from "../src/wisphub/debt";
import { encodeReceivablesCursor } from "../src/wisphub/receivables";
import { providerCents } from "../src/money";
import { paymentRequestsResponse } from "../src/routes/payment-requests/schema";
import { customerDebtResponse, customersResponse } from "../src/routes/direct-payments/schema";

/* cobros-in-links — the API half of Por cobrar inside Links.

   US1: the business's open invoices, read live one block at a time
   through the integration's `receivables` capability (D1–D5, D18), and
   never from the sweep's copy (SC-006). The foundation it stands on is
   here too: the money helper that reads either shape (T003), the
   invoice row's three new details (T004) and the session naming what
   the integration can do (D13).
   US3: a search in the view asks the customers door for panel rows only
   (D8), then each result's debt from the `customerDebt` capability —
   two reads, one operation, the measured billing cycle never counted
   twice (D9, D10).
   US4: the integration away is an answer on both doors (D7, D9).

   WispHub is intercepted at its origin. The measured demo row of
   2026-09-23 is the fixture: `sub_total` 499, `saldo` 299, `total` 798. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const JSON_HEADERS = { headers: { "Content-Type": "application/json" } };

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(() => resetProviderCaches());
afterEach(() => fetchMock.assertNoPendingInterceptors());

const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const json = (body: unknown) => [200, JSON.stringify(body), JSON_HEADERS] as const;
/* What `AbortSignal.timeout` throws when the deadline fires — simulated,
   as provider-latency.test.ts does, rather than waited for */
const stalled = () => new DOMException("The operation was aborted", "TimeoutError");

const PERIOD_LINE = "Periodo del 15/Sept./2026 al 15/Oct./2026";

/* The measured demo row (2026-09-23): a 499.00 plan with 299.00 carried */
const measuredRow = (over: Record<string, unknown> = {}) => ({
  id_factura: 1042,
  cliente: { usuario: "greyes@wifiplus", nombre: "Janely" },
  sub_total: 499,
  saldo: 299,
  total: 798,
  fecha_emision: "2026-09-23",
  fecha_vencimiento: "2026-10-03",
  articulos: [
    { descripcion: `Plan de Internet: Plan 10M 499.00\r\n${PERIOD_LINE}\r\n`, precio: 499, cantidad: 1 },
  ],
  ...over,
});

const isInvoiceList = (p: string) => p.startsWith("/api/facturas/?") && p.includes("estado=1");
/* The exact `usuario=` filter. The mock agent sorts query parameters
   before it matches, so the filter is looked for anywhere in the query. */
const isRecordLookup = (p: string) => p.startsWith("/api/clientes/?") && /[?&]usuario=/.test(p);

/* One page of the invoice list. `calls` collects every path the
   provider was asked, so a test can count them and read what they
   carried. */
function mockInvoices(
  results: unknown[],
  opts: { next?: string | null; count?: number | null; calls?: string[] } = {},
) {
  const body: Record<string, unknown> = { next: opts.next ?? null, results };
  if (opts.count !== null) body.count = opts.count ?? results.length;
  wh()
    .intercept({ method: "GET", path: isInvoiceList })
    .reply(
      200,
      (req) => {
        opts.calls?.push(req.path);
        return body;
      },
      JSON_HEADERS,
    );
}

const asBusiness = async (email = "demo@devolada.app") => ({
  headers: { Cookie: await sessionCookieHeader(email) },
});
const getBlock = async (query = "", email?: string) =>
  (await app()).request(`/payment-requests${query}`, await asBusiness(email), env);

const params = (path: string) => new URL(path, WISPHUB_ORIGIN).searchParams;

/* ---- Foundation: the money helper, the row, the session ---- */

describe("cobros-in-links US1 (T003): one door for money in either shape", () => {
  it("a string and a JSON number both land in integer cents; unreadable input is null, never a throw", () => {
    expect(providerCents("299.00")).toBe(29900);
    expect(providerCents(299)).toBe(29900);
    expect(providerCents(499.5)).toBe(49950);
    expect(providerCents("-10.00")).toBe(-1000);
    /* A float that `* 100` would get wrong goes through the string parser */
    expect(providerCents(0.1 + 0.2)).toBe(30);
    for (const unreadable of ["abc", "", "4,99", Number.NaN, Infinity, null, undefined, {}, [1]]) {
      expect(providerCents(unreadable)).toBeNull();
    }
  });
});

describe("cobros-in-links US1 (T004): the invoice row carries its period and its saldo anterior", () => {
  const client = () => wisphubAt("wh-key-1", null, env);

  it("reads sub_total, the invoice's saldo and the period line from the measured row", async () => {
    mockInvoices([measuredRow()]);
    const page = await client().pendingInvoicesPage("/facturas/?estado=1&limit=10");
    expect(page.invoices).toEqual([
      {
        invoiceId: 1042,
        usuario: "greyes@wifiplus",
        customerName: "Janely",
        totalCents: 79800,
        invoiceDate: "2026-09-23",
        dueDate: "2026-10-03",
        periodCents: 49900,
        carriedCents: 29900,
        period: PERIOD_LINE,
      },
    ]);
    expect(page.total).toBe(1);
  });

  it("takes both money shapes: a string saldo and a number sub_total", async () => {
    mockInvoices([measuredRow({ saldo: "299.00", sub_total: 499 })]);
    const [row] = (await client().pendingInvoicesPage("/facturas/?estado=1")).invoices;
    expect(row.carriedCents).toBe(29900);
    expect(row.periodCents).toBe(49900);
  });

  it("an absent count is null, never a guess (FR-007)", async () => {
    mockInvoices([measuredRow()], { count: null });
    expect((await client().pendingInvoicesPage("/facturas/?estado=1")).total).toBeNull();
  });

  it("a row with no period line, or unreadable details, keeps its total and says null", async () => {
    mockInvoices([
      measuredRow({ articulos: [{ descripcion: "Reconexión" }], sub_total: "n/a", saldo: undefined }),
      measuredRow({ id_factura: 1043, articulos: null }),
    ]);
    const [first, second] = (await client().pendingInvoicesPage("/facturas/?estado=1")).invoices;
    expect(first).toMatchObject({ totalCents: 79800, period: null, periodCents: null, carriedCents: null });
    expect(second).toMatchObject({ totalCents: 79800, period: null });
  });

  it("the period match stops at the line's end, on the text measured 2026-09-27 (M3)", async () => {
    mockInvoices([
      measuredRow({
        articulos: [{ descripcion: "Plan de Internet: Plan 2M/1M 2.00\r\nPeriodo del 1/Oct./2026 al 31/Oct./2026\r\n" }],
      }),
    ]);
    const [row] = (await client().pendingInvoicesPage("/facturas/?estado=1")).invoices;
    expect(row.period).toBe("Periodo del 1/Oct./2026 al 31/Oct./2026");
  });

  it("debtOf over the same list is unchanged, byte for byte: the money path reads totalCents alone", async () => {
    mockInvoices([measuredRow(), measuredRow({ id_factura: 1043, total: 499, saldo: 0 })]);
    const { invoices } = await client().pendingInvoicesPage("/facturas/?estado=1");
    const stripped = invoices.map(({ periodCents: _p, carriedCents: _c, period: _t, ...rest }) => rest);
    const customer = { usuario: "greyes@wifiplus", carriedBalanceCents: 0 };
    const withDetails = debtOf(customer, { invoices, complete: true, source: "live" });
    const without = debtOf(customer, { invoices: stripped, complete: true, source: "live" });
    expect(JSON.stringify(withDetails)).toBe(JSON.stringify(without));
    expect(withDetails.totalCents).toBe(79800 + 49900);
  });
});

describe("cobros-in-links US1 (T045): the session says what the integration can do (D13)", () => {
  it("a business with a WispHub key reads both capabilities; one with no integration reads none", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    await seedBusiness({ email: "sin@isp.mx" });

    const connected = await (await app()).request("/auth/me", await asBusiness(), env);
    expect((await connected.json()).data.integrationCapabilities).toEqual(["receivables", "customerDebt"]);

    const bare = await (await app()).request("/auth/me", await asBusiness("sin@isp.mx"), env);
    expect((await bare.json()).data.integrationCapabilities).toEqual([]);
  });

  it("an integration row with no key is not connected, and can do nothing", async () => {
    await seedBusiness({ wisphubApiKey: null, reconnectionThresholdPercent: 80 });
    const res = await (await app()).request("/auth/me", await asBusiness(), env);
    expect((await res.json()).data.integrationCapabilities).toEqual([]);
  });
});

/* ---- US1: the Por cobrar list, one block at a time ---- */

describe("cobros-in-links US1: GET /payment-requests answers one live block (D1–D5)", () => {
  it("maps the block to the contract, in the provider's order, with the provider's count", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockInvoices(
      [
        measuredRow({ id_factura: 10, cliente: { usuario: "jacruz@wifiplus", nombre: "Juan" } }),
        measuredRow(),
        measuredRow({ id_factura: 7, cliente: { usuario: "aflores@wifiplus", nombre: null } }),
      ],
      { count: 193 },
    );

    const res = await getBlock();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    /* The fixture a component test would use is the contract's shape */
    expect(paymentRequestsResponse.safeParse(data).success).toBe(true);
    expect(data.results.map((r: { externalId: number }) => r.externalId)).toEqual([10, 1042, 7]);
    expect(data.results[1]).toEqual({
      externalId: 1042,
      customerUsuario: "greyes@wifiplus",
      customerName: "Janely",
      amountCents: 79800,
      invoiceDate: "2026-09-23",
      dueDate: "2026-10-03",
      periodCents: 49900,
      carriedCents: 29900,
      period: PERIOD_LINE,
    });
    expect(data.results[2].customerName).toBeNull();
    expect(data.total).toBe(193);
    expect(data.integration).toBe("ok");
    expect(data.nextCursor).toBeNull();
    /* D1: the whole-list fields are gone */
    expect(data).not.toHaveProperty("cobros");
    expect(data).not.toHaveProperty("complete");
    expect(data).not.toHaveProperty("readAt");
  });

  it("FR-004: the first block carries an explicit window — 180 days back, one day ahead — and the open filter", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const calls: string[] = [];
    mockInvoices([measuredRow()], { calls });
    const expected = pendingWindow(new Date());

    await getBlock();
    expect(calls).toHaveLength(1);
    const sent = params(calls[0]);
    expect(sent.get("estado")).toBe("1");
    expect(sent.get("tipo_fecha")).toBe("fecha_emision");
    expect(sent.get("desde")).toBe(expected.desde);
    expect(sent.get("hasta")).toBe(expected.hasta);
    const span = (Date.parse(sent.get("hasta")!) - Date.parse(sent.get("desde")!)) / 86_400_000;
    expect(span).toBe(181);
    expect(sent.get("offset")).toBe("0");
  });

  it("D4: limit is clamped to the Links band, 10–50", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const calls: string[] = [];
    mockInvoices([], { calls });
    mockInvoices([], { calls });
    mockInvoices([], { calls });

    await getBlock("?limit=3");
    await getBlock("?limit=500");
    await getBlock();
    expect(calls.map((p) => params(p).get("limit"))).toEqual(["10", "50", "20"]);
  });

  it("D2: nextCursor walks the provider's own next — offset from the provider, the window from the first block", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const calls: string[] = [];
    const { desde, hasta } = pendingWindow(new Date());
    mockInvoices([measuredRow()], {
      calls,
      count: 30,
      /* As measured 2026-09-27 (M1): absolute, every filter carried back */
      next: `http://api.wisphub.net/api/facturas/?desde=${desde}&estado=1&hasta=${hasta}&limit=20&offset=20&tipo_fecha=fecha_emision`,
    });
    const first = (await (await getBlock("?limit=20")).json()).data;
    expect(first.nextCursor).toEqual(expect.any(String));
    /* Opaque: the browser never holds a path */
    expect(first.nextCursor).not.toContain("facturas");
    expect(atob(first.nextCursor.replaceAll("-", "+").replaceAll("_", "/"))).not.toContain("/");

    mockInvoices([measuredRow({ id_factura: 999 })], { calls, count: 30 });
    const second = (await (await getBlock(`?limit=20&cursor=${first.nextCursor}`)).json()).data;
    expect(second.results[0].externalId).toBe(999);
    /* The walk ends where the provider's `next` is null */
    expect(second.nextCursor).toBeNull();

    const [a, b] = calls.map(params);
    expect(b.get("offset")).toBe("20");
    expect(b.get("limit")).toBe("20");
    expect(b.get("desde")).toBe(a.get("desde"));
    expect(b.get("hasta")).toBe(a.get("hasta"));
  });

  it("D2: the window stays fixed across blocks when the clock has crossed midnight since the first", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const calls: string[] = [];
    mockInvoices([measuredRow()], { calls });
    /* A walk that began yesterday: its cursor carries yesterday's window,
       and today's clock must not move it */
    const yesterday = pendingWindow(new Date(Date.now() - 86_400_000));
    const cursor = encodeReceivablesCursor({ ...yesterday, offset: 40, limit: 20 });

    const res = await getBlock(`?cursor=${cursor}`);
    expect(res.status).toBe(200);
    const sent = params(calls[0]);
    expect(sent.get("desde")).toBe(yesterday.desde);
    expect(sent.get("hasta")).toBe(yesterday.hasta);
    expect(sent.get("offset")).toBe("40");
  });

  it("D2: a cursor holding a path, a foreign prefix, a backwards window or junk is a VALIDATION_ERROR, and asks nothing", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const b64 = (plain: string) => btoa(plain).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const crafted = [
      /* a provider path the server would fetch with the business's key */
      b64("/facturas/?estado=2&limit=100"),
      b64("inv:/clientes/1/saldo/"),
      /* the customers door's own cursor — not one this door wrote */
      b64("wh:20"),
      /* desde after hasta */
      b64("inv:2026-09-01:2026-03-01:0:20"),
      /* a block larger than one call of the band */
      b64("inv:2026-03-01:2026-09-01:0:5000"),
      b64("inv:2026-03-01:2026-09-01:-20:20"),
      "%%%not-base64%%%",
      /* Review of 2026-09-28: a day the month does not have — Date.parse
         alone accepts it — and a window wider than the 181 days this
         adapter ever writes */
      b64("inv:2026-02-31:2026-03-01:0:20"),
      b64("inv:2025-01-01:2026-09-01:0:20"),
    ];
    for (const cursor of crafted) {
      const res = await getBlock(`?cursor=${encodeURIComponent(cursor)}`);
      expect(res.status, cursor).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("a limit that is not an integer answers VALIDATION_ERROR in the project envelope", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const res = await getBlock("?limit=abc");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("SC-006: with a finished snapshot that says otherwise, the door returns the live rows in exactly one provider call", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const db = drizzle(env.DB);
    const now = new Date();
    /* The sweep's copy of a large tenant, finished and served — every
       money path would read it (bug: pending-invoice-cap) */
    await db.insert(wisphubSweeps).values({
      businessId: business.id,
      kind: "pending",
      baseUrl: `${WISPHUB_ORIGIN}/api`,
      servedPassId: "pass-1",
      servedPages: PENDING_LIVE_PAGES + 2,
      servedStartedAt: now,
      servedFinishedAt: now,
      updatedAt: now,
    });
    await db.insert(wisphubPages).values({
      businessId: business.id,
      kind: "pending",
      passId: "pass-1",
      page: 0,
      rows: JSON.stringify([
        { invoiceId: 5555, usuario: "snapshot@wifiplus", customerName: "Del snapshot", totalCents: 100, invoiceDate: null, dueDate: null },
      ]),
      fetchedAt: now,
    });
    const calls: string[] = [];
    mockInvoices([measuredRow()], { calls });

    const { data } = await (await getBlock()).json();
    expect(calls).toHaveLength(1);
    expect(data.results.map((r: { externalId: number }) => r.externalId)).toEqual([1042]);
    expect(JSON.stringify(data)).not.toContain("snapshot@wifiplus");
  });

  it("every member reads, a viewer included (cobros-live D4)", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    await seedMember(business, "lectora@isp.mx", "viewer");
    mockInvoices([measuredRow()]);
    const res = await getBlock("", "lectora@isp.mx");
    expect(res.status).toBe(200);
    expect((await res.json()).data.results).toHaveLength(1);
  });
});

/* ---- US3: the search in Por cobrar ---- */

const customerRecord = (over: Record<string, unknown> = {}) => ({
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely Reyes",
  telefono: "5512345678",
  estado: "Activo",
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: { nombre: "Zona dia 15" },
  ...over,
});

describe("cobros-in-links US3: the customers door's panel-only search (D8)", () => {
  type Field = "nombre" | "apellido" | "usuario" | "telefono";
  const FIELDS: Field[] = ["nombre", "apellido", "usuario", "telefono"];

  function mockSearch(results: unknown[]) {
    for (const field of FIELDS) {
      wh()
        .intercept({ method: "GET", path: (p) => p.includes(`${field}__contains=`) })
        .reply(...json({ count: field === "nombre" ? results.length : 0, next: null, results: field === "nombre" ? results : [] }));
    }
  }

  async function seedWithApiLink(opts: { key?: string | null } = {}) {
    const business = await seedBusiness({
      wisphubApiKey: opts.key === undefined ? "wh-key-1" : opts.key,
      speiClabe: "646180157000000004",
      speiBank: "STP",
    });
    const db = drizzle(env.DB);
    /* An API link that matches the text «Jan»: the collections API made
       it, and it has no customer and no debt in WispHub */
    await db.insert(paymentLinks).values({
      businessId: business.id,
      token: "tokapijanet12345",
      source: "api",
      customerRef: "JAN-001",
      label: "Janet API",
      askCents: 10000,
    });
    /* A panel link the offline fallback can find by usuario */
    await db.insert(paymentLinks).values({
      businessId: business.id,
      token: "tokpaneljan12345",
      wisphubCustomerId: "6",
      customerUsuario: "janely@wifiplus",
    });
    return business;
  }

  const search = async (query: string) =>
    (await app()).request(`/direct-payments/customers${query}`, await asBusiness(), env);

  it("channel=panel leaves API links out of the first block and out of the matched floor", async () => {
    await seedWithApiLink();
    mockSearch([customerRecord({ usuario: "janely@wifiplus", nombre: "Janely" })]);
    const { data } = await (await search("?q=Jan&channel=panel")).json();
    expect(customersResponse.safeParse(data).success).toBe(true);
    expect(data.results.map((r: { channel: string }) => r.channel)).toEqual(["panel"]);
    expect(data.matched).toBe(1);
  });

  it("without channel, the same search still answers the API link, as today", async () => {
    await seedWithApiLink();
    mockSearch([customerRecord({ usuario: "janely@wifiplus", nombre: "Janely" })]);
    const { data } = await (await search("?q=Jan")).json();
    expect(data.results.map((r: { channel: string }) => r.channel).sort()).toEqual(["api", "panel"]);
    expect(data.matched).toBe(2);
  });

  it("channel=panel leaves API links out of the offline fallback too, and of its count", async () => {
    await seedWithApiLink();
    for (const field of FIELDS) {
      wh().intercept({ method: "GET", path: (p) => p.includes(`${field}__contains=`) }).replyWithError(stalled());
    }
    const { data } = await (await search("?q=jan&channel=panel")).json();
    expect(data.wisphub).toBe("unavailable");
    expect(data.results.map((r: { usuario: string | null }) => r.usuario)).toEqual(["janely@wifiplus"]);
    expect(data.matched).toBe(1);
  });

  it("channel=panel browses the provider's list and never walks the API phase", async () => {
    await seedWithApiLink();
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/?limit=") && p.includes("offset=0") })
      .reply(...json({ count: 1, next: null, results: [customerRecord()] }));
    const { data } = await (await search("?channel=panel")).json();
    expect(data.results.map((r: { channel: string }) => r.channel)).toEqual(["panel"]);
  });
});

describe("cobros-in-links US3: GET /direct-payments/customers/debt — what a result owes (D9, D10)", () => {
  const debt = async (usuario: string, email?: string) =>
    (await app()).request(
      `/direct-payments/customers/debt?usuario=${encodeURIComponent(usuario)}`,
      await asBusiness(email),
      env,
    );

  /* The two reads, in order. `calls` records the order they arrived in. */
  function mockRecord(record: unknown | null, calls?: string[]) {
    wh()
      .intercept({ method: "GET", path: isRecordLookup })
      .reply(
        200,
        (req) => {
          calls?.push(req.path);
          return { count: record ? 1 : 0, results: record ? [record] : [] };
        },
        JSON_HEADERS,
      );
  }
  function mockBalance(idServicio: number, facturas: unknown, calls?: string[], saldo = 0) {
    wh()
      .intercept({ method: "GET", path: `/api/clientes/${idServicio}/saldo/` })
      .reply(
        200,
        (req) => {
          calls?.push(req.path);
          return {
            username: "greyes@wifiplus",
            facturas,
            /* The door's own figure — ignored on purpose (FR-015) */
            saldo,
            url_pago: "http:///saldo/abc",
          };
        },
        JSON_HEADERS,
      );
  }

  it("the measured cycle: 299.00 carried before the billing run, 798.00 open after it — never 1,097.00", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });

    /* The day before the run: the invoice closed as Pagada, the
       remainder lives in the record, the door lists nothing — and says
       0, which is why its own figure is never read */
    mockRecord(customerRecord({ saldo: "299.00", estado_facturas: "Pagadas" }));
    mockBalance(6, []);
    const before = (await (await debt("greyes@wifiplus")).json()).data;
    expect(customerDebtResponse.safeParse(before).success).toBe(true);
    expect(before).toEqual({
      usuario: "greyes@wifiplus",
      state: "owes",
      totalCents: 29900,
      invoiceCents: 0,
      carriedBalanceCents: 29900,
      invoices: [],
    });

    /* After the run: the record is back to 0.00 and the new invoice
       holds 499.00 + 299.00 */
    mockRecord(customerRecord({ saldo: "0.00", estado_facturas: "Pendiente de Pago" }));
    mockBalance(6, [{ id: 1042, fecha_emision: "2026-09-23", fecha_vencimiento: "2026-10-03", total: 798.0 }], undefined, 798);
    const after = (await (await debt("greyes@wifiplus")).json()).data;
    expect(after).toEqual({
      usuario: "greyes@wifiplus",
      state: "owes",
      totalCents: 79800,
      invoiceCents: 79800,
      carriedBalanceCents: 0,
      invoices: [{ invoiceId: 1042, invoiceDate: "2026-09-23", dueDate: "2026-10-03", totalCents: 79800 }],
    });
    expect(after.totalCents).not.toBe(109700);
  });

  it("exactly two provider calls, in order: usuario= first, then the balance door with the FRESH id_servicio", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const calls: string[] = [];
    /* The record says 88 — a search row's cached id could have been
       anything; the fresh one is what the balance door is asked with */
    mockRecord(customerRecord({ id_servicio: 88 }), calls);
    mockBalance(88, [{ id: 7, fecha_emision: "2026-09-01", fecha_vencimiento: "2026-09-11", total: 499 }], calls);

    const { data } = await (await debt("greyes@wifiplus")).json();
    expect(data.state).toBe("owes");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("usuario=greyes%40wifiplus");
    expect(calls[1]).toBe("/api/clientes/88/saldo/");
  });

  it("an invoice older than 180 days counts: the balance door has no window (FR-017)", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockRecord(customerRecord());
    mockBalance(6, [{ id: 3, fecha_emision: "2025-11-01", fecha_vencimiento: "2025-11-11", total: 350 }]);
    const { data } = await (await debt("greyes@wifiplus")).json();
    expect(data).toMatchObject({ state: "owes", totalCents: 35000, invoices: [{ invoiceId: 3 }] });
  });

  it("a credit is netted against the open invoices, never shown as money (debt-truth D12)", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockRecord(customerRecord({ saldo: "-100.00" }));
    mockBalance(6, [{ id: 9, fecha_emision: "2026-09-01", fecha_vencimiento: null, total: 499 }]);
    const { data } = await (await debt("greyes@wifiplus")).json();
    expect(data).toMatchObject({ state: "owes", totalCents: 39900, invoiceCents: 39900, carriedBalanceCents: 0 });
  });

  it("none only when the zero is proven — a paid-up record with nothing open", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockRecord(customerRecord({ saldo: "0.00", estado_facturas: "Pagadas" }));
    mockBalance(6, []);
    const { data } = await (await debt("greyes@wifiplus")).json();
    expect(data).toEqual({
      usuario: "greyes@wifiplus",
      state: "none",
      totalCents: 0,
      invoiceCents: 0,
      carriedBalanceCents: 0,
      invoices: [],
    });
  });

  it("a credit larger than the invoices nets to a proven zero", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    mockRecord(customerRecord({ saldo: "-600.00" }));
    mockBalance(6, [{ id: 9, fecha_emision: "2026-09-01", fecha_vencimiento: null, total: 499 }]);
    const { data } = await (await debt("greyes@wifiplus")).json();
    expect(data).toMatchObject({ state: "none", totalCents: 0 });
  });

  describe("unconfirmed, a 200 with no amount, in four cases", () => {
    const expectUnconfirmed = async () => {
      const res = await debt("greyes@wifiplus");
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data).toEqual({ usuario: "greyes@wifiplus", state: "unconfirmed" });
      expect(data).not.toHaveProperty("totalCents");
    };

    it("a stalled customer read", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1" });
      wh().intercept({ method: "GET", path: isRecordLookup }).replyWithError(stalled());
      await expectUnconfirmed();
    });

    it("a stalled balance door", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1" });
      mockRecord(customerRecord());
      wh().intercept({ method: "GET", path: "/api/clientes/6/saldo/" }).replyWithError(stalled());
      await expectUnconfirmed();
    });

    it("an unreadable balance body", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1" });
      mockRecord(customerRecord());
      mockBalance(6, "not a list");
      await expectUnconfirmed();
      mockRecord(customerRecord());
      mockBalance(6, [{ id: 1, total: "mucho" }]);
      await expectUnconfirmed();
    });

    it("a customer who has vanished from WispHub", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1" });
      mockRecord(null);
      await expectUnconfirmed();
    });

    /* Review of 2026-09-28: answers that parse as JSON but cannot be read
       used to escape as a 500. The contract says an outage is never a
       5xx on this door — the row says Sin confirmar and the others keep
       working. */
    it("an answer of the wrong shape: a null invoice, a record body with no results, a balance the parser refuses", async () => {
      await seedBusiness({ wisphubApiKey: "wh-key-1" });
      mockRecord(customerRecord());
      mockBalance(6, [null]);
      await expectUnconfirmed();

      wh().intercept({ method: "GET", path: isRecordLookup }).reply(...json({ detail: "¿?" }));
      await expectUnconfirmed();

      mockRecord(customerRecord({ saldo: "1,299.00" }));
      await expectUnconfirmed();
    });
  });

  it("a refused key answers 503 INTEGRATION_AUTH_FAILED, and never carries the key", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-io" });
    wh()
      .intercept({ method: "GET", path: isRecordLookup })
      .reply(403, JSON.stringify({ detail: "Invalid API key" }), JSON_HEADERS);
    const res = await debt("greyes@wifiplus");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: { code: "INTEGRATION_AUTH_FAILED" } });
    expect(JSON.stringify(body)).not.toContain("wh-key-io");
  });

  it("no integration answers 409 NOT_CONFIGURED", async () => {
    await seedBusiness();
    const res = await debt("greyes@wifiplus");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_CONFIGURED");
  });

  it("a blank usuario is a 400 in the project envelope, and asks nothing", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    for (const query of ["?usuario=%20%20", "?usuario=", ""]) {
      const res = await (await app()).request(`/direct-payments/customers/debt${query}`, await asBusiness(), env);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ success: false, error: { code: "VALIDATION_ERROR" } });
    }
  });

  it("a viewer may read it: payments:read, like the customers door", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    await seedMember(business, "lectora@isp.mx", "viewer");
    mockRecord(customerRecord({ saldo: "299.00", estado_facturas: "Pagadas" }));
    mockBalance(6, []);
    const res = await debt("greyes@wifiplus", "lectora@isp.mx");
    expect(res.status).toBe(200);
    expect((await res.json()).data.totalCents).toBe(29900);
  });

  it("without a session the door is closed", async () => {
    const res = await (await app()).request("/direct-payments/customers/debt?usuario=greyes%40wifiplus", {}, env);
    expect(res.status).toBe(401);
  });
});

/* ---- Tenant isolation (constitution V) ----

   Review of 2026-09-28: every case above seeds one keyed business, and
   the interceptors match on the path alone, so a door that resolved the
   wrong business's integration would pass them all. Here two businesses
   are connected with different keys, and each interceptor answers only
   to its own key: a member of B must reach B's provider with B's key,
   and A's interceptor must be left untouched. */
describe("cobros-in-links US1, US3: each door asks the actor's own integration, with its own key", () => {
  const withKey = (key: string) => ({ headers: { Authorization: `Api-Key ${key}` } });

  async function twoBusinesses() {
    await seedBusiness({ wisphubApiKey: "wh-key-A" });
    await seedBusiness({ email: "b@isp.mx", wisphubApiKey: "wh-key-B" });
  }

  it("the Por cobrar block of business B is read with B's key, and shows only B's invoices", async () => {
    await twoBusinesses();
    wh()
      .intercept({ method: "GET", path: isInvoiceList, ...withKey("wh-key-B") })
      .reply(...json({ next: null, count: 1, results: [measuredRow({ id_factura: 2001, cliente: { usuario: "de-b@isp", nombre: "De B" } })] }));

    const { data } = await (await getBlock("", "b@isp.mx")).json();
    expect(data.results.map((r: { externalId: number }) => r.externalId)).toEqual([2001]);
  });

  it("the debt door of business B reads the record and the balance with B's key", async () => {
    await twoBusinesses();
    wh()
      .intercept({ method: "GET", path: isRecordLookup, ...withKey("wh-key-B") })
      .reply(...json({ count: 1, results: [customerRecord({ usuario: "de-b@isp", id_servicio: 77, saldo: "150.00", estado_facturas: "Pagadas" })] }));
    wh()
      .intercept({ method: "GET", path: "/api/clientes/77/saldo/", ...withKey("wh-key-B") })
      .reply(...json({ username: "de-b@isp", facturas: [], saldo: 0 }));

    const res = await (await app()).request(
      "/direct-payments/customers/debt?usuario=de-b%40isp",
      await asBusiness("b@isp.mx"),
      env,
    );
    expect((await res.json()).data).toMatchObject({ state: "owes", totalCents: 15000 });
  });
});

/* ---- US4: the integration away is never "nobody owes" ---- */

describe("cobros-in-links US4: GET /payment-requests when the integration is away (D7)", () => {
  const UNAVAILABLE = { results: [], nextCursor: null, total: null, integration: "unavailable" };

  it("a stalled first block answers 200 unavailable — never an empty 'ok'", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    wh().intercept({ method: "GET", path: isInvoiceList }).replyWithError(stalled());
    const res = await getBlock();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(UNAVAILABLE);
  });

  it("a failing first block (a 500) answers the same", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    wh().intercept({ method: "GET", path: isInvoiceList }).reply(500, "boom");
    expect((await (await getBlock()).json()).data).toEqual(UNAVAILABLE);
  });

  it("a body that is not the list's shape is weather too", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    wh().intercept({ method: "GET", path: isInvoiceList }).reply(...json({ detail: "¿?" }));
    expect((await (await getBlock()).json()).data).toEqual(UNAVAILABLE);
  });

  it("a later block failing answers the same, and the earlier blocks stay the client's", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const { desde, hasta } = pendingWindow(new Date());
    mockInvoices([measuredRow()], {
      next: `http://api.wisphub.net/api/facturas/?desde=${desde}&estado=1&hasta=${hasta}&limit=20&offset=20&tipo_fecha=fecha_emision`,
    });
    const first = (await (await getBlock()).json()).data;
    expect(first.results).toHaveLength(1);

    wh().intercept({ method: "GET", path: isInvoiceList }).replyWithError(stalled());
    const second = (await (await getBlock(`?cursor=${first.nextCursor}`)).json()).data;
    expect(second).toEqual(UNAVAILABLE);
  });

  it("a refused key answers 503 INTEGRATION_AUTH_FAILED — setup, not weather — and never carries the key", async () => {
    await seedBusiness({ wisphubApiKey: "wh-key-io" });
    wh()
      .intercept({ method: "GET", path: isInvoiceList })
      .reply(403, JSON.stringify({ detail: "Invalid API key" }), JSON_HEADERS);
    const res = await getBlock();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: { code: "INTEGRATION_AUTH_FAILED" } });
    expect(JSON.stringify(body)).not.toContain("wh-key-io");
  });

  it("no integration answers 409 NOT_CONFIGURED, and asks nothing", async () => {
    await seedBusiness();
    const res = await getBlock();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_CONFIGURED");
  });

  it("an integration row with no key is not connected: 409", async () => {
    await seedBusiness({ wisphubApiKey: null, reconnectionThresholdPercent: 80 });
    expect((await getBlock()).status).toBe(409);
  });
});

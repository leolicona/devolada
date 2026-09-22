import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { paymentLinks } from "../src/db/schema";
import { decodeCursor } from "../src/routes/direct-payments/cursor";
import { app, seedBusiness, sessionCookieHeader } from "./helpers";

/* links-on-demand-search US1: the page asks for one screenful instead of
   reading a customer base.

   What this file proves is the door's half of that sentence: a browse is
   ONE provider call for ONE block and it says how many customers exist
   (FR-001, FR-018, FR-020); a search is four `__contains` filters asked
   at once and merged (FR-003, FR-005, D4); the number it reports is a
   floor rather than a total (FR-006, D5); the cursor carries which
   source the walk is in (D2); and a test link never reaches a
   business-facing read (FR-017). */

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

/* The browse block: `limit` and `offset`, which is all the provider
   offers to page by (D3, D6) */
function mockBlock(results: unknown[], count = results.length, match?: (path: string) => boolean) {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/clientes/") && p.includes("offset=") && (match?.(p) ?? true),
    })
    .reply(...json({ count, next: null, results }));
}

type Field = "nombre" | "apellido" | "usuario" | "telefono";
const FIELDS: Field[] = ["nombre", "apellido", "usuario", "telefono"];

/* All four filters answer, always — the saved call is not worth the
   guess that `bug: customer-lookup-misses` is (D4) */
function mockSearch(answers: Partial<Record<Field, { results: unknown[]; count?: number }>>) {
  for (const field of FIELDS) {
    const answer = answers[field] ?? { results: [] };
    fetchMock
      .get(WISPHUB_ORIGIN)
      .intercept({ method: "GET", path: (p) => p.includes(`${field}__contains=`) })
      .reply(...json({ count: answer.count ?? answer.results.length, next: null, results: answer.results }));
  }
}

const asBusiness = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };
const read = async (query = "") =>
  (await app()).request(`/direct-payments/customers${query}`, asBusiness, env);

const apiLink = async (businessId: string, over: Record<string, unknown> = {}) => {
  const [row] = await drizzle(env.DB)
    .insert(paymentLinks)
    .values({
      businessId,
      token: `tok${crypto.randomUUID().replace(/-/g, "").slice(0, 13)}`,
      source: "api",
      customerRef: "CLI-4471",
      askCents: 49900,
      label: "Ana Ruiz",
      ...over,
    })
    .returning();
  return row;
};

describe("US1: the browse is one block, not a customer base", () => {
  it("answers the first block live and says how many customers the ISP has", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    mockBlock([customer()], 6513);

    const res = await read("?limit=10");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      channel: "panel",
      usuario: "greyes@wifiplus",
      wisphubId: 6,
      name: "Janely Reyes",
      phone: "5512345678",
    });
    /* FR-018: never "la lista puede estar incompleta" — the count the
       provider answers with every block, instead */
    expect(data.total).toBe(6513);
    expect(data.matched).toBeNull();
    expect(data.wisphub).toBe("ok");
    /* More to walk: the cursor is where the next block starts */
    expect(decodeCursor(data.nextCursor)).toEqual({ phase: "wisphub", offset: 1 });
  });

  it("a customer with no link yet still comes back, with nothing to copy yet (FR-008, D7)", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    mockBlock([customer()]);

    const { data } = await (await read()).json();
    expect(data.results[0]).toMatchObject({ hasLink: false, url: null, waLink: null });
    /* Reading created nothing: SC-009 in one assertion */
    expect(await drizzle(env.DB).select().from(paymentLinks)).toHaveLength(0);
  });

  it("a customer who already has one carries it, and it is not replaced (FR-005, FR-009)", async () => {
    const business = await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    await drizzle(env.DB)
      .insert(paymentLinks)
      .values({
        businessId: business.id,
        token: "tok-greyes-known",
        wisphubCustomerId: "6",
        customerUsuario: "greyes@wifiplus",
      });
    mockBlock([customer()]);

    const { data } = await (await read()).json();
    expect(data.results[0]).toMatchObject({
      hasLink: true,
      url: expect.stringContaining("/p/tok-greyes-known"),
      waLink: expect.stringContaining("wa.me/525512345678"),
    });
  });

  it("walks Devolada's own links first and crosses into WispHub in the same block (D2)", async () => {
    const business = await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    await apiLink(business.id, { customerRef: "CLI-1" });
    await apiLink(business.id, { customerRef: "CLI-2" });
    mockBlock([customer()], 1);

    const { data } = await (await read("?limit=10")).json();
    expect(data.results.map((r: { channel: string }) => r.channel)).toEqual(["api", "api", "panel"]);
    expect(data.results[0]).toMatchObject({ channel: "api", customerRef: "CLI-1", usuario: null, hasLink: true });
    /* The provider's list is exhausted, so the walk is over */
    expect(data.nextCursor).toBeNull();
  });

  it("the cursor carries its phase: a block that ends inside the API links says so (D2)", async () => {
    const business = await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    await apiLink(business.id, { customerRef: "CLI-1" });
    await apiLink(business.id, { customerRef: "CLI-2" });
    await apiLink(business.id, { customerRef: "CLI-3" });

    /* limit is clamped up to ten, and three API links do not fill it —
       so this asks for the block with the API phase already drained */
    mockBlock([], 0);
    const { data } = await (await read("?limit=2")).json();
    expect(data.results).toHaveLength(3);

    /* With a block the API links cannot fill, the walk crosses over and
       the cursor is the provider's offset */
    expect(data.nextCursor).toBeNull();
  });

  it("clamps the block to what one provider call may cost (D3)", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    /* The ceiling: a client asking for 500 is asked for 50 */
    mockBlock([customer()], 1, (p) => p.includes("limit=50"));
    expect((await read("?limit=500")).status).toBe(200);

    /* The floor: a client asking for 1 is asked for 10, so a tall screen
       does not pay four round trips to fill itself */
    mockBlock([customer()], 1, (p) => p.includes("limit=10"));
    expect((await read("?limit=1")).status).toBe(200);
  });

  it("refuses a cursor it did not write, rather than guessing at it (D2)", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    const res = await read("?cursor=not-a-cursor");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("US1: a search asks four filters at once", () => {
  it("merges the four answers, dedupes by identity, and reports the largest count as a floor (D4, D5, D6)", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    const other = customer({ id_servicio: 7, usuario: "mlopez@wifiplus", nombre: "María López" });
    mockSearch({
      /* The same customer answered by two filters is one row */
      nombre: { results: [other], count: 904 },
      apellido: { results: [other], count: 12 },
      telefono: { results: [customer()], count: 3 },
    });

    const { data } = await (await read("?q=mar&limit=50")).json();
    expect(data.results.map((r: { usuario: string }) => r.usuario)).toEqual([
      "mlopez@wifiplus",
      "greyes@wifiplus",
    ]);
    /* D5: the union of four filters cannot be sized without fetching all
       four whole, so the page says "más de 904", never "904" as a total */
    expect(data.matched).toBe(904);
    /* D5: a search answers one block and no cursor */
    expect(data.nextCursor).toBeNull();
    expect(data.total).toBeNull();
  });

  it("finds an API link by its reference and by its label, which no provider filter can (FR-003)", async () => {
    const business = await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    await apiLink(business.id, { customerRef: "CLI-4471", label: "Ana Ruiz" });
    mockSearch({});

    const byRef = await (await read("?q=4471")).json();
    expect(byRef.data.results).toHaveLength(1);
    expect(byRef.data.results[0]).toMatchObject({ channel: "api", customerRef: "CLI-4471", askCents: 49900 });

    /* FR-004: case and accents are ignored on Devolada's side too */
    mockSearch({});
    const byLabel = await (await read("?q=ANA%20RU")).json();
    expect(byLabel.data.results).toHaveLength(1);
  });

  it("refuses under three characters and asks the provider nothing (FR-002)", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    const res = await read("?q=ma");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("a box holding only spaces is not a search — it browses (Edge Cases)", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    mockBlock([customer()], 1);

    const { data } = await (await read("?q=%20%20%20")).json();
    expect(data.matched).toBeNull();
    expect(data.total).toBe(1);
  });

  it("a business with no WispHub searches its own links and is told so (FR-015)", async () => {
    const business = await seedBusiness({ ...SPEI });
    await apiLink(business.id, { customerRef: "CLI-4471", label: "Ana Ruiz" });

    const { data } = await (await read("?q=ana")).json();
    expect(data.wisphub).toBe("not_configured");
    expect(data.results).toHaveLength(1);
    expect(data.results[0].channel).toBe("api");
  });
});

/* automated-collections-api D12 (FR-035), carried into FR-017: a test
   credential's links EXIST — the caller polls them through /v1 — and
   reach no business-facing read. */
describe("US1 (FR-017): a test link never reaches the panel", () => {
  it("is absent from a browse and from a search alike", async () => {
    const business = await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    await apiLink(business.id, { customerRef: "CLI-REAL", label: "Ana Ruiz" });
    await apiLink(business.id, { customerRef: "CLI-TEST", label: "Ana Ruiz", isTest: true });

    mockBlock([], 0);
    const browsed = await (await read()).json();
    expect(browsed.data.results.map((r: { customerRef: string }) => r.customerRef)).toEqual(["CLI-REAL"]);

    mockSearch({});
    const searched = await (await read("?q=ana")).json();
    expect(searched.data.results.map((r: { customerRef: string }) => r.customerRef)).toEqual(["CLI-REAL"]);
  });
});

import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { paymentLinks } from "../src/db/schema";
import { app, seedBusiness, sessionCookieHeader } from "./helpers";

/* links-on-demand-search US3: the search keeps working when WispHub
   does not.

   D10 in one file. A provider outage is an ANSWER — `success: true`,
   `wisphub: "unavailable"`, and whatever Devolada itself holds — never
   a 503 and never an error block (FR-014). A business that never
   connected WispHub gets the same shape under `"not_configured"`
   (FR-015, constitution VIII).

   Two things stay failures, deliberately. A REJECTED key is a setup
   problem the ISP must fix, not weather to ride out, and keeps its 503
   (`bug: links-refused-key`). And the ACT still fails when the provider
   is silent: a link created from a stale identity would be a link to
   the wrong person (D8). */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const SPEI = { speiClabe: "646180157000000004", speiBank: "STP" };

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const json = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

/* The provider answers nothing at all: every call this request makes
   dies the way a stall does. `.persist()` because a search is four. */
function mockOutage() {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") })
    .replyWithError(new Error("connection reset"))
    .persist();
}

function mockRefusal() {
  fetchMock
    .get(WISPHUB_ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") })
    .reply(403, JSON.stringify({ detail: "forbidden" }), {
      headers: { "Content-Type": "application/json" },
    })
    .persist();
}

const asBusiness = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };
const read = async (query = "") =>
  (await app()).request(`/direct-payments/customers${query}`, asBusiness, env);

const apiLink = (businessId: string, over: Record<string, unknown> = {}) =>
  drizzle(env.DB)
    .insert(paymentLinks)
    .values({
      businessId,
      token: `tok${crypto.randomUUID().replace(/-/g, "").slice(0, 13)}`,
      source: "api",
      customerRef: "CLI-4471",
      askCents: 49900,
      label: "Ana Ruiz",
      ...over,
    });

const panelLink = (businessId: string, usuario: string, token: string) =>
  drizzle(env.DB)
    .insert(paymentLinks)
    .values({ businessId, token, wisphubCustomerId: "6", customerUsuario: usuario });

describe("US3: a provider that does not answer is an answer", () => {
  it("a search answers 200 with what Devolada holds, and says the provider is away (FR-014)", async () => {
    const business = await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    await apiLink(business.id, { customerRef: "CLI-ANA", label: "Ana Ruiz" });
    mockOutage();

    const res = await read("?q=ana");
    /* Never a 503, never an error block */
    expect(res.status).toBe(200);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(data.wisphub).toBe("unavailable");
    expect(data.results.map((r: { customerRef: string }) => r.customerRef)).toEqual(["CLI-ANA"]);
    fetchMock.get(WISPHUB_ORIGIN).cleanMocks();
  });

  it("FR-006: more stored links match than fit in a block, and the count says so", async () => {
    const business = await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    /* Twenty-five customers whose usuario carries "mar" — more than the
       ten-row block below can hold */
    for (let i = 0; i < 25; i++) {
      await panelLink(business.id, `mar${i}@wifiplus`, `tok-mar-${String(i).padStart(4, "0")}0`);
    }
    mockOutage();

    const first = await (await read("?q=mar&limit=10")).json();
    expect(first.data.wisphub).toBe("unavailable");
    expect(first.data.results).toHaveLength(10);
    /* The number the operator decides on: how many MATCHED, not how
       many were shown. With the provider away this is EXACT — what
       Devolada holds is all there is to count, and the note already
       says what cannot be asked (D5, amended 2026-09-23). */
    expect(first.data.matched).toBe(25);

    /* FR-006: and every one of them is reachable by scrolling, with the
       provider away exactly as with it there */
    expect(first.data.nextCursor).toBeTruthy();
    const second = await (
      await read(`?q=mar&limit=10&cursor=${encodeURIComponent(first.data.nextCursor)}`)
    ).json();
    expect(second.data.results).toHaveLength(10);
    const third = await (
      await read(`?q=mar&limit=10&cursor=${encodeURIComponent(second.data.nextCursor)}`)
    ).json();
    expect(third.data.results).toHaveLength(5);
    /* Twenty-five walked, and the walk says it is done */
    expect(third.data.nextCursor).toBeNull();

    const walked = [...first.data.results, ...second.data.results, ...third.data.results];
    expect(new Set(walked.map((r: { usuario: string }) => r.usuario)).size).toBe(25);
    fetchMock.get(WISPHUB_ORIGIN).cleanMocks();
  });

  it("the customer whose link Devolada holds is still findable by usuario (FR-003, US3 scenario)", async () => {
    const business = await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    await panelLink(business.id, "greyes@wifiplus", "tok-greyes-held");
    mockOutage();

    const { data } = await (await read("?q=greyes")).json();
    expect(data.wisphub).toBe("unavailable");
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      channel: "panel",
      usuario: "greyes@wifiplus",
      hasLink: true,
      url: expect.stringContaining("/p/tok-greyes-held"),
      /* FR-010: the row stores nothing about the person, so the door
         has no name to give — the browser fills it from what it saw
         minutes ago (FR-021) */
      name: null,
      phone: null,
    });
    /* No phone to dial without the provider: WhatsApp's own picker */
    expect(data.results[0].waLink).toContain("wa.me/?text=");
    fetchMock.get(WISPHUB_ORIGIN).cleanMocks();
  });

  it("a browse answers the same way: what the walk already had, and the note", async () => {
    const business = await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    await apiLink(business.id, { customerRef: "CLI-1" });
    mockOutage();

    const { data } = await (await read()).json();
    expect(data.wisphub).toBe("unavailable");
    expect(data.results.map((r: { customerRef: string }) => r.customerRef)).toEqual(["CLI-1"]);
    /* The walk stops where the provider stopped answering */
    expect(data.nextCursor).toBeNull();
    expect(data.total).toBeNull();
    fetchMock.get(WISPHUB_ORIGIN).cleanMocks();
  });

  it("a business with no key is the same shape under `not_configured` (FR-015)", async () => {
    const business = await seedBusiness({ ...SPEI });
    await apiLink(business.id, { customerRef: "CLI-ANA", label: "Ana Ruiz" });

    const browsed = await (await read()).json();
    expect(browsed.data.wisphub).toBe("not_configured");
    expect(browsed.data.results).toHaveLength(1);

    const searched = await (await read("?q=ana")).json();
    expect(searched.data.wisphub).toBe("not_configured");
    expect(searched.data.results).toHaveLength(1);
  });
});

/* bug: links-refused-key — the distinction this feature must not lose */
describe("US3: a refused key is still a 503, because it is setup and not weather", () => {
  it("answers WISPHUB_AUTH_FAILED with 503, on a search and on a browse alike", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    mockRefusal();

    const searched = await read("?q=ana");
    expect(searched.status).toBe(503);
    expect((await searched.json()).error.code).toBe("WISPHUB_AUTH_FAILED");

    const browsed = await read();
    expect(browsed.status).toBe(503);
    expect((await browsed.json()).error.code).toBe("WISPHUB_AUTH_FAILED");
    fetchMock.get(WISPHUB_ORIGIN).cleanMocks();
  });
});

describe("US3: the act still fails when the provider is silent (D8)", () => {
  it("a link is never created from an identity nobody could confirm", async () => {
    await seedBusiness({ ...SPEI, wisphubApiKey: "wh-key-1" });
    mockOutage();

    const res = await (await app()).request(
      "/direct-payments/links",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5174",
          Cookie: await sessionCookieHeader("demo@devolada.app"),
        },
        body: JSON.stringify({ usuario: "greyes@wifiplus" }),
      },
      env,
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("WISPHUB_UNAVAILABLE");
    expect(await drizzle(env.DB).select().from(paymentLinks)).toHaveLength(0);
    fetchMock.get(WISPHUB_ORIGIN).cleanMocks();
  });
});
